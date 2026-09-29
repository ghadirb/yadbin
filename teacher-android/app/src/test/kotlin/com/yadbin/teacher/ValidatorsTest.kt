package com.yadbin.teacher

import com.yadbin.teacher.core.utils.Validators
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.core.utils.percentFa
import org.junit.Assert.*
import org.junit.Test

class ValidatorsTest {
    @Test fun phone_normalization() {
        assertEquals("09123456789", Validators.normalizePhone("09123456789"))
        assertEquals("09123456789", Validators.normalizePhone("+98 912 345 6789"))
        assertEquals("09123456789", Validators.normalizePhone("۰۹۱۲۳۴۵۶۷۸۹"))
        assertEquals("09123456789", Validators.normalizePhone("9123456789"))
        assertNull(Validators.normalizePhone("12345"))
        assertNull(Validators.normalizePhone("02112345678"))
    }

    @Test fun password_rules() {
        assertNotNull(Validators.passwordError("short"))
        assertNull(Validators.passwordError("longenough1"))
    }

    @Test fun name_rules() {
        assertNotNull(Validators.nameError("ع"))
        assertNull(Validators.nameError("علی رضایی"))
    }

    @Test fun bulk_names_one_per_line() {
        val text = "علی رضایی\r\n  سارا   محمدی \n\n\nمحمد احمدی\nرضا کریمی\n"
        assertEquals(listOf("علی رضایی", "سارا محمدی", "محمد احمدی", "رضا کریمی"), Validators.parseNames(text))
        assertTrue(Validators.parseNames("  \n \n").isEmpty())
    }

    @Test fun persian_number_formatting() {
        assertEquals("۱۲", 12.fa())
        assertEquals("۸۳٪", 0.8333.percentFa())
    }
}
