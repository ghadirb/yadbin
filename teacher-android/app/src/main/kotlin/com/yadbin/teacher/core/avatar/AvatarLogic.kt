package com.yadbin.teacher.core.avatar

/** Pure rules of the student picture system (no Android classes → unit-testable).
 *  Display priority (spec §7): 1) teacher's own photo, 2) preset avatar chosen by the teacher, 3) default avatar derived from the id.
 *  Nothing here ever touches the network: pictures live only in the app's private storage on the teacher's device. */
object AvatarLogic {
    const val PRESET_COUNT = 6
    const val PHOTO_SIZE_PX = 512

    sealed interface Source {
        data object Photo : Source
        data class Preset(val index: Int) : Source
    }

    /** Stable "random" default so a class of students without pictures does not show one identical image. */
    fun defaultIndex(studentId: String): Int = (studentId.hashCode() and Int.MAX_VALUE) % PRESET_COUNT

    fun resolve(hasPhoto: Boolean, chosenPreset: Int?, studentId: String): Source = when {
        hasPhoto -> Source.Photo
        chosenPreset != null && chosenPreset in 0 until PRESET_COUNT -> Source.Preset(chosenPreset)
        else -> Source.Preset(defaultIndex(studentId))
    }

    /** The id becomes part of a file name: only plain ASCII letters/digits/'-'/'_' are accepted (no path separators, no "..", no unicode tricks). */
    fun safeKey(studentId: String): String? =
        studentId.takeIf { it.length in 1..64 && it.all { c -> (c.code < 128 && c.isLetterOrDigit()) || c == '-' || c == '_' } }

    /** Centered square crop: returns [x, y, side]. */
    fun cropSquare(width: Int, height: Int): IntArray {
        val side = minOf(width, height)
        return intArrayOf((width - side) / 2, (height - side) / 2, side)
    }

    /** Largest power-of-two sample size that keeps both sides >= [target]. */
    fun sampleSize(width: Int, height: Int, target: Int): Int {
        var s = 1
        while (width / (s * 2) >= target && height / (s * 2) >= target) s *= 2
        return s
    }
}
