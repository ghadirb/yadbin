package com.yadbin.teacher.core.utils

import com.yadbin.teacher.domain.models.GrowthSubject
import kotlin.math.abs

/**
 * Pure helpers for the growth screen (no Android types, so they are unit-tested on the JVM).
 * Wording is deliberately conservative: only "recorded performance", never a diagnosis, cause or ranking (spec §6, §24).
 */
object Growth {
    /** Range codes understood by the server, in the order shown to the teacher. */
    val RANGES: List<Pair<String, String>> = listOf(
        "7d" to "۷ روز اخیر", "30d" to "۳۰ روز اخیر", "3m" to "۳ ماه اخیر", "6m" to "۶ ماه اخیر", "all" to "کل دوره",
    )

    const val MSG_NOT_ENOUGH_RANGE = "برای این بازه هنوز داده کافی برای نمایش روند رشد وجود ندارد."
    const val MSG_NOT_ENOUGH_ACTIVITIES = "برای مشاهده روند رشد، فعالیت‌های بیشتری نیاز است."

    /** 0..100 value -> «۷۸٪». */
    fun percent(v: Double): String = "${Math.round(v)}٪".toFa()

    /** One decimal where useful: 76.0 -> «۷۶»; 76.4 -> «۷۶٫۴». */
    private fun num(v: Double): String {
        val r = Math.round(abs(v) * 10) / 10.0
        return (if (r == Math.floor(r)) r.toLong().toString() else r.toString()).replace('.', '٫').toFa()
    }

    /** Difference of two percentages, in PERCENTAGE POINTS (not a relative percent): «۱۶ واحد درصد افزایش». */
    fun pointsPhrase(points: Double): String =
        if (abs(points) < 0.5) "تقریباً بدون تغییر" else "${num(points)} واحد درصد ${if (points > 0) "افزایش" else "کاهش"}"

    /** Short signed form for tight spaces: «+۱۲» / «−۵» (points). */
    fun signedPoints(points: Double): String =
        if (abs(points) < 0.5) "۰" else (if (points > 0) "+" else "−") + num(points)

    fun trendTitle(direction: String): String = when (direction) {
        "up" -> "رو به رشد"
        "stable" -> "تقریباً ثابت"
        "fluctuating" -> "نوسانی"
        "down" -> "رو به کاهش"
        else -> "داده کافی نیست"
    }

    /** Arrow used next to a skill; purely descriptive. */
    fun trendArrow(direction: String): String = when (direction) {
        "up" -> "↑"
        "down" -> "↓"
        "fluctuating" -> "↕"
        "stable" -> "→"
        else -> "—"
    }

    fun gameLabel(code: String): String = when (code) {
        "memory" -> "حافظه"
        "attention" -> "توجه"
        "problem_solving" -> "حل مسئله"
        else -> code
    }

    /** Seconds -> «۱٫۴ ثانیه». */
    fun seconds(v: Double): String = "${num(v)} ثانیه".toFa()

    /** «آزمون ۱: ۶۵٪ • آزمون ۲: ۷۲٪» for one subject, in time order. */
    fun examLine(s: GrowthSubject): String = s.exams.joinToString(" • ") { "آزمون ${it.index.fa()}: ${percent(it.percent)}" }

    /**
     * Index of the chart point nearest to a tap. x positions follow the RTL chart: the oldest point is on the right.
     * Returns null when there are fewer than 2 points (no chart is drawn then).
     */
    fun nearestIndex(tapX: Float, width: Float, count: Int, padding: Float = 0f): Int? {
        if (count < 2 || width <= 0f) return null
        val usable = (width - 2 * padding).coerceAtLeast(1f)
        val fromRight = ((width - padding - tapX) / usable).coerceIn(0f, 1f)
        return Math.round(fromRight * (count - 1))
    }
}
