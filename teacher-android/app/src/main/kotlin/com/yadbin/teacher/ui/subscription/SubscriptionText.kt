package com.yadbin.teacher.ui.subscription

import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.core.utils.jalaliFa
import com.yadbin.teacher.core.utils.toFa
import com.yadbin.teacher.domain.models.PlanDto
import com.yadbin.teacher.domain.models.SubEntitlements
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** Pure text/maths for the subscription screens (unit-tested). Nothing here decides access: the server did; this only words it. */
object SubscriptionText {
    /** ISO-8601 UTC from the Worker ("2026-10-04T10:11:12.345Z") -> epoch millis. */
    fun isoMillis(iso: String?): Long? {
        if (iso.isNullOrBlank() || iso.length < 19) return null
        return try {
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(iso.substring(0, 19))?.time
        } catch (e: Exception) { null }
    }

    /** Whole days left, rounded up, measured against the SERVER time that came with the response (the phone clock is not used). */
    fun daysLeft(serverTime: String, expires: String?): Int? {
        val now = isoMillis(serverTime) ?: return null
        val end = isoMillis(expires) ?: return null
        if (end <= now) return 0
        return ((end - now + 86_399_999L) / 86_400_000L).toInt()
    }

    fun title(e: SubEntitlements): String = when {
        e.plan == "PRO" -> "اشتراک حرفه‌ای"
        e.plan == "TRIAL" -> "اشتراک آزمایشی"
        else -> "پلن رایگان"
    }

    fun headline(e: SubEntitlements): String = when (e.plan) {
        "PRO" -> "تا تاریخ ${e.expiresAt.jalaliFa()} فعال است"
        "TRIAL" -> {
            val d = daysLeft(e.serverTime, e.trialExpiresAt)
            when {
                d == null -> "دورهٔ آزمایشی فعال است"
                d == 0 -> "امروز به پایان می‌رسد"
                else -> "تا ${d.fa()} روز آینده فعال است"
            }
        }
        else -> if (e.status == "EXPIRED") "دورهٔ آزمایشی یا اشتراک شما تمام شده؛ اکنون با محدودیت‌های پلن رایگان کار می‌کنید." else "با محدودیت‌های پلن رایگان کار می‌کنید."
    }

    /** One-line state for the dashboard card. */
    fun banner(e: SubEntitlements): String = when (e.plan) {
        "PRO" -> "اشتراک حرفه‌ای • تا ${e.expiresAt.jalaliFa()}"
        "TRIAL" -> daysLeft(e.serverTime, e.trialExpiresAt).let { d -> if (d == null) "اشتراک آزمایشی فعال است" else if (d == 0) "اشتراک آزمایشی امروز تمام می‌شود" else "اشتراک آزمایشی • ${d.fa()} روز مانده" }
        else -> "پلن رایگان • برای امکانات کامل ارتقا دهید"
    }

    /** «کلاس: ۱ از ۱» / «کلاس: نامحدود». */
    fun limitLine(label: String, limit: Int?, used: Int): String =
        if (limit == null) "$label: نامحدود" else "$label: ${used.fa()} از ${limit.fa()}"

    fun aiLine(limit: Int?, used: Int): String =
        if (limit == null) "هوش مصنوعی: نامحدود" else "هوش مصنوعی در ماه: ${used.fa()} از ${limit.fa()} درخواست"

    /** Prices are stored in rial by the server; teachers read toman. Null = not decided yet (shown by the caller). */
    fun priceToman(p: PlanDto): String? {
        val price = p.price ?: return null
        if (!p.priceAvailable) return null
        val toman = if (p.currency.equals("IRR", true)) price / 10 else price
        return "${group(toman)} تومان".toFa()
    }

    fun group(n: Long): String = n.toString().reversed().chunked(3).joinToString("٬").reversed()

    fun periodLabel(p: PlanDto): String = when (p.period) { "yearly" -> "سالانه"; "monthly" -> "ماهانه"; else -> p.name }
}
