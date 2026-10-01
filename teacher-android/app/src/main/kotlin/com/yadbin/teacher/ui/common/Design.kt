package com.yadbin.teacher.ui.common

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.runtime.getValue
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Small rounded status label used on cards (calm colours; meaning comes from the text, not only from the colour). */
@Composable
fun StatusChip(text: String, container: Color = MaterialTheme.colorScheme.surfaceVariant, content: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Surface(color = container, contentColor = content, shape = RoundedCornerShape(50)) {
        Text(text, Modifier.padding(horizontal = 10.dp, vertical = 3.dp), style = MaterialTheme.typography.labelMedium)
    }
}

// ---- v1.2 UI step 2: calm, limited design vocabulary -----------------------------------------

/** The only four status meanings the UI uses (spec §20). The text always carries the meaning; colour only supports it. */
enum class Tone { Success, Warning, Error, Info }

@Composable
fun toneColors(tone: Tone): Pair<Color, Color> {
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    return when (tone) {
        Tone.Success -> if (dark) Color(0xFF14532D) to Color(0xFFBBF7D0) else Color(0xFFDCFCE7) to Color(0xFF166534)
        Tone.Warning -> if (dark) Color(0xFF713F12) to Color(0xFFFEF3C7) else Color(0xFFFEF3C7) to Color(0xFF92400E)
        Tone.Error -> if (dark) Color(0xFF7F1D1D) to Color(0xFFFECACA) else Color(0xFFFEE2E2) to Color(0xFF991B1B)
        Tone.Info -> if (dark) Color(0xFF1E3A8A) to Color(0xFFDBEAFE) else Color(0xFFDBEAFE) to Color(0xFF1E40AF)
    }
}

@Composable
fun StatusChip(text: String, tone: Tone) {
    val (bg, fg) = toneColors(tone)
    StatusChip(text, bg, fg)
}

/** A number with a label, used in the dashboard summary row. */
@Composable
fun SummaryCard(value: String, label: String, modifier: Modifier = Modifier) {
    Card(modifier, shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f))) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp)) {
            Text(value, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
        }
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.padding(top = 8.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)
}

/** Soft grey block with a gentle pulse; the only continuous animation in the app, and only while loading (spec §18, §23). */
@Composable
fun SkeletonBlock(modifier: Modifier = Modifier) {
    val t = rememberInfiniteTransition(label = "skeleton")
    val a by t.animateFloat(0.35f, 0.7f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "alpha")
    Box(modifier.clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = a)))
}

@Composable
fun SkeletonList(count: Int = 4, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(count) { SkeletonBlock(Modifier.fillMaxWidth().height(84.dp)) }
    }
}

/** Small educational illustration (open book + star) drawn in code, for empty states. */
@Composable
fun EmptyIllustration(modifier: Modifier = Modifier) {
    val bg = MaterialTheme.colorScheme.primaryContainer
    val ink = MaterialTheme.colorScheme.primary
    Canvas(modifier.size(96.dp)) {
        val s = size.minDimension
        drawCircle(bg, s / 2f)
        val page = Color.White
        drawRoundRect(page, Offset(0.2f * s, 0.34f * s), Size(0.29f * s, 0.34f * s), CornerRadius(0.04f * s))
        drawRoundRect(page, Offset(0.51f * s, 0.34f * s), Size(0.29f * s, 0.34f * s), CornerRadius(0.04f * s))
        for (i in 0..2) {
            drawLine(ink.copy(alpha = 0.5f), Offset(0.25f * s, (0.43f + 0.07f * i) * s), Offset(0.44f * s, (0.43f + 0.07f * i) * s), 0.014f * s)
            drawLine(ink.copy(alpha = 0.5f), Offset(0.56f * s, (0.43f + 0.07f * i) * s), Offset(0.75f * s, (0.43f + 0.07f * i) * s), 0.014f * s)
        }
        drawCircle(Color(0xFFFBBF24), 0.055f * s, Offset(0.5f * s, 0.24f * s))
    }
}
