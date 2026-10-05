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

class VisionRangeRulesTest {
    private val q = com.yadbin.teacher.core.pdf.VisionQuota(allowed = true, limit = 200, used = 150, remaining = 50, maxPagesPerBook = 120)
    private fun check(lo: Int?, hi: Int?, n: Int = 300, quota: com.yadbin.teacher.core.pdf.VisionQuota? = q) =
        com.yadbin.teacher.ui.sources.validateVisionRange(lo, hi, n, quota)

    @org.junit.Test fun acceptsValidRange() { org.junit.Assert.assertEquals(10..40, check(10, 40).first) }
    @org.junit.Test fun rejectsOutOfBook() { org.junit.Assert.assertNotNull(check(0, 5).second); org.junit.Assert.assertNotNull(check(1, 400).second) }
    @org.junit.Test fun rejectsReversed() { org.junit.Assert.assertNotNull(check(30, 10).second) }
    @org.junit.Test fun rejectsBeyondQuota() { org.junit.Assert.assertNotNull(check(1, 51).second); org.junit.Assert.assertEquals(1..50, check(1, 50).first) }
    @org.junit.Test fun rejectsMoreThanMaxPerBook() { org.junit.Assert.assertNotNull(check(1, 121, quota = null).second) }
    @org.junit.Test fun parsesPersianDigits() { org.junit.Assert.assertEquals(123, com.yadbin.teacher.ui.sources.parsePageNumber("۱۲۳")) }
}
