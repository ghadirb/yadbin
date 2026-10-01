package com.yadbin.teacher

import com.yadbin.teacher.core.utils.Jalali
import com.yadbin.teacher.core.utils.jalaliFa
import com.yadbin.teacher.core.utils.jalaliNumericFa
import org.junit.Assert.*
import org.junit.Test

class JalaliTest {
    private fun j(y: Int, m: Int, d: Int) = Jalali.fromGregorian(y, m, d).let { Triple(it.year, it.month, it.day) }

    @Test fun known_nowruz_and_month_boundaries() {
        assertEquals(Triple(1403, 1, 1), j(2024, 3, 20))
        assertEquals(Triple(1404, 1, 1), j(2025, 3, 21))
        assertEquals(Triple(1405, 1, 1), j(2026, 3, 21))
        assertEquals(Triple(1408, 1, 1), j(2029, 3, 20))
        assertEquals(Triple(1404, 12, 29), j(2026, 3, 20))   // 1404 is not a leap year
        assertEquals(Triple(1405, 6, 10), j(2026, 9, 1))
        assertEquals(Triple(1405, 7, 1), j(2026, 9, 23))
    }

    @Test fun iso_utc_is_shown_in_tehran_time_and_in_persian_digits() {
        assertEquals("۱۰ شهریور ۱۴۰۵", "2026-09-01T10:00:00.000Z".jalaliFa())
        assertEquals("۱۴۰۵/۰۶/۱۰", "2026-09-01T10:00:00.000Z".jalaliNumericFa())
        // 22:00 UTC is already the next day in Tehran (UTC+3:30)
        assertEquals("۱۱ شهریور ۱۴۰۵", "2026-09-01T22:00:00.000Z".jalaliFa())
        // date-only input is accepted
        assertEquals("۱ مهر ۱۴۰۵", "2026-09-23".jalaliFa())
    }

    @Test fun bad_input_gives_empty_string_not_a_crash() {
        assertEquals("", (null as String?).jalaliFa())
        assertEquals("", "".jalaliFa())
        assertEquals("", "not-a-date".jalaliFa())
        assertEquals("", "2026-13-40T00:00:00Z".jalaliFa())
    }

    @Test fun never_shows_gregorian_digits_or_year() {
        val s = "2026-09-01T10:00:00.000Z".jalaliFa()
        assertFalse(s.any { it in '0'..'9' })
        assertFalse(s.contains("۲۰۲۶"))
    }
}
