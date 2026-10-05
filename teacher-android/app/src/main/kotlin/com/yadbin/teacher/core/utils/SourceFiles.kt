package com.yadbin.teacher.core.utils

import kotlin.math.min

/**
 * Pure helpers for choosing a book file. The limits mirror the Worker (docs/content-sources.md); the SERVER is the real gate,
 * these checks only save the teacher an upload that would be refused anyway.
 */
object SourceFiles {
    const val MAX_BYTES: Int = 20 * 1024 * 1024
    val MIME_TYPES: Array<String> = arrayOf(
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "application/octet-stream", // some file managers report a .docx / .txt like this; the extension decides below
    )

    /** pdf | docx | txt, decided by the file extension (null = not supported). */
    fun typeFor(fileName: String?): String? = when (fileName?.substringAfterLast('.', "")?.lowercase()) {
        "pdf" -> "pdf"
        "docx" -> "docx"
        "txt" -> "txt"
        else -> null
    }

    /** Plain Persian reason why the file cannot be used, or null when it can. */
    fun problemFor(fileName: String?, sizeBytes: Long): String? = when {
        typeFor(fileName) == null ->
            "فقط فایل PDF، Word (با پسوند docx) یا متن ساده (txt) پشتیبانی می‌شود. اگر فایل Word قدیمی (doc) دارید، آن را با «ذخیره به‌عنوان» به docx تبدیل کنید."
        sizeBytes <= 0L -> "فایل خالی است."
        sizeBytes > MAX_BYTES -> "حجم فایل بیشتر از ۲۰ مگابایت است. فصل‌ها را جداگانه وارد کنید یا متن را مستقیم بچسبانید."
        else -> null
    }

    /** «ریاضی_ششم.pdf» → «ریاضی ششم» (a starting point for the title; the teacher can change it). */
    fun titleFromFileName(fileName: String?): String =
        fileName?.substringBeforeLast('.')?.replace('_', ' ')?.replace('-', ' ')?.replace(Regex("\\s+"), " ")?.trim().orEmpty().take(100)
}

/** How many independent questions a piece of text can support. Mirrors worker/src/ai/assessment-from-source.ts; the server decides. */
object SourceQuiz {
    const val CHARS_PER_QUESTION = 300
    const val MIN_SOURCE_CHARS = 200
    const val PROMPT_CHAR_BUDGET = 10_000
    const val MIN_QUESTIONS = 3
    const val MAX_QUESTIONS = 20

    /** 0 when the text is too short to use at all. */
    fun capacity(chars: Int): Int =
        if (chars < MIN_SOURCE_CHARS) 0 else (min(chars, PROMPT_CHAR_BUDGET) / CHARS_PER_QUESTION).coerceIn(1, MAX_QUESTIONS)

    /** A sensible default number of questions for [chars] of text (never below 3, never above what the text supports). */
    fun defaultCount(chars: Int): Int = min(10, capacity(chars)).coerceAtLeast(MIN_QUESTIONS)
}
