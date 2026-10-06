package com.yadbin.teacher.domain.models

import kotlinx.serialization.Serializable

// ---- comprehensive student report («گزارش جامع پرونده دانش‌آموز») -------------------------------------
// The app does NOT re-compute or re-draw the report: GET /api/students/:id/report/print returns the print-ready A4 HTML and the
// app only previews + prints it. Only the few header fields below are read from the JSON (type=summary) to build the period chips.
// Every field has a default so an older/newer server never breaks parsing.

@Serializable data class ReportStudentInfo(
    val id: String = "", val name: String = "", val className: String? = null, val gradeLabel: String? = null, val academicYear: String? = null,
)

@Serializable data class ReportPeriodInfo(
    val key: String = "", val label: String = "", val title: String = "", val academicYear: String? = null,
    val fromJalali: String = "", val toJalali: String = "",
)

@Serializable data class ReportPeriodOptions(
    val currentYear: String = "", val previousYear: String = "", val firstResultAt: String? = null, val hasPreviousYearData: Boolean = false,
)

@Serializable data class ReportMeta(
    val student: ReportStudentInfo = ReportStudentInfo(),
    val period: ReportPeriodInfo = ReportPeriodInfo(),
    val periodOptions: ReportPeriodOptions = ReportPeriodOptions(),
)

/** What the server sends for printing: the A4 HTML and the suggested PDF file name (header X-Report-Filename). */
data class ReportHtml(val html: String, val fileName: String)

/** [period] = a code from `ReportPeriods`; [from]/[to] (YYYY-MM-DD, Gregorian, inclusive) only for `custom`. [type] = full | summary. */
data class ReportQuery(
    val period: String = "year_current",
    val from: String? = null,
    val to: String? = null,
    val type: String = "full",
) {
    fun queryString(): String = buildString {
        append("period=").append(period)
        if (period == "custom") {
            from?.let { append("&from=").append(it) }
            to?.let { append("&to=").append(it) }
        }
        append("&type=").append(type)
    }
}
