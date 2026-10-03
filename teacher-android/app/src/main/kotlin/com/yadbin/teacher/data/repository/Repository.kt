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
    suspend fun templates(): Loaded<TemplatesResponse> = cached("templates", TemplatesResponse.serializer()) { api.templates() }
    suspend fun dashboard(query: String = ""): Loaded<DashboardResponse> = cached("dashboard:$query", DashboardResponse.serializer()) { api.dashboard(query) }
    suspend fun updateStudent(id: String, name: String, age: Int?, gradeCode: String?, gender: String?, note: String?): EduStudent =
        api.updateStudent(id, name, age, gradeCode, gender, note).student
    suspend fun aiDraft(prompt: String, classId: String?, studentId: String?): DraftResponse = api.aiDraft(prompt, classId, studentId)
    suspend fun createActivityFromSpec(spec: ActivitySpec): ActivityCreated = api.createActivityV12(spec)

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
