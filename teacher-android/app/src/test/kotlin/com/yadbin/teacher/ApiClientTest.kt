package com.yadbin.teacher

import com.yadbin.teacher.core.network.ApiClient
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.data.remote.ApiService
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class ApiClientTest {
    private lateinit var server: MockWebServer
    private var token: String? = null
    private var unauthorized = 0
    private lateinit var api: ApiService

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val client = ApiClient(server.url("/").toString(), { token }, { unauthorized++ })
        api = ApiService(client)
    }
    @After fun tearDown() { runCatching { server.shutdown() } }

    private fun ok(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test fun login_sends_json_and_parses_token() = runTest {
        server.enqueue(ok("""{"token":"jwt.abc","teacher":{"id":"t1","name":"معلم","phone":"09123456789"}}"""))
        val r = api.login("09123456789", "password123")
        assertEquals("jwt.abc", r.token)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/auth/login", req.path)
        assertNull("no Authorization header before login", req.getHeader("Authorization"))
        val body = Json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("09123456789", body["phone"]!!.jsonPrimitive.content)
    }

    @Test fun teacher_endpoints_send_bearer_token() = runTest {
        token = "jwt.abc"
        server.enqueue(ok("""{"classes":[]}"""))
        api.classes()
        assertEquals("Bearer jwt.abc", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun error_body_maps_to_persian_ApiException() = runTest {
        server.enqueue(ok("""{"error":"invalid_credentials","message":"شماره موبایل یا رمز عبور اشتباه است."}""", 401))
        val e = runCatching { api.login("09123456789", "wrongpass") }.exceptionOrNull()
        assertTrue(e is ApiException)
        e as ApiException
        assertEquals("invalid_credentials", e.code)
        assertEquals(401, e.status)
        assertEquals("شماره موبایل یا رمز عبور اشتباه است.", e.message)
        assertEquals("a failed login is not an expired session", 0, unauthorized)
    }

    @Test fun rejected_token_triggers_session_expiry() = runTest {
        token = "expired"
        server.enqueue(ok("""{"error":"unauthorized","message":"نشست منقضی شده."}""", 401))
        assertTrue(runCatching { api.classes() }.exceptionOrNull() is ApiException)
        assertEquals(1, unauthorized)
    }

    @Test fun non_json_error_still_gives_a_message() = runTest {
        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>bad gateway</html>"))
        val e = runCatching { api.classes() }.exceptionOrNull() as ApiException
        assertEquals(502, e.status)
        assertTrue(e.message!!.isNotBlank())
    }

    @Test fun unreachable_server_is_NetworkException() = runTest {
        server.shutdown()
        assertTrue(runCatching { api.classes() }.exceptionOrNull() is NetworkException)
    }

    @Test fun create_activity_encodes_all_or_id_list() = runTest {
        val created = """{"activity":{"id":"a1","classId":"c1","gameType":"memory","difficultyMode":"adaptive","questionCount":10,"status":"active"},"links":[{"studentId":"s1","name":"علی","token":"TOK","url":"https://x/play/TOK"}]}"""
        server.enqueue(ok(created, 201)); server.enqueue(ok(created, 201))
        token = "jwt"
        val r = api.createActivity("c1", "memory", "adaptive", 10, null)
        assertEquals("https://x/play/TOK", r.links.single().url)
        api.createActivity("c1", "memory", "adaptive", 10, listOf("s1", "s2"))

        val first = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals(JsonPrimitive("all"), first["studentIds"])
        val second = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals(listOf("s1", "s2"), (second["studentIds"] as JsonArray).map { it.jsonPrimitive.content })
        assertEquals(10, second["questionCount"]!!.jsonPrimitive.content.toInt())
    }

    @Test fun class_without_school_omits_or_nulls_it() = runTest {
        token = "jwt"
        server.enqueue(ok("""{"class":{"id":"c1","name":"سوم الف","grade":"سوم","schoolName":null,"createdAt":"2026-01-01"}}""", 201))
        val c = api.createClass("سوم الف", "سوم", "  ").cls
        assertEquals("c1", c.id)
        val body = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertFalse("blank school must not be sent as an empty string", body["schoolName"]?.jsonPrimitive?.content == "")
    }
}
