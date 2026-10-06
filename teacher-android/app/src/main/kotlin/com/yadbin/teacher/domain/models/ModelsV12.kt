package com.yadbin.teacher.domain.models

import kotlinx.serialization.Serializable

// ---- v1.2: age / grade aware activities --------------------------------------------------------
// Everything is optional: old classes, students and activities simply have null values.

@Serializable data class FitStudent(val studentId: String, val fit: String = "unknown", val label: String = "", val reasons: List<String> = emptyList())
/** Advisory only: it never blocks anything; the teacher always has the final say. */
@Serializable data class Suitability(val summary: Map<String, Int> = emptyMap(), val students: List<FitStudent> = emptyList())

@Serializable data class EduStudent(
    val id: String = "",
    val name: String = "",
    val age: Int? = null,
    val ageApproximate: Boolean = false,
    val gradeCode: String? = null,
    val gradeLabel: String? = null,
    val gender: String? = null,
    val note: String? = null,
)
@Serializable data class StudentEnvelope(val student: EduStudent)

@Serializable data class SkillIndicator(
    val skill: String,
    val label: String,
    val game: String = "",
    val status: String = "insufficient",
    val statusLabel: String = "",
    val sufficientData: Boolean = false,
    val sessionCount: Int = 0,
)
@Serializable data class ProfileSummary(val text: String = "", val basedOn: Int = 0, val assessmentsBasedOn: Int = 0)
/** Teacher assessments (manual + from sources) summarised under the student's name; separate from the cognitive indicators. */
@Serializable data class ProfileAssessmentSubject(val subject: String = "", val count: Int = 0, val average: Double = 0.0, val last: Double = 0.0, val trend: String = "")
@Serializable data class ProfileAssessments(
    val count: Int = 0, val average: Double? = null, val last: Double? = null, val lastAt: String? = null,
    val subjects: List<ProfileAssessmentSubject> = emptyList(), val text: String = "",
)
/** Performance INDICATORS of activities - never a medical or psychological diagnosis. */
@Serializable data class EducationalProfile(
    val student: EduStudent = EduStudent(),
    val completedActivities: Int = 0,
    val lastActivityAt: String? = null,
    val skills: List<SkillIndicator> = emptyList(),
    val summary: ProfileSummary = ProfileSummary(),
    val assessments: ProfileAssessments = ProfileAssessments(),
    val notice: String = "",
)

@Serializable data class Recommendation(
    val rank: Int = 0,
    val basis: String = "",
    val skill: String = "",
    val skillLabel: String = "",
    val gameType: String = "memory",
    val level: String = "basic",
    val levelLabel: String = "",
    val difficultyMode: String = "adaptive",
    val templateId: String? = null,
    val templateTitle: String? = null,
    val fit: String = "unrestricted",
    val text: String = "",
    val reason: String = "",
)
@Serializable data class RecommendationsResponse(
    val recommendations: List<Recommendation> = emptyList(),
    val requiresTeacherApproval: Boolean = true,
    val notice: String = "",
)

@Serializable data class Template(
    val id: String,
    val title: String,
    val description: String = "",
    val category: String = "",
    val gameType: String = "memory",
    val difficultyMode: String = "adaptive",
    val questionCount: Int = 8,
    val suggestedMinutes: Int = 8,
    val level: String = "basic",
    val skills: List<String> = emptyList(),
    val gradeMin: String = "preschool",
    val gradeMax: String = "g6",
    val ageMin: Int = 5,
    val ageMax: Int = 12,
)
@Serializable data class TemplatesResponse(val templates: List<Template> = emptyList())

/** AI Activity Builder result: a DRAFT only. Nothing is created until the teacher edits and approves it. */
@Serializable data class ActivityDraft(
    val title: String = "",
    val educationalGoal: String = "",
    val description: String = "",
    val gameType: String = "memory",
    val difficultyMode: String = "adaptive",
    val stages: Int = 1,
    val questionCount: Int = 8,
    val suggestedMinutes: Int = 8,
    val level: String = "basic",
    val levelLabel: String = "",
    val skills: List<String> = emptyList(),
    val skillLabels: List<String> = emptyList(),
    val gradeMin: String? = null,
    val gradeMax: String? = null,
    val ageMin: Int? = null,
    val ageMax: Int? = null,
    val templateId: String? = null,
)
@Serializable data class DraftResponse(
    val draft: ActivityDraft,
    val alternatives: List<ActivityDraft> = emptyList(),
    val source: String = "rules",
    val notice: String = "",
)

// ---- Teacher dashboard (counts and distributions only - no ranking of students) -----------------
@Serializable data class Distribution(val good: Int = 0, val average: Int = 0, val needs_practice: Int = 0, val insufficient: Int = 0)
@Serializable data class SkillDistribution(val skill: String = "", val label: String = "", val game: String = "", val distribution: Distribution = Distribution())
@Serializable data class DashClass(
    val id: String,
    val name: String,
    val gradeCode: String? = null,
    val gradeLabel: String? = null,
    val studentCount: Int = 0,
    val activityCount: Int = 0,
    val assigned: Int = 0,
    val completed: Int = 0,
    val completionRate: Double? = null,
    val skills: List<SkillDistribution> = emptyList(),
)
@Serializable data class DashActivity(
    val id: String,
    val classId: String,
    val className: String = "",
    val title: String? = null,
    val gameType: String = "",
    val level: String? = null,
    val levelLabel: String? = null,
    val skillLabels: List<String> = emptyList(),
    val assigned: Int = 0,
    val completed: Int = 0,
    val performanceStatus: String = "insufficient",
    val performanceLabel: String = "",
)
@Serializable data class DashTotals(val classes: Int = 0, val activities: Int = 0, val assigned: Int = 0, val completed: Int = 0)
@Serializable data class DashboardResponse(
    val classes: List<DashClass> = emptyList(),
    val activities: List<DashActivity> = emptyList(),
    val totals: DashTotals = DashTotals(),
    val notice: String = "",
)

/** Everything the teacher confirmed on the create-activity form (null/empty = not set). */
data class ActivitySpec(
    val classId: String,
    val gameType: String,
    val difficultyMode: String = "adaptive",
    val questionCount: Int = 10,
    /** null = whole class */
    val studentIds: List<String>? = null,
    val title: String? = null,
    val description: String? = null,
    val suggestedMinutes: Int? = null,
    val level: String? = null,
    val skills: List<String> = emptyList(),
    val gradeMin: String? = null,
    val gradeMax: String? = null,
    val ageMin: Int? = null,
    val ageMax: Int? = null,
    val templateId: String? = null,
)

/** Values handed from the AI builder / a recommendation to the create-activity form. The form stays fully editable: the teacher approves. */
data class ActivityPrefill(
    val templateId: String? = null,
    val gameType: String? = null,
    val difficultyMode: String? = null,
    val questionCount: Int? = null,
    val title: String? = null,
    val description: String? = null,
    val suggestedMinutes: Int? = null,
    val level: String? = null,
    val skills: List<String> = emptyList(),
    val gradeMin: String? = null,
    val gradeMax: String? = null,
    val ageMin: Int? = null,
    val ageMax: Int? = null,
    val studentId: String? = null,
)

fun ActivityDraft.toPrefill() = ActivityPrefill(
    templateId = templateId, gameType = gameType, difficultyMode = difficultyMode, questionCount = questionCount, title = title,
    description = description, suggestedMinutes = suggestedMinutes, level = level, skills = skills, gradeMin = gradeMin, gradeMax = gradeMax, ageMin = ageMin, ageMax = ageMax,
)
