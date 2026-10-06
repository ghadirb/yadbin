package com.yadbin.teacher.core.utils

/**
 * Jalali (Shamsi) dates for display. The server always stores/returns ISO-8601 UTC (e.g. 2026-09-01T10:00:00.000Z);
 * the app converts only when showing a date, so every screen uses [jalaliFa] / [jalaliNumericFa].
 * Pure arithmetic (no java.time) because minSdk is 24. Tehran is treated as a fixed UTC+03:30 (Iran dropped DST in 2022).
 */
object Jalali {
    private val MONTHS = listOf("فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند")
    private const val TEHRAN_OFFSET_MIN = 3 * 60 + 30

    data class Date(val year: Int, val month: Int, val day: Int)

    fun monthName(m: Int): String = MONTHS[m - 1]

    /** Gregorian y/m/d -> Jalali. */
    fun fromGregorian(gy: Int, gm: Int, gd: Int): Date {
        val cum = intArrayOf(0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334)
        val gy2 = if (gm > 2) gy + 1 else gy
        var days = 355666 + 365 * gy + (gy2 + 3) / 4 - (gy2 + 99) / 100 + (gy2 + 399) / 400 + gd + cum[gm - 1]
        var jy = -1595 + 33 * (days / 12053)
        days %= 12053
        jy += 4 * (days / 1461)
        days %= 1461
        if (days > 365) { jy += (days - 1) / 365; days = (days - 1) % 365 }
        val jm = if (days < 186) 1 + days / 31 else 7 + (days - 186) / 30
        val jd = 1 + if (days < 186) days % 31 else (days - 186) % 30
        return Date(jy, jm, jd)
    }

    data class GregorianDate(val year: Int, val month: Int, val day: Int) {
        /** «2026-09-23» — the form the report API expects for a custom range. */
        fun iso(): String = "%04d-%02d-%02d".format(year, month, day)
    }

    /**
     * Jalali y/m/d -> Gregorian, or null when that Jalali date does not exist (e.g. 30 Esfand of a common year, 31 Mehr).
     * Built on [fromGregorian] (already covered by tests): estimate the day from 1 Farvardin ≈ 21 March, then confirm by converting back.
     */
    fun toGregorian(jy: Int, jm: Int, jd: Int): GregorianDate? {
        if (jy !in 1300..1600 || jm !in 1..12 || jd !in 1..31) return null
        val offset = if (jm <= 6) (jm - 1) * 31 + (jd - 1) else 186 + (jm - 7) * 30 + (jd - 1)
        val guess = daysFromCivil(jy + 621, 3, 21) + offset
        for (delta in -3L..3L) {
            val (y, m, d) = civilFromDays(guess + delta)
            val back = fromGregorian(y, m, d)
            if (back.year == jy && back.month == jm && back.day == jd) return GregorianDate(y, m, d)
        }
        return null
    }

    // days since 1970-01-01 <-> civil date (H. Hinnant's algorithms)
    private fun daysFromCivil(y0: Int, m: Int, d: Int): Long {
        val y = (if (m <= 2) y0 - 1 else y0).toLong()
        val era = Math.floorDiv(y, 400L)
        val yoe = y - era * 400
        val doy = (153 * (m + (if (m > 2) -3 else 9)) + 2) / 5 + d - 1
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }
    private fun civilFromDays(z0: Long): Triple<Int, Int, Int> {
        val z = z0 + 719468
        val era = Math.floorDiv(z, 146097L)
        val doe = z - era * 146097
        val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        val mp = (5 * doy + 2) / 153
        val d = (doy - (153 * mp + 2) / 5 + 1).toInt()
        val m = (if (mp < 10) mp + 3 else mp - 9).toInt()
        val y = (yoe + era * 400 + (if (m <= 2) 1 else 0)).toInt()
        return Triple(y, m, d)
    }

    /** "HH:mm" in Tehran local time for an ISO timestamp that carries a time of day; null for date-only / unparsable input. */
    fun tehranTime(iso: String?): String? {
        if (iso == null) return null
        val m = Regex("""^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})""").find(iso) ?: return null
        val total = Math.floorMod(m.groupValues[1].toInt() * 60 + m.groupValues[2].toInt() + TEHRAN_OFFSET_MIN, 24 * 60)
        return "${two(total / 60)}:${two(total % 60)}"
    }

    /** "2026-09-01T10:00:00.000Z" (UTC) -> Jalali date in Tehran local time, or null if unparsable. */
    fun fromIso(iso: String?): Date? {
        if (iso == null || iso.length < 10) return null
        val m = Regex("""^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?""").find(iso) ?: return null
        val (ys, ms, ds, hs, mins) = m.destructured
        val y = ys.toInt(); val mo = ms.toInt(); val d = ds.toInt()
        if (mo !in 1..12 || d !in 1..31) return null
        val minutes = (if (hs.isEmpty()) 12 * 60 else hs.toInt() * 60 + mins.toInt()) + TEHRAN_OFFSET_MIN
        val (cy, cm, cd) = civilFromDays(daysFromCivil(y, mo, d) + Math.floorDiv(minutes, 24 * 60))
        return fromGregorian(cy, cm, cd)
    }
}

private fun two(n: Int) = n.toString().padStart(2, '0')

/** «۱۰ شهریور ۱۴۰۵» — the form used everywhere in the UI. Returns "" for null/invalid input. */
fun String?.jalaliFa(): String {
    val d = Jalali.fromIso(this) ?: return ""
    return "${d.day} ${Jalali.monthName(d.month)} ${d.year}".toFa()
}

/** «۱۴۰۵/۰۶/۱۰» */
fun String?.jalaliNumericFa(): String {
    val d = Jalali.fromIso(this) ?: return ""
    return "${d.year}/${two(d.month)}/${two(d.day)}".toFa()
}

/** «۸ مهر ۱۴۰۵، ۱۲:۳۰» — Jalali date and Tehran time (date only when the input has no time). Storage stays ISO UTC. */
fun String?.jalaliDateTimeFa(): String {
    val date = this.jalaliFa()
    if (date.isEmpty()) return ""
    val time = Jalali.tehranTime(this) ?: return date
    return "$date، $time".toFa()
}
