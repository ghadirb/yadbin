@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.sources

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.ContentSourceDetail
import com.yadbin.teacher.domain.models.SourceDraftSpec
import com.yadbin.teacher.domain.usecases.SourceRules
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private class SourceQuizViewModel(private val repo: Repository, private val sourceId: String) : ViewModel() {
    private val _source = MutableStateFlow<Ui<ContentSourceDetail>>(Ui.Loading)
    val source: StateFlow<Ui<ContentSourceDetail>> = _source.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    init { refresh() }
    private fun refresh() { viewModelScope.launch { _source.value = loadUi { repo.contentSource(sourceId) } } }
    fun clearError() { _error.value = null }
    fun create(spec: SourceDraftSpec, onCreated: (String) -> Unit) {
        if (_busy.value) return
        viewModelScope.launch {
            _busy.value = true
            try { onCreated(repo.aiAssessmentDraftFromSource(spec).assessment.id) }
            catch (e: Exception) { _error.value = errorText(e) }
            finally { _busy.value = false }
        }
    }
}

@Composable
fun SourceQuizScreen(sourceId: String, onBack: () -> Unit, onCreated: (String) -> Unit) {
    val container = LocalContainer.current
    val vm: SourceQuizViewModel = viewModel(key = "source-quiz-$sourceId", factory = VmFactory { SourceQuizViewModel(container.repository, sourceId) })
    val state by vm.source.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var selected by remember { mutableStateOf(setOf<String>()) }
    var wholeSource by remember { mutableStateOf(true) }
    var count by remember { mutableIntStateOf(10) }
    var title by remember { mutableStateOf("") }
    var level by remember { mutableStateOf("medium") }
    var types by remember { mutableStateOf(setOf("multiple_choice")) }
    error?.let { message -> AlertDialog(onDismissRequest = vm::clearError, title = { Text("خطا") }, text = { Text(message) }, confirmButton = { TextButton(onClick = vm::clearError) { Text("باشه") } }) }
    Scaffold(topBar = { YadbinTopBar("ساخت آزمون از منبع", onBack) }) { padding ->
        when (val current = state) {
            Ui.Loading -> LoadingBox(Modifier.padding(padding))
            is Ui.Error -> ErrorBox(current.message, onRetry = null)
            is Ui.Ready -> {
                val detail = current.data
                val info = detail.source
                val selectedChars = if (wholeSource) info.charCount else detail.sections.filter { it.id in selected }.sumOf { it.charCount }
                val advice = SourceRules.countAdvice(count, selectedChars)
                LazyColumn(Modifier.padding(padding).fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(vertical = 16.dp)) {
                    item { Text(info.title, style = MaterialTheme.typography.headlineSmall) }
                    item { OutlinedTextField(title, { title = it.take(SourceRules.MAX_TITLE) }, label = { Text("عنوان آزمون (اختیاری)") }, singleLine = true, modifier = Modifier.fillMaxWidth()) }
                    item { Text("محدودهٔ متن", style = MaterialTheme.typography.titleMedium) }
                    item { Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) { Checkbox(wholeSource, { wholeSource = it; if (it) selected = emptySet() }); Text("کل منبع") } }
                    if (!wholeSource) items(detail.sections, key = { it.id }) { section -> Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) { Checkbox(section.id in selected, { checked -> selected = if (checked) selected + section.id else selected - section.id }); Text(section.title, modifier = Modifier.weight(1f)); Text("${section.charCount} ظ†ظˆغŒط³ظ‡", style = MaterialTheme.typography.labelSmall) } }
                    item { Text("طھط¹ط¯ط§ط¯ ط³ط¤ط§ظ„: ${count}") }
                    item { Slider(value = count.toFloat(), onValueChange = { count = it.toInt().coerceIn(3, 20) }, valueRange = 3f..20f, steps = 16) }
                    item { Text("نوع سؤال") }
                    items(SourceRules.QUESTION_TYPES) { (key, label) -> Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) { Checkbox(key in types, { checked -> types = if (checked) types + key else types - key }); Text(label) } }
                    item { Text("سطح سؤال") }
                    item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("easy" to "ط¢ط³ط§ظ†", "medium" to "ظ…طھظˆط³ط·", "hard" to "ط³ط®طھ").forEach { (key, label) -> FilterChip(selected = level == key, onClick = { level = key }, label = { Text(label) }) } } }
                    item { if (!advice.ok) Text(advice.message ?: "ظ…ط­ط¯ظˆط¯ظ‡ظ” ط§ظ†طھط®ط§ط¨â€Œط´ط¯ظ‡ ع©ط§ظپغŒ ظ†غŒط³طھ.", color = MaterialTheme.colorScheme.error) }
                    item { Button(enabled = advice.ok && types.isNotEmpty() && !busy, onClick = { vm.create(SourceDraftSpec(sourceId = sourceId, sectionIds = selected.toList(), wholeSource = wholeSource, title = title, level = level, questionCount = count, questionTypes = types.toList()), onCreated) }, modifier = Modifier.fillMaxWidth()) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("ساخت پیش‌نویس آزمون") } }
                    item { Text("آزمون ابتدا به‌صورت پیش‌نویس باز می‌شود و قبل از انتشار قابل ویرایش و بازبینی است.", style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
    }
}

