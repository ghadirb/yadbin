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
import com.yadbin.teacher.core.utils.Labels
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.ClassDetail
import com.yadbin.teacher.domain.usecases.CreateActivityUseCase
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class CreateActivityViewModel(
    private val repo: Repository,
    private val useCase: CreateActivityUseCase,
    private val classId: String,
) : ViewModel() {
    private val _cls = MutableStateFlow<Ui<ClassDetail>>(Ui.Loading)
    val cls: StateFlow<Ui<ClassDetail>> = _cls.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    init { load() }
    fun load() { viewModelScope.launch { _cls.value = Ui.Loading; _cls.value = loadUi { repo.classDetail(classId) } } }

    fun create(game: String, difficulty: String, count: Int, selected: List<String>?, onCreated: (String) -> Unit) {
        viewModelScope.launch {
            _busy.value = true; _error.value = null
            try {
                val r = useCase(classId, game, difficulty, count, selected)
                onCreated(r.activity.id)
            } catch (e: ApiException) { _error.value = errorText(e) }
            catch (e: NetworkException) { _error.value = errorText(e) }
            finally { _busy.value = false }
        }
    }
}

@Composable
fun CreateActivityScreen(classId: String, onBack: () -> Unit, onCreated: (activityId: String) -> Unit) {
    val c = LocalContainer.current
    val vm: CreateActivityViewModel = viewModel(key = "create-activity-$classId", factory = VmFactory { CreateActivityViewModel(c.repository, c.createActivity, classId) })
    val cls by vm.cls.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()

    var wholeClass by rememberSaveable { mutableStateOf(true) }
    var selected by rememberSaveable { mutableStateOf(setOf<String>()) }
    var game by rememberSaveable { mutableStateOf("memory") }
    var difficulty by rememberSaveable { mutableStateOf("adaptive") }   // default: adaptive
    var count by rememberSaveable { mutableStateOf(10f) }          // default: 10

    Scaffold(topBar = { YadbinTopBar("فعالیت جدید", onBack) }) { pad ->
        when (val d = cls) {
            Ui.Loading -> LoadingBox(Modifier.padding(pad))
            is Ui.Error -> Box(Modifier.padding(pad)) { ErrorBox(d.message, vm::load) }
            is Ui.Ready -> {
                val students = d.data.students
                Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                    Section("۱. دانش‌آموزان")
                    ChoiceRow("کل کلاس (${students.size.fa()} نفر)", wholeClass) { wholeClass = true }
                    ChoiceRow("انتخاب دستی", !wholeClass) { wholeClass = false }
                    if (!wholeClass) {
                        students.forEach { s ->
                            Row(Modifier.fillMaxWidth().clickable { selected = if (s.id in selected) selected - s.id else selected + s.id }, verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(checked = s.id in selected, onCheckedChange = { selected = if (it) selected + s.id else selected - s.id })
                                Text(s.name)
                            }
                        }
                    }

                    Section("۲. بازی")
                    listOf("memory", "attention", "problem_solving").forEach { g -> ChoiceRow(Labels.game(g), game == g) { game = g } }

                    Section("۳. سطح دشواری")
                    listOf("adaptive", "easy", "medium", "hard").forEach { m -> ChoiceRow(Labels.difficulty(m), difficulty == m) { difficulty = m } }

                    Section("۴. تعداد سؤال: ${count.toInt().fa()}")
                    Slider(value = count, onValueChange = { count = it }, valueRange = 5f..12f, steps = 6)

                    error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
                    Spacer(Modifier.height(16.dp))
                    val canSubmit = students.isNotEmpty() && (wholeClass || selected.isNotEmpty()) && !busy
                    Button(
                        onClick = { vm.create(game, difficulty, count.toInt(), if (wholeClass) null else students.map { it.id }.filter { it in selected }, onCreated) },
                        enabled = canSubmit, modifier = Modifier.fillMaxWidth(),
                    ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("ساخت فعالیت و لینک‌ها") }
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
