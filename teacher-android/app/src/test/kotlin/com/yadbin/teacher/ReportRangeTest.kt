package com.yadbin.teacher

import com.yadbin.teacher.core.utils.Jalali
import com.yadbin.teacher.core.utils.ReportPeriods
import com.yadbin.teacher.domain.models.ReportMeta
import com.yadbin.teacher.domain.models.ReportQuery
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class ReportRangeTest {
    @Test fun parses_persian_arabic_and_latin_digits_with_common_separators() {
        val expected = Jalali.Date(1405, 7, 1)
        assertEquals(expected, ReportPeriods.parseJalali("۱۴۰۵/۰۷/۰۱"))
        assertEquals(expected, ReportPeriods.parseJalali("1405/7/1"))
        assertEquals(expected, ReportPeriods.parseJalali("١٤٠٥-٠٧-٠١"))
        assertEquals(expected, ReportPeriods.parseJalali("  1405.07.01 "))
    }

    @Test fun rejects_anything_that_is_not_a_real_jalali_date() {
        for (bad in listOf("", "abc", "1405/07", "1405/13/01", "1405/07/31", "1404/12/30", "1405/7/1/2", "14050701", "1405/07/xx", "99999/1/1"))
            assertNull("should reject '$bad'", ReportPeriods.parseJalali(bad))
    }

    @Test fun query_string_has_dates_only_for_a_custom_range() {
        assertEquals("period=year_current&type=full", ReportQuery().queryString())
        assertEquals("period=30d&type=summary", ReportQuery(period = "30d", from = "2026-01-01", to = "2026-02-01", type = "summary").queryString())
        assertEquals("period=custom&from=2026-09-23&to=2027-03-20&type=full", ReportQuery(period = "custom", from = "2026-09-23", to = "2027-03-20").queryString())
    }

    @Test fun period_chips_cover_the_required_ranges() {
        val codes = ReportPeriods.ALL.map { it.first }
        assertEquals(listOf("7d", "30d", "3m", "6m", "year_current", "year_previous", "custom"), codes)
    }

    @Test fun report_header_parses_from_the_real_server_shape_and_survives_missing_fields() {
        val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
        val sample = """{"type":"summary","student":{"id":"s1","name":"سارا","className":"چهارم الف","classNames":["چهارم الف"],"gradeLabel":"چهارم","academicYear":"۱۴۰۵–۱۴۰۶"},
          "period":{"key":"year_current","label":"سال تحصیلی ۱۴۰۵–۱۴۰۶","from":"2026-09-23T00:00:00.000Z","to":"2026-10-06T00:00:00.000Z","fromJalali":"۱ مهر ۱۴۰۵","toJalali":"۱۴ مهر ۱۴۰۵",
                    "academicYear":"۱۴۰۵–۱۴۰۶","days":13,"bucket":"day","timeZone":"Asia/Tehran","title":"گزارش عملکرد دانش‌آموز در سال تحصیلی ۱۴۰۵–۱۴۰۶"},
          "overview":{"activityCount":0},"periodOptions":{"currentYear":"۱۴۰۵–۱۴۰۶","previousYear":"۱۴۰۴–۱۴۰۵","firstResultAt":"2025-11-02T08:00:00.000Z","hasPreviousYearData":true},"metadata":{"version":1}}"""
        val m = json.decodeFromString(ReportMeta.serializer(), sample)
        assertEquals("سارا", m.student.name)
        assertEquals("گزارش عملکرد دانش‌آموز در سال تحصیلی ۱۴۰۵–۱۴۰۶", m.period.title)
        assertTrue(m.periodOptions.hasPreviousYearData)
        assertEquals("۱۴۰۴–۱۴۰۵", m.periodOptions.previousYear)
        // an older/newer server with none of these fields must not break parsing, and must not offer a previous year
        val empty = json.decodeFromString(ReportMeta.serializer(), "{}")
        assertFalse(empty.periodOptions.hasPreviousYearData)
        assertEquals("", empty.student.name)
    }
}
