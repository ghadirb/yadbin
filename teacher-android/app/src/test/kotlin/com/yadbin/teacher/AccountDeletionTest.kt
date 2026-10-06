package com.yadbin.teacher

import com.yadbin.teacher.core.auth.MemoryTokenStore
import com.yadbin.teacher.core.diagnostics.CrashLog
import com.yadbin.teacher.core.network.ApiClient
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.utils.Support
import com.yadbin.teacher.data.local.MemoryCacheStore
import com.yadbin.teacher.data.remote.ApiService
import com.yadbin.teacher.data.repository.Repository
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

/** Account deletion (client side), support links and the local crash report. */
class AccountDeletionTest {
    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private class Env(val server: MockWebServer, val tokens: MemoryTokenStore, val cache: MemoryCacheStore, val repo: Repository, val unauthorized: IntArray)

    // suspend: CacheStore.put is a suspend function (called from runTest)
    private suspend fun env(): Env {
        val server = MockWebServer().also { it.start() }
        val tokens = MemoryTokenStore().also { it.save("jwt", "معلم") }
        val cache = MemoryCacheStore().also { it.put("classes", "{}") }
        val unauthorized = intArrayOf(0)
        val client = ApiClient(server.url("/").toString(), { tokens.token() }, onUnauthorized = { unauthorized[0]++ })
        return Env(server, tokens, cache, Repository(ApiService(client), cache, tokens), unauthorized)
    }

    @Test fun delete_sends_password_and_confirm_then_clears_session_and_cache() = runTest {
        val e = env()
        e.server.enqueue(json("""{"ok":true,"deleted":true}"""))
        e.repo.deleteAccount("secret-pass")
        val req = e.server.takeRequest()
        assertEquals("POST", req.method); assertEquals("/api/account/delete", req.path)
        assertEquals("Bearer jwt", req.getHeader("Authorization"))
        val body = req.body.readUtf8()
        assertTrue(body, body.contains("\"password\":\"secret-pass\"")); assertTrue(body, body.contains("\"confirm\":true"))
        assertFalse(e.repo.isLoggedIn); assertNull(e.cache.get("classes"))
        e.server.shutdown()
    }

    @Test fun wrong_password_is_403_keeps_the_session_and_does_not_log_out() = runTest {
        val e = env()
        e.server.enqueue(json("""{"error":"wrong_password","message":"رمز عبور اشتباه است."}""", 403))
        val ex = runCatching { e.repo.deleteAccount("bad") }.exceptionOrNull()
        assertTrue(ex is ApiException); assertEquals(403, (ex as ApiException).status)
        assertTrue("a mistyped password must keep the teacher logged in", e.repo.isLoggedIn)
        assertNotNull(e.cache.get("classes"))
        assertEquals("403 must never trigger the «session expired» path", 0, e.unauthorized[0])
        e.server.shutdown()
    }

    @Test fun already_deleted_404_still_cleans_up_locally() = runTest {
        val e = env()
        e.server.enqueue(json("""{"error":"not_found","message":"حساب پیدا نشد."}""", 404))
        e.repo.deleteAccount("secret-pass")
        assertFalse(e.repo.isLoggedIn); assertNull(e.cache.get("classes"))
        e.server.shutdown()
    }

    @Test fun other_server_errors_keep_the_account_and_the_local_data() = runTest {
        val e = env()
        e.server.enqueue(json("""{"error":"rate_limited","message":"تلاش‌های زیاد."}""", 429))
        assertTrue(runCatching { e.repo.deleteAccount("x") }.exceptionOrNull() is ApiException)
        assertTrue(e.repo.isLoggedIn); assertNotNull(e.cache.get("classes"))
        e.server.shutdown()
    }

    @Test fun delete_button_needs_password_and_confirmation() {
        assertFalse(Support.canDelete("", true))
        assertFalse(Support.canDelete("pass", false))
        assertTrue(Support.canDelete("pass", true))
    }

    @Test fun legal_pages_are_built_on_the_api_origin() {
        assertEquals("https://x.workers.dev/privacy", Support.privacyUrl("https://x.workers.dev"))
        assertEquals("https://x.workers.dev/terms", Support.termsUrl("https://x.workers.dev/"))
        assertEquals("https://x.workers.dev/support", Support.supportUrl("https://x.workers.dev//"))
        assertTrue(Support.TELEGRAM_URL.endsWith("MaliarProSupport")); assertTrue(Support.RUBIKA_URL.endsWith("MaliarProSupport")); assertTrue(Support.EITAA_URL.endsWith("MaliarProSupport"))
    }

    @Test fun crash_report_has_class_names_and_frames_but_never_the_message() {
        val secret = "نام دانش‌آموز: علی رضایی"
        val report = CrashLog.format(IllegalStateException(secret, RuntimeException("inner $secret")), "1.0.0 (7)", "Test Phone, Android 14")
        assertTrue(report.contains("app=1.0.0 (7)")); assertTrue(report.contains("device=Test Phone, Android 14"))
        assertTrue(report.contains("exception=java.lang.IllegalStateException")); assertTrue(report.contains("caused by=java.lang.RuntimeException"))
        assertTrue(report.contains("  at "))
        assertFalse("exception messages may contain user text and must never be stored", report.contains("علی") || report.contains("inner"))
    }
}
