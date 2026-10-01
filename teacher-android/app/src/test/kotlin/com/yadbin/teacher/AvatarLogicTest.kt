package com.yadbin.teacher

import com.yadbin.teacher.core.avatar.AvatarLogic
import com.yadbin.teacher.core.utils.performanceWordFa
import com.yadbin.teacher.core.utils.relativeDayFa
import org.junit.Assert.*
import org.junit.Test

class AvatarLogicTest {
    private val id = "3f2b8c1e-8a7d-4a55-9d3e-1c2b3a4d5e6f"

    @Test fun priority_photo_then_chosen_preset_then_default() {
        assertEquals(AvatarLogic.Source.Photo, AvatarLogic.resolve(true, 2, id))
        assertEquals(AvatarLogic.Source.Preset(2), AvatarLogic.resolve(false, 2, id))
        assertEquals(AvatarLogic.Source.Preset(AvatarLogic.defaultIndex(id)), AvatarLogic.resolve(false, null, id))
        // an out-of-range stored value never crashes and never leaves an empty slot
        assertEquals(AvatarLogic.Source.Preset(AvatarLogic.defaultIndex(id)), AvatarLogic.resolve(false, 99, id))
        assertEquals(AvatarLogic.Source.Preset(AvatarLogic.defaultIndex(id)), AvatarLogic.resolve(false, -1, id))
    }

    @Test fun default_index_is_stable_in_range_and_spreads_students() {
        assertEquals(AvatarLogic.defaultIndex(id), AvatarLogic.defaultIndex(id))
        val ids = (1..60).map { java.util.UUID.nameUUIDFromBytes("s$it".toByteArray()).toString() }
        val idx = ids.map { AvatarLogic.defaultIndex(it) }
        assertTrue(idx.all { it in 0 until AvatarLogic.PRESET_COUNT })
        assertTrue("students should not all get the same avatar", idx.toSet().size >= 4)
        assertTrue(AvatarLogic.defaultIndex("") in 0 until AvatarLogic.PRESET_COUNT)
    }

    @Test fun file_key_rejects_path_tricks() {
        assertEquals(id, AvatarLogic.safeKey(id))
        assertNull(AvatarLogic.safeKey(""))
        assertNull(AvatarLogic.safeKey("../../etc/passwd"))
        assertNull(AvatarLogic.safeKey("a/b"))
        assertNull(AvatarLogic.safeKey("a\\b"))
        assertNull(AvatarLogic.safeKey("..")) // dots are not allowed at all
        assertNull(AvatarLogic.safeKey("علی"))
        assertNull(AvatarLogic.safeKey("x".repeat(65)))
    }

    @Test fun square_crop_is_centered() {
        assertArrayEquals(intArrayOf(100, 0, 800), AvatarLogic.cropSquare(1000, 800))
        assertArrayEquals(intArrayOf(0, 200, 600), AvatarLogic.cropSquare(600, 1000))
        assertArrayEquals(intArrayOf(0, 0, 512), AvatarLogic.cropSquare(512, 512))
    }

    @Test fun sample_size_keeps_both_sides_at_or_above_target() {
        assertEquals(1, AvatarLogic.sampleSize(600, 600, 512))
        assertEquals(2, AvatarLogic.sampleSize(1100, 1100, 512))
        assertEquals(4, AvatarLogic.sampleSize(4200, 3100, 512))
        assertEquals(1, AvatarLogic.sampleSize(100, 100, 512))
    }

    @Test fun relative_day_uses_tehran_calendar_day() {
        val now = 1790157600000L // 2026-09-23T10:00Z = 1 Mehr 1405, 13:30 in Tehran
        assertEquals("امروز", "2026-09-23T08:00:00.000Z".relativeDayFa(now))
        assertEquals("دیروز", "2026-09-22T08:00:00.000Z".relativeDayFa(now))
        assertEquals("۱۰ شهریور ۱۴۰۵", "2026-09-01T10:00:00.000Z".relativeDayFa(now))
        assertEquals("", (null as String?).relativeDayFa(now))
        assertEquals("", "garbage".relativeDayFa(now))
    }

    @Test fun performance_words_follow_server_thresholds_and_never_diagnose() {
        assertNull(performanceWordFa(null))
        assertEquals("خوب", performanceWordFa(0.8))
        assertEquals("متوسط", performanceWordFa(0.79))
        assertEquals("متوسط", performanceWordFa(0.5))
        assertEquals("نیازمند تمرین بیشتر", performanceWordFa(0.49))
    }
}
