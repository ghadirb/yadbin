package com.yadbin.teacher

import com.yadbin.teacher.core.utils.Labels
import com.yadbin.teacher.core.utils.Qr
import com.yadbin.teacher.domain.models.ClassDetail
import com.yadbin.teacher.domain.models.StudentReport
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

/** Contract tests: the JSON shapes produced by worker/src (see docs/api.md) must parse. */
class ModelsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun insufficient_data_report_has_no_numbers() {
        val r = json.decodeFromString(StudentReport.serializer(), """
          {"student":{"id":"s1","name":"علی رضایی"},"completedActivities":1,"lastActivityAt":null,
           "skills":[{"game":"memory","title":"حافظه و یادآوری","gameName":"به خاطر بسپار","status":"insufficient","statusLabel":"داده کافی نیست",
             "sufficientData":false,"message":"داده کافی نیست.","sessionCount":1,"sampleCount":3,
             "accuracy":null,"averageResponseTime":null,"highestDifficulty":null,"independentAccuracy":null,"guidedAccuracy":null,
             "helpResponsiveness":null,"ruleAdaptation":null,"reverseTaskAccuracy":null,
             "trend":{"title":"روند عملکرد مشاهده‌شده","direction":"insufficient","confidence":"none","sessionCount":1,"label":"برای نمایش روند، فعالیت‌های بیشتری لازم است.","note":null},
             "series":[]}],
           "suggestions":[],"suggestionFallback":"برای ارائه پیشنهاد، فعالیت‌های بیشتری لازم است.","notice":"..."}""")
        val k = r.skills.single()
        assertFalse(k.sufficientData); assertNull(k.accuracy); assertTrue(k.series.isEmpty())
        assertEquals("روند عملکرد مشاهده‌شده", k.trend.title)
        assertNotNull(r.suggestionFallback)
    }

    @Test fun report_with_trend_and_suggestion_parses_numbers_as_double() {
        val r = json.decodeFromString(StudentReport.serializer(), """
          {"student":{"id":"s1","name":"سارا"},"completedActivities":3,"lastActivityAt":"2026-09-01T10:00:00Z",
           "skills":[{"game":"problem_solving","title":"حل مسئله","gameName":"راهش را پیدا کن","status":"good","statusLabel":"عملکرد خوب","sufficientData":true,
             "sessionCount":3,"sampleCount":24,"accuracy":0.8333,"averageResponseTime":4200,"highestDifficulty":2,"independentAccuracy":0.75,"guidedAccuracy":0.8333,"helpResponsiveness":0.5,
             "trend":{"title":"روند عملکرد مشاهده‌شده","direction":"up","confidence":"moderate","sessionCount":3,"label":"...","note":null},
             "series":[{"session":1,"createdAt":"a","accuracy":0.6,"averageResponseTime":5000,"difficultyReached":1},{"session":2,"createdAt":"b","accuracy":0.7,"averageResponseTime":4500,"difficultyReached":2},{"session":3,"createdAt":"c","accuracy":0.83,"averageResponseTime":4200,"difficultyReached":2}]}],
           "suggestions":[{"rule":"problem_help_responsive","gameType":"problem_solving","difficultyMode":"hard","text":"...","label":"پیشنهاد سیستم","gameName":"راهش را پیدا کن"}],
           "suggestionFallback":null,"notice":"x"}""")
        val k = r.skills.single()
        assertEquals(0.8333, k.accuracy!!, 1e-9); assertEquals(3, k.series.size); assertEquals("پیشنهاد سیستم", r.suggestions.single().label)
    }

    @Test fun class_detail_parses_reserved_word_field() {
        val d = json.decodeFromString(ClassDetail.serializer(), """
          {"class":{"id":"c1","name":"سوم الف","grade":"سوم","schoolName":null,"createdAt":"x"},
           "students":[{"id":"s1","name":"علی","completedActivities":2,"lastActivityAt":null}],
           "activities":[{"id":"a1","gameType":"attention","difficultyMode":"hard","questionCount":10,"status":"active","createdAt":"x","expiresAt":"y","assigned":5,"completed":1}]}""")
        assertEquals("سوم الف", d.cls.name); assertEquals(5, d.activities.single().assigned)
    }

    @Test fun ui_labels_never_use_diagnostic_wording() {
        val all = listOf("memory", "attention", "problem_solving").map { Labels.game(it) } +
            listOf("adaptive", "easy", "medium", "hard").map { Labels.difficulty(it) }
        val banned = listOf("هوش", "ADHD", "اختلال", "ضعیف", "رتبه")
        all.forEach { label -> banned.forEach { assertFalse("$label contains $it", label.contains(it)) } }
        assertEquals("به خاطر بسپار", Labels.game("memory"))
    }

    @Test fun share_text_contains_link() {
        assertEquals("لطفاً این فعالیت کوتاه را انجام دهید:\nhttps://x/play/ABC", Labels.shareText("https://x/play/ABC"))
    }

    @Test fun qr_matrix_is_square_and_has_modules() {
        val m = Qr.matrix("https://yadbin.pages.dev/play/8FK29X7P")
        assertTrue(m.size > 20); assertTrue(m.all { it.size == m.size }); assertTrue(m.any { row -> row.any { it } })
        assertNotEquals(m.flatMap { it.toList() }, Qr.matrix("https://yadbin.pages.dev/play/OTHER").flatMap { it.toList() })
    }
}
