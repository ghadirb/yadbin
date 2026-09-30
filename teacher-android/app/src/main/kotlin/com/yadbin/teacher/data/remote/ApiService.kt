package com.yadbin.teacher.data.remote

import com.yadbin.teacher.core.network.ApiClient
import com.yadbin.teacher.domain.models.*
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

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

    suspend fun createClass(name: String, grade: String, school: String?): ClassEnvelope =
        c.request("POST", "/api/classes", ClassEnvelope.serializer(), j.encodeToString(ClassRequest.serializer(), ClassRequest(name, grade, school?.ifBlank { null })))

    suspend fun classDetail(id: String): ClassDetail = c.request("GET", "/api/classes/$id", ClassDetail.serializer())

    suspend fun updateClass(id: String, name: String, grade: String, school: String?): ClassEnvelope =
        c.request("PUT", "/api/classes/$id", ClassEnvelope.serializer(), j.encodeToString(ClassRequest.serializer(), ClassRequest(name, grade, school?.ifBlank { null })))

    suspend fun deleteClass(id: String) { c.request("DELETE", "/api/classes/$id", OkResponse.serializer()) }

    suspend fun addStudents(classId: String, text: String): AddStudentsResponse =
        c.request("POST", "/api/classes/$classId/students", AddStudentsResponse.serializer(), j.encodeToString(AddStudentsRequest.serializer(), AddStudentsRequest(text)))

    /** Leaves the class; the student's data is kept. */
    suspend fun removeFromClass(classId: String, studentId: String) {
        c.request("DELETE", "/api/classes/$classId/students/$studentId", OkResponse.serializer())
    }

    /** Permanently deletes the student and all results. */
    suspend fun deleteStudentData(studentId: String) { c.request("DELETE", "/api/students/$studentId", OkResponse.serializer()) }

    suspend fun createActivity(classId: String, gameType: String, difficulty: String, questionCount: Int, studentIds: List<String>?): ActivityCreated {
        val ids: JsonElement = if (studentIds == null) JsonPrimitive("all") else JsonArray(studentIds.map { JsonPrimitive(it) })
        val body = j.encodeToString(ActivityRequest.serializer(), ActivityRequest(classId, gameType, difficulty, questionCount, ids))
        return c.request("POST", "/api/activities", ActivityCreated.serializer(), body)
    }

    suspend fun activity(id: String): ActivityDetail = c.request("GET", "/api/activities/$id", ActivityDetail.serializer())
    suspend fun cancelActivity(id: String) { c.request("POST", "/api/activities/$id/cancel", OkResponse.serializer()) }

    suspend fun studentReport(id: String): StudentReport = c.request("GET", "/api/reports/student/$id", StudentReport.serializer())
    suspend fun classReport(id: String): ClassReport = c.request("GET", "/api/reports/class/$id", ClassReport.serializer())
}

@kotlinx.serialization.Serializable
data class OkResponse(val ok: Boolean = true)
