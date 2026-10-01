@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.classes

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.Labels
import com.yadbin.teacher.core.utils.Validators
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.core.utils.percentFa
import com.yadbin.teacher.core.utils.jalaliFa
import com.yadbin.teacher.domain.models.WeeklyPoint
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.ClassDetail
import com.yadbin.teacher.domain.models.ClassReport
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ClassDetailViewModel(private val repo: Repository, val classId: String) : ViewModel() {
    private val _detail = MutableStateFlow<Ui<ClassDetail>>(Ui.Loading)
    val detail: StateFlow<Ui<ClassDetail>> = _detail.asStateFlow()
    private val _report = MutableStateFlow<Ui<ClassReport>>(Ui.Loading)
    val report: StateFlow<Ui<ClassReport>> = _report.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            if (_detail.value !is Ui.Ready) _detail.value = Ui.Loading
            _detail.value = loadUi { repo.classDetail(classId) }
            _report.value = loadUi { repo.classReport(classId) }
        }
    }

    fun clearMessage() { _message.value = null }

    private fun act(success: String?, block: suspend () -> Unit, after: () -> Unit = {}) {
        viewModelScope.launch {
            try {
                block()
                if (success != null) _message.value = success
                after()
                refresh()
            } catch (e: ApiException) { _message.value = errorText(e) }
            catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }

    /** Quick-add: one name per line. */
    fun addStudents(text: String) {
        val names = Validators.parseNames(text)
        if (names.isEmpty()) { _message.value = "نامی وارد نشده است."; return }
        act(null, { val r = repo.addStudents(classId, names.joinToString("\n")); _message.value = "${r.added.size.fa()} دانش‌آموز اضافه شد." + if (r.skipped > 0) " (${r.skipped.fa()} نام نامعتبر رد شد)" else "" })
    }

    fun removeFromClass(studentId: String) = act("دانش‌آموز از کلاس حذف شد (اطلاعات او حفظ شد).", { repo.removeFromClass(classId, studentId) })
    /** Clears results/history only; the student stays in the class. */
    fun clearStudentData(studentId: String) = act("داده‌های دانش‌آموز حذف شد؛ خود دانش‌آموز در کلاس باقی ماند.", { repo.clearStudentData(studentId) })
    /** Removes the student completely, with all data. */
    fun deleteStudent(studentId: String) = act("دانش‌آموز و همه‌ی داده‌های او حذف شد.", { repo.deleteStudentData(studentId) })
    fun deleteClass(onDone: () -> Unit) = act(null, { repo.deleteClass(classId) }, onDone)
    /** Archive keeps all data; the class moves to the archived list on the dashboard. */
    fun archive(archived: Boolean, onDone: () -> Unit = {}) =
        act(if (archived) "کلاس آرشیو شد." else "کلاس از آرشیو خارج شد.", { repo.setClassArchived(classId, archived) }, onDone)
}

private enum class StudentAction { REMOVE, CLEAR_DATA, DELETE }

