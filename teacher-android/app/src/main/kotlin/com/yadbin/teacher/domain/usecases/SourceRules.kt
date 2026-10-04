package com.yadbin.teacher.domain.usecases

import com.yadbin.teacher.core.utils.SourceQuiz
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.domain.models.ContentSectionPart
import com.yadbin.teacher.domain.models.ContentSourceInfo

/** Answer to «با متن انتخاب‌شده می‌شود این تعداد سؤال ساخت؟». [suggested] is 0 when even the smallest quiz is not possible. */
data class CountAdvice(val ok: Boolean, val suggested: Int, val message: String?)

/**
 * Pure rules of the «کتاب‌ها و منابع درسی» screens (no Android), so they are unit-tested.
 * The numbers mirror the Worker ([SourceQuiz]); the SERVER stays the real gate, this only saves a request that would be refused.
 */
object SourceRules {
    /** Same types as the teacher's own question editor. */
    val QUESTION_TYPES: List<Pair<String, String>> = listOf(
        "multiple_choice" to "چهارگزینه‌ای", "true_false" to "درست / نادرست", "fill_blank" to "جای خالی",
    )
    const val MAX_TITLE = 100
    const val MAX_NOTES = 300

    fun countAdvice(requested: Int, chars: Int): CountAdvice {
        val cap = SourceQuiz.capacity(chars)
        val usable = if (cap >= SourceQuiz.MIN_QUESTIONS) cap else 0
        return when {
            cap == 0 -> CountAdvice(false, 0, "متن انتخاب‌شده برای ساخت آزمون کافی نیست. بخش‌های بیشتری را انتخاب کنید یا فصل کامل را بردارید.")
            cap < SourceQuiz.MIN_QUESTIONS -> CountAdvice(
                false, 0,
                "متن انتخاب‌شده فقط برای ${cap.fa()} سؤال مستقل کافی است و حداقل ${SourceQuiz.MIN_QUESTIONS.fa()} سؤال لازم است. بخش‌های بیشتری را انتخاب کنید یا فصل کامل را بردارید.",
            )
            requested < SourceQuiz.MIN_QUESTIONS || requested > SourceQuiz.MAX_QUESTIONS ->
                CountAdvice(false, usable, "تعداد سؤال باید بین ${SourceQuiz.MIN_QUESTIONS.fa()} تا ${SourceQuiz.MAX_QUESTIONS.fa()} باشد.")
            requested > cap -> CountAdvice(false, usable, "محتوای انتخاب‌شده برای تولید ${requested.fa()} سؤال مستقل کافی نیست. تعداد پیشنهادی: ${cap.fa()} سؤال.")
            else -> CountAdvice(true, usable, null)
        }
    }

    /** The server sends its own label; this is only a fallback (an old cached answer, a new status). */
    fun statusLabel(info: ContentSourceInfo): String = info.statusLabel.ifBlank {
        when (info.status) {
            "pending_file" -> "در انتظار فایل"
            "processing" -> "در حال پردازش"
            "ready" -> "آماده استفاده"
            "needs_review", "needs_ocr" -> "نیاز به بررسی"
            "failed" -> "خطا"
            else -> info.status
        }
    }

    /** ok | warn | error | info — the screen maps it to a colour; the text always carries the meaning. */
    fun statusGroup(status: String): String = when (status) {
        "ready" -> "ok"
        "needs_review" -> "warn"
        "needs_ocr", "failed" -> "error"
        else -> "info"
    }

    private val RESENDABLE = setOf("pending_file", "processing", "failed", "needs_ocr")

    /** A file can be sent (again) for a source that is not usable yet. Pasted text has no file: the teacher adds a new source instead. */
    fun canSendFile(info: ContentSourceInfo): Boolean = info.fileType != "paste" && info.status in RESENDABLE

    /** The new file must be of the same kind the source was created for (the server reads it by that kind). */
    fun fileMatches(info: ContentSourceInfo, pickedType: String): Boolean = info.fileType == pickedType

    /** ready or needs_review (the teacher then picks the range by hand). */
    fun isUsable(info: ContentSourceInfo): Boolean = info.usable || info.status == "ready" || info.status == "needs_review"

    /** «۱۲ صفحه • ۴۰ بخش متن» — «بخش متن», never a technical word. */
    fun sizeLine(info: ContentSourceInfo): String =
        listOfNotNull(info.pageCount?.takeIf { it > 0 }?.let { "${it.fa()} صفحه" }, info.partCount.takeIf { it > 0 }?.let { "${it.fa()} بخش متن" }).joinToString(" • ")

    fun defaultQuizTitle(sourceTitle: String): String = "آزمون ${sourceTitle.trim()}".trim().take(MAX_TITLE)

    /** Characters inside a hand-picked range of text parts (both ends included). 0 until both ends are chosen. */
    fun rangeChars(parts: List<ContentSectionPart>, from: Int?, to: Int?): Int =
        if (from == null || to == null || to < from) 0 else parts.filter { it.index in from..to }.sumOf { it.text.length }
}
