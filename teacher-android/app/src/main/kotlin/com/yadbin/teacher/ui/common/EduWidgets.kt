@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.yadbin.teacher.ui.common

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.yadbin.teacher.core.utils.CodeLabel
import com.yadbin.teacher.core.utils.Edu

/** Persian/Arabic digits -> Int (null when empty or not a number). */
fun parseIntFa(raw: String): Int? {
    val t = buildString {
        for (ch in raw.trim()) when (ch) {
            in '0'..'9' -> append(ch)
            in '۰'..'۹' -> append('0' + (ch - '۰'))
            in '٠'..'٩' -> append('0' + (ch - '٠'))
        }
    }
    return t.toIntOrNull()
}

/** A small button that opens a menu of [options]; [allowNone] adds a "not set" entry. */
@Composable
fun OptionDropdown(
    label: String,
    options: List<CodeLabel>,
    selected: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
    allowNone: Boolean = false,
    noneLabel: String = "انتخاب نشده",
) {
    var open by remember { mutableStateOf(false) }
    val current = options.firstOrNull { it.code == selected }?.label ?: noneLabel
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelMedium)
        Box {
            OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) { Text(current) }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                if (allowNone) DropdownMenuItem(text = { Text(noneLabel) }, onClick = { open = false; onSelect(null) })
                options.forEach { o -> DropdownMenuItem(text = { Text(o.label) }, onClick = { open = false; onSelect(o.code) }) }
            }
        }
    }
}

val gradeOptions: List<CodeLabel> = Edu.grades.map { CodeLabel(it.code, it.label) }

@Composable
fun GradeDropdown(label: String, selected: String?, onSelect: (String?) -> Unit, modifier: Modifier = Modifier, allowNone: Boolean = false, noneLabel: String = "انتخاب نشده") =
    OptionDropdown(label, gradeOptions, selected, onSelect, modifier, allowNone, noneLabel)

/** Optional whole-number field (age). Keeps what the teacher typed; the caller parses it with [parseIntFa]. */
@Composable
fun AgeField(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    OutlinedTextField(
        value = value, onValueChange = { onChange(it.filter { c -> c.isDigit() }.take(2)) },
        label = { Text(label) }, singleLine = true, modifier = modifier,
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
    )
}

@Composable
fun SkillChips(selected: Set<String>, onToggle: (String) -> Unit, max: Int = 5) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Edu.skills.forEach { s ->
            val on = s.code in selected
            FilterChip(selected = on, onClick = { if (on || selected.size < max) onToggle(s.code) }, label = { Text(s.label) })
        }
    }
}

/** Read-only labels (grade range, level, skills ...). */
@Composable
fun InfoChips(items: List<String>) {
    val shown = items.filter { it.isNotBlank() }
    if (shown.isEmpty()) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        shown.forEach { AssistChip(onClick = {}, label = { Text(it, style = MaterialTheme.typography.labelSmall) }) }
    }
}

/** Advisory fit badge: colour hints, but the teacher can always pick any activity for any student. */
@Composable
fun FitBadge(fit: String, label: String? = null) {
    val text = label?.takeIf { it.isNotBlank() } ?: Edu.fitLabel(fit)
    val color = when (fit) {
        "suitable" -> MaterialTheme.colorScheme.primaryContainer
        "easier_possible" -> MaterialTheme.colorScheme.tertiaryContainer
        "out_of_range" -> MaterialTheme.colorScheme.errorContainer
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
    Surface(color = color, shape = MaterialTheme.shapes.small) {
        Text(text, Modifier.padding(horizontal = 8.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
fun NoticeText(text: String) {
    if (text.isBlank()) return
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
