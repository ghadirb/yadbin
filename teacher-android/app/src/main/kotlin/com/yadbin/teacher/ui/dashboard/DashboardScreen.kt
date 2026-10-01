@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.dashboard

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.Edu
import com.yadbin.teacher.domain.models.ClassSummary
import com.yadbin.teacher.domain.models.ClassesResponse
import com.yadbin.teacher.domain.models.DashTotals
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class DashboardViewModel(private val repo: Repository) : ViewModel() {
    private val _state = MutableStateFlow<Ui<ClassesResponse>>(Ui.Loading)
    val state: StateFlow<Ui<ClassesResponse>> = _state.asStateFlow()
    private val _totals = MutableStateFlow<DashTotals?>(null)
    val totals: StateFlow<DashTotals?> = _totals.asStateFlow()
    private var archived = false
    init { refresh() }

    fun showArchived(value: Boolean) { if (archived != value) { archived = value; _state.value = Ui.Loading; refresh() } }

    fun refresh() {
        viewModelScope.launch {
            if (_state.value !is Ui.Ready) _state.value = Ui.Loading
            _state.value = loadUi { if (archived) repo.archivedClasses() else repo.classes() }
            if (!archived) {
                try { _totals.value = repo.dashboard().data.totals } catch (e: ApiException) { } catch (e: NetworkException) { }
            }
        }
    }

    fun logout(onDone: () -> Unit) { viewModelScope.launch { repo.logout(); onDone() } }
}

@Composable
fun DashboardScreen(onOpenClass: (String) -> Unit, onCreateClass: () -> Unit, onLoggedOut: () -> Unit, onOverview: () -> Unit = {}) {
    val c = LocalContainer.current
    val vm: DashboardViewModel = viewModel(factory = VmFactory { DashboardViewModel(c.repository) })
    val state by vm.state.collectAsStateWithLifecycle()
    val totals by vm.totals.collectAsStateWithLifecycle()
    val teacherName = remember { c.tokens.teacherName()?.takeIf { it.isNotBlank() } }
    var archivedTab by rememberSaveable { mutableStateOf(false) }

    // refresh when coming back from Create Class / Class Detail
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, e -> if (e == androidx.lifecycle.Lifecycle.Event.ON_RESUME) vm.refresh() }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }

    Scaffold(
        topBar = {
            YadbinTopBar("داشبورد", actions = {
                TextButton(onClick = onOverview) { Text("نمای کلی") }
                TextButton(onClick = { vm.logout(onLoggedOut) }) { Text("خروج") }
            })
        },
        floatingActionButton = {
            val s = state
            if (s is Ui.Ready && s.data.classes.isNotEmpty()) {
                ExtendedFloatingActionButton(onClick = onCreateClass, icon = { Icon(Icons.Default.Add, null) }, text = { Text("ساخت کلاس") })
            }
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = !archivedTab, onClick = { archivedTab = false; vm.showArchived(false) }, label = { Text("کلاس‌های فعال") })
                FilterChip(selected = archivedTab, onClick = { archivedTab = true; vm.showArchived(true) }, label = { Text("آرشیو") })
            }
            when (val s = state) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(s.message, vm::refresh)
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    if (s.data.classes.isEmpty()) {
                        Spacer(Modifier.height(48.dp))
                        if (archivedTab) EmptyState("کلاس آرشیوشده‌ای وجود ندارد.")
                        else EmptyState("هنوز کلاسی ایجاد نکرده‌اید.", "ساخت اولین کلاس", onCreateClass)
                    } else {
                        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (!archivedTab) {
                                item { GreetingHeader(teacherName, totals) }
                                item { SummaryRow(s.data.classes, totals) }
                                item { SectionTitle("کلاس‌های من") }
                            }
                            items(s.data.classes, key = { it.id }) { cls -> ClassCard(cls, onOpenClass) }
                            item { Spacer(Modifier.height(72.dp)) }
                        }
                    }
                }
            }
        }
    }
}

/** «سلام، خانم احمدی 👋» + one calm status line (pending = assigned − completed student tasks). */
@Composable
private fun GreetingHeader(name: String?, totals: DashTotals?) {
    Column(Modifier.fillMaxWidth().padding(top = 4.dp)) {
        Text(if (name != null) "سلام، $name 👋" else "سلام 👋", style = MaterialTheme.typography.headlineSmall)
        val pending = totals?.let { (it.assigned - it.completed).coerceAtLeast(0) }
        val line = when {
            pending == null -> "خوش آمدید."
            pending > 0 -> "امروز ${pending.fa()} تکلیف دانش‌آموزی در انتظار انجام است."
            else -> "فعلاً تکلیف باز یا در انتظاری وجود ندارد."
        }
        Text(line, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Four summary cards. Classes/students come from the class list; activities from the dashboard totals when available. */
@Composable
private fun SummaryRow(classes: List<ClassSummary>, totals: DashTotals?) {
    val dash = "—"
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SummaryCard(classes.size.fa(), "کلاس", Modifier.weight(1f))
            SummaryCard(classes.sumOf { it.studentCount }.fa(), "دانش‌آموز", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SummaryCard(totals?.activities?.fa() ?: dash, "فعالیت", Modifier.weight(1f))
            SummaryCard(totals?.completed?.fa() ?: dash, "انجام‌شده", Modifier.weight(1f))
        }
    }
}

@Composable
private fun ClassCard(cls: ClassSummary, onOpen: (String) -> Unit) {
    Card(Modifier.fillMaxWidth().clickable { onOpen(cls.id) }, shape = RoundedCornerShape(18.dp), elevation = CardDefaults.cardElevation(1.dp)) {
        Column(Modifier.padding(16.dp)) {
            Text(cls.name, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val sub = listOfNotNull(cls.gradeLabel ?: cls.grade, Edu.ageRange(cls.ageMin, cls.ageMax)).joinToString(" • ")
            if (sub.isNotBlank()) Text(sub, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusChip("${cls.studentCount.fa()} دانش‌آموز", Tone.Info)
                StatusChip("${cls.recentActivityCount.fa()} فعالیت اخیر", Tone.Success)
            }
            Spacer(Modifier.height(10.dp))
            FilledTonalButton(onClick = { onOpen(cls.id) }, modifier = Modifier.fillMaxWidth()) { Text("ورود به کلاس") }
        }
    }
}
