package com.yadbin.teacher

import com.yadbin.teacher.core.utils.Edu
import com.yadbin.teacher.domain.models.ActivityDetail
import com.yadbin.teacher.domain.models.ActivityDraft
import com.yadbin.teacher.domain.models.ClassDetail
import com.yadbin.teacher.domain.models.DashboardResponse
import com.yadbin.teacher.domain.models.DraftResponse
import com.yadbin.teacher.domain.models.EducationalProfile
import com.yadbin.teacher.domain.models.RecommendationsResponse
import com.yadbin.teacher.domain.models.toPrefill
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

/** v1.2 contract + compatibility: old payloads (no age/grade fields) must still parse; new payloads expose the new data. */
class V12ModelsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun old_class_payload_without_v12_fields_still_parses() {
        val d = json.decodeFromString(ClassDetail.serializer(), """
          {"class":{"id":"c1","name":"سوم الف","grade":"سوم","schoolName":null,"createdAt":"2026-01-01"},
           "students":[{"id":"s1","name":"علی","completedActivities":0}],
           "activities":[{"id":"a1","gameType":"memory","difficultyMode":"adaptive","questionCount":10,"status":"active"}]}""")
        assertNull(d.cls.gradeCode); assertNull(d.cls.ageMin)
        assertNull(d.students.single().age); assertNull(d.students.single().gradeCode)
        assertNull(d.activities.single().level); assertTrue(d.activities.single().skillLabels.isEmpty())
    }

    @Test fun v12_class_and_student_fields_parse() {
        val d = json.decodeFromString(ClassDetail.serializer(), """
          {"class":{"id":"c1","name":"ششم ب","grade":"ششم ابتدایی","gradeCode":"g6","gradeLabel":"ششم ابتدایی","ageMin":11,"ageMax":12},
           "students":[{"id":"s1","name":"سارا","age":11,"ageApproximate":true,"gradeCode":"g6","gradeLabel":"ششم ابتدایی","gender":"female","note":"x"}],
           "activities":[{"id":"a1","gameType":"attention","difficultyMode":"medium","questionCount":8,"status":"active","level":"intermediate","levelLabel":"متوسط","skillLabels":["توجه"],"gradeMinLabel":"چهارم ابتدایی","gradeMaxLabel":"ششم ابتدایی"}]}""")
        assertEquals("g6", d.cls.gradeCode); assertEquals(11, d.cls.ageMin)
        val s = d.students.single(); assertEquals(11, s.age); assertTrue(s.ageApproximate)
        assertEquals("چهارم ابتدایی تا ششم ابتدایی", Edu.gradeRange(d.activities.single().gradeMinLabel, d.activities.single().gradeMaxLabel))
    }

    @Test fun activity_detail_carries_advisory_fit_and_old_servers_default_to_unknown() {
        val withFit = json.decodeFromString(ActivityDetail.serializer(), """
          {"activity":{"id":"a1","classId":"c1","gameType":"memory","difficultyMode":"easy","questionCount":5,"status":"active","hasSuitabilityRange":true},
           "students":[{"studentId":"s1","name":"علی","token":"T","url":"u","status":"pending","fit":"out_of_range","fitLabel":"خارج از محدوده پیشنهادی","fitReasons":["پایه پایین‌تر از محدوده است."]}]}""")
        assertTrue(withFit.activity.hasSuitabilityRange)
        assertEquals("out_of_range", withFit.students.single().fit)
        val old = json.decodeFromString(ActivityDetail.serializer(), """
          {"activity":{"id":"a1","classId":"c1","gameType":"memory","difficultyMode":"easy","questionCount":5,"status":"active"},
           "students":[{"studentId":"s1","name":"علی","token":"T","url":"u","status":"pending"}]}""")
        assertFalse(old.activity.hasSuitabilityRange)
        assertEquals("unknown", old.students.single().fit)
    }

    @Test fun profile_and_recommendations_parse() {
        val p = json.decodeFromString(EducationalProfile.serializer(), """
          {"student":{"id":"s1","name":"سارا","age":8,"ageApproximate":false,"gradeCode":"g2","gradeLabel":"دوم ابتدایی"},"completedActivities":4,"lastActivityAt":"2026-09-01T10:00:00.000Z",
           "skills":[{"skill":"memory","label":"حافظه","game":"memory","status":"good","statusLabel":"خوب","sufficientData":true,"sessionCount":3},
                     {"skill":"attention","label":"توجه","game":"attention","status":"needs_practice","statusLabel":"نیاز به تمرین بیشتر","sufficientData":true,"sessionCount":3}],
           "summary":{"text":"در ۵ فعالیت اخیر ...","basedOn":5},"notice":"تشخیص پزشکی نیست"}""")
        assertEquals(2, p.skills.size); assertEquals("needs_practice", p.skills[1].status)
        val r = json.decodeFromString(RecommendationsResponse.serializer(), """
          {"student":{"id":"s1"},"recommendations":[{"rank":1,"basis":"needs_practice","skill":"attention","skillLabel":"توجه","gameType":"attention","level":"introductory","levelLabel":"مقدماتی",
            "difficultyMode":"easy","templateId":"attention-find-target","templateTitle":"پیدا کردن هدف","fit":"suitable","text":"برای فعالیت بعدی، تمرین توجه با سطح مقدماتی پیشنهاد می‌شود.","reason":"...","prefill":{"a":1}}],
           "requiresTeacherApproval":true,"notice":"n"}""")
        assertTrue(r.requiresTeacherApproval); assertEquals("attention-find-target", r.recommendations.single().templateId)
    }

    @Test fun ai_draft_is_only_a_draft_and_converts_to_an_editable_prefill() {
        val r = json.decodeFromString(DraftResponse.serializer(), """
          {"draft":{"title":"حافظه تصویری — دوم ابتدایی","educationalGoal":"تقویت حافظه","description":"d","gameType":"memory","difficultyMode":"easy","stages":1,"questionCount":5,"suggestedMinutes":5,
            "level":"introductory","levelLabel":"مقدماتی","skills":["memory"],"skillLabels":["حافظه"],"gradeMin":"g2","gradeMax":"g2","ageMin":7,"ageMax":9,"templateId":"memory-visual-intro"},
           "alternatives":[],"source":"rules","created":false,"requiresTeacherApproval":true,"notice":"فقط پیشنهاد"}""")
        val d: ActivityDraft = r.draft
        val p = d.toPrefill()
        assertEquals("memory", p.gameType); assertEquals(5, p.questionCount); assertEquals(listOf("memory"), p.skills)
        assertEquals("g2", p.gradeMin); assertNull("a draft is never tied to a student by itself", p.studentId)
    }

    @Test fun dashboard_has_counts_and_distributions_only() {
        val d = json.decodeFromString(DashboardResponse.serializer(), """
          {"classes":[{"id":"c1","name":"ششم","gradeCode":"g6","gradeLabel":"ششم ابتدایی","studentCount":20,"activityCount":2,"assigned":40,"completed":30,"completionRate":0.75,
            "skills":[{"skill":"memory","label":"حافظه","game":"memory","distribution":{"good":10,"average":5,"needs_practice":3,"insufficient":2}}]}],
           "activities":[],"totals":{"classes":1,"activities":2,"assigned":40,"completed":30},"notice":"n"}""")
        assertEquals(3, d.classes.single().skills.single().distribution.needs_practice)
        assertEquals(30, d.totals.completed)
    }

    @Test fun catalog_labels_and_fit_text() {
        assertEquals("سوم ابتدایی", Edu.gradeLabel("g3")); assertEquals("مقدماتی", Edu.levelLabel("introductory"))
        assertEquals("حافظه", Edu.skillLabel("memory")); assertEquals("مناسب", Edu.fitLabel("suitable"))
        assertEquals("خارج از محدوده پیشنهادی", Edu.fitLabel("out_of_range"))
        assertEquals(13, Edu.grades.size)
        assertNull(Edu.ageRange(null, null))
    }
}
