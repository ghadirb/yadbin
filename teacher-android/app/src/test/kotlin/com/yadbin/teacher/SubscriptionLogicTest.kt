package com.yadbin.teacher

import com.yadbin.teacher.core.billing.KeyMask
import com.yadbin.teacher.core.network.ApiClient
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.domain.models.PlanDto
import com.yadbin.teacher.domain.models.SubEntitlements
import com.yadbin.teacher.domain.models.SubscriptionResponse
import com.yadbin.teacher.ui.subscription.SubscriptionText
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.Test

class SubscriptionLogicTest {
    private fun mask(s: String): String {
        val m = "com.yadbin.teacher".toByteArray()
        return s.toByteArray().mapIndexed { i, b -> "%02x".format((b.toInt() xor m[i % m.size].toInt()) and 0xff) }.joinToString("")
    }

    @Test fun keyMaskRoundTripsTheGradleEncoding() {
        val key = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC+/="
        assertEquals(key, KeyMask.decode(mask(key)))
        assertEquals("", KeyMask.decode(""))
        assertEquals("", KeyMask.decode("zz"))
        assertEquals("", KeyMask.decode("abc"))
    }

    @Test fun daysLeftUsesServerTimeAndRoundsUp() {
        assertEquals(7, SubscriptionText.daysLeft("2026-10-04T10:00:00.000Z", "2026-10-11T10:00:00.000Z"))
        assertEquals(1, SubscriptionText.daysLeft("2026-10-04T10:00:00.000Z", "2026-10-04T10:00:01.000Z"))
        assertEquals(0, SubscriptionText.daysLeft("2026-10-04T10:00:00.000Z", "2026-10-04T09:59:59.000Z"))
        assertNull(SubscriptionText.daysLeft("garbage", "2026-10-04T10:00:00.000Z"))
        assertNull(SubscriptionText.daysLeft("2026-10-04T10:00:00.000Z", null))
    }

    @Test fun titlesFollowTheServerPlanOnly() {
        assertEquals("اشتراک آزمایشی", SubscriptionText.title(SubEntitlements(plan = "TRIAL", status = "TRIAL")))
        assertEquals("اشتراک حرفه‌ای", SubscriptionText.title(SubEntitlements(plan = "PRO", status = "ACTIVE")))
        assertEquals("پلن رایگان", SubscriptionText.title(SubEntitlements(plan = "FREE", status = "EXPIRED")))
        assertTrue(SubscriptionText.headline(SubEntitlements(plan = "FREE", status = "EXPIRED")).contains("تمام شده"))
        assertTrue(SubscriptionText.headline(SubEntitlements(plan = "TRIAL", status = "TRIAL", trialExpiresAt = "2026-10-11T10:00:00.000Z", serverTime = "2026-10-04T10:00:00.000Z")).contains("۷ روز"))
    }

    @Test fun limitLinesAndPrices() {
        assertEquals("کلاس: ۱ از ۱", SubscriptionText.limitLine("کلاس", 1, 1))
        assertEquals("کلاس: نامحدود", SubscriptionText.limitLine("کلاس", null, 3))
        assertNull(SubscriptionText.priceToman(PlanDto(id = "p", price = null, priceAvailable = false)))
        assertEquals("۵۰٬۰۰۰ تومان", SubscriptionText.priceToman(PlanDto(id = "p", price = 500000, currency = "IRR", priceAvailable = true)))
    }

    @Test fun subscriptionJsonFromTheWorkerDecodes() {
        val j = Json { ignoreUnknownKeys = true; explicitNulls = false }
        val r = j.decodeFromString(SubscriptionResponse.serializer(),
            """{"subscription":{"plan":"FREE","status":"EXPIRED","trialActive":false,"subscriptionActive":false,"trialStartedAt":"a","trialExpiresAt":"b","expiresAt":null,"planId":null,"limits":{"maxClasses":1,"maxStudents":10,"maxAssessments":3,"aiRequestsPerMonth":3},"features":{"teacherAssessment":true,"aiBuilder":false,"fullReports":false},"serverTime":"t","extra":1},"usage":{"classes":1,"students":2,"assessments":0,"aiRequests":0},"paymentsAvailable":false}""")
        assertEquals("EXPIRED", r.subscription.status); assertEquals(1, r.subscription.limits.maxClasses); assertFalse(r.paymentsAvailable)
        val pro = j.decodeFromString(SubscriptionResponse.serializer(), """{"subscription":{"plan":"PRO","status":"ACTIVE","limits":{"maxClasses":null,"maxStudents":null,"maxAssessments":null,"aiRequestsPerMonth":null}}}""")
        assertNull(pro.subscription.limits.maxClasses)
    }

    @Test fun featureLimitReachedReachesTheUiHookWithTheServerMessage() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"FEATURE_LIMIT_REACHED","message":"به سقف رسیدید","details":{"feature":"classes"}}"""))
        server.start()
        var got: String? = null
        val client = ApiClient(server.url("/").toString(), { "t" }, onLimitReached = { got = it })
        try { client.request("POST", "/api/classes", String.serializer()); fail() } catch (e: ApiException) { assertEquals("FEATURE_LIMIT_REACHED", e.code); assertEquals(403, e.status) }
        assertEquals("به سقف رسیدید", got)
        server.shutdown()
    }

    @Test fun networkProblemsAreStillNetworkExceptionsButNoLongerAllSayOffline() = runTest {
        val server = MockWebServer(); server.start()
        val url = server.url("/").toString()
        server.shutdown() // connection refused
        val refused = try { ApiClient(url, { null }).request("GET", "/x", String.serializer()); null } catch (e: NetworkException) { e.message }
        assertNotNull(refused); assertTrue(refused!!.contains("ارتباط با سرور"))
        val slow = MockWebServer(); slow.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)); slow.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)); slow.start()
        val http = okhttp3.OkHttpClient.Builder().readTimeout(200, java.util.concurrent.TimeUnit.MILLISECONDS).callTimeout(2, java.util.concurrent.TimeUnit.SECONDS).build()
        val timeout = try { ApiClient(slow.url("/").toString(), { null }, http = http).request("GET", "/x", String.serializer()); null } catch (e: NetworkException) { e.message }
        assertNotNull(timeout); assertTrue(timeout!!.contains("دیر پاسخ"))
        slow.shutdown()
    }
}