@Composable
fun ClassDetailScreen(
    classId: String,
    onBack: () -> Unit,
    onNewActivity: () -> Unit,
    onOpenActivity: (String) -> Unit,
    onOpenStudent: (String) -> Unit,
) {
    val c = LocalContainer.current
    val vm: ClassDetailViewModel = viewModel(key = "class-$classId", factory = VmFactory { ClassDetailViewModel(c.repository, classId) })
    val detail by vm.detail.collectAsStateWithLifecycle()
    val report by vm.report.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(0) }
    var showAdd by rememberSaveable { mutableStateOf(false) }
    var showDeleteClass by rememberSaveable { mutableStateOf(false) }
    var pending by remember { mutableStateOf<Pair<StudentAction, Pair<String, String>>?>(null) }
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        message?.let { snackbar.showSnackbar(it); vm.clearMessage() }
    }

    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, e -> if (e == androidx.lifecycle.Lifecycle.Event.ON_RESUME) vm.refresh() }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }

    val title = (detail as? Ui.Ready)?.data?.cls?.name ?: "کلاس"
    Scaffold(
        topBar = {
            YadbinTopBar(title, onBack, actions = {
                val isArchived = (detail as? Ui.Ready)?.data?.cls?.archived == true
                TextButton(onClick = { if (isArchived) vm.archive(false) else vm.archive(true, onBack) }) { Text(if (isArchived) "بازگردانی" else "آرشیو") }
                TextButton(onClick = { showDeleteClass = true }) { Text("حذف کلاس") }
            })
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            when (val d = detail) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(d.message, vm::refresh)
                is Ui.Ready -> {
                    if (d.offline) OfflineBanner()
                    Text("${d.data.cls.grade}${d.data.cls.schoolName?.let { " • $it" } ?: ""}", Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodyMedium)
                    TabRow(selectedTabIndex = tab) {
                        Tab(tab == 0, { tab = 0 }, text = { Text("دانش‌آموزان") })
                        Tab(tab == 1, { tab = 1 }, text = { Text("فعالیت‌ها") })
                        Tab(tab == 2, { tab = 2 }, text = { Text("گزارش") })
                    }
                    when (tab) {
                        0 -> StudentsTab(d.data, { showAdd = true }, onOpenStudent) { action, id, name -> pending = action to (id to name) }
                        1 -> ActivitiesTab(d.data, onNewActivity, onOpenActivity)
                        else -> ReportTab(report)
                    }
                }
            }
        }
    }

    if (showAdd) AddStudentsDialog(onDismiss = { showAdd = false }, onSubmit = { text -> showAdd = false; vm.addStudents(text) })

    pending?.let { (action, who) ->
        val (id, name) = who
        if (action == StudentAction.REMOVE) {
            ConfirmDialog("حذف از کلاس", "«$name» از این کلاس خارج می‌شود، ولی اطلاعات و نتایج او حفظ می‌شود.", "حذف از کلاس",
                { pending = null; vm.removeFromClass(id) }, { pending = null })
        } else if (action == StudentAction.CLEAR_DATA) {
            ConfirmDialog("حذف داده‌های دانش‌آموز", "همه‌ی نتایج و تاریخچه‌ی «$name» برای همیشه پاک می‌شود، ولی خود دانش‌آموز در کلاس می‌ماند. این کار قابل بازگشت نیست.", "حذف داده‌ها",
                { pending = null; vm.clearStudentData(id) }, { pending = null })
        } else {
            ConfirmDialog("حذف کامل دانش‌آموز", "«$name» همراه با همه‌ی اطلاعات و نتایجش برای همیشه حذف می‌شود. این کار قابل بازگشت نیست.", "حذف کامل",
                { pending = null; vm.deleteStudent(id) }, { pending = null })
        }
    }
    if (showDeleteClass) {
        ConfirmDialog("حذف کلاس", "کلاس با فعالیت‌ها و نتایج آن حذف می‌شود. این کار قابل بازگشت نیست.", "حذف کلاس",
            { showDeleteClass = false; vm.deleteClass(onBack) }, { showDeleteClass = false })
    }
}

