@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.yadbin.teacher.ui.classes

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.Edu
import com.yadbin.teacher.core.utils.Labels
import com.yadbin.teacher.core.utils.Validators
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.core.utils.percentFa
import com.yadbin.teacher.core.utils.performanceWordFa
import com.yadbin.teacher.core.utils.relativeDayFa
import com.yadbin.teacher.core.avatar.StudentAvatarStore
import com.yadbin.teacher.core.utils.jalaliFa
import com.yadbin.teacher.core.utils.jalaliDateTimeFa
import com.yadbin.teacher.domain.models.WeeklyPoint
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.ClassDetail
import com.yadbin.teacher.domain.models.ClassReport
import com.yadbin.teacher.domain.models.ClassSummary
import com.yadbin.teacher.domain.models.StudentRow
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ClassDetailViewModel(private val repo: Repository, val classId: String, private val avatars: StudentAvatarStore? = null) : ViewModel() {
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
    fun addStudents(text: String, gender: String? = null) {
        val names = Validators.parseNames(text)
        if (names.isEmpty()) { _message.value = "نامی وارد نشده است."; return }
        act(null, { val r = repo.addStudents(classId, names.joinToString("\n"), gender); _message.value = "${r.added.size.fa()} دانش‌آموز اضافه شد." + if (r.skipped > 0) " (${r.skipped.fa()} نام نامعتبر رد شد)" else "" })
    }

    fun removeFromClass(studentId: String) = act("دانش‌آموز از کلاس حذف شد (اطلاعات او حفظ شد).", { repo.removeFromClass(classId, studentId) })
    /** Clears results/history only; the student stays in the class. */
    fun clearStudentData(studentId: String) = act("داده‌های دانش‌آموز حذف شد؛ خود دانش‌آموز در کلاس باقی ماند.", { repo.clearStudentData(studentId) })
    /** Removes the student completely, with all data. */
    fun deleteStudent(studentId: String) = act("دانش‌آموز، داده‌ها و تصویر محلی او حذف شد.", { repo.deleteStudentData(studentId); avatars?.deleteAll(studentId) })
    fun updateClass(name: String, grade: String, school: String?, gradeCode: String?, ageMin: Int?, ageMax: Int?) =
        act("مشخصات کلاس ذخیره شد.", { repo.updateClass(classId, name, grade, school, gradeCode, ageMin, ageMax) })
    fun updateStudent(id: String, name: String, age: Int?, gradeCode: String?, gender: String?, note: String?) =
        act("مشخصات دانش‌آموز ذخیره شد.", { repo.updateStudent(id, name, age, gradeCode, gender, note) })
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
    val vm: ClassDetailViewModel = viewModel(key = "class-$classId", factory = VmFactory { ClassDetailViewModel(c.repository, classId, c.avatars) })
    val detail by vm.detail.collectAsStateWithLifecycle()
    val report by vm.report.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(0) }
    var showAdd by rememberSaveable { mutableStateOf(false) }
    var showDeleteClass by rememberSaveable { mutableStateOf(false) }
    var showEditClass by rememberSaveable { mutableStateOf(false) }
    var editingStudent by remember { mutableStateOf<StudentRow?>(null) }
    var avatarFor by remember { mutableStateOf<StudentRow?>(null) }
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

    // The class name is shown large right below the bar, so the bar itself stays short and the three actions live in one overflow menu
    // (three text buttons used to squeeze the title into two broken lines on narrow phones).
    Scaffold(
        topBar = {
            YadbinTopBar("کلاس", onBack, actions = {
                val isArchived = (detail as? Ui.Ready)?.data?.cls?.archived == true
                var menu by remember { mutableStateOf(false) }
                Box {
                    IconButton(onClick = { menu = true }) { Icon(androidx.compose.material.icons.Icons.Default.MoreVert, contentDescription = "گزینه‌های کلاس") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text(if (isArchived) "بازگردانی" else "آرشیو") }, onClick = { menu = false; if (isArchived) vm.archive(false) else vm.archive(true, onBack) })
                        DropdownMenuItem(text = { Text("ویرایش") }, onClick = { menu = false; showEditClass = true })
                        DropdownMenuItem(text = { Text("حذف کلاس", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; showDeleteClass = true })
                    }
                }
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
                    val cls = d.data.cls
                    val sub = listOfNotNull(cls.gradeLabel ?: cls.grade, Edu.ageRange(cls.ageMin, cls.ageMax), cls.schoolName).joinToString(" • ")
                    val activeCount = d.data.activities.count { it.lifecycle == "active" }
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(cls.name, style = MaterialTheme.typography.headlineSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (sub.isNotBlank()) Text(sub, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatusChip("${d.data.students.size.fa()} دانش‌آموز", Tone.Info)
                            StatusChip("${activeCount.fa()} فعالیت فعال", if (activeCount > 0) Tone.Success else Tone.Info)
                        }
                    }
                    TabRow(selectedTabIndex = tab, containerColor = Color.Transparent) {
                        Tab(tab == 0, { tab = 0 }, text = { Text("دانش‌آموزان", maxLines = 1, softWrap = false, fontSize = 13.sp, fontWeight = if (tab == 0) FontWeight.Bold else FontWeight.Normal) })
                        Tab(tab == 1, { tab = 1 }, text = { Text("فعالیت‌ها", maxLines = 1, softWrap = false, fontSize = 13.sp, fontWeight = if (tab == 1) FontWeight.Bold else FontWeight.Normal) })
                        Tab(tab == 2, { tab = 2 }, text = { Text("گزارش", maxLines = 1, softWrap = false, fontSize = 13.sp, fontWeight = if (tab == 2) FontWeight.Bold else FontWeight.Normal) })
                    }
                    // Spec §23: one subtle, short animation when the tab changes (no continuous animation).
                    Crossfade(targetState = tab, animationSpec = tween(180), label = "class-tab") { t ->
                        when (t) {
                            0 -> StudentsTab(d.data, { showAdd = true }, onOpenStudent, { editingStudent = it }, { avatarFor = it }) { action, id, name -> pending = action to (id to name) }
                            1 -> ActivitiesTab(d.data, onNewActivity, onOpenActivity)
                            else -> ReportTab(report)
                        }
                    }
                }
            }
        }
    }

    if (showEditClass) {
        (detail as? Ui.Ready)?.data?.cls?.let { cls ->
            EditClassDialog(cls, onDismiss = { showEditClass = false }, onSubmit = { name, code, school, a, b ->
                showEditClass = false
                vm.updateClass(name, Edu.gradeLabel(code) ?: cls.grade, school, code, a, b)
            })
        }
    }
    editingStudent?.let { st ->
        EditStudentDialog(st, defaultGradeCode = (detail as? Ui.Ready)?.data?.cls?.gradeCode, onDismiss = { editingStudent = null }, onSubmit = { name, age, code, gender, note ->
            editingStudent = null
            vm.updateStudent(st.id, name, age, code, gender, note)
        })
    }
    avatarFor?.let { st -> AvatarEditorDialog(st.id, st.name, st.gender) { avatarFor = null } }
    if (showAdd) AddStudentsDialog(onDismiss = { showAdd = false }, onSubmit = { text, gender -> showAdd = false; vm.addStudents(text, gender) })

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
        ConfirmDialog("حذف کلاس", "کلاس با فعالیت‌ها و نتایج آن حذف می‌شود. اطلاعات و تصویر محلی دانش‌آموزان حذف نمی‌شود. این کار قابل بازگشت نیست.", "حذف کلاس",
            { showDeleteClass = false; vm.deleteClass(onBack) }, { showDeleteClass = false })
    }
}

