package com.yadbin.teacher.data.repository

import com.yadbin.teacher.core.auth.TokenStore
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.data.local.CacheStore
import com.yadbin.teacher.data.remote.ApiService
import com.yadbin.teacher.domain.models.*
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json

/** [fromCache] = the network was unreachable and the last saved copy is shown. */
data class Loaded<T>(val data: T, val fromCache: Boolean = false)

class Repository(
    private val api: ApiService,
    private val cache: CacheStore,
    private val tokens: TokenStore,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    val isLoggedIn: Boolean get() = tokens.token() != null
    val teacherName: String? get() = tokens.teacherName()

    suspend fun login(phone: String, password: String) {
        val r = api.login(phone, password)
        cache.clear()                      // never show a previous teacher's cached data
        tokens.save(r.token, r.teacher.name)
    }

    /** Returns the one-time recovery code (shown to the teacher; needed for "forgot password"). */
    suspend fun register(name: String, phone: String, password: String): String? {
        val r = api.register(name, phone, password)
        cache.clear()
        tokens.save(r.token, r.teacher.name)
        return r.recoveryCode
    }

    suspend fun resetPassword(phone: String, recoveryCode: String, newPassword: String): String? {
        val r = api.resetPassword(phone, recoveryCode, newPassword)
        cache.clear()
        tokens.save(r.token, r.teacher.name)
        return r.recoveryCode
    }

    suspend fun logout() {
        tokens.clear()
        cache.clear()
    }

    // ---- reads (network first, cached copy when offline) ------------------------------------
    suspend fun classes(): Loaded<ClassesResponse> = cached("classes", ClassesResponse.serializer()) { api.classes() }
    suspend fun archivedClasses(): Loaded<ClassesResponse> = cached("classes:archived", ClassesResponse.serializer()) { api.archivedClasses() }
    suspend fun studentHistory(id: String): Loaded<StudentHistory> = cached("history:$id", StudentHistory.serializer()) { api.studentHistory(id) }
    suspend fun classDetail(id: String): Loaded<ClassDetail> = cached("class:$id", ClassDetail.serializer()) { api.classDetail(id) }
    suspend fun classReport(id: String): Loaded<ClassReport> = cached("classReport:$id", ClassReport.serializer()) { api.classReport(id) }
    suspend fun studentReport(id: String): Loaded<StudentReport> = cached("student:$id", StudentReport.serializer()) { api.studentReport(id) }
    suspend fun activity(id: String): Loaded<ActivityDetail> = cached("activity:$id", ActivityDetail.serializer()) { api.activity(id) }

    // ---- writes (always need the network) ---------------------------------------------------
    suspend fun createClass(name: String, grade: String, school: String?, gradeCode: String? = null, ageMin: Int? = null, ageMax: Int? = null): ClassSummary =
        api.createClass(name, grade, school, gradeCode, ageMin, ageMax).cls
    suspend fun updateClass(id: String, name: String, grade: String, school: String?, gradeCode: String? = null, ageMin: Int? = null, ageMax: Int? = null): ClassSummary =
        api.updateClass(id, name, grade, school, gradeCode, ageMin, ageMax).cls
    suspend fun deleteClass(id: String) = api.deleteClass(id)
    suspend fun addStudents(classId: String, text: String, gender: String? = null): AddStudentsResponse = api.addStudents(classId, text, gender)
    suspend fun removeFromClass(classId: String, studentId: String) = api.removeFromClass(classId, studentId)
    suspend fun clearStudentData(studentId: String) = api.clearStudentData(studentId)
    suspend fun deleteStudentData(studentId: String) = api.deleteStudentData(studentId)
    suspend fun createActivity(classId: String, gameType: String, difficulty: String, questionCount: Int, studentIds: List<String>?): ActivityCreated =
        api.createActivity(classId, gameType, difficulty, questionCount, studentIds)
    suspend fun cancelActivity(id: String) = api.cancelActivity(id)
    suspend fun setClassArchived(id: String, archived: Boolean): ClassSummary = api.setClassArchived(id, archived).cls
    suspend fun updateActivity(id: String, title: String, description: String, minutes: Int?): ActivityDetail = api.updateActivity(id, title, description, minutes)
    suspend fun duplicateActivity(id: String): ActivityCreated = api.duplicateActivity(id)
    suspend fun setActivityArchived(id: String, archived: Boolean): ActivityDetail = api.setActivityArchived(id, archived)
    suspend fun regenerateLink(activityId: String, studentId: String): LinksResponse = api.regenerateLink(activityId, studentId)
    suspend fun startPreview(id: String, compareMode: String? = null) = api.startPreview(id, compareMode)
    suspend fun updateActivityFull(id: String, edit: ActivityEdit): ActivityDetail = api.updateActivityFull(id, edit)
    suspend fun previewFeedback(id: String, feedback: String) = api.previewFeedback(id, feedback)
    suspend fun publishActivity(id: String, withoutPreview: Boolean = false) = api.publishActivity(id, withoutPreview)

    // ---- v1.2 ----
    suspend fun studentProfile(id: String): Loaded<EducationalProfile> = cached("profile:$id", EducationalProfile.serializer()) { api.studentProfile(id) }
    suspend fun recommendations(id: String): Loaded<RecommendationsResponse> = cached("recs:$id", RecommendationsResponse.serializer()) { api.recommendations(id) }
    suspend fun studentGrowth(id: String, q: GrowthQuery): Loaded<StudentGrowth> = cached("growth:$id:${q.queryString()}", StudentGrowth.serializer()) { api.studentGrowth(id, q) }
    suspend fun growthSummary(id: String, q: GrowthQuery): GrowthSummary = api.growthSummary(id, q)
    // comprehensive report: always live (a printed report must not come from a stale cache)
    suspend fun fullReportMeta(id: String): ReportMeta = api.fullReportMeta(id)
    suspend fun fullReportHtml(id: String, q: ReportQuery): ReportHtml = api.fullReportHtml(id, q)
    suspend fun templates(): Loaded<TemplatesResponse> = cached("templates", TemplatesResponse.serializer()) { api.templates() }
    suspend fun dashboard(query: String = ""): Loaded<DashboardResponse> = cached("dashboard:$query", DashboardResponse.serializer()) { api.dashboard(query) }
    suspend fun updateStudent(id: String, name: String, age: Int?, gradeCode: String?, gender: String?, note: String?): EduStudent =
        api.updateStudent(id, name, age, gradeCode, gender, note).student
    suspend fun aiDraft(prompt: String, classId: String?, studentId: String?): DraftResponse = api.aiDraft(prompt, classId, studentId)
    suspend fun createActivityFromSpec(spec: ActivitySpec): ActivityCreated = api.createActivityV12(spec)

    // ---- Teacher Assessments ----
    suspend fun assessments(status: String = "all"): Loaded<AssessmentList> = cached("assessments:$status", AssessmentList.serializer()) { api.assessments(status) }
    suspend fun assessment(id: String): Loaded<AssessmentDetail> = cached("assessment:$id", AssessmentDetail.serializer()) { api.assessment(id) }
    suspend fun assessmentReport(id: String): Loaded<AssessmentReport> = cached("assessmentReport:$id", AssessmentReport.serializer()) { api.assessmentReport(id) }
    suspend fun studentAssessments(studentId: String): Loaded<StudentAssessments> = cached("studentAssessments:$studentId", StudentAssessments.serializer()) { api.studentAssessments(studentId) }
    suspend fun createAssessment(title: String, subject: String?, gradeCode: String?, level: String?, description: String?, minutes: Int?) = api.createAssessment(title, subject, gradeCode, level, description, minutes)
    suspend fun updateAssessment(id: String, title: String, subject: String?, gradeCode: String?, level: String?, description: String?, minutes: Int?) = api.updateAssessment(id, title, subject, gradeCode, level, description, minutes)
    suspend fun addAssessmentQuestion(id: String, q: QuestionDraft) = api.addAssessmentQuestion(id, q)
    suspend fun updateAssessmentQuestion(id: String, qid: String, q: QuestionDraft) = api.updateAssessmentQuestion(id, qid, q)
    suspend fun deleteAssessmentQuestion(id: String, qid: String) = api.deleteAssessmentQuestion(id, qid)
    suspend fun duplicateAssessmentQuestion(id: String, qid: String) = api.duplicateAssessmentQuestion(id, qid)
    suspend fun reorderAssessment(id: String, order: List<String>) = api.reorderAssessment(id, order)
    suspend fun startAssessmentPreview(id: String) = api.startAssessmentPreview(id)
    suspend fun assessmentPreviewFeedback(id: String, feedback: String) = api.assessmentPreviewFeedback(id, feedback)
    suspend fun publishAssessment(id: String, classId: String?, studentIds: List<String>? = null) = api.publishAssessment(id, classId, studentIds)
    suspend fun assignAssessment(id: String, classId: String, studentIds: List<String>? = null) = api.assignAssessment(id, classId, studentIds)
    suspend fun duplicateAssessment(id: String) = api.duplicateAssessment(id)
    suspend fun newAssessmentVersion(id: String) = api.newAssessmentVersion(id)
    suspend fun setAssessmentArchived(id: String, archived: Boolean) = api.setAssessmentArchived(id, archived)
    suspend fun deleteAssessment(id: String) = api.deleteAssessment(id)
    suspend fun aiAssessmentDraft(prompt: String, subject: String?, gradeCode: String?, level: String?, count: Int) = api.aiAssessmentDraft(prompt, subject, gradeCode, level, count)

    // ---- Content sources (کتاب‌ها و منابع درسی): reads work offline from the last saved copy; writes and AI always need the network ----
    suspend fun contentSources(): Loaded<ContentSourceList> = cached("sources", ContentSourceList.serializer()) { api.contentSources() }
    suspend fun contentSource(id: String): Loaded<ContentSourceDetail> = cached("source:$id", ContentSourceDetail.serializer()) { api.contentSource(id) }
    suspend fun createContentSource(title: String, subject: String?, gradeCode: String?, description: String?, fileType: String, originalFileName: String?, text: String?) =
        api.createContentSource(title, subject, gradeCode, description, fileType, originalFileName, text)
    suspend fun updateContentSource(id: String, title: String, subject: String?, gradeCode: String?, description: String?) = api.updateContentSource(id, title, subject, gradeCode, description)
    suspend fun deleteContentSource(id: String) = api.deleteContentSource(id)
    suspend fun processContentSource(id: String, bytes: ByteArray) = api.processContentSource(id, bytes)
    suspend fun processContentSourceText(id: String, text: String) = api.processContentSourceText(id, text)
    suspend fun visionQuota() = api.visionQuota()
    suspend fun readSourcePages(images: List<String>, batchIndex: Int, pageStart: Int, documentHash: String) = api.readSourcePages(images, batchIndex, pageStart, documentHash)
    suspend fun contentSourceSection(id: String, sectionId: String) = api.contentSourceSection(id, sectionId)
    suspend fun aiAssessmentDraftFromSource(spec: SourceDraftSpec) = api.aiAssessmentDraftFromSource(spec)

    // ---- Subscription / payment (the server is the only source of truth; the cached copy is for display while offline) ----
    suspend fun subscription(): Loaded<SubscriptionResponse> = cached("subscription", SubscriptionResponse.serializer()) { api.subscription() }
    suspend fun plans(): Loaded<PlansResponse> = cached("plans", PlansResponse.serializer()) { api.plans() }
    suspend fun createPayment(planId: String) = api.createPayment(planId)
    suspend fun confirmMyketPurchase(originalJson: String, signature: String) = api.confirmMyket(originalJson, signature)

    private suspend fun <T> cached(key: String, serializer: KSerializer<T>, fetch: suspend () -> T): Loaded<T> {
        try {
            val fresh = fetch()
            cache.put(key, json.encodeToString(serializer, fresh))
            return Loaded(fresh, fromCache = false)
        } catch (e: NetworkException) {
            val saved = cache.get(key) ?: throw e
            return Loaded(json.decodeFromString(serializer, saved), fromCache = true)
        }
    }
}