@Composable
private fun StudentsTab(
    data: ClassDetail,
    onAdd: () -> Unit,
    onOpen: (String) -> Unit,
    onAction: (StudentAction, String, String) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Button(onClick = onAdd, Modifier.padding(16.dp).fillMaxWidth()) { Text("+ دانش‌آموز") }
        if (data.students.isEmpty()) {
            EmptyState("هنوز دانش‌آموزی اضافه نشده است.")
        } else {
            LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(data.students, key = { it.id }) { s ->
                    var menu by remember { mutableStateOf(false) }
                    Card(Modifier.fillMaxWidth().clickable { onOpen(s.id) }) {
                        Row(Modifier.padding(start = 16.dp, top = 8.dp, bottom = 8.dp, end = 4.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(s.name, style = MaterialTheme.typography.titleSmall)
                                Text("فعالیت‌های انجام‌شده: ${s.completedActivities.fa()}", style = MaterialTheme.typography.bodySmall)
                                if (s.activityStateLabel.isNotBlank()) Text("وضعیت: ${s.activityStateLabel}", style = MaterialTheme.typography.bodySmall)
                                s.averagePerformance?.let { Text("میانگین عملکرد: ${it.percentFa()}", style = MaterialTheme.typography.bodySmall) }
                                s.lastActivityAt?.jalaliFa()?.takeIf { it.isNotBlank() }?.let { Text("آخرین فعالیت: $it", style = MaterialTheme.typography.bodySmall) }
                            }
                            Box {
                                TextButton(onClick = { menu = true }) { Text("⋮") }
                                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                    DropdownMenuItem(text = { Text("حذف از کلاس") }, onClick = { menu = false; onAction(StudentAction.REMOVE, s.id, s.name) })
                                    DropdownMenuItem(text = { Text("حذف داده‌های دانش‌آموز") }, onClick = { menu = false; onAction(StudentAction.CLEAR_DATA, s.id, s.name) })
                                    DropdownMenuItem(text = { Text("حذف کامل دانش‌آموز") }, onClick = { menu = false; onAction(StudentAction.DELETE, s.id, s.name) })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivitiesTab(data: ClassDetail, onNew: () -> Unit, onOpen: (String) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Button(onClick = onNew, Modifier.padding(16.dp).fillMaxWidth(), enabled = data.students.isNotEmpty()) { Text("فعالیت جدید") }
        if (data.students.isEmpty()) Text("برای ساخت فعالیت ابتدا دانش‌آموز اضافه کنید.", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall)
        if (data.activities.isEmpty()) {
            EmptyState("هنوز فعالیتی ساخته نشده است.")
        } else {
            LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(data.activities, key = { it.id }) { a ->
                    Card(Modifier.fillMaxWidth().clickable { onOpen(a.id) }) {
                        Column(Modifier.padding(16.dp)) {
                            Text(a.title ?: Labels.game(a.gameType), style = MaterialTheme.typography.titleSmall)
                            Text("${Labels.difficulty(a.difficultyMode)} • ${a.questionCount.fa()} سؤال • ${a.lifecycleLabel.ifBlank { Labels.activityStatus(a.status) }}", style = MaterialTheme.typography.bodySmall)
                            Text("انجام‌شده: ${a.completed.fa()} از ${a.assigned.fa()}" + a.createdAt.jalaliFa().takeIf { it.isNotBlank() }?.let { " • ساخته‌شده: $it" }.orEmpty(), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ReportTab(report: Ui<ClassReport>) {
    when (report) {
        Ui.Loading -> LoadingBox()
        is Ui.Error -> ErrorBox(report.message, null)
        is Ui.Ready -> {
            val r = report.data
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("آمار کلی فعالیت", style = MaterialTheme.typography.titleMedium)
                if (r.overallLabel.isNotBlank()) {
                    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) {
                        Text(r.overallLabel, Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
                    }
                }
                StatLine("تعداد دانش‌آموزان", r.studentCount.fa())
                StatLine("دانش‌آموزان فعال (۳۰ روز اخیر)", r.activeStudents.fa())
                r.averagePerformance?.let { StatLine("میانگین عملکرد کلاس", it.percentFa()) }
                StatLine("فعالیت‌های ایجادشده", r.activitiesCreated.fa())
                StatLine("لینک‌های ارسال‌شده", r.assignedLinks.fa())
                StatLine("تعداد تکمیل‌شده", r.completedSessions.fa())
                r.completionRate?.let { StatLine("نرخ تکمیل", it.percentFa()) }
                if (r.byGame.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text("به تفکیک بازی", style = MaterialTheme.typography.titleSmall)
                    r.byGame.forEach { g ->
                        StatLine(Labels.game(g.game), "${g.completed.fa()} از ${g.assigned.fa()}" + (g.averagePerformance?.let { " • ${it.percentFa()}" } ?: ""))
                    }
                }
                if (r.weekly.any { it.completed > 0 }) {
                    Spacer(Modifier.height(8.dp))
                    Text("فعالیت‌های انجام‌شده در ۶ هفته‌ی اخیر", style = MaterialTheme.typography.titleSmall)
                    WeeklyBars(r.weekly)
                }
                Spacer(Modifier.height(8.dp))
                Text("گزارش کلاس فقط آمار کلی است؛ رتبه‌بندی یا مقایسه‌ی دانش‌آموزان وجود ندارد.", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** Simple bars: completed sessions per week (class as a whole; never per student). */
@Composable
private fun WeeklyBars(weeks: List<WeeklyPoint>) {
    val bar = MaterialTheme.colorScheme.primary
    val base = MaterialTheme.colorScheme.outlineVariant
    val max = (weeks.maxOfOrNull { it.completed } ?: 0).coerceAtLeast(1)
    Canvas(Modifier.fillMaxWidth().height(100.dp).padding(vertical = 8.dp)) {
        val n = weeks.size
        val slot = size.width / n
        val bw = slot * 0.6f
        weeks.forEachIndexed { i, w ->
            val h = size.height * (w.completed.toFloat() / max)
            drawRect(if (w.completed > 0) bar else base, topLeft = Offset(i * slot + (slot - bw) / 2, size.height - h.coerceAtLeast(2f)), size = Size(bw, h.coerceAtLeast(2f)))
        }
    }
    Text(weeks.joinToString("  ") { it.completed.fa() }, style = MaterialTheme.typography.labelSmall)
}

@Composable
private fun StatLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label); Text(value, style = MaterialTheme.typography.titleSmall)
    }
}

@Composable
private fun AddStudentsDialog(onDismiss: () -> Unit, onSubmit: (String) -> Unit) {
    var mode by rememberSaveable { mutableStateOf(0) }
    var single by rememberSaveable { mutableStateOf("") }
    var bulk by rememberSaveable { mutableStateOf("") }
    val count = if (mode == 1) Validators.parseNames(bulk).size else 0
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("افزودن دانش‌آموز") },
        text = {
            Column {
                TabRow(selectedTabIndex = mode) {
                    Tab(mode == 0, { mode = 0 }, text = { Text("یک نفر") })
                    Tab(mode == 1, { mode = 1 }, text = { Text("افزودن سریع") })
                }
                Spacer(Modifier.height(12.dp))
                if (mode == 0) {
                    OutlinedTextField(single, { single = it }, label = { Text("نام دانش‌آموز") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                } else {
                    OutlinedTextField(bulk, { bulk = it }, label = { Text("هر خط یک دانش‌آموز") }, minLines = 5, modifier = Modifier.fillMaxWidth())
                    if (count > 0) Text("${count.fa()} نام", style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = if (mode == 0) single.trim().length >= 2 else count > 0,
                onClick = { onSubmit(if (mode == 0) single else bulk) },
            ) { Text(if (mode == 0) "افزودن" else "افزودن همه") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
}
