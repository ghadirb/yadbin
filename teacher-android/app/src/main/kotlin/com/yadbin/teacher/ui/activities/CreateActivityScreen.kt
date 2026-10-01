@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.activities

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.CodeLabel
import com.yadbin.teacher.core.utils.Edu
import com.yadbin.teacher.core.utils.Labels
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.ActivitySpec
import com.yadbin.teacher.domain.models.ClassDetail
import com.yadbin.teacher.domain.models.Template
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class CreateActivityViewModel(
    private val repo: Repository,
    private val classId: String,
) : ViewModel() {
    private val _cls = MutableStateFlow<Ui<ClassDetail>>(Ui.Loading)
    val cls: StateFlow<Ui<ClassDetail>> = _cls.asStateFlow()
    private val _templates = MutableStateFlow<List<Template>>(emptyList())
    val templates: StateFlow<List<Template>> = _templates.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    init { load() }
    fun load() {
        viewModelScope.launch {
            _cls.value = Ui.Loading
            _cls.value = loadUi { repo.classDetail(classId) }
            // Templates are a convenience: the form works without them (offline / older server).
            try { _templates.value = repo.templates().data.templates } catch (e: Exception) { /* keep empty */ }
        }
    }

    fun create(spec: ActivitySpec, onCreated: (String) -> Unit) {
        viewModelScope.launch {
            _busy.value = true; _error.value = null
            try {
                val r = repo.createActivityFromSpec(spec)
                onCreated(r.activity.id)
            } catch (e: ApiException) { _error.value = errorText(e) }
            catch (e: NetworkException) { _error.value = errorText(e) }
            finally { _busy.value = false }
        }
    }
}

