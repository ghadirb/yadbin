@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.sources

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
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
import com.yadbin.teacher.core.utils.Edu
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.AssessmentDetail
import com.yadbin.teacher.domain.models.ContentSourceDetail
import com.yadbin.teacher.domain.models.SourceDraftSpec
import com.yadbin.teacher.domain.usecases.SourceRules
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private class SourceQuizViewModel(private val repo: Repository, private val sourceId: String, private val replaceId: String?) : ViewModel() {
    /** Edit mode: the assessment being rebuilt, used to pre-fill the same options the teacher chose when it was made. */
    private val _prefill = MutableStateFlow<AssessmentDetail?>(null)
    val prefill: StateFlow<AssessmentDetail?> = _prefill.asStateFlow()
    private val _source = MutableStateFlow<Ui<ContentSourceDetail>>(Ui.Loading)
    val source: StateFlow<Ui<ContentSourceDetail>> = _source.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    init { refresh(); if (replaceId != null) viewModelScope.launch { try { _prefill.value = repo.assessment(replaceId).data } catch (e: Exception) { /* the form still works with defaults */ } } }
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
fun SourceQuizScreen(sourceId: String, replaceAssessmentId: String? = null, onBack: () -> Unit, onCreated: (String) -> Unit) {
    val container = LocalContainer.current
    val editing = replaceAssessmentId != null
    val vm: SourceQuizViewModel = viewModel(key = "source-quiz-$sourceId-${replaceAssessmentId.orEmpty()}", factory = VmFactory { SourceQuizViewModel(container.repository, sourceId, replaceAssessmentId) })
    val state by vm.source.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var selected by remember { mutableStateOf(setOf<String>()) }
    var wholeSource by remember { mutableStateOf(true) }
    var count by remember { mutableIntStateOf(10) }
    var title by remember { mutableStateOf("") }
    var level by remember { mutableStateOf("basic") }
    var types by remember { mutableStateOf(setOf("multiple_choice")) }
    val target by vm.prefill.collectAsStateWithLifecycle()
    var prefilled by remember { mutableStateOf(false) }
    var confirmReplace by remember { mutableStateOf(false) }
    LaunchedEffect(target) {
        val d = target
        if (d != null && !prefilled) {
            prefilled = true
            title = d.assessment.title
            d.assessment.level?.let { level = it }
            if (d.questions.isNotEmpty()) count = d.questions.size.coerceIn(3, 20)
            val known = SourceRules.QUESTION_TYPES.map { it.first }.toSet()
            d.questions.map { it.type }.filter { it in known }.toSet().takeIf { it.isNotEmpty() }?.let { types = it }
        }
    }
    val spec = { SourceDraftSpec(sourceId = sourceId, sectionIds = selected.toList(), wholeSource = wholeSource, title = title, level = level, questionCount = count, questionTypes = types.toList(), replaceAssessmentId = replaceAssessmentId) }
    if (confirmReplace) ConfirmDialog("جایگزینی سؤال‌ها", "سؤال‌های فعلی این آزمون حذف و با سؤال‌های تازه از منبع جایگزین می‌شوند. آزمایش قبلی هم باطل می‌شود. ادامه می‌دهید؟", "جایگزین کن", { confirmReplace = false; vm.create(spec(), onCreated) }, { confirmReplace = false })
    error?.let { message -> AlertDialog(onDismissRequest = vm::clearError, title = { Text("خطا") }, text = { Text(message) }, confirmButton = { TextButton(onClick = vm::clearError) { Text("باشه") } }) }
    Scaffold(topBar = { YadbinTopBar(if (editing) "ویرایش آزمون از منبع" else "ساخت آزمون از منبع", onBack) }) { padding ->
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
                    if (!wholeSource) items(detail.sections, key = { it.id }) { section -> Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) { Checkbox(section.id in selected, { checked -> selected = if (checked) selected + section.id else selected - section.id }); Text(section.title, modifier = Modifier.weight(1f)); Text("${section.charCount} نویسه", style = MaterialTheme.typography.labelSmall) } }
                    item { Text("تعداد سؤال: ${count}") }
                    item { Slider(value = count.toFloat(), onValueChange = { count = it.toInt().coerceIn(3, 20) }, valueRange = 3f..20f, steps = 16) }
                    item { Text("نوع سؤال") }
                    items(SourceRules.QUESTION_TYPES) { (key, label) -> Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) { Checkbox(key in types, { checked -> types = if (checked) types + key else types - key }); Text(label) } }
                    item { Text("سطح سؤال") }
                    item { Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) { Edu.levels.forEach { option -> FilterChip(selected = level == option.code, onClick = { level = option.code }, label = { Text(option.label) }) } } }
                    item { if (!advice.ok) Text(advice.message ?: "محدودهٔ انتخاب‌شده کافی نیست.", color = MaterialTheme.colorScheme.error) }
                    item { Button(enabled = advice.ok && types.isNotEmpty() && !busy, onClick = { if (editing) confirmReplace = true else vm.create(spec(), onCreated) }, modifier = Modifier.fillMaxWidth()) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(if (editing) "جایگزین‌کردن سؤال‌ها از منبع" else "ساخت پیش‌نویس آزمون") } }
                    item { Text(if (editing) "سؤال‌های همین آزمون با انتخاب‌های بالا دوباره ساخته می‌شوند. درس، پایه، زمان و توضیح آزمون تغییر نمی‌کنند." else "آزمون ابتدا به‌صورت پیش‌نویس باز می‌شود و قبل از انتشار قابل ویرایش و بازبینی است.", style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
    }
}

