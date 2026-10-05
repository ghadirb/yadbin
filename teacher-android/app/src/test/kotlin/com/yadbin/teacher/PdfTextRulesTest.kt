package com.yadbin.teacher

import com.yadbin.teacher.core.utils.PdfTextRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PdfTextRulesTest {
    private fun line(i: Int) = "علی ${10 + i} مداد دارد و ${20 + i} دفتر دیگر می‌خرد، پس در مجموع ${30 + i} وسیله از این کتاب خواهد داشت."
    private fun page(from: Int) = (0 until 8).joinToString("\n") { line(from + it) }
    private val pages = listOf(page(0), page(8), page(16))
    private fun reverse(s: String) = s.split("\n").joinToString("\n") { it.reversed() }

    @Test fun normalPersianTextIsUsable() {
        assertFalse(PdfTextRules.looksReversedPersian(pages.joinToString("\n")))
        assertTrue(PdfTextRules.isUsable(pages))
    }

    @Test fun letterReversedPersianIsDetectedAndNotUsable() {
        val rev = pages.map(::reverse)
        assertTrue(PdfTextRules.looksReversedPersian(rev.joinToString("\n")))
        assertFalse(PdfTextRules.isUsable(rev))
    }

    @Test fun scannedPagesWithNoTextAreNotUsable() {
        assertFalse(PdfTextRules.isUsable(emptyList()))
        assertFalse(PdfTextRules.isUsable(listOf("", "", "")))
        assertFalse(PdfTextRules.isUsable(listOf("ab", "cd", "ef")))
    }

    @Test fun brokenFontCharactersAreGarbled() {
        val garbled = "\uE001\uE002\uFFFD".repeat(30) + " abc"
        assertTrue(PdfTextRules.looksGarbled(garbled))
        assertFalse(PdfTextRules.isUsable(listOf(garbled)))
    }

    @Test fun pagesAreJoinedWithFormFeed() {
        assertEquals("a\u000cb", PdfTextRules.join(listOf("a", "b")))
    }
}
