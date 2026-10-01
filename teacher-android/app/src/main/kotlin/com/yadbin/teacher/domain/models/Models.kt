package com.yadbin.teacher.domain.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// ---- Requests -------------------------------------------------------------------------------
@Serializable data class LoginRequest(val phone: String, val password: String)
@Serializable data class RegisterRequest(val name: String, val phone: String, val password: String)
@Serializable data class ResetPasswordRequest(val phone: String, val recoveryCode: String, val newPassword: String)
@Serializable data class ClassRequest(
    val name: String, val grade: String, val schoolName: String? = null,
    /** v1.2 structured fields; null = not sent (server keeps the old value). */
    val gradeCode: String? = null, val ageMin: Int? = null, val ageMax: Int? = null,
)
@Serializable data class AddStudentsRequest(val text: String)
@Serializable data class ActivityRequest(
    val classId: String,
    val gameType: String,
    val difficultyMode: String,
    val questionCount: Int,
    /** the string "all" or an array of student ids (server contract) */
    val studentIds: JsonElement,
)

// ---- Auth -----------------------------------------------------------------------------------
@Serializable data class Teacher(val id: String, val name: String, val phone: String)
/** [recoveryCode] is present on register / reset-password only; it is shown to the teacher once. */
@Serializable data class AuthResponse(val token: String, val teacher: Teacher, val recoveryCode: String? = null)

// ---- Classes / students ---------------------------------------------------------------------
@Serializable data class ClassSummary(
    val id: String,
    val name: String,
    val grade: String,
    val schoolName: String? = null,
    val createdAt: String? = null,
    val studentCount: Int = 0,
    val recentActivityCount: Int = 0,
    val archived: Boolean = false,
    // v1.2 (null for old classes)
    val gradeCode: String? = null,
    val gradeLabel: String? = null,
    val ageMin: Int? = null,
    val ageMax: Int? = null,
)
@Serializable data class ClassesResponse(val classes: List<ClassSummary>)
@Serializable data class ClassEnvelope(@SerialName("class") val cls: ClassSummary)

@Serializable data class StudentRow(
    val id: String,
    val name: String,
    val completedActivities: Int = 0,
    val lastActivityAt: String? = null,
    val openActivities: Int = 0,
    /** null until the server has enough data (same rule as the report) */
    val averagePerformance: Double? = null,
    val activityStateLabel: String = "",
    // v1.2 (all optional)
    val age: Int? = null,
    val ageApproximate: Boolean = false,
    val birthYear: Int? = null,
    val gradeCode: String? = null,
    val gradeLabel: String? = null,
    val gender: String? = null,
    val note: String? = null,
)
@Serializable data class ActivityRow(
    val id: String,
    val gameType: String,
    val difficultyMode: String,
    val questionCount: Int,
    val status: String,
    val title: String? = null,
    val lifecycle: String = "active",
    val lifecycleLabel: String = "",
    val createdAt: String? = null,
    val expiresAt: String? = null,
    val assigned: Int = 0,
    val completed: Int = 0,
    // v1.2
    val level: String? = null,
    val levelLabel: String? = null,
    val skillLabels: List<String> = emptyList(),
    val gradeMinLabel: String? = null,
    val gradeMaxLabel: String? = null,
    val ageMin: Int? = null,
    val ageMax: Int? = null,
)
@Serializable data class ClassDetail(
    @SerialName("class") val cls: ClassSummary,
    val students: List<StudentRow> = emptyList(),
    val activities: List<ActivityRow> = emptyList(),
)
@Serializable data class StudentRef(val id: String, val name: String)
@Serializable data class AddStudentsResponse(val added: List<StudentRef> = emptyList(), val skipped: Int = 0)

