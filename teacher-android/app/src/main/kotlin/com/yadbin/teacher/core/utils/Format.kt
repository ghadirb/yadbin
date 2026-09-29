package com.yadbin.teacher.core.utils

private const val FA = "۰۱۲۳۴۵۶۷۸۹"

fun Int.fa(): String = toString().toFa()
fun String.toFa(): String = buildString { for (ch in this@toFa) append(if (ch in '0'..'9') FA[ch - '0'] else ch) }

/** 0.8333 -> «۸۳٪» */
fun Double.percentFa(): String = "${(this * 100).toInt()}٪".toFa()

/** milliseconds -> «۱٫۴ ثانیه» */
fun Double.secondsFa(): String {
    val s = Math.round(this / 100.0) / 10.0
    return "$s ثانیه".replace('.', '٫').toFa()
}

object Labels {
    fun game(type: String) = when (type) {
        "memory" -> "به خاطر بسپار"
        "attention" -> "پیداش کن"
        "problem_solving" -> "راهش را پیدا کن"
        else -> type
    }
    fun difficulty(mode: String) = when (mode) {
        "adaptive" -> "تطبیقی"
        "easy" -> "آسان"
        "medium" -> "متوسط"
        "hard" -> "سخت"
        else -> mode
    }
    fun activityStatus(s: String) = when (s) {
        "active" -> "فعال"
        "canceled" -> "لغوشده"
        else -> s
    }
    fun studentStatus(s: String) = when (s) {
        "pending" -> "شروع نشده"
        "started" -> "در حال انجام"
        "completed" -> "انجام شد"
        else -> s
    }
    const val SHARE_PREFIX = "لطفاً این فعالیت کوتاه را انجام دهید:"
    fun shareText(url: String) = "$SHARE_PREFIX\n$url"
}
