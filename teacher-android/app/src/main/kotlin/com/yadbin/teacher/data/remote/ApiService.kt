package com.yadbin.teacher.data.remote

import com.yadbin.teacher.core.network.ApiClient
import com.yadbin.teacher.domain.models.*
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** One function per Worker endpoint (docs/api.md). */
class ApiService(private val c: ApiClient) {
    private val j get() = c.json

    suspend fun register(name: String, phone: String, password: String): AuthResponse =
        c.request("POST", "/api/auth/register", AuthResponse.serializer(), j.encodeToString(RegisterRequest.serializer(), RegisterRequest(name, phone, password)))

    suspend fun login(phone: String, password: String): AuthResponse =
        c.request("POST", "/api/auth/login", AuthResponse.serializer(), j.encodeToString(LoginRequest.serializer(), LoginRequest(phone, password)))

    suspend fun resetPassword(phone: String, recoveryCode: String, newPassword: String): AuthResponse =
        c.request("POST", "/api/auth/reset-password", AuthResponse.serializer(), j.encodeToString(ResetPasswordRequest.serializer(), ResetPasswordRequest(phone, recoveryCode, newPassword)))

    suspend fun classes(): ClassesResponse = c.request("GET", "/api/classes", ClassesResponse.serializer())

    suspend fun createClass(name: String, grade: String, school: String?, gradeCode: String? = null, ageMin: Int? = null, ageMax: Int? = null): ClassEnvelope =
        c.request("POST", "/api/classes", ClassEnvelope.serializer(), j.encodeToString(ClassRequest.serializer(), ClassRequest(name, grade, school?.ifBlank { null }, gradeCode, ageMin, ageMax)))

    suspend fun classDetail(id: String): ClassDetail = c.request("GET", "/api/classes/$id", ClassDetail.serializer())

    /** v1.2: age range is always sent (null clears it); gradeCode null clears the structured grade. */
    suspend fun updateClass(id: String, name: String, grade: String, school: String?, gradeCode: String? = null, ageMin: Int? = null, ageMax: Int? = null): ClassEnvelope {
        val body = buildJsonObject {
            put("name", name); put("grade", grade)
            put("schoolName", school?.ifBlank { null }?.let { JsonPrimitive(it) } ?: JsonNull)
            put("gradeCode", gradeCode?.let { JsonPrimitive(it) } ?: JsonNull)
            put("ageMin", ageMin?.let { JsonPrimitive(it) } ?: JsonNull)
            put("ageMax", ageMax?.let { JsonPrimitive(it) } ?: JsonNull)
        }.toString()
        return c.request("PUT", "/api/classes/$id", ClassEnvelope.serializer(), body)
    }

    suspend fun deleteClass(id: String) { c.request("DELETE", "/api/classes/$id", OkResponse.serializer()) }

    suspend fun addStudents(classId: String, text: String, gender: String? = null): AddStudentsResponse =
        c.request("POST", "/api/classes/$classId/students", AddStudentsResponse.serializer(), j.encodeToString(AddStudentsRequest.serializer(), AddStudentsRequest(text, gender)))

    /** Leaves the class; the student's data is kept. */
    suspend fun removeFromClass(classId: String, studentId: String) {
        c.request("DELETE", "/api/classes/$classId/students/$studentId", OkResponse.serializer())
    }

    /** Erases all results/history of the student but KEEPS the student in the class. */
    suspend fun clearStudentData(studentId: String) { c.request("DELETE", "/api/students/$studentId/data", ClearDataResponse.serializer()) }

    /** Permanently deletes the student AND all results. */
    suspend fun deleteStudentData(studentId: String) { c.request("DELETE", "/api/students/$studentId", OkResponse.serializer()) }

    suspend fun createActivity(classId: String, gameType: String, difficulty: String, questionCount: Int, studentIds: List<String>?): ActivityCreated {
        val ids: JsonElement = if (studentIds == null) JsonPrimitive("all") else JsonArray(studentIds.map { JsonPrimitive(it) })
        val body = j.encodeToString(ActivityRequest.serializer(), ActivityRequest(classId, gameType, difficulty, questionCount, ids))
        return c.request("POST", "/api/activities", ActivityCreated.serializer(), body)
    }

