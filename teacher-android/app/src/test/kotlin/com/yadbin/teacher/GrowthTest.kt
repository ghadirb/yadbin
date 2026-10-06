package com.yadbin.teacher

import com.yadbin.teacher.core.utils.Growth
import com.yadbin.teacher.domain.models.GrowthQuery
import com.yadbin.teacher.domain.models.GrowthSubject
import com.yadbin.teacher.domain.models.GrowthExam
import com.yadbin.teacher.domain.models.StudentGrowth
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

/**
 * «روند رشد و تحلیل»: the Android models must read the REAL server payload (fixtures are captured from the Worker's own
 * integration test), an older/empty server must never crash the app, and the wording helpers must stay conservative.
 */
class GrowthTest {
    private val json = Json { ignoreUnknownKeys = true }
    private fun fixture(name: String): StudentGrowth {
        val text = javaClass.classLoader!!.getResource(name)!!.readText(Charsets.UTF_8)
        return json.decodeFromString(StudentGrowth.serializer(), text)
    }

    @Test fun real_payload_parses_with_overview_timeline_skills_and_assessments() {
        val g = fixture("growth-sample.json")
        assertEquals("3m", g.range)
        assertEquals(10, g.overview.activityCount); assertEquals(5, g.overview.assessmentCount)
        assertEquals(13.0, g.overview.startVsCurrent!!.changePoints, 0.001)
        assertNull(g.overview.changeVsPrevious)                       // not enough data in the previous period
        assertTrue(g.cognitive.timeline.available)
        assertEquals("week", g.cognitive.timeline.bucket)
        assertEquals(6, g.cognitive.timeline.points.size)
        assertEquals("up", g.cognitive.timeline.trend.direction)
        val memory = g.cognitive.skills.first { it.game == "memory" }
        assertEquals("حافظه", memory.skill); assertTrue(memory.sufficient); assertEquals(6, memory.series.size)
        assertNotNull(memory.responseTime)
    }

    @Test fun assessments_are_a_separate_block_with_per_subject_exams() {
        val a = fixture("growth-sample.json").assessments
        assertEquals(5, a.count); assertTrue(a.chartAvailable)
        val math = a.subjects.first { it.subject == "ریاضی" }
        assertEquals(listOf(65.0, 72.0, 81.0), math.exams.map { it.percent })
        assertEquals(listOf(1, 2, 3), math.exams.map { it.index })
        assertEquals(16.0, math.changePoints!!, 0.001)
        // no cognitive game codes leak into the assessment block
        assertTrue(a.series.none { it.subject == "حافظه" })
    }

    @Test fun suggestion_is_educational_and_needs_teacher_approval() {
        val s = fixture("growth-sample.json").suggestion!!
        assertTrue(s.requiresTeacherApproval)
        assertEquals("problem_solving", s.gameType); assertEquals("intermediate", s.level)
        assertEquals("problem-patterns", s.prefill.templateId)
    }

    @Test fun filter_options_come_from_the_server() {
        val av = fixture("growth-sample.json").filters.available
        assertEquals(listOf("7d", "30d", "3m", "6m", "all"), av.ranges.map { it.code })
        assertEquals(listOf("memory", "attention"), av.games.map { it.code })
        assertEquals(listOf("ریاضی", "علوم"), av.subjects)
    }

    @Test fun empty_payload_shows_no_chart_no_skills_and_a_fixed_message() {
        val g = fixture("growth-empty.json")
        assertEquals(0, g.overview.activityCount)
        assertFalse(g.cognitive.timeline.available); assertTrue(g.cognitive.timeline.points.isEmpty())
        assertEquals(Growth.MSG_NOT_ENOUGH_RANGE, g.cognitive.timeline.message)
        assertTrue(g.cognitive.skills.isEmpty())
        assertFalse(g.analysis.sufficient)
    }

    @Test fun an_old_or_minimal_server_response_still_parses_with_safe_defaults() {
        val g = json.decodeFromString(StudentGrowth.serializer(), "{}")
        assertEquals(0, g.overview.activityCount); assertFalse(g.cognitive.timeline.available)
        assertNull(g.suggestion); assertEquals("insufficient", g.cognitive.timeline.trend.direction)
        val extra = json.decodeFromString(StudentGrowth.serializer(), """{"someFutureField":{"x":1},"overview":{"activityCount":2,"newMetric":9}}""")
        assertEquals(2, extra.overview.activityCount)
    }

    @Test fun query_string_has_only_chosen_filters_and_encodes_the_subject() {
        assertEquals("range=30d", GrowthQuery().queryString())
        val q = GrowthQuery(range = "3m", game = "memory", level = "basic", subject = "علوم تجربی")
        val s = q.queryString()
        assertTrue(s.startsWith("range=3m&game=memory&level=basic&subject="))
        assertFalse(s.contains(" ")); assertFalse(s.contains("علوم"))
    }

    // ---- wording helpers ----

    @Test fun change_is_phrased_in_percentage_points_not_percent() {
        assertEquals("۱۶ واحد درصد افزایش", Growth.pointsPhrase(16.0))
        assertEquals("۵٫۴ واحد درصد کاهش", Growth.pointsPhrase(-5.4))
        assertEquals("تقریباً بدون تغییر", Growth.pointsPhrase(0.3))
        assertEquals("+۱۲", Growth.signedPoints(12.0)); assertEquals("−۵", Growth.signedPoints(-5.0))
        assertEquals("۷۸٪", Growth.percent(77.6))
    }

    @Test fun trend_wording_is_descriptive_only() {
        val titles = listOf("up", "stable", "fluctuating", "down", "insufficient").map { Growth.trendTitle(it) }
        assertEquals(listOf("رو به رشد", "تقریباً ثابت", "نوسانی", "رو به کاهش", "داده کافی نیست"), titles)
        val forbidden = listOf("اختلال", "مشکل", "ضعف", "بیش‌فعال", "درمان")
        (titles + Growth.MSG_NOT_ENOUGH_ACTIVITIES + Growth.MSG_NOT_ENOUGH_RANGE).forEach { t -> forbidden.forEach { assertFalse("$t contains $it", t.contains(it)) } }
        assertEquals("—", Growth.trendArrow("insufficient"))
    }

    @Test fun exam_line_lists_exams_in_order() {
        val s = GrowthSubject(subject = "ریاضی", exams = listOf(GrowthExam(index = 1, percent = 65.0), GrowthExam(index = 2, percent = 72.0)))
        assertEquals("آزمون ۱: ۶۵٪ • آزمون ۲: ۷۲٪", Growth.examLine(s))
    }

    @Test fun tapping_selects_the_nearest_point_in_rtl_order() {
        // the oldest point (index 0) is drawn on the RIGHT edge, the newest on the left
        assertEquals(0, Growth.nearestIndex(1000f, 1000f, 5))
        assertEquals(4, Growth.nearestIndex(0f, 1000f, 5))
        assertEquals(2, Growth.nearestIndex(500f, 1000f, 5))
        assertEquals(0, Growth.nearestIndex(900f, 1000f, 5, padding = 100f))
        assertNull(Growth.nearestIndex(10f, 1000f, 1))               // a single point never forms a chart
    }
}
