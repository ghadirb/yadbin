package com.yadbin.teacher

import com.yadbin.teacher.core.auth.MemoryTokenStore
import com.yadbin.teacher.core.network.ApiClient
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.data.local.MemoryCacheStore
import com.yadbin.teacher.data.remote.ApiService
import com.yadbin.teacher.data.repository.Repository
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class RepositoryTest {
    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    private val classes = """{"classes":[{"id":"c1","name":"سوم الف","grade":"سوم","studentCount":5,"recentActivityCount":2}]}"""

    @Test fun login_saves_session_and_logout_clears_everything() = runTest {
        val server = MockWebServer().also { it.start() }
        val tokens = MemoryTokenStore(); val cache = MemoryCacheStore()
        val repo = Repository(ApiService(ApiClient(server.url("/").toString(), { tokens.token() })), cache, tokens)
        server.enqueue(json("""{"token":"jwt","teacher":{"id":"t","name":"معلم","phone":"09123456789"}}"""))
        repo.login("09123456789", "password123")
        assertTrue(repo.isLoggedIn); assertEquals("معلم", repo.teacherName)
        server.enqueue(json(classes)); repo.classes()
        assertNotNull(cache.get("classes"))
        repo.logout()
        assertFalse(repo.isLoggedIn); assertNull("previous teacher's data must not survive logout", cache.get("classes"))
        server.shutdown()
    }

    @Test fun offline_falls_back_to_last_saved_copy() = runTest {
        val server = MockWebServer().also { it.start() }
        val tokens = MemoryTokenStore().also { it.save("jwt", "معلم") }
        val repo = Repository(ApiService(ApiClient(server.url("/").toString(), { tokens.token() })), MemoryCacheStore(), tokens)

        server.enqueue(json(classes))
        val online = repo.classes()
        assertFalse(online.fromCache); assertEquals(5, online.data.classes.single().studentCount)

        server.shutdown()                                   // connection lost
        val offline = repo.classes()
        assertTrue(offline.fromCache)
        assertEquals("سوم الف", offline.data.classes.single().name)
    }

    @Test fun offline_without_cache_reports_network_error() = runTest {
        val server = MockWebServer().also { it.start() }
        val tokens = MemoryTokenStore().also { it.save("jwt", "معلم") }
        val repo = Repository(ApiService(ApiClient(server.url("/").toString(), { tokens.token() })), MemoryCacheStore(), tokens)
        server.shutdown()
        assertTrue(runCatching { repo.classes() }.exceptionOrNull() is NetworkException)
    }
}
