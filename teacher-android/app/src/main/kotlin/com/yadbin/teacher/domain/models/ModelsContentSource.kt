package com.yadbin.teacher.domain.models

import kotlinx.serialization.Serializable

/**
 * کتاب‌ها و منابع درسی – mirrors worker/src/routes/content-sources.ts and worker/src/ai/assessment-from-source.ts.
 * The UI never shows technical words (chunk, retrieval …): [partCount] is shown only as «بخش متن».
 */
@Serializable data class ContentSourceInfo(
    val id: String,
    val title: String = "",
    val description: String? = null,
    val subject: String? = null,
    val gradeCode: String? = null,
    val gradeLabel: String? = null,
    /** pdf | docx | txt | paste */
    val fileType: String = "paste",
    val fileTypeLabel: String = "",
    val originalFileName: String? = null,
    /** pending_file | processing | ready | needs_review | needs_ocr | failed */
    val status: String = "pending_file",
    val statusLabel: String = "",
    val statusMessage: String? = null,
    /** ready or needs_review: a quiz can be made from it. */
    val usable: Boolean = false,
    val charCount: Int = 0,
    val partCount: Int = 0,
    val pageCount: Int? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
)

/** One chapter / lesson / exercise … [parentId] links a lesson to its chapter. [charCount] counts only this section's own text. */
@Serializable data class ContentSection(
    val id: String,
    val parentId: String? = null,
    val title: String = "",
    val type: String = "section",
    val typeLabel: String = "",
    val orderIndex: Int = 0,
    val partCount: Int = 0,
    val charCount: Int = 0,
)

/** Answer of GET /content-sources/:id, POST /content-sources, PUT, POST …/process and GET …/sections. */
@Serializable data class ContentSourceDetail(
    val source: ContentSourceInfo,
    val sections: List<ContentSection> = emptyList(),
    /** true when «process» was repeated for a source that is already usable (nothing was changed). */
    val duplicate: Boolean = false,
)

@Serializable data class ContentSourceList(
    val sources: List<ContentSourceInfo> = emptyList(),
    val limit: Int = 30,
    val maxFileMegabytes: Double = 20.0,
    val maxPages: Int = 300,
)

@Serializable data class ContentSectionPart(val index: Int = 0, val page: Int? = null, val text: String = "")

/** GET /content-sources/:id/sections/:sectionId — the extracted text, so the teacher can read it and choose a range by hand. */
@Serializable data class ContentSectionText(val section: ContentSection, val parts: List<ContentSectionPart> = emptyList())

/** What the teacher chose for «ساخت آزمون از کتاب/منبع». Exactly one way of selecting: [sectionIds], [wholeSource] or a manual range. */
data class SourceDraftSpec(
    val sourceId: String,
    val sectionIds: List<String> = emptyList(),
    val wholeSource: Boolean = false,
    val rangeFrom: Int? = null,
    val rangeTo: Int? = null,
    val title: String? = null,
    val subject: String? = null,
    val gradeCode: String? = null,
    val level: String? = null,
    val questionCount: Int = 10,
    val questionTypes: List<String> = listOf("multiple_choice"),
    val minutes: Int? = null,
    val notes: String? = null,
)

/** POST /ai/assessment-draft-from-source (201). Always a DRAFT: the teacher edits, previews and approves before anything is published. */
@Serializable data class SourceDraftResult(
    val assessment: AssessmentInfo,
    val questions: List<AssessmentQuestion> = emptyList(),
    val requestedQuestions: Int = 0,
    /** how many fewer questions than requested were valid (the rest were dropped because the book did not support them). */
    val shortfall: Int = 0,
    val droppedQuestions: Int = 0,
    val notice: String = "",
)
