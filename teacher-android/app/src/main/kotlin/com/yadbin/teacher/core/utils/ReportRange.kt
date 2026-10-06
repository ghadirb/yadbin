package com.yadbin.teacher.core.utils

/** Report periods offered in the comprehensive student report (codes are the server's `period` values). */
object ReportPeriods {
    const val CUSTOM = "custom"
    const val YEAR_CURRENT = "year_current"
    const val YEAR_PREVIOUS = "year_previous"
    val ALL: List<Pair<String, String>> = listOf(
        "7d" to "۷ روز اخیر",
        "30d" to "۳۰ روز اخیر",
        "3m" to "۳ ماه اخیر",
        "6m" to "۶ ماه اخیر",
        YEAR_CURRENT to "سال تحصیلی جاری",
        YEAR_PREVIOUS to "سال تحصیلی گذشته",
        CUSTOM to "بازهٔ سفارشی",
    )

    /** «۱۴۰۵/۰۷/۰۱» (Persian/Arabic/Latin digits; / - . as separators) -> a real Jalali date, or null. */
    fun parseJalali(input: String): Jalali.Date? {
        val norm = buildString {
            for (ch in input.trim()) append(
                when (ch) {
                    in '۰'..'۹' -> '0' + (ch - '۰')
                    in '٠'..'٩' -> '0' + (ch - '٠')
                    '-', '.', '،', '\\', '_', ' ' -> '/'
                    else -> ch
                },
            )
        }
        val parts = norm.split('/').filter { it.isNotEmpty() }
        if (parts.size != 3 || parts.any { p -> p.any { it !in '0'..'9' } || p.length > 4 }) return null
        val (y, m, d) = parts.map { it.toInt() }
        return if (Jalali.toGregorian(y, m, d) != null) Jalali.Date(y, m, d) else null
    }
}
