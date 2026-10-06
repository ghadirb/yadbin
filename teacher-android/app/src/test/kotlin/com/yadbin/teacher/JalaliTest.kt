package com.yadbin.teacher

import com.yadbin.teacher.core.utils.Jalali
import com.yadbin.teacher.core.utils.jalaliFa
import com.yadbin.teacher.core.utils.jalaliDateTimeFa
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

    @Test fun jalali_to_gregorian_matches_known_dates_and_rejects_impossible_ones() {
        assertEquals("2026-09-23", Jalali.toGregorian(1405, 7, 1)!!.iso())   // 1 Mehr 1405 = start of the academic year
        assertEquals("2026-03-21", Jalali.toGregorian(1405, 1, 1)!!.iso())
        assertEquals("2025-03-20", Jalali.toGregorian(1403, 12, 30)!!.iso()) // 1403 is a leap year
        assertEquals("2026-03-20", Jalali.toGregorian(1404, 12, 29)!!.iso())
        assertEquals("2027-09-22", Jalali.toGregorian(1406, 6, 31)!!.iso())  // last day of the 1405–1406 academic year
        assertEquals("2029-03-20", Jalali.toGregorian(1408, 1, 1)!!.iso())
        assertNull(Jalali.toGregorian(1404, 12, 30))  // 1404 is not a leap year
        assertNull(Jalali.toGregorian(1405, 7, 31))   // Mehr has 30 days
        assertNull(Jalali.toGregorian(1405, 13, 1))
        assertNull(Jalali.toGregorian(1405, 1, 0))
    }

    @Test fun jalali_to_gregorian_round_trips_every_day_of_two_years() {
        for (jy in 1405..1406) for (jm in 1..12) for (jd in 1..(if (jm <= 6) 31 else 30)) {
            val g = Jalali.toGregorian(jy, jm, jd) ?: continue // 30 Esfand of a common year does not exist
            val back = Jalali.fromGregorian(g.year, g.month, g.day)
            assertEquals(Triple(jy, jm, jd), Triple(back.year, back.month, back.day))
        }
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

    @Test fun date_and_time_follow_the_spec_format() {
        // 10:00 UTC = 13:30 Tehran (UTC+3:30)
        assertEquals("۱۰ شهریور ۱۴۰۵، ۱۳:۳۰", "2026-09-01T10:00:00.000Z".jalaliDateTimeFa())
        // crossing midnight in Tehran moves both the date and the clock
        assertEquals("۱۱ شهریور ۱۴۰۵، ۰۱:۳۰", "2026-09-01T22:00:00.000Z".jalaliDateTimeFa())
        // date-only input has no time of day
        assertEquals("۱ مهر ۱۴۰۵", "2026-09-23".jalaliDateTimeFa())
        assertEquals("", (null as String?).jalaliDateTimeFa())
        assertEquals("", "garbage".jalaliDateTimeFa())
    }
}
