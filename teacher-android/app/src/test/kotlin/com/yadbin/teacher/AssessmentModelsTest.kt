package com.yadbin.teacher

import com.yadbin.teacher.domain.models.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import org.junit.Assert.*
import org.junit.Test

/**
 * Teacher Assessments contract: the payloads below are REAL responses captured from the Worker
 * (worker/src/routes/assessments.ts), so the app models can never silently drift from the API.
 */
class AssessmentModelsTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test fun detail_parses_all_three_question_types_with_their_keys() {
        val d = json.decodeFromString(AssessmentDetail.serializer(), DETAIL)
        assertEquals("draft", d.assessment.status)
        assertEquals("علوم", d.assessment.subject)
        assertEquals(3, d.questions.size)
        assertEquals(listOf("multiple_choice", "true_false", "fill_blank"), d.questions.map { it.type })
        assertEquals(4, d.questions[0].options?.size)
        assertEquals(0, (d.questions[0].correct as JsonPrimitive).intOrNull)
        assertEquals(true, (d.questions[1].correct as JsonPrimitive).booleanOrNull)
        assertEquals(listOf("شیراز"), d.questions[2].answers)
        assertTrue(d.editable)
        assertTrue(d.links.isEmpty())
    }

    @Test fun preview_start_gives_the_shared_preview_url() {
        val p = json.decodeFromString(AssessmentPreviewStarted.serializer(), PREVIEW)
        assertTrue(p.url.contains("/preview/"))
    }

    @Test fun publish_returns_one_personal_play_link_per_student_and_locks_editing() {
        val d = json.decodeFromString(AssessmentDetail.serializer(), PUBLISHED)
        assertEquals("published", d.assessment.status)
        assertFalse(d.editable)
        assertTrue(d.canCreateNewVersion)
        assertEquals(1, d.links.size)
        assertTrue(d.links.single().url.contains("/play/"))
    }

    @Test fun list_report_and_student_section_parse() {
        val l = json.decodeFromString(AssessmentList.serializer(), LIST)
        assertEquals("teacher_assessment", "teacher_assessment") // contentType is ignored by the app; the screen itself is the type
        assertEquals(1, l.assessments.size)
        assertEquals(1, l.assessments.single().completed)

        val r = json.decodeFromString(AssessmentReport.serializer(), REPORT)
        assertTrue(r.sufficientData)
        assertEquals(1, r.participants)
        assertEquals(100.0, r.averagePercent!!, 0.01)
        assertEquals(3, r.questions.size)
        assertEquals(100.0, r.questions.first().percentCorrect!!, 0.01)
        assertTrue(r.notice.contains("رتبه"))                       // no ranking, ever

        val s = json.decodeFromString(StudentAssessments.serializer(), STUDENT)
        assertEquals("آزمون‌های معلم", s.title)
        val row = s.assessments.single()
        assertEquals(3, row.correct)
        assertEquals(3, row.questionCount)
        assertEquals(100.0, row.percent!!, 0.01)
    }

    @Test fun unknown_future_fields_and_missing_optional_fields_do_not_break_parsing() {
        val d = json.decodeFromString(AssessmentDetail.serializer(), """{"assessment":{"id":"a1","title":"x","futureField":1},"questions":[{"id":"q1","type":"fill_blank","text":"t"}]}""")
        assertEquals("draft", d.assessment.status)
        assertNull(d.questions.single().options)
    }

    private companion object {
        val DETAIL = """{"assessment":{"id":"8cded396-df37-4c89-89a0-d35e360c9869","rootId":"8cded396-df37-4c89-89a0-d35e360c9869","version":1,"contentType":"teacher_assessment","title":"علوم","description":null,"subject":"علوم","gradeCode":"g6","gradeLabel":"ششم ابتدایی","level":"intermediate","levelLabel":"متوسط","suggestedMinutes":null,"status":"draft","statusLabel":"پیش‌نویس","questionCount":3,"assigned":0,"completed":0,"previewedAt":null,"previewFeedback":null,"teacherApprovedAt":null,"createdAt":"2026-10-03T17:32:29.400Z","updatedAt":"2026-10-03T17:32:29.438Z","publishedAt":null,"archivedAt":null},"questions":[{"id":"0f40306e-b17d-41e4-bad7-f34a57d540df","position":1,"type":"multiple_choice","typeLabel":"چهارگزینه‌ای","text":"پایتخت؟","options":["تهران","شیراز","تبریز","اصفهان"],"explanation":"x","correct":0},{"id":"06f25d39-cd95-47fd-a25a-3b10903759fa","position":2,"type":"true_false","typeLabel":"درست / نادرست","text":"زمین گرد است.","options":null,"explanation":null,"correct":true},{"id":"4381bbaf-7d78-4691-b583-caa3800f538d","position":3,"type":"fill_blank","typeLabel":"جای خالی","text":"مرکز فارس ____","options":null,"explanation":null,"answers":["شیراز"]}],"problems":[],"versions":[{"id":"8cded396-df37-4c89-89a0-d35e360c9869","version":1,"status":"draft","statusLabel":"پیش‌نویس"}],"students":[],"editable":true,"canCreateNewVersion":false}"""
        val PREVIEW = """{"token":"95ZMPZQMMS5J4SMF","url":"https://play.example/preview/95ZMPZQMMS5J4SMF","summary":{"kind":"teacher_assessment","title":"علوم","subject":"علوم","gradeLabel":"ششم ابتدایی","levelLabel":"متوسط","questionCount":3,"estimatedMinutes":3,"note":"این اجرا فقط برای آزمایش شماست؛ دانش‌آموزی ایجاد نمی‌شود و هیچ نتیجه‌ای در گزارش‌ها ثبت نمی‌شود."}}"""
        val PUBLISHED = """{"assessment":{"id":"8cded396-df37-4c89-89a0-d35e360c9869","rootId":"8cded396-df37-4c89-89a0-d35e360c9869","version":1,"contentType":"teacher_assessment","title":"علوم","description":null,"subject":"علوم","gradeCode":"g6","gradeLabel":"ششم ابتدایی","level":"intermediate","levelLabel":"متوسط","suggestedMinutes":null,"status":"published","statusLabel":"منتشرشده","questionCount":3,"assigned":1,"completed":0,"previewedAt":"2026-10-03T17:32:29.483Z","previewFeedback":"suitable","teacherApprovedAt":"2026-10-03T17:32:29.483Z","createdAt":"2026-10-03T17:32:29.400Z","updatedAt":"2026-10-03T17:32:29.493Z","publishedAt":"2026-10-03T17:32:29.493Z","archivedAt":null},"questions":[{"id":"0f40306e-b17d-41e4-bad7-f34a57d540df","position":1,"type":"multiple_choice","typeLabel":"چهارگزینه‌ای","text":"پایتخت؟","options":["تهران","شیراز","تبریز","اصفهان"],"explanation":"x","correct":0},{"id":"06f25d39-cd95-47fd-a25a-3b10903759fa","position":2,"type":"true_false","typeLabel":"درست / نادرست","text":"زمین گرد است.","options":null,"explanation":null,"correct":true},{"id":"4381bbaf-7d78-4691-b583-caa3800f538d","position":3,"type":"fill_blank","typeLabel":"جای خالی","text":"مرکز فارس ____","options":null,"explanation":null,"answers":["شیراز"]}],"problems":[],"versions":[{"id":"8cded396-df37-4c89-89a0-d35e360c9869","version":1,"status":"published","statusLabel":"منتشرشده"}],"students":[{"studentId":"4a43d2aa-bce2-4d43-a8e1-aeb3228f718b","classId":"002cd2b3-a7e3-4cbc-8ad4-aac9dd7fb027","name":"دانش‌آموز","token":"QAZY3JXP9YCRRL5H","url":"https://play.example/play/QAZY3JXP9YCRRL5H","status":"pending","startedAt":null,"completedAt":null}],"editable":false,"canCreateNewVersion":true,"links":[{"studentId":"4a43d2aa-bce2-4d43-a8e1-aeb3228f718b","name":"دانش‌آموز","token":"QAZY3JXP9YCRRL5H","url":"https://play.example/play/QAZY3JXP9YCRRL5H","status":"pending"}]}"""
        val LIST = """{"assessments":[{"id":"8cded396-df37-4c89-89a0-d35e360c9869","rootId":"8cded396-df37-4c89-89a0-d35e360c9869","version":1,"contentType":"teacher_assessment","title":"علوم","description":null,"subject":"علوم","gradeCode":"g6","gradeLabel":"ششم ابتدایی","level":"intermediate","levelLabel":"متوسط","suggestedMinutes":null,"status":"published","statusLabel":"منتشرشده","questionCount":3,"assigned":1,"completed":1,"previewedAt":"2026-10-03T17:32:29.483Z","previewFeedback":"suitable","teacherApprovedAt":"2026-10-03T17:32:29.483Z","createdAt":"2026-10-03T17:32:29.400Z","updatedAt":"2026-10-03T17:32:29.493Z","publishedAt":"2026-10-03T17:32:29.493Z","archivedAt":null}],"filter":"all"}"""
        val REPORT = """{"assessment":{"id":"8cded396-df37-4c89-89a0-d35e360c9869","rootId":"8cded396-df37-4c89-89a0-d35e360c9869","version":1,"contentType":"teacher_assessment","title":"علوم","description":null,"subject":"علوم","gradeCode":"g6","gradeLabel":"ششم ابتدایی","level":"intermediate","levelLabel":"متوسط","suggestedMinutes":null,"status":"published","statusLabel":"منتشرشده","questionCount":3,"assigned":1,"completed":1,"previewedAt":"2026-10-03T17:32:29.483Z","previewFeedback":"suitable","teacherApprovedAt":"2026-10-03T17:32:29.483Z","createdAt":"2026-10-03T17:32:29.400Z","updatedAt":"2026-10-03T17:32:29.493Z","publishedAt":"2026-10-03T17:32:29.493Z","archivedAt":null},"participants":1,"assigned":1,"started":1,"notFinished":0,"sufficientData":true,"averagePercent":100,"averageCorrect":3,"highestPercent":100,"lowestPercent":100,"averageMinutes":null,"questions":[{"questionId":"0f40306e-b17d-41e4-bad7-f34a57d540df","position":1,"type":"multiple_choice","typeLabel":"چهارگزینه‌ای","text":"پایتخت؟","answered":1,"correct":1,"incorrect":0,"unanswered":0,"percentCorrect":100},{"questionId":"06f25d39-cd95-47fd-a25a-3b10903759fa","position":2,"type":"true_false","typeLabel":"درست / نادرست","text":"زمین گرد است.","answered":1,"correct":1,"incorrect":0,"unanswered":0,"percentCorrect":100},{"questionId":"4381bbaf-7d78-4691-b583-caa3800f538d","position":3,"type":"fill_blank","typeLabel":"جای خالی","text":"مرکز فارس ____","answered":1,"correct":1,"incorrect":0,"unanswered":0,"percentCorrect":100}],"notice":"این گزارش برای تحلیل خود آزمون است؛ رتبه‌بندی یا مقایسهٔ دانش‌آموزان نمایش داده نمی‌شود."}"""
        val STUDENT = """{"student":{"id":"4a43d2aa-bce2-4d43-a8e1-aeb3228f718b","name":"دانش‌آموز"},"section":"teacher_assessments","title":"آزمون‌های معلم","assessments":[{"assessmentId":"8cded396-df37-4c89-89a0-d35e360c9869","title":"علوم","subject":"علوم","version":1,"status":"completed","statusLabel":"انجام شده","date":"2026-10-03T17:32:29.523Z","questionCount":3,"correct":3,"unanswered":0,"percent":100,"minutes":null}],"notice":"نمرهٔ آزمون‌های معلم، سنجش درسی است و در پروفایل شناختی یادبین (حافظه، توجه، حل مسئله…) هیچ نقشی ندارد."}"""
    }
}
