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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import com.yadbin.teacher.R

private val Light = lightColorScheme(
    primary = Color(0xFF0F766E), onPrimary = Color.White,
    primaryContainer = Color(0xFFCCFBF1), onPrimaryContainer = Color(0xFF042F2E),
    secondary = Color(0xFF7C3AED), onSecondary = Color.White,
    secondaryContainer = Color(0xFFEDE9FE), onSecondaryContainer = Color(0xFF2E1065),
    tertiary = Color(0xFFB45309), onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFEF3C7), onTertiaryContainer = Color(0xFF451A03),
    background = Color(0xFFF7FAF9), onBackground = Color(0xFF14201E),
    surface = Color(0xFFFFFFFF), onSurface = Color(0xFF14201E),
    surfaceVariant = Color(0xFFE6EFED), onSurfaceVariant = Color(0xFF3F4F4C),
    outline = Color(0xFF6F7F7B), outlineVariant = Color(0xFFCBD8D5),
    error = Color(0xFFB42318), onError = Color.White,
    errorContainer = Color(0xFFFEE4E2), onErrorContainer = Color(0xFF55160C),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF5EEAD4), onPrimary = Color(0xFF042F2E),
    primaryContainer = Color(0xFF115E59), onPrimaryContainer = Color(0xFFCCFBF1),
    secondary = Color(0xFFC4B5FD), onSecondary = Color(0xFF2E1065),
    secondaryContainer = Color(0xFF4C1D95), onSecondaryContainer = Color(0xFFEDE9FE),
    tertiary = Color(0xFFFCD34D), onTertiary = Color(0xFF451A03),
    tertiaryContainer = Color(0xFF78350F), onTertiaryContainer = Color(0xFFFEF3C7),
    background = Color(0xFF0E1514), onBackground = Color(0xFFE2ECEA),
    surface = Color(0xFF141C1B), onSurface = Color(0xFFE2ECEA),
    surfaceVariant = Color(0xFF26322F), onSurfaceVariant = Color(0xFFB9C8C4),
    outline = Color(0xFF879793), outlineVariant = Color(0xFF3A4946),
    error = Color(0xFFFDA29B), onError = Color(0xFF55160C),
    errorContainer = Color(0xFF7A271A), onErrorContainer = Color(0xFFFEE4E2),
)

/** Slightly rounder corners than the M3 default; used by cards, dialogs and chips app-wide. */
private val YadbinShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp), small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp), large = RoundedCornerShape(20.dp), extraLarge = RoundedCornerShape(28.dp),
)

/** One readable Persian UI font (Vazirmatn, OFL) for every screen; Persian digits are produced by the app's own formatters. */
val YadbinFont = FontFamily(
    Font(R.font.vazirmatn_regular, FontWeight.Normal),
    Font(R.font.vazirmatn_medium, FontWeight.Medium),
    Font(R.font.vazirmatn_bold, FontWeight.Bold),
)

private fun Typography.withFont(f: FontFamily) = Typography(
    displayLarge = displayLarge.copy(fontFamily = f), displayMedium = displayMedium.copy(fontFamily = f), displaySmall = displaySmall.copy(fontFamily = f),
    headlineLarge = headlineLarge.copy(fontFamily = f), headlineMedium = headlineMedium.copy(fontFamily = f), headlineSmall = headlineSmall.copy(lineHeight = 34.sp, fontFamily = f),
    titleLarge = titleLarge.copy(lineHeight = 32.sp, fontFamily = f, fontWeight = FontWeight.Bold), titleMedium = titleMedium.copy(lineHeight = 26.sp, fontFamily = f, fontWeight = FontWeight.Bold), titleSmall = titleSmall.copy(lineHeight = 22.sp, fontFamily = f),
    bodyLarge = bodyLarge.copy(lineHeight = 27.sp, fontFamily = f), bodyMedium = bodyMedium.copy(lineHeight = 24.sp, fontFamily = f), bodySmall = bodySmall.copy(lineHeight = 20.sp, fontFamily = f),
    labelLarge = labelLarge.copy(lineHeight = 20.sp, fontFamily = f), labelMedium = labelMedium.copy(lineHeight = 18.sp, fontFamily = f), labelSmall = labelSmall.copy(fontFamily = f),
)

/** Material 3, always right-to-left (Persian UI regardless of device locale). */
@Composable
fun YadbinTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, typography = Typography().withFont(YadbinFont), shapes = YadbinShapes) {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl, content = content)
    }
}
