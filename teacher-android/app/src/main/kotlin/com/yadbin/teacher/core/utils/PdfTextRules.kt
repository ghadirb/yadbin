package com.yadbin.teacher.core.utils

import java.text.Normalizer

/**
 * Pure checks on text read from a PDF ON THE PHONE. They mirror worker/src/content_sources/extract.ts (looksGarbled, looksReversedPersian, minCharsPerPage)
 * so the phone decides «this text is unusable → read the page images instead» BEFORE sending anything; the SERVER still re-checks everything.
 */
object PdfTextRules {
    const val MIN_CHARS_PER_PAGE = 25
    /** Same as the Worker: more pages than this is refused there. */
    const val MAX_PAGES = 300
    const val PAGE_BREAK = '\u000c'

    private val COMMON = listOf("که", "در", "از", "را", "این", "با", "به", "است", "های", "می")
    private val FORWARD = COMMON.toSet()
    private val MIRRORED = COMMON.map { it.reversed() }.toSet()
    private val NON_PERSIAN = Regex("[^\\u0600-\\u06FF]+")

    /** Persian taken from a PDF in VISUAL order comes out letter-reversed («که» → «هک»): mirrored common words outnumber the real ones. */
    fun looksReversedPersian(text: String): Boolean {
        val words = Normalizer.normalize(text, Normalizer.Form.NFKC).replace('\u200c', ' ').replace('\u200d', ' ').split(NON_PERSIAN).filter { it.isNotEmpty() }
        if (words.size < 40) return false
        var fwd = 0
        var rev = 0
        for (w in words) { if (w in FORWARD) fwd++ else if (w in MIRRORED) rev++ }
        return rev >= 8 && rev > fwd * 1.5
    }

    /** Private-use / replacement characters are what broken PDF fonts turn into. */
    fun looksGarbled(text: String): Boolean {
        val visible = text.filter { !it.isWhitespace() }
        if (visible.length < 40) return false
        val bad = visible.count { it in '\uE000'..'\uF8FF' || it == '\uFFFD' }
        return bad.toDouble() / visible.length > 0.08
    }

    /** true when [pages] can be sent as the book's text; false → the text layer is missing / broken / mirrored and the page IMAGES must be read instead. */
    fun isUsable(pages: List<String>): Boolean {
        if (pages.isEmpty()) return false
        val joined = pages.joinToString(PAGE_BREAK.toString())
        val chars = joined.count { !it.isWhitespace() }
        if (chars == 0 || chars < MIN_CHARS_PER_PAGE * pages.size) return false
        return !looksGarbled(joined) && !looksReversedPersian(joined)
    }

    fun join(pages: List<String>): String = pages.joinToString(PAGE_BREAK.toString())
}