// ---- Activities -----------------------------------------------------------------------------
@Serializable data class ActivityInfo(
    val id: String,
    val classId: String,
    val gameType: String,
    val difficultyMode: String,
    val questionCount: Int,
    val status: String,
    val createdAt: String? = null,
    val expiresAt: String? = null,
    val title: String? = null,
    val description: String? = null,
    val suggestedMinutes: Int? = null,
    val lifecycle: String = "active",
    val lifecycleLabel: String = "",
    // v1.2
    val level: String? = null,
    val levelLabel: String? = null,
    val skills: List<String>? = null,
    val skillLabels: List<String> = emptyList(),
    val gradeMin: String? = null,
    val gradeMax: String? = null,
    val gradeMinLabel: String? = null,
    val gradeMaxLabel: String? = null,
    val ageMin: Int? = null,
    val ageMax: Int? = null,
    val templateId: String? = null,
    val hasSuitabilityRange: Boolean = false,
)
@Serializable data class ActivityLink(val studentId: String, val name: String, val token: String, val url: String)
@Serializable data class ActivityCreated(val activity: ActivityInfo, val links: List<ActivityLink> = emptyList(), val suitability: Suitability? = null)
@Serializable data class ActivityStudent(
    val studentId: String,
    val name: String,
    val token: String,
    val url: String,
    val status: String,
    val startedAt: String? = null,
    val completedAt: String? = null,
    // v1.2: advisory fit of the student to the activity range
    val fit: String = "unknown",
    val fitLabel: String? = null,
    val fitReasons: List<String> = emptyList(),
)
@Serializable data class ActivityDetail(val activity: ActivityInfo, val students: List<ActivityStudent> = emptyList())

// ---- Reports (descriptive only; server withholds numbers when data is insufficient) ----------
@Serializable data class TrendInfo(
    val title: String = "روند عملکرد مشاهده‌شده",
    val direction: String = "insufficient",
    val confidence: String = "none",
    val sessionCount: Int = 0,
    val label: String = "",
    val note: String? = null,
)
@Serializable data class SeriesPoint(
    val session: Int,
    val createdAt: String? = null,
    val accuracy: Double? = null,
    val averageResponseTime: Double? = null,
    val difficultyReached: Double? = null,
)
@Serializable data class SkillCard(
    val game: String,
    val title: String,
    val gameName: String,
    val status: String,
    val statusLabel: String,
    val sufficientData: Boolean = false,
    val message: String? = null,
    val sessionCount: Int = 0,
    val sampleCount: Int = 0,
    val accuracy: Double? = null,
    val averageResponseTime: Double? = null,
    val highestDifficulty: Double? = null,
    val independentAccuracy: Double? = null,
    val guidedAccuracy: Double? = null,
    val helpResponsiveness: Double? = null,
    val ruleAdaptation: Double? = null,
    val reverseTaskAccuracy: Double? = null,
    val trend: TrendInfo = TrendInfo(),
    val series: List<SeriesPoint> = emptyList(),
)
@Serializable data class Suggestion(
    val rule: String = "",
    val gameType: String,
    val difficultyMode: String = "adaptive",
    val text: String,
    val label: String = "پیشنهاد سیستم",
    val gameName: String = "",
)
@Serializable data class StudentSummary(
    val sessions: Int = 0,
    val successes: Int = 0,
    val performance: Double? = null,
    val sufficientData: Boolean = false,
    val timeSpentMinutes: Int = 0,
)
@Serializable data class StudentReport(
    val student: StudentRef,
    val completedActivities: Int = 0,
    val lastActivityAt: String? = null,
    val summary: StudentSummary = StudentSummary(),
    val skills: List<SkillCard> = emptyList(),
    val suggestions: List<Suggestion> = emptyList(),
    val suggestionFallback: String? = null,
    val notice: String = "",
)
@Serializable data class ClassGameStat(val game: String, val activities: Int = 0, val assigned: Int = 0, val completed: Int = 0, val averagePerformance: Double? = null)
@Serializable data class WeeklyPoint(val weekStart: String, val completed: Int = 0, val averagePerformance: Double? = null)
@Serializable data class ClassReportClass(val id: String, val name: String, val grade: String)
@Serializable data class ClassReport(
    @SerialName("class") val cls: ClassReportClass,
    val studentCount: Int = 0,
    val activitiesCreated: Int = 0,
    val assignedLinks: Int = 0,
    val completedSessions: Int = 0,
    val completionRate: Double? = null,
    val activeStudents: Int = 0,
    val averagePerformance: Double? = null,
    val overallLabel: String = "",
    val byGame: List<ClassGameStat> = emptyList(),
    val weekly: List<WeeklyPoint> = emptyList(),
)

// ---- v1.1 ------------------------------------------------------------------------------------
@Serializable data class LinksResponse(val links: List<ActivityLink> = emptyList())
@Serializable data class HistoryItem(
    val activityId: String,
    val title: String = "",
    val gameType: String = "",
    val gameName: String = "",
    val status: String = "",
    val startedAt: String? = null,
    val completedAt: String? = null,
    val accuracy: Double? = null,
    val sampleCount: Int = 0,
    val durationSeconds: Int? = null,
)
@Serializable data class StudentHistory(val student: StudentRef, val history: List<HistoryItem> = emptyList())