    // ---- v1.1 ----
    suspend fun archivedClasses(): ClassesResponse = c.request("GET", "/api/classes?archived=true", ClassesResponse.serializer())
    suspend fun setClassArchived(id: String, archived: Boolean): ClassEnvelope =
        c.request("POST", "/api/classes/$id/${if (archived) "archive" else "unarchive"}", ClassEnvelope.serializer())
    suspend fun studentHistory(id: String): StudentHistory = c.request("GET", "/api/students/$id/history", StudentHistory.serializer())
    suspend fun updateActivity(id: String, title: String, description: String, minutes: Int?): ActivityDetail {
        val body = buildJsonObject {
            put("title", title.trim()); put("description", description.trim())
            if (minutes != null) put("suggestedMinutes", minutes) else put("suggestedMinutes", JsonNull)
        }.toString()
        return c.request("PUT", "/api/activities/$id", ActivityDetail.serializer(), body)
    }
    suspend fun duplicateActivity(id: String): ActivityCreated = c.request("POST", "/api/activities/$id/duplicate", ActivityCreated.serializer())
    suspend fun setActivityArchived(id: String, archived: Boolean): ActivityDetail =
        c.request("POST", "/api/activities/$id/${if (archived) "archive" else "unarchive"}", ActivityDetail.serializer())
    suspend fun regenerateLink(activityId: String, studentId: String): LinksResponse {
        val body = buildJsonObject { put("studentId", studentId) }.toString()
        return c.request("POST", "/api/activities/$activityId/regenerate-links", LinksResponse.serializer(), body)
    }

    suspend fun activity(id: String): ActivityDetail = c.request("GET", "/api/activities/$id", ActivityDetail.serializer())
    suspend fun cancelActivity(id: String) { c.request("POST", "/api/activities/$id/cancel", OkResponse.serializer()) }
    /** [compareMode] (easy/medium/hard) = try another level without changing the activity; it never counts as approval. */
    suspend fun startPreview(id: String, compareMode: String? = null): PreviewStarted {
        val body = if (compareMode != null) buildJsonObject { put("compareMode", compareMode) }.toString() else null
        return c.request("POST", "/api/activities/$id/preview", PreviewStarted.serializer(), body)
    }
    suspend fun previewFeedback(id: String, feedback: String): ActivityDetail {
        val body = buildJsonObject { put("feedback", feedback) }.toString()
        return c.request("POST", "/api/activities/$id/preview-feedback", ActivityDetail.serializer(), body)
    }
    /** [withoutPreview] = the teacher explicitly chose to publish an untested activity. */
    suspend fun publishActivity(id: String, withoutPreview: Boolean = false): ActivityDetail {
        val body = if (withoutPreview) buildJsonObject { put("withoutPreview", true) }.toString() else null
        return c.request("POST", "/api/activities/$id/publish", ActivityDetail.serializer(), body)
    }
    /** Full edit: every setting is sent (null clears the optional ones). */
    suspend fun updateActivityFull(id: String, e: ActivityEdit): ActivityDetail {
        val body = buildJsonObject {
            put("title", e.title.trim()); put("description", e.description.trim())
            put("suggestedMinutes", e.suggestedMinutes?.let { JsonPrimitive(it) } ?: JsonNull)
            put("difficultyMode", e.difficultyMode); put("questionCount", e.questionCount)
            put("level", e.level?.let { JsonPrimitive(it) } ?: JsonNull)
            put("skills", if (e.skills.isEmpty()) JsonNull else JsonArray(e.skills.map { JsonPrimitive(it) }))
            put("gradeMin", e.gradeMin?.let { JsonPrimitive(it) } ?: JsonNull); put("gradeMax", e.gradeMax?.let { JsonPrimitive(it) } ?: JsonNull)
            put("ageMin", e.ageMin?.let { JsonPrimitive(it) } ?: JsonNull); put("ageMax", e.ageMax?.let { JsonPrimitive(it) } ?: JsonNull)
        }.toString()
        return c.request("PUT", "/api/activities/$id", ActivityDetail.serializer(), body)
    }

    // ---- v1.2 ----
    /** Sends every profile field: null clears it, so the edit form is the single source of truth. */
    suspend fun updateStudent(id: String, name: String, age: Int?, gradeCode: String?, gender: String?, note: String?): StudentEnvelope {
        val body = buildJsonObject {
            put("name", name.trim())
            put("age", age?.let { JsonPrimitive(it) } ?: JsonNull)
            put("gradeCode", gradeCode?.let { JsonPrimitive(it) } ?: JsonNull)
            put("gender", gender?.let { JsonPrimitive(it) } ?: JsonNull)
            put("note", note?.trim()?.ifBlank { null }?.let { JsonPrimitive(it) } ?: JsonNull)
        }.toString()
        return c.request("PUT", "/api/students/$id", StudentEnvelope.serializer(), body)
    }
    suspend fun studentProfile(id: String): EducationalProfile = c.request("GET", "/api/students/$id/profile", EducationalProfile.serializer())
    suspend fun recommendations(id: String): RecommendationsResponse = c.request("GET", "/api/students/$id/recommendations", RecommendationsResponse.serializer())
    suspend fun templates(): TemplatesResponse = c.request("GET", "/api/templates", TemplatesResponse.serializer())
    suspend fun aiDraft(prompt: String, classId: String?, studentId: String?): DraftResponse {
        val body = buildJsonObject {
            put("prompt", prompt.trim())
            if (classId != null) put("classId", classId)
            if (studentId != null) put("studentId", studentId)
        }.toString()
        return c.request("POST", "/api/ai/activity-draft", DraftResponse.serializer(), body)
    }
    suspend fun dashboard(query: String = ""): DashboardResponse = c.request("GET", "/api/dashboard$query", DashboardResponse.serializer())

