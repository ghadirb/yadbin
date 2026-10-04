package com.yadbin.teacher.core.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

/** Server answered with an error. [message] is already user-facing Persian text. */
class ApiException(val code: String, message: String, val status: Int) : Exception(message)

/** The server could not be reached (offline, DNS, timeout). */
class NetworkException(message: String = "اتصال اینترنت برقرار نیست.") : Exception(message)

@Serializable
private data class ErrorBody(val error: String? = null, val message: String? = null)

/** Thin HTTP layer: JSON in/out, Bearer auth, error mapping. No Android dependencies (unit-testable). */
@OptIn(ExperimentalSerializationApi::class)
class ApiClient(
    baseUrl: String,
    private val tokenProvider: () -> String?,
    private val onUnauthorized: () -> Unit = {},
    /** Called with the server's Persian message when a Free-plan limit is hit (FEATURE_LIMIT_REACHED) so the UI can offer the upgrade screen. */
    private val onLimitReached: (String) -> Unit = {},
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS)
        .build(),
) {
    val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }
    private val base = baseUrl.trimEnd('/')
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun <T> request(method: String, path: String, serializer: KSerializer<T>, body: String? = null): T =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(base + path).header("Accept", "application/json")
            val token = tokenProvider()
            if (token != null) builder.header("Authorization", "Bearer $token")
            val payload = when {
                body != null -> body.toRequestBody(jsonType)
                method == "POST" || method == "PUT" -> "{}".toRequestBody(jsonType)
                else -> null
            }
            builder.method(method, payload)
            // Spec 6.2: one quiet retry for READS only (idempotent). Writes are never auto-retried (no duplicate classes/activities).
            val attempts = if (method == "GET") 2 else 1
            var lastError: IOException? = null
            for (attempt in 1..attempts) {
                try {
                    return@withContext http.newCall(builder.build()).execute().use { resp ->
                        val text = resp.body?.string().orEmpty()
                        if (!resp.isSuccessful) {
                            if (resp.code == 401 && token != null) onUnauthorized()
                            val ex = toApiException(resp.code, text)
                            if (ex.code == "FEATURE_LIMIT_REACHED") onLimitReached(ex.message ?: "")
                            throw ex
                        }
                        try {
                            json.decodeFromString(serializer, text)
                        } catch (e: SerializationException) {
                            throw ApiException("bad_response", "پاسخ نامعتبر از سرور دریافت شد.", resp.code)
                        }
                    }
                } catch (e: IOException) {
                    if (attempt < attempts) kotlinx.coroutines.delay(600) else lastError = e
                }
            }
            throw networkError(lastError)
        }

    /**
     * Every IOException used to read «اتصال اینترنت برقرار نیست», even when the phone WAS online and only the server was slow or briefly unreachable.
     * Same exception type (the offline cache fallback relies on it), honest text.
     */
    private fun networkError(e: IOException?): NetworkException = when (e) {
        is SocketTimeoutException -> NetworkException("سرور دیر پاسخ داد. چند لحظه بعد دوباره تلاش کنید.")
        is UnknownHostException, is ConnectException -> NetworkException("ارتباط با سرور برقرار نشد. اتصال اینترنت یا فیلترشکن/DNS را بررسی کنید و دوباره تلاش کنید.")
        null -> NetworkException()
        else -> NetworkException("ارتباط با سرور قطع شد. دوباره تلاش کنید.")
    }

    private fun toApiException(status: Int, text: String): ApiException {
        val parsed = try { json.decodeFromString(ErrorBody.serializer(), text) } catch (e: Exception) { null }
        val message = parsed?.message?.takeIf { it.isNotBlank() } ?: "دریافت اطلاعات با مشکل مواجه شد. لطفاً دوباره تلاش کنید."
        return ApiException(parsed?.error ?: "http_$status", message, status)
    }
}
