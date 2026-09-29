package com.yadbin.teacher.core.utils

/** Client-side mirrors of the Worker's validation (the server stays the authority). */
object Validators {
    private const val PERSIAN = "۰۱۲۳۴۵۶۷۸۹"
    private const val ARABIC = "٠١٢٣٤٥٦٧٨٩"

    fun normalizeDigits(s: String): String = buildString {
        for (ch in s) {
            val p = PERSIAN.indexOf(ch)
            val a = ARABIC.indexOf(ch)
            append(if (p >= 0) ('0' + p) else if (a >= 0) ('0' + a) else ch)
        }
    }

    /** Iranian mobile: 09xxxxxxxxx (also +98 / 0098 / 98 prefixes, Persian digits). */
    fun normalizePhone(raw: String): String? {
        var p = normalizeDigits(raw).replace(Regex("[\\s\\-()]"), "")
        p = p.replace(Regex("^(\\+98|0098|98)"), "0")
        if (Regex("^9\\d{9}$").matches(p)) p = "0$p"
        return if (Regex("^09\\d{9}$").matches(p)) p else null
    }

    fun nameError(name: String, label: String = "نام"): String? {
        val n = name.trim()
        return when {
            n.length < 2 -> "$label خیلی کوتاه است."
            n.length > 80 -> "$label خیلی بلند است."
            else -> null
        }
    }

    fun passwordError(password: String): String? = when {
        password.length < 8 -> "رمز عبور باید حداقل ۸ کاراکتر باشد."
        password.length > 128 -> "رمز عبور خیلی بلند است."
        else -> null
    }

    /** Quick-add: one student per line. Trims, collapses spaces, drops blanks. */
    fun parseNames(text: String): List<String> =
        text.split(Regex("\\r?\\n")).map { it.trim().replace(Regex("\\s+"), " ") }.filter { it.isNotEmpty() }
}