    /** Creates an activity from the teacher-approved form (plain, template or AI draft all end up here). */
    suspend fun createActivityV12(spec: ActivitySpec): ActivityCreated {
        val body = buildJsonObject {
            put("classId", spec.classId); put("gameType", spec.gameType); put("difficultyMode", spec.difficultyMode); put("questionCount", spec.questionCount)
            put("studentIds", if (spec.studentIds == null) JsonPrimitive("all") else JsonArray(spec.studentIds.map { JsonPrimitive(it) }))
            spec.title?.takeIf { it.isNotBlank() }?.let { put("title", it.trim()) }
            spec.description?.takeIf { it.isNotBlank() }?.let { put("description", it.trim()) }
            spec.suggestedMinutes?.let { put("suggestedMinutes", it) }
            spec.level?.let { put("level", it) }
            if (spec.skills.isNotEmpty()) put("skills", JsonArray(spec.skills.map { JsonPrimitive(it) }))
            spec.gradeMin?.let { put("gradeMin", it) }
            spec.gradeMax?.let { put("gradeMax", it) }
            spec.ageMin?.let { put("ageMin", it) }
            spec.ageMax?.let { put("ageMax", it) }
            spec.templateId?.let { put("templateId", it) }
        }.toString()
        return c.request("POST", "/api/activities", ActivityCreated.serializer(), body)
    }

