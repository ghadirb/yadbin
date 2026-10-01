@file:OptIn(ExperimentalLayoutApi::class)

package com.yadbin.teacher.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yadbin.teacher.core.utils.Edu
import com.yadbin.teacher.core.utils.Labels
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.core.utils.jalaliDateTimeFa
import com.yadbin.teacher.domain.models.ActivityRow

/** Emoji that goes with a game type (spec §15: "🧠 حافظه"). Unknown types fall back to a neutral book. */
fun gameEmoji(gameType: String): String = when (gameType) {
    "memory" -> "🧠"
    "attention" -> "🔍"
    "problem_solving" -> "🧩"
    else -> "📘"
}

/**
 * Activity card for the class "فعالیت‌ها" tab (spec §15): title, game type + grade + level, question count,
 * how many students finished, and a status chip. Archived / finished activities keep the same layout but
 * are visibly calmer (softer surface and text), so they never look like an error.
 */
@Composable
fun ActivityCard(a: ActivityRow, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val active = a.lifecycle == "active"
    val container = if (active) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)
    val textAlpha = if (active) 1f else 0.78f
    val statusText = a.lifecycleLabel.ifBlank { Labels.activityStatus(a.status) }
    val tone = when (a.lifecycle) {
        "active" -> Tone.Success
        "archived" -> Tone.Info
        else -> Tone.Warning
    }
    Card(
        modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = container),
        elevation = CardDefaults.cardElevation(defaultElevation = if (active) 1.dp else 0.dp),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
                    Text(gameEmoji(a.gameType), style = MaterialTheme.typography.titleLarge)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        a.title ?: Labels.game(a.gameType),
                        style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = textAlpha),
                    )
                    val sub = listOfNotNull(
                        Labels.game(a.gameType),
                        Edu.gradeRange(a.gradeMinLabel, a.gradeMaxLabel),
                        a.levelLabel,
                    ).joinToString(" • ")
                    Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.width(8.dp))
                StatusChip(statusText, tone)
            }
            val chips = listOfNotNull(Edu.ageRange(a.ageMin, a.ageMax)) + a.skillLabels
            if (chips.isNotEmpty()) InfoChips(chips)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("${a.questionCount.fa()} سؤال", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                a.suggestedMinutes?.let { Text("${it.fa()} دقیقه", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Text("${a.assigned.fa()} دانش‌آموز", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                a.createdAt.jalaliDateTimeFa().takeIf { it.isNotBlank() }?.let {
                    Text("ساخته‌شده: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (a.assigned > 0) {
                Text("انجام‌شده: ${a.completed.fa()} از ${a.assigned.fa()}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface.copy(alpha = textAlpha))
                LinearProgressIndicator(
                    progress = { (a.completed.toFloat() / a.assigned).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(50)),
                )
            }
        }
    }
}