@Composable
fun CreateActivityScreen(classId: String, onBack: () -> Unit, onCreated: (activityId: String) -> Unit, onAiBuilder: () -> Unit = {}) {
    val c = LocalContainer.current
    val vm: CreateActivityViewModel = viewModel(key = "create-activity-$classId", factory = VmFactory { CreateActivityViewModel(c.repository, classId) })
    val cls by vm.cls.collectAsStateWithLifecycle()
    val templates by vm.templates.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()

    var wholeClass by rememberSaveable { mutableStateOf(true) }
    var selected by rememberSaveable { mutableStateOf(setOf<String>()) }
    var game by rememberSaveable { mutableStateOf("memory") }
    var difficulty by rememberSaveable { mutableStateOf("adaptive") }   // default: adaptive
    var count by rememberSaveable { mutableStateOf(10f) }          // default: 10
    var title by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var minutes by rememberSaveable { mutableStateOf("") }
    var level by rememberSaveable { mutableStateOf<String?>(null) }
    var skills by rememberSaveable { mutableStateOf(setOf<String>()) }
    var gradeMin by rememberSaveable { mutableStateOf<String?>(null) }
    var gradeMax by rememberSaveable { mutableStateOf<String?>(null) }
    var ageMin by rememberSaveable { mutableStateOf("") }
    var ageMax by rememberSaveable { mutableStateOf("") }
    var templateId by rememberSaveable { mutableStateOf<String?>(null) }
    var prefillTemplateDone by rememberSaveable { mutableStateOf(false) }

    fun applyTemplate(t: Template) {
        game = t.gameType; difficulty = t.difficultyMode; count = t.questionCount.coerceIn(5, 12).toFloat()
        title = t.title; description = t.description; minutes = t.suggestedMinutes.toString(); level = t.level
        skills = t.skills.toSet(); gradeMin = t.gradeMin; gradeMax = t.gradeMax
        ageMin = t.ageMin.toString(); ageMax = t.ageMax.toString(); templateId = t.id
    }

    // One-shot hand-over from the AI builder / a recommendation (read and cleared); everything stays editable.
    val prefill = remember { c.prefill.also { c.prefill = null } }
    LaunchedEffect(Unit) {
        prefill?.let { p ->
            p.gameType?.let { game = it }
            p.difficultyMode?.let { difficulty = it }
            p.questionCount?.let { count = it.coerceIn(5, 12).toFloat() }
            p.title?.let { title = it }
            p.description?.let { description = it }
            p.suggestedMinutes?.let { minutes = it.toString() }
            p.level?.let { level = it }
            if (p.skills.isNotEmpty()) skills = p.skills.toSet()
            p.gradeMin?.let { gradeMin = it }
            p.gradeMax?.let { gradeMax = it }
            p.ageMin?.let { ageMin = it.toString() }
            p.ageMax?.let { ageMax = it.toString() }
            p.templateId?.let { templateId = it }
            p.studentId?.let { wholeClass = false; selected = setOf(it) }
        }
    }
    // A recommendation carries only the template id: apply the template defaults once the list is loaded.
    LaunchedEffect(templates) {
        val want = prefill?.templateId
        if (prefill != null && want != null && !prefillTemplateDone && prefill.title == null) {
            templates.firstOrNull { it.id == want }?.let { applyTemplate(it); prefillTemplateDone = true }
        }
    }

    Scaffold(topBar = { YadbinTopBar("فعالیت جدید", onBack) }) { pad ->
        when (val d = cls) {
            Ui.Loading -> LoadingBox(Modifier.padding(pad))
            is Ui.Error -> Box(Modifier.padding(pad)) { ErrorBox(d.message, vm::load) }
            is Ui.Ready -> {
                val students = d.data.students
                val classGrade = d.data.cls.gradeCode
                val minAge = parseIntFa(ageMin); val maxAge = parseIntFa(ageMax)
                val minutesVal = parseIntFa(minutes)
                val ageBad = (ageMin.isNotBlank() && (minAge == null || minAge !in 3..25)) || (ageMax.isNotBlank() && (maxAge == null || maxAge !in 3..25)) || (minAge != null && maxAge != null && minAge > maxAge)
                val gradeBad = gradeMin != null && gradeMax != null && (Edu.grades.firstOrNull { it.code == gradeMin }?.order ?: 0) > (Edu.grades.firstOrNull { it.code == gradeMax }?.order ?: 0)
                val minutesBad = minutes.isNotBlank() && (minutesVal == null || minutesVal !in 1..120)
                Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                    OutlinedButton(onClick = onAiBuilder, modifier = Modifier.fillMaxWidth()) { Text("ساخت پیشنهاد با هوش مصنوعی") }
                    Text("هوش مصنوعی فقط پیشنهاد می‌دهد؛ شما ویرایش و تأیید می‌کنید.", style = MaterialTheme.typography.bodySmall)

                    Section("۱. دانش‌آموزان")
                    ChoiceRow("کل کلاس (${students.size.fa()} نفر)", wholeClass) { wholeClass = true }
                    ChoiceRow("انتخاب دستی", !wholeClass) { wholeClass = false }
                    if (!wholeClass) {
                        students.forEach { s ->
                            Row(Modifier.fillMaxWidth().clickable { selected = if (s.id in selected) selected - s.id else selected + s.id }, verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(checked = s.id in selected, onCheckedChange = { selected = if (it) selected + s.id else selected - s.id })
                                Text(s.name)
                                val info = listOfNotNull(s.gradeLabel, s.age?.let { it.fa() + " ساله" }).joinToString(" • ")
                                if (info.isNotBlank()) Text("  ($info)", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }

                    if (templates.isNotEmpty()) {
                        Section("۲. قالب آماده (اختیاری)")
                        val gOrder = Edu.grades.firstOrNull { it.code == classGrade }?.order
                        fun inRange(t: Template): Boolean {
                            val lo = Edu.grades.firstOrNull { it.code == t.gradeMin }?.order ?: return true
                            val hi = Edu.grades.firstOrNull { it.code == t.gradeMax }?.order ?: return true
                            return gOrder != null && gOrder in lo..hi
                        }
                        val ordered = templates.sortedByDescending { inRange(it) }
                        val opts = ordered.map { CodeLabel(it.id, it.title + if (inRange(it)) " ✓" else "") }
                        OptionDropdown("قالب", opts, templateId, { id ->
                            val t = templates.firstOrNull { it.id == id }
                            if (t != null) applyTemplate(t) else templateId = null
                        }, Modifier.fillMaxWidth(), allowNone = true, noneLabel = "بدون قالب")
                        templates.firstOrNull { it.id == templateId }?.let { Text(it.description, style = MaterialTheme.typography.bodySmall) }
                        Text("علامت ✓ یعنی قالب برای پایه‌ی این کلاس مناسب است. بعد از انتخاب قالب می‌توانید همه‌چیز را تغییر دهید.", style = MaterialTheme.typography.bodySmall)
                    }

                    Section("۳. بازی")
                    listOf("memory", "attention", "problem_solving").forEach { g -> ChoiceRow(Labels.game(g), game == g) { game = g } }

                    Section("۴. سطح دشواری بازی")
                    listOf("adaptive", "easy", "medium", "hard").forEach { m -> ChoiceRow(Labels.difficulty(m), difficulty == m) { difficulty = m } }

                    Section("۵. تعداد سؤال: ${count.toInt().fa()}")
                    Slider(value = count, onValueChange = { count = it }, valueRange = 5f..12f, steps = 6)

                    Section("۶. مشخصات فعالیت (اختیاری)")
                    OutlinedTextField(title, { title = it.take(80) }, label = { Text("عنوان") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(description, { description = it.take(500) }, label = { Text("توضیحات") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    AgeField("زمان پیشنهادی (دقیقه)", minutes, { minutes = it }, Modifier.fillMaxWidth())
                    if (minutesBad) Text("زمان باید بین ۱ تا ۱۲۰ دقیقه باشد.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(8.dp))
                    OptionDropdown("سطح فعالیت", Edu.levels, level, { level = it }, Modifier.fillMaxWidth(), allowNone = true, noneLabel = "تعیین نشده")
                    Spacer(Modifier.height(8.dp))
                    Text("مهارت‌های هدف (تا ۵ مورد)", style = MaterialTheme.typography.labelMedium)
                    SkillChips(skills, { skills = if (it in skills) skills - it else skills + it })

                    Section("۷. محدوده‌ی پیشنهادی پایه و سن (اختیاری)")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GradeDropdown("از پایه", gradeMin, { gradeMin = it }, Modifier.weight(1f), allowNone = true, noneLabel = "—")
                        GradeDropdown("تا پایه", gradeMax, { gradeMax = it }, Modifier.weight(1f), allowNone = true, noneLabel = "—")
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AgeField("از سن", ageMin, { ageMin = it }, Modifier.weight(1f))
                        AgeField("تا سن", ageMax, { ageMax = it }, Modifier.weight(1f))
                    }
                    if (gradeBad) Text("پایه‌ی شروع نباید بالاتر از پایه‌ی پایان باشد.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    if (ageBad) Text("بازه‌ی سنی معتبر نیست (۳ تا ۲۵ سال).", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    Text("این محدوده فقط برای راهنمایی است؛ شما می‌توانید فعالیت را برای هر دانش‌آموزی انتخاب کنید.", style = MaterialTheme.typography.bodySmall)

                    error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
                    Spacer(Modifier.height(16.dp))
                    val canSubmit = students.isNotEmpty() && (wholeClass || selected.isNotEmpty()) && !busy && !ageBad && !gradeBad && !minutesBad
                    Button(
                        onClick = {
                            val spec = ActivitySpec(
                                classId = classId, gameType = game, difficultyMode = difficulty, questionCount = count.toInt(),
                                studentIds = if (wholeClass) null else students.map { it.id }.filter { it in selected },
                                title = title.trim().ifBlank { null }, description = description.trim().ifBlank { null }, suggestedMinutes = minutesVal,
                                level = level, skills = skills.toList(), gradeMin = gradeMin, gradeMax = gradeMax, ageMin = minAge, ageMax = maxAge, templateId = templateId,
                            )
                            vm.create(spec, onCreated)
                        },
                        enabled = canSubmit, modifier = Modifier.fillMaxWidth(),
                    ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("تأیید و ساخت فعالیت و لینک‌ها") }
                    if (!wholeClass && selected.isEmpty()) Text("حداقل یک دانش‌آموز انتخاب کنید.", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun Section(text: String) {
    Spacer(Modifier.height(16.dp))
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
}

@Composable
private fun ChoiceRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected = selected, onClick = onClick)
        Text(label)
    }
}