@Composable
private fun StudentsTab(
    data: ClassDetail,
    onAdd: () -> Unit,
    onOpen: (String) -> Unit,
    onEdit: (StudentRow) -> Unit,
    onAvatar: (StudentRow) -> Unit,
    onAction: (StudentAction, String, String) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        if (data.students.isEmpty()) {
            EmptyState(
                "هنوز دانش‌آموزی به این کلاس اضافه نشده است.", "افزودن دانش‌آموز", onAdd,
                illustration = { PresetAvatar(3, Modifier.size(88.dp).clip(CircleShape)) },
            )
        } else {
            Button(onClick = onAdd, Modifier.padding(16.dp).fillMaxWidth()) { Text("+ دانش‌آموز") }
            LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(data.students, key = { it.id }) { s ->
                    StudentCard(s, onOpen = { onOpen(s.id) }, onAvatar = { onAvatar(s) }, onEdit = { onEdit(s) }, onAction = onAction)
                }
            }
        }
    }
}

/** Tappable student card: picture/avatar, name, grade • age and three short status chips (spec §4). */
@Composable
private fun StudentCard(s: StudentRow, onOpen: () -> Unit, onAvatar: () -> Unit, onEdit: () -> Unit, onAction: (StudentAction, String, String) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Card(
        Modifier.fillMaxWidth().clickable(onClick = onOpen),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(Modifier.padding(start = 12.dp, top = 12.dp, bottom = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            StudentAvatar(s.id, size = 56.dp, gender = s.gender, onClick = onAvatar)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(s.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val sub = listOfNotNull(s.gradeLabel, s.age?.let { (if (s.ageApproximate) "حدود " else "") + it.fa() + " ساله" }).joinToString(" • ")
                if (sub.isNotBlank()) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    StatusChip("${s.completedActivities.fa()} فعالیت انجام شده")
                    s.lastActivityAt.relativeDayFa().takeIf { it.isNotBlank() }?.let { StatusChip("آخرین فعالیت: $it") }
                    performanceWordFa(s.averagePerformance)?.let { w ->
                        val warn = w.startsWith("نیازمند")
                        StatusChip(
                            "عملکرد اخیر: $w",
                            container = if (warn) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.primaryContainer,
                            content = if (warn) MaterialTheme.colorScheme.onTertiaryContainer else MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                }
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, contentDescription = "گزینه‌ها") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("تغییر تصویر") }, onClick = { menu = false; onAvatar() })
                    DropdownMenuItem(text = { Text("ویرایش سن و پایه") }, onClick = { menu = false; onEdit() })
                    DropdownMenuItem(text = { Text("حذف از کلاس") }, onClick = { menu = false; onAction(StudentAction.REMOVE, s.id, s.name) })
                    DropdownMenuItem(text = { Text("حذف داده‌های دانش‌آموز") }, onClick = { menu = false; onAction(StudentAction.CLEAR_DATA, s.id, s.name) })
                    DropdownMenuItem(text = { Text("حذف کامل دانش‌آموز") }, onClick = { menu = false; onAction(StudentAction.DELETE, s.id, s.name) })
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
            if (data.students.isEmpty()) EmptyState("هنوز فعالیتی ساخته نشده است.")
            else EmptyState("هنوز فعالیتی ساخته نشده است.", "ساخت فعالیت", onNew)
        } else {
            LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(data.activities, key = { it.id }) { a ->
                    ActivityCard(a, onClick = { onOpen(a.id) })
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
private fun AddStudentsDialog(onDismiss: () -> Unit, onSubmit: (String, String?) -> Unit) {
    var mode by rememberSaveable { mutableStateOf(0) }
    var single by rememberSaveable { mutableStateOf("") }
    var bulk by rememberSaveable { mutableStateOf("") }
    var gender by rememberSaveable { mutableStateOf<String?>(null) }
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
                Spacer(Modifier.height(8.dp))
                Text(if (mode == 0) "جنسیت (اختیاری)" else "جنسیت همه (اختیاری)", style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(gender == "female", { gender = if (gender == "female") null else "female" }, label = { Text("دختر") })
                    FilterChip(gender == "male", { gender = if (gender == "male") null else "male" }, label = { Text("پسر") })
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = if (mode == 0) single.trim().length >= 2 else count > 0,
                onClick = { onSubmit(if (mode == 0) single else bulk, gender) },
            ) { Text(if (mode == 0) "افزودن" else "افزودن همه") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
}


@Composable
private fun EditClassDialog(cls: ClassSummary, onDismiss: () -> Unit, onSubmit: (String, String?, String?, Int?, Int?) -> Unit) {
    var name by rememberSaveable { mutableStateOf(cls.name) }
    var code by rememberSaveable { mutableStateOf(cls.gradeCode) }
    var school by rememberSaveable { mutableStateOf(cls.schoolName.orEmpty()) }
    var ageMin by rememberSaveable { mutableStateOf(cls.ageMin?.toString().orEmpty()) }
    var ageMax by rememberSaveable { mutableStateOf(cls.ageMax?.toString().orEmpty()) }
    val a = parseIntFa(ageMin); val b = parseIntFa(ageMax)
    val rangeBad = a != null && b != null && a > b
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("ویرایش کلاس") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("نام کلاس") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                GradeDropdown("پایه تحصیلی", code, { code = it }, Modifier.fillMaxWidth(), noneLabel = cls.grade)
                OutlinedTextField(school, { school = it }, label = { Text("نام مدرسه (اختیاری)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("بازه سنی پیشنهادی (اختیاری)", style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AgeField("از سن", ageMin, { ageMin = it }, Modifier.weight(1f))
                    AgeField("تا سن", ageMax, { ageMax = it }, Modifier.weight(1f))
                }
                if (rangeBad) Text("حداقل سن نباید از حداکثر سن بیشتر باشد.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(enabled = name.trim().length >= 2 && !rangeBad, onClick = { onSubmit(name.trim(), code, school.trim().ifBlank { null }, a, b) }) { Text("ذخیره") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
}

@Composable
private fun EditStudentDialog(
    st: StudentRow,
    defaultGradeCode: String?,
    onDismiss: () -> Unit,
    onSubmit: (name: String, age: Int?, gradeCode: String?, gender: String?, note: String?) -> Unit,
) {
    var name by rememberSaveable { mutableStateOf(st.name) }
    var age by rememberSaveable { mutableStateOf(st.age?.toString().orEmpty()) }
    var code by rememberSaveable { mutableStateOf(st.gradeCode ?: defaultGradeCode) }
    var gender by rememberSaveable { mutableStateOf(st.gender) }
    var note by rememberSaveable { mutableStateOf(st.note.orEmpty()) }
    val ageVal = parseIntFa(age)
    val ageBad = age.isNotBlank() && (ageVal == null || ageVal < 3 || ageVal > 25)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("مشخصات دانش‌آموز") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("نام") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                AgeField("سن (اختیاری)", age, { age = it }, Modifier.fillMaxWidth())
                if (ageBad) Text("سن باید بین ۳ تا ۲۵ سال باشد.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                GradeDropdown("پایه (اختیاری)", code, { code = it }, Modifier.fillMaxWidth(), allowNone = true)
                OptionDropdown("جنسیت (اختیاری)", listOf(com.yadbin.teacher.core.utils.CodeLabel("female", "دختر"), com.yadbin.teacher.core.utils.CodeLabel("male", "پسر")), gender, { gender = it }, Modifier.fillMaxWidth(), allowNone = true)
                OutlinedTextField(note, { note = it.take(500) }, label = { Text("توضیحات معلم (اختیاری)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                Text("این اطلاعات فقط برای پیشنهاد فعالیت مناسب است و در صورت خالی بودن، همه‌چیز مثل قبل کار می‌کند.", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(enabled = name.trim().length >= 2 && !ageBad, onClick = { onSubmit(name.trim(), ageVal, code, gender, note.trim().ifBlank { null }) }) { Text("ذخیره") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
}