    // ---- Teacher Assessments (آزمون‌های معلم) ----
    suspend fun assessments(status: String = "all"): AssessmentList = c.request("GET", "/api/assessments?status=$status", AssessmentList.serializer())
    suspend fun assessment(id: String): AssessmentDetail = c.request("GET", "/api/assessments/$id", AssessmentDetail.serializer())
    suspend fun createAssessment(title: String, subject: String?, gradeCode: String?, level: String?, description: String?, minutes: Int?): AssessmentDetail =
        c.request("POST", "/api/assessments", AssessmentDetail.serializer(), assessmentBody(title, subject, gradeCode, level, description, minutes))
    suspend fun updateAssessment(id: String, title: String, subject: String?, gradeCode: String?, level: String?, description: String?, minutes: Int?): AssessmentDetail =
        c.request("PUT", "/api/assessments/$id", AssessmentDetail.serializer(), assessmentBody(title, subject, gradeCode, level, description, minutes))
    private fun assessmentBody(title: String, subject: String?, gradeCode: String?, level: String?, description: String?, minutes: Int?): String = buildJsonObject {
        put("title", title.trim())
        put("subject", subject?.trim()?.ifBlank { null }?.let { JsonPrimitive(it) } ?: JsonNull)
        put("gradeCode", gradeCode?.let { JsonPrimitive(it) } ?: JsonNull)
        put("level", level?.let { JsonPrimitive(it) } ?: JsonNull)
        put("description", description?.trim()?.ifBlank { null }?.let { JsonPrimitive(it) } ?: JsonNull)
        put("suggestedMinutes", minutes?.let { JsonPrimitive(it) } ?: JsonNull)
    }.toString()
    private fun questionBody(q: QuestionDraft): String = buildJsonObject {
        put("type", q.type); put("text", q.text.trim())
        when (q.type) {
            "multiple_choice" -> { put("options", JsonArray(q.options.map { JsonPrimitive(it.trim()) })); q.correctIndex?.let { put("correct", it) } }
            "true_false" -> q.correctBool?.let { put("correct", it) }
            else -> put("answers", JsonArray(q.answers.map { it.trim() }.filter { it.isNotEmpty() }.map { JsonPrimitive(it) }))
        }
        put("explanation", q.explanation.trim().ifBlank { null }?.let { JsonPrimitive(it) } ?: JsonNull)
    }.toString()
    suspend fun addAssessmentQuestion(id: String, q: QuestionDraft): AssessmentDetail = c.request("POST", "/api/assessments/$id/questions", AssessmentDetail.serializer(), questionBody(q))
    suspend fun updateAssessmentQuestion(id: String, qid: String, q: QuestionDraft): AssessmentDetail = c.request("PUT", "/api/assessments/$id/questions/$qid", AssessmentDetail.serializer(), questionBody(q))
    suspend fun deleteAssessmentQuestion(id: String, qid: String): AssessmentDetail = c.request("DELETE", "/api/assessments/$id/questions/$qid", AssessmentDetail.serializer())
    suspend fun duplicateAssessmentQuestion(id: String, qid: String): AssessmentDetail = c.request("POST", "/api/assessments/$id/questions/$qid/duplicate", AssessmentDetail.serializer())
    suspend fun reorderAssessment(id: String, order: List<String>): AssessmentDetail {
        val body = buildJsonObject { put("order", JsonArray(order.map { JsonPrimitive(it) })) }.toString()
        return c.request("POST", "/api/assessments/$id/reorder", AssessmentDetail.serializer(), body)
    }
    suspend fun startAssessmentPreview(id: String): AssessmentPreviewStarted = c.request("POST", "/api/assessments/$id/preview", AssessmentPreviewStarted.serializer())
    suspend fun assessmentPreviewFeedback(id: String, feedback: String): AssessmentDetail {
        val body = buildJsonObject { put("feedback", feedback) }.toString()
        return c.request("POST", "/api/assessments/$id/preview-feedback", AssessmentDetail.serializer(), body)
    }
    /** [classId] null = publish only; with a class every student of the class gets a personal /play link. */
    suspend fun publishAssessment(id: String, classId: String?, studentIds: List<String>? = null): AssessmentDetail {
        val body = buildJsonObject {
            if (classId != null) { put("classId", classId); if (studentIds != null) put("studentIds", JsonArray(studentIds.map { JsonPrimitive(it) })) }
        }.toString()
        return c.request("POST", "/api/assessments/$id/publish", AssessmentDetail.serializer(), body)
    }
    /** [studentIds] null = whole class; otherwise only these students (ids of that class) get a personal link. */
    suspend fun assignAssessment(id: String, classId: String, studentIds: List<String>? = null): AssessmentDetail {
        val body = buildJsonObject {
            put("classId", classId)
            if (studentIds != null) put("studentIds", JsonArray(studentIds.map { JsonPrimitive(it) }))
        }.toString()
        return c.request("POST", "/api/assessments/$id/assign", AssessmentDetail.serializer(), body)
    }
    suspend fun duplicateAssessment(id: String): AssessmentDetail = c.request("POST", "/api/assessments/$id/duplicate", AssessmentDetail.serializer())
    suspend fun newAssessmentVersion(id: String): AssessmentDetail = c.request("POST", "/api/assessments/$id/new-version", AssessmentDetail.serializer())
    suspend fun setAssessmentArchived(id: String, archived: Boolean): AssessmentDetail =
        c.request("POST", "/api/assessments/$id/${if (archived) "archive" else "unarchive"}", AssessmentDetail.serializer())
    suspend fun deleteAssessment(id: String) { c.request("DELETE", "/api/assessments/$id", OkResponse.serializer()) }
    suspend fun assessmentReport(id: String): AssessmentReport = c.request("GET", "/api/assessments/$id/report", AssessmentReport.serializer())
    suspend fun studentAssessments(studentId: String): StudentAssessments = c.request("GET", "/api/students/$studentId/assessments", StudentAssessments.serializer())
    /** AI makes a DRAFT only (never published). No student data is sent. */
    suspend fun aiAssessmentDraft(prompt: String, subject: String?, gradeCode: String?, level: String?, count: Int): AssessmentDetail {
        val body = buildJsonObject {
            put("prompt", prompt.trim()); put("questionCount", count)
            subject?.trim()?.takeIf { it.isNotEmpty() }?.let { put("subject", it) }
            gradeCode?.let { put("gradeCode", it) }; level?.let { put("level", it) }
        }.toString()
        return c.request("POST", "/api/ai/assessment-draft", AssessmentDetail.serializer(), body)
    }

    suspend fun studentReport(id: String): StudentReport = c.request("GET", "/api/reports/student/$id", StudentReport.serializer())
    suspend fun classReport(id: String): ClassReport = c.request("GET", "/api/reports/class/$id", ClassReport.serializer())
}

@kotlinx.serialization.Serializable
data class OkResponse(val ok: Boolean = true)

@kotlinx.serialization.Serializable
data class ClearDataResponse(val ok: Boolean = true, val clearedActivities: Int = 0)
