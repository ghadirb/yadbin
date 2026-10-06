package com.yadbin.teacher.domain.models

import kotlinx.serialization.Serializable

// ---- «روند رشد و تحلیل» (GET /api/students/:id/growth) ------------------------------------------
// Percent values are on a 0..100 scale (one decimal) — NOT 0..1 like the older report endpoints.
// Every field has a default so an older/newer server never breaks parsing; the screen shows only what exists.
// Growth is always "a student compared with their own past": nothing here ranks or compares students.

@Serializable data class GrowthTrend(
    val direction: String = "insufficient", // up | stable | fluctuating | down | insufficient
    val label: String = "",
    val n: Int = 0,
    val change: Double? = null,
    val residualSd: Double? = null,
)

@Serializable data class GrowthChange(val points: Double = 0.0, val label: String = "", val previousAverage: Double = 0.0)
@Serializable data class GrowthStartCurrent(val startPercent: Double = 0.0, val currentPercent: Double = 0.0, val changePoints: Double = 0.0, val window: Int = 0)

@Serializable data class GrowthOverview(
    val activityCount: Int = 0,
    val assessmentCount: Int = 0,
    val activeDays: Int = 0,
    val lastActivityAt: String? = null,
    val cognitiveAverage: Double? = null,
    val lastPerformance: Double? = null,
    val changeVsPrevious: GrowthChange? = null,
    val changeNote: String? = null,
    val startVsCurrent: GrowthStartCurrent? = null,
    val startVsCurrentLabel: String? = null,
)

@Serializable data class GrowthGameBucket(val percent: Double = 0.0, val results: Int = 0)

/** One chart point = one time bucket (day / week / four weeks) — an aggregate, never a raw result and never interpolated. */
@Serializable data class GrowthPoint(
    val bucketStart: String = "",
    val percent: Double = 0.0,
    val results: Int = 0,
    val samples: Int = 0,
    val averageResponseSeconds: Double? = null,
    val byGame: Map<String, GrowthGameBucket> = emptyMap(),
)

@Serializable data class GrowthTimeline(
    val available: Boolean = false,
    val message: String? = null,
    val bucket: String = "day",
    val points: List<GrowthPoint> = emptyList(),
    val trend: GrowthTrend = GrowthTrend(),
)

@Serializable data class GrowthResponseTime(val startSeconds: Double = 0.0, val currentSeconds: Double = 0.0, val changeSeconds: Double = 0.0)
@Serializable data class GrowthSeriesPoint(val at: String = "", val percent: Double = 0.0)

@Serializable data class GrowthSkill(
    val game: String = "",
    val skill: String = "",
    val results: Int = 0,
    val samples: Int = 0,
    val sufficient: Boolean = false,
    val start: Double? = null,
    val current: Double? = null,
    val changePoints: Double? = null,
    val changeLabel: String? = null,
    val trend: GrowthTrend = GrowthTrend(),
    val responseTime: GrowthResponseTime? = null,
    val series: List<GrowthSeriesPoint> = emptyList(),
)

@Serializable data class GrowthActivity(
    val activityId: String = "",
    val title: String = "",
    val date: String = "",
    val gameType: String = "",
    val skill: String = "",
    val level: String? = null,
    val levelLabel: String = "",
    val percent: Double = 0.0,
    val answers: Int = 0,
    val averageResponseSeconds: Double? = null,
    val difficultyReached: Double? = null,
    val status: String = "completed",
    val statusLabel: String = "",
    val changePoints: Double? = null,
)

@Serializable data class GrowthActivities(val recent: List<GrowthActivity> = emptyList(), val mostChanged: List<GrowthActivity> = emptyList())

@Serializable data class GrowthCognitive(
    val title: String = "رشد در فعالیت‌های شناختی",
    val timeline: GrowthTimeline = GrowthTimeline(),
    val skills: List<GrowthSkill> = emptyList(),
    val skillsMessage: String? = null,
    val activities: GrowthActivities = GrowthActivities(),
)

@Serializable data class GrowthExam(val index: Int = 0, val assessmentId: String = "", val title: String = "", val at: String = "", val percent: Double = 0.0)

@Serializable data class GrowthSubject(
    val subject: String = "",
    val count: Int = 0,
    val average: Double = 0.0,
    val first: Double = 0.0,
    val last: Double = 0.0,
    val changePoints: Double? = null,
    val changeLabel: String? = null,
    val trend: GrowthTrend = GrowthTrend(),
    val exams: List<GrowthExam> = emptyList(),
)

@Serializable data class GrowthAssessmentPoint(val at: String = "", val percent: Double = 0.0, val subject: String = "")

/** Separate from the cognitive block on purpose: school scores never enter the cognitive indicators. */
@Serializable data class GrowthAssessments(
    val title: String = "روند آزمون‌های درسی",
    val count: Int = 0,
    val average: Double? = null,
    val last: Double? = null,
    val chartAvailable: Boolean = false,
    val message: String? = null,
    val series: List<GrowthAssessmentPoint> = emptyList(),
    val subjects: List<GrowthSubject> = emptyList(),
    val note: String = "",
)

@Serializable data class GrowthStatement(val text: String = "")

@Serializable data class GrowthAnalysis(
    val sufficient: Boolean = false,
    val text: String = "",
    val statements: List<GrowthStatement> = emptyList(),
    val notice: String = "",
)

@Serializable data class GrowthPrefill(
    val templateId: String? = null,
    val gameType: String? = null,
    val level: String? = null,
    val skills: List<String> = emptyList(),
)

@Serializable data class GrowthSuggestion(
    val prefill: GrowthPrefill = GrowthPrefill(),
    val text: String = "",
    val reason: String = "",
    val skill: String = "",
    val gameType: String = "memory",
    val level: String = "basic",
    val levelLabel: String = "",
    val requiresTeacherApproval: Boolean = true,
)

@Serializable data class GrowthOption(val code: String = "", val label: String = "")
@Serializable data class GrowthAvailable(
    val ranges: List<GrowthOption> = emptyList(),
    val games: List<GrowthOption> = emptyList(),
    val levels: List<GrowthOption> = emptyList(),
    val subjects: List<String> = emptyList(),
)
@Serializable data class GrowthFiltersInfo(val available: GrowthAvailable = GrowthAvailable())

@Serializable data class StudentGrowth(
    val range: String = "30d",
    val rangeLabel: String = "",
    val filters: GrowthFiltersInfo = GrowthFiltersInfo(),
    val overview: GrowthOverview = GrowthOverview(),
    val cognitive: GrowthCognitive = GrowthCognitive(),
    val assessments: GrowthAssessments = GrowthAssessments(),
    val analysis: GrowthAnalysis = GrowthAnalysis(),
    val suggestion: GrowthSuggestion? = null,
    val notice: String = "",
)

/** POST /api/students/:id/growth/summary — AI wording of the analysis, or the rule-based text when AI is unavailable. */
@Serializable data class GrowthSummary(
    val source: String = "rules", // ai | rules
    val text: String = "",
    val sufficient: Boolean = false,
    val aiUsed: Boolean = false,
    val reason: String? = null,
    val notice: String = "",
)

/** The filters the teacher can pick (kept simple for mobile). null = no filter. */
data class GrowthQuery(
    val range: String = "30d",
    val game: String? = null,
    val level: String? = null,
    val subject: String? = null,
) {
    fun queryString(): String = buildString {
        append("range=").append(range)
        game?.let { append("&game=").append(it) }
        level?.let { append("&level=").append(it) }
        subject?.let { append("&subject=").append(java.net.URLEncoder.encode(it, "UTF-8")) }
    }
}
