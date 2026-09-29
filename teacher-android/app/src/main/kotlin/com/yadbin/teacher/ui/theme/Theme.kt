package com.yadbin.teacher.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.platform.LocalLayoutDirection

private val Light = lightColorScheme(
    primary = Color(0xFF0F766E), onPrimary = Color.White,
    primaryContainer = Color(0xFFCCFBF1), onPrimaryContainer = Color(0xFF042F2E),
    secondary = Color(0xFF7C3AED), tertiary = Color(0xFFB45309),
    background = Color(0xFFFAFAF9), surface = Color(0xFFFFFFFF),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF5EEAD4), onPrimary = Color(0xFF042F2E),
    primaryContainer = Color(0xFF115E59), onPrimaryContainer = Color(0xFFCCFBF1),
)

/** Material 3, always right-to-left (Persian UI regardless of device locale). */
@Composable
fun YadbinTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light) {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl, content = content)
    }
}
