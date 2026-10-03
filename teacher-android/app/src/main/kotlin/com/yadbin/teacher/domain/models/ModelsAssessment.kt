package com.yadbin.teacher.domain.models

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** Teacher Assessments (آزمون‌های معلم) – mirrors worker/src/routes/assessments.ts. Kept apart from cognitive Activity models on purpose. */
@Serializable data class AssessmentInfo(
    val id: String,
    val rootId: String = "",
    val version: Int = 1,
    val title: String = "",
    val description: String? = null,
    val subject: String? = null,
    val gradeCode: String? = null,
    val gradeLabel: String? = null,
    val level: String? = null,
    val levelLabel: String? = null,
    val suggestedMinutes: Int? = null,
    val status: String = "draft",
    val statusLabel: String = "",
    val questionCount: Int = 0,
    val assigned: Int = 0,
    val completed: Int = 0,
    val previewFeedback: String? = null,
    val publishedAt: String? = null,
    val updatedAt: String = "",
)

@Serializable data class AssessmentList(val assessments: List<AssessmentInfo> = emptyList(), val filter: String = "all")

/** Teacher view of one question (includes the key). [correct] is a number (multiple choice), a boolean (true/false); fill-blank uses [answers]. */
@Serializable data class AssessmentQuestion(
    val id: String,
    val position: Int = 0,
    val type: String,
    val typeLabel: String = "",
    val text: String = "",
    val options: List<String>? = null,
    val explanation: String? = null,
    val correct: JsonElement? = null,
    val answers: List<String>? = null,
)

@Serializable data class AssessmentVersion(val id: String, val version: Int = 1, val status: String = "draft")
@Serializable data class AssessmentLink(val studentId: String = "", val classId: String? = null, val name: String = "", val url: String = "", val status: String = "pending")

@Serializable data class AssessmentDetail(
    val assessment: AssessmentInfo,
    val questions: List<AssessmentQuestion> = emptyList(),
    val problems: List<String> = emptyList(),
    val versions: List<AssessmentVersion> = emptyList(),
    val students: List<AssessmentLink> = emptyList(),
    val editable: Boolean = true,
    val canCreateNewVersion: Boolean = false,
    /** Present only on publish / assign. */
    val links: List<AssessmentLink> = emptyList(),
)

@Serializable data class AssessmentPreviewStarted(val token: String = "", val url: String)

@Serializable data class AssessmentQuestionStat(
    val questionId: String, val position: Int = 0, val typeLabel: String = "", val text: String = "",
    val correct: Int = 0, val incorrect: Int = 0, val unanswered: Int = 0, val percentCorrect: Double? = null,
)

/** Test analysis only: no names, no ranking. */
@Serializable data class AssessmentReport(
    val assessment: AssessmentInfo,
    val participants: Int = 0, val assigned: Int = 0, val notFinished: Int = 0, val sufficientData: Boolean = false,
    val averagePercent: Double? = null, val highestPercent: Double? = null, val lowestPercent: Double? = null, val averageMinutes: Double? = null,
    val questions: List<AssessmentQuestionStat> = emptyList(),
    val notice: String = "",
)

@Serializable data class StudentAssessmentRow(
    val assessmentId: String, val title: String = "", val subject: String? = null, val version: Int = 1,
    val status: String = "pending", val statusLabel: String = "", val date: String? = null,
    val questionCount: Int? = null, val correct: Int? = null, val percent: Double? = null, val minutes: Int? = null,
)
@Serializable data class StudentAssessments(val assessments: List<StudentAssessmentRow> = emptyList(), val title: String = "آزمون‌های معلم", val notice: String = "")

/** What the teacher typed in the question editor (before it is sent). */
data class QuestionDraft(
    val type: String,
    val text: String = "",
    val options: List<String> = listOf("", "", "", ""),
    val correctIndex: Int? = null,
    val correctBool: Boolean? = null,
    val answers: List<String> = listOf(""),
    val explanation: String = "",
)
