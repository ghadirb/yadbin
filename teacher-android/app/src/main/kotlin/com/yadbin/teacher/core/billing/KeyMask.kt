package com.yadbin.teacher.core.billing

/** Rebuilds the Myket public key at run time from the XOR-masked hex the Gradle script stored (Myket «توصیه‌های امنیتی»: don't keep the key as a plain string). */
object KeyMask {
    private val mask = "com.yadbin.teacher".toByteArray()

    fun decode(hex: String): String {
        if (hex.isBlank() || hex.length % 2 != 0) return ""
        val out = ByteArray(hex.length / 2)
        for (i in out.indices) {
            val v = hex.substring(i * 2, i * 2 + 2).toIntOrNull(16) ?: return ""
            out[i] = (v xor mask[i % mask.size].toInt()).toByte()
        }
        return String(out)
    }
}
