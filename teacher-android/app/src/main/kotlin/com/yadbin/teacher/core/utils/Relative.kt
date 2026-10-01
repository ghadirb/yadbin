package com.yadbin.teacher.core.utils

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private fun isoOf(millis: Long): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(millis))

/** «امروز» / «دیروز» / «۸ مهر ۱۴۰۵» (Tehran calendar day). "" for null/invalid input. */
fun String?.relativeDayFa(nowMillis: Long = System.currentTimeMillis()): String {
    val d = Jalali.fromIso(this) ?: return ""
    if (d == Jalali.fromIso(isoOf(nowMillis))) return "امروز"
    if (d == Jalali.fromIso(isoOf(nowMillis - 86_400_000L))) return "دیروز"
    return this.jalaliFa()
}

/** Same thresholds as the server (worker/src/scoring/status.ts): >= 80% good, >= 50% average, else needs more practice. A performance INDICATOR, never a label for the child. */
fun performanceWordFa(avg: Double?): String? = when {
    avg == null -> null
    avg >= 0.8 -> "خوب"
    avg >= 0.5 -> "متوسط"
    else -> "نیازمند تمرین بیشتر"
}
