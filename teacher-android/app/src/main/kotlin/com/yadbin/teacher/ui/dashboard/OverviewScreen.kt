@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.dashboard

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.utils.CodeLabel
import com.yadbin.teacher.core.utils.Edu
import com.yadbin.teacher.core.utils.Labels
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.core.utils.percentFa
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.DashClass
import com.yadbin.teacher.domain.models.DashboardResponse
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class OverviewViewModel(private val repo: Repository) : ViewModel() {
    private val _state = MutableStateFlow<Ui<DashboardResponse>>(Ui.Loading)
    val state: StateFlow<Ui<DashboardResponse>> = _state.asStateFlow()
    private var query = ""

    init { load("") }

    fun load(q: String) {
        query = q
        viewModelScope.launch {
            if (_state.value !is Ui.Ready) _state.value = Ui.Loading
            _state.value = loadUi { repo.dashboard(q) }
        }
    }
    fun retry() = load(query)
}

/** Teacher-wide overview: counts and distributions only. Students are never ranked or compared with each other. */
@Composable
fun OverviewScreen(onBack: () -> Unit, onOpenClass: (String) -> Unit) {
    val c = LocalContainer.current
    val vm: OverviewViewModel = viewModel(factory = VmFactory { OverviewViewModel(c.repository) })
    val state by vm.state.collectAsStateWithLifecycle()
    var grade by rememberSaveable { mutableStateOf<String?>(null) }
    var level by rememberSaveable { mutableStateOf<String?>(null) }
    var game by rememberSaveable { mutableStateOf<String?>(null) }
    var completion by rememberSaveable { mutableStateOf<String?>(null) }

    fun apply(g: String? = grade, l: String? = level, gm: String? = game, cp: String? = completion) {
        val q = listOfNotNull(g?.let { "grade=$it" }, l?.let { "level=$it" }, gm?.let { "gameType=$it" }, cp?.let { "completion=$it" })
        vm.load(if (q.isEmpty()) "" else "?" + q.joinToString("&"))
    }

    Scaffold(topBar = { YadbinTopBar("نمای کلی کلاس‌ها", onBack) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("فیلتر", style = MaterialTheme.typography.titleSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GradeDropdown("پایه", grade, { grade = it; apply(g = it) }, Modifier.weight(1f), allowNone = true, noneLabel = "همه")
                OptionDropdown("سطح فعالیت", Edu.levels, level, { level = it; apply(l = it) }, Modifier.weight(1f), allowNone = true, noneLabel = "همه")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OptionDropdown(
                    "بازی", listOf("memory", "attention", "problem_solving").map { CodeLabel(it, Labels.game(it)) }, game,
                    { game = it; apply(gm = it) }, Modifier.weight(1f), allowNone = true, noneLabel = "همه",
                )
                OptionDropdown(
                    "وضعیت تکمیل", listOf(CodeLabel("done", "کامل‌شده"), CodeLabel("open", "در جریان")), completion,
                    { completion = it; apply(cp = it) }, Modifier.weight(1f), allowNone = true, noneLabel = "همه",
                )
            }
            when (val s = state) {
                Ui.Loading -> Box(Modifier.fillMaxWidth().height(160.dp)) { LoadingBox() }
                is Ui.Error -> Box(Modifier.fillMaxWidth().height(200.dp)) { ErrorBox(s.message, vm::retry) }
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    Content(s.data, onOpenClass)
                }
            }
        }
    }
}

@Composable
private fun Content(d: DashboardResponse, onOpenClass: (String) -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Stat("کلاس‌ها", d.totals.classes.fa())
            Stat("فعالیت‌ها", d.totals.activities.fa())
            Stat("لینک‌های ارسال‌شده", d.totals.assigned.fa())
            Stat("تکمیل‌شده", d.totals.completed.fa())
        }
    }
    if (d.classes.isEmpty()) EmptyState("کلاسی با این فیلتر پیدا نشد.")
    d.classes.forEach { ClassCard(it, onOpenClass) }
    if (d.activities.isNotEmpty()) {
        Text("فعالیت‌ها", style = MaterialTheme.typography.titleMedium)
        d.activities.take(40).forEach { a ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(a.title ?: Labels.game(a.gameType), style = MaterialTheme.typography.titleSmall)
                    Text("${a.className} • انجام‌شده: ${a.completed.fa()} از ${a.assigned.fa()}", style = MaterialTheme.typography.bodySmall)
                    InfoChips(listOfNotNull(a.levelLabel, "عملکرد کلی: " + a.performanceLabel.ifBlank { Edu.performanceLabel(a.performanceStatus) }) + a.skillLabels)
                }
            }
        }
    }
    NoticeText(d.notice.ifBlank { "فقط شمارش و توزیع کلی نمایش داده می‌شود؛ دانش‌آموزان با یکدیگر مقایسه یا رتبه‌بندی نمی‌شوند." })
}

@Composable
private fun ClassCard(c: DashClass, onOpen: (String) -> Unit) {
    Card(Modifier.fillMaxWidth().clickable { onOpen(c.id) }) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(c.name, style = MaterialTheme.typography.titleMedium)
            Text(listOfNotNull(c.gradeLabel, "${c.studentCount.fa()} دانش‌آموز", "${c.activityCount.fa()} فعالیت").joinToString(" • "), style = MaterialTheme.typography.bodySmall)
            Text("تکمیل: ${c.completed.fa()} از ${c.assigned.fa()}" + (c.completionRate?.let { " (${it.percentFa()})" } ?: ""), style = MaterialTheme.typography.bodySmall)
            c.skills.forEach { k ->
                val x = k.distribution
                Text("${k.label}: خوب ${x.good.fa()} • متوسط ${x.average.fa()} • نیاز به تمرین ${x.needs_practice.fa()} • داده کافی نیست ${x.insufficient.fa()}", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(label); Text(value, style = MaterialTheme.typography.titleSmall) }
}
