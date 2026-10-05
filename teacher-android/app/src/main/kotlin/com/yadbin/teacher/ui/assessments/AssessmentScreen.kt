@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.assessments

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.Edu
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.data.repository.Loaded
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.*
import com.yadbin.teacher.ui.activities.QrView
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

class AssessmentViewModel(private val repo: Repository, private val id: String) : ViewModel() {
    private val _state = MutableStateFlow<Ui<AssessmentDetail>>(Ui.Loading)
    val state: StateFlow<Ui<AssessmentDetail>> = _state.asStateFlow()
    private val _report = MutableStateFlow<Ui<AssessmentReport>?>(null)
    val report: StateFlow<Ui<AssessmentReport>?> = _report.asStateFlow()
    private val _classes = MutableStateFlow<List<ClassSummary>>(emptyList())
    val classes: StateFlow<List<ClassSummary>> = _classes.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init { refresh() }
    fun clearMessage() { _message.value = null }
    fun refresh() { viewModelScope.launch { if (_state.value !is Ui.Ready) _state.value = Ui.Loading; _state.value = loadUi { repo.assessment(id) } } }
    fun loadReport() { viewModelScope.launch { _report.value = Ui.Loading; _report.value = loadUi { repo.assessmentReport(id) } } }
    fun loadClasses() { viewModelScope.launch { try { _classes.value = repo.classes().data.classes } catch (e: ApiException) { _message.value = errorText(e) } catch (e: NetworkException) { _message.value = errorText(e) } } }

    /** Runs a write; the server answer is the new truth (status may have fallen back to draft after an edit). */
    private fun act(success: String?, block: suspend () -> AssessmentDetail) {
        viewModelScope.launch {
            try { val d = block(); _state.value = Ui.Ready(d); if (success != null) _message.value = success }
            catch (e: ApiException) { _message.value = errorText(e) }
            catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }
    fun saveInfo(title: String, subject: String?, grade: String?, level: String?, desc: String?, minutes: Int?) =
        act("اطلاعات آزمون ذخیره شد.") { repo.updateAssessment(id, title, subject, grade, level, desc, minutes) }
    fun addQuestion(q: QuestionDraft) = act("سؤال اضافه شد.") { repo.addAssessmentQuestion(id, q) }
    fun updateQuestion(qid: String, q: QuestionDraft) = act("سؤال ذخیره شد.") { repo.updateAssessmentQuestion(id, qid, q) }
    fun deleteQuestion(qid: String) = act("سؤال حذف شد.") { repo.deleteAssessmentQuestion(id, qid) }
    fun duplicateQuestion(qid: String) = act("سؤال کپی شد.") { repo.duplicateAssessmentQuestion(id, qid) }
    fun move(order: List<String>) = act(null) { repo.reorderAssessment(id, order) }
    fun feedback(value: String) = act(when (value) {
        "suitable", "too_easy" -> "آزمون برای انتشار آماده شد."
        else -> "ثبت شد؛ آزمون را ویرایش و دوباره آزمایش کنید."
    }) { repo.assessmentPreviewFeedback(id, value) }
    fun publish(classId: String?, studentIds: List<String>? = null) = act("آزمون منتشر شد.") { repo.publishAssessment(id, classId, studentIds) }
    fun assign(classId: String, studentIds: List<String>? = null) =
        act(if (studentIds == null) "آزمون به کلاس اختصاص یافت." else "آزمون به ${studentIds.size.fa()} دانش‌آموز اختصاص یافت.") { repo.assignAssessment(id, classId, studentIds) }
    private val _students = MutableStateFlow<Ui<List<StudentRef>>?>(null)
    val students: StateFlow<Ui<List<StudentRef>>?> = _students.asStateFlow()
    /** Students of one class, for the "selected students" picker. */
    fun loadStudents(classId: String) {
        viewModelScope.launch {
            _students.value = Ui.Loading
            _students.value = loadUi { val l = repo.classDetail(classId); Loaded(l.data.students.map { StudentRef(it.id, it.name) }, l.fromCache) }
        }
    }
    fun clearStudents() { _students.value = null }
    fun newVersion(onCreated: (String) -> Unit) {
        viewModelScope.launch {
            try { val d = repo.newAssessmentVersion(id); _message.value = "نسخهٔ جدید به‌صورت پیش‌نویس ساخته شد؛ نسخهٔ قبلی و نتیجه‌هایش دست‌نخورده ماند."; onCreated(d.assessment.id) }
            catch (e: ApiException) { _message.value = errorText(e) } catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }
    fun duplicate(onCreated: (String) -> Unit) {
        viewModelScope.launch {
            try { val d = repo.duplicateAssessment(id); _message.value = "کپی آزمون به‌صورت پیش‌نویس ساخته شد."; onCreated(d.assessment.id) }
            catch (e: ApiException) { _message.value = errorText(e) } catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }
    fun setArchived(archived: Boolean) = act(if (archived) "آزمون آرشیو شد." else "آزمون از آرشیو خارج شد.") { repo.setAssessmentArchived(id, archived) }
    fun delete(onDone: () -> Unit) {
        viewModelScope.launch {
            try { repo.deleteAssessment(id); onDone() } catch (e: ApiException) { _message.value = errorText(e) } catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }
    fun preview(onOpen: (String) -> Unit) {
        viewModelScope.launch {
            try { onOpen(repo.startAssessmentPreview(id).url); _message.value = "آزمایش آزمون در مرورگر باز شد؛ آن را تا انتها انجام دهید و بعد بازخورد بدهید."; refresh() }
            catch (e: ApiException) { _message.value = errorText(e) } catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }
}

@Composable
fun AssessmentScreen(assessmentId: String, onBack: () -> Unit, onOpenAssessment: (String) -> Unit) {
    val c = LocalContainer.current
    val ctx = LocalContext.current
    val vm: AssessmentViewModel = viewModel(key = "assessment-$assessmentId", factory = VmFactory { AssessmentViewModel(c.repository, assessmentId) })
    val state by vm.state.collectAsStateWithLifecycle()
    val report by vm.report.collectAsStateWithLifecycle()
    val classes by vm.classes.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    var editInfo by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<AssessmentQuestion?>(null) }
    var addType by remember { mutableStateOf<String?>(null) }
    var typeMenu by remember { mutableStateOf(false) }
    var deleteQ by remember { mutableStateOf<AssessmentQuestion?>(null) }
    var showFeedback by remember { mutableStateOf(false) }
    var showPublish by remember { mutableStateOf(false) }
    var qrFor by remember { mutableStateOf<AssessmentLink?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); vm.clearMessage() } }

    Scaffold(
        topBar = { YadbinTopBar("آزمون معلم", onBack, actions = { TextButton(onClick = vm::refresh) { Text("به‌روزرسانی") } }) },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            when (val s = state) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(s.message, vm::refresh)
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    val d = s.data
                    val a = d.assessment
                    val live = a.status == "published"
                    val archived = a.status == "archived"
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        item {
                            Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text(a.title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                                        AssessmentStatusChip(a.status, a.statusLabel)
                                    }
                                    val meta = listOfNotNull(a.subject, a.gradeLabel, a.levelLabel, a.suggestedMinutes?.let { "${it.fa()} دقیقه" }, if (a.version > 1) "نسخه ${a.version.fa()}" else null)
                                    if (meta.isNotEmpty()) Text(meta.joinToString(" • "), style = MaterialTheme.typography.bodyMedium)
                                    a.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                                    Text("آزمون معلم — جدا از فعالیت‌های شناختی یادبین؛ نمره‌اش وارد پروفایل شناختی نمی‌شود.", style = MaterialTheme.typography.labelSmall)
                                    if (!archived) OutlinedButton(onClick = { editInfo = true }) { Text("ویرایش اطلاعات آزمون") }
                                }
                            }
                        }
                        item { NoticeText(workflowHint(a)) }
                        if (d.problems.isNotEmpty() && !live && !archived) item {
                            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                                Column(Modifier.padding(12.dp)) { d.problems.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) } }
                            }
                        }
                        item { SectionTitle("سؤال‌ها (${d.questions.size.fa()})") }
                        items(d.questions, key = { it.id }) { q ->
                            val idx = d.questions.indexOf(q)
                            QuestionCard(
                                q, idx, d.editable,
                                onEdit = { editing = q }, onDelete = { deleteQ = q }, onCopy = { vm.duplicateQuestion(q.id) },
                                onUp = { if (idx > 0) vm.move(d.questions.map { it.id }.toMutableList().also { l -> l.add(idx - 1, l.removeAt(idx)) }) },
                                onDown = { if (idx < d.questions.size - 1) vm.move(d.questions.map { it.id }.toMutableList().also { l -> l.add(idx + 1, l.removeAt(idx)) }) },
                            )
                        }
                        if (d.editable) item {
                            Box {
                                Button(onClick = { typeMenu = true }, modifier = Modifier.fillMaxWidth()) { Text("+ افزودن سؤال") }
                                DropdownMenu(expanded = typeMenu, onDismissRequest = { typeMenu = false }) {
                                    listOf("multiple_choice" to "چهارگزینه‌ای", "true_false" to "درست / نادرست", "fill_blank" to "جای خالی").forEach { (code, label) ->
                                        DropdownMenuItem(text = { Text(label) }, onClick = { typeMenu = false; addType = code })
                                    }
                                }
                            }
                        } else if (live) item {
                            NoticeText("این آزمون منتشر شده و تغییر نمی‌کند تا نتیجهٔ دانش‌آموزان خراب نشود. برای ویرایش «ساخت نسخهٔ جدید» را بزنید.")
                        }

                        // ---- workflow actions ----
                        item { SectionTitle("آزمایش و انتشار") }
                        item {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (!archived) {
                                    OutlinedButton(onClick = { vm.preview { url -> openUrl(ctx, url) } }, modifier = Modifier.fillMaxWidth(), enabled = d.questions.isNotEmpty()) { Text("آزمایش آزمون (مثل دانش‌آموز)") }
                                    if (!live) OutlinedButton(onClick = { showFeedback = true }, modifier = Modifier.fillMaxWidth()) { Text("ثبت نظر پس از آزمایش") }
                                    if (a.status == "ready_to_publish") Button(onClick = { vm.loadClasses(); showPublish = true }, modifier = Modifier.fillMaxWidth()) { Text("انتشار برای کلاس") }
                                    if (live) Button(onClick = { vm.loadClasses(); showPublish = true }, modifier = Modifier.fillMaxWidth()) { Text("اختصاص به کلاس دیگر") }
                                    if (d.canCreateNewVersion) OutlinedButton(onClick = { vm.newVersion(onOpenAssessment) }, modifier = Modifier.fillMaxWidth()) { Text("ساخت نسخهٔ جدید برای ویرایش") }
                                }
                                OutlinedButton(onClick = { vm.duplicate(onOpenAssessment) }, modifier = Modifier.fillMaxWidth()) { Text("کپی آزمون") }
                                OutlinedButton(onClick = { vm.setArchived(!archived) }, modifier = Modifier.fillMaxWidth()) { Text(if (archived) "خارج کردن از آرشیو" else "آرشیو") }
                                if (a.status == "draft" || a.status == "teacher_preview" || a.status == "ready_to_publish") {
                                    TextButton(onClick = { confirmDelete = true }) { Text("حذف پیش‌نویس", color = MaterialTheme.colorScheme.error) }
                                }
                            }
                        }

                        // ---- links ----
                        val links = d.students
                        if (links.isNotEmpty()) {
                            item { SectionTitle("لینک دانش‌آموزان") }
                            items(links, key = { it.url }) { l ->
                                Card(Modifier.fillMaxWidth()) {
                                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Text(l.name, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                                            Text(when (l.status) { "completed" -> "انجام شد"; "started" -> "در حال انجام"; else -> "شروع نشده" }, style = MaterialTheme.typography.labelMedium)
                                        }
                                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                            TextButton(onClick = { copyLink(ctx, l.url) }) { Text("کپی لینک") }
                                            TextButton(onClick = { shareLink(ctx, l.url) }) { Text("ارسال") }
                                            TextButton(onClick = { qrFor = l }) { Text("QR") }
                                        }
                                    }
                                }
                            }
                        }

                        // ---- report ----
                        if (live || archived) {
                            item { SectionTitle("گزارش آزمون") }
                            item { if (report == null) OutlinedButton(onClick = vm::loadReport, modifier = Modifier.fillMaxWidth()) { Text("نمایش گزارش آزمون") } }
                            item { ReportBlock(report, vm::loadReport) }
                        }
                    }
                }
            }
        }
    }

    // ---- dialogs ----
    val cur = (state as? Ui.Ready<AssessmentDetail>)?.data
    if (editInfo && cur != null) EditInfoDialog(cur.assessment, onDismiss = { editInfo = false }) { t, sub, g, l, ds, m -> editInfo = false; vm.saveInfo(t, sub, g, l, ds, m) }
    val et = editing
    if (et != null) QuestionDialog(initial = et.toDraft(), onDismiss = { editing = null }) { q -> editing = null; vm.updateQuestion(et.id, q) }
    val at = addType
    if (at != null) QuestionDialog(initial = QuestionDraft(type = at), onDismiss = { addType = null }) { q -> addType = null; vm.addQuestion(q) }
    deleteQ?.let { q -> ConfirmDialog("حذف سؤال", "این سؤال از آزمون حذف شود؟", "حذف", { deleteQ = null; vm.deleteQuestion(q.id) }, { deleteQ = null }) }
    if (confirmDelete) ConfirmDialog("حذف پیش‌نویس", "این پیش‌نویس برای همیشه حذف شود؟", "حذف", { confirmDelete = false; vm.delete(onBack) }, { confirmDelete = false })
    if (showFeedback) FeedbackDialog(onDismiss = { showFeedback = false }) { showFeedback = false; vm.feedback(it) }
    val studentsUi by vm.students.collectAsStateWithLifecycle()
    if (showPublish && cur != null) PublishDialog(
        classes, studentsUi, live = cur.assessment.status == "published",
        onDismiss = { showPublish = false; vm.clearStudents() },
        onLoadStudents = vm::loadStudents,
    ) { cid, ids ->
        showPublish = false; vm.clearStudents()
        if (cur.assessment.status == "published") { if (cid != null) vm.assign(cid, ids) } else vm.publish(cid, ids)
    }
    qrFor?.let { l ->
        AlertDialog(
            onDismissRequest = { qrFor = null }, title = { Text(l.name) },
            text = { QrView(l.url, Modifier.size(240.dp)) },
            confirmButton = { TextButton(onClick = { qrFor = null }) { Text("بستن") } },
        )
    }
}

private fun workflowHint(a: AssessmentInfo): String = when (a.status) {
    "draft" -> "پیش‌نویس: سؤال‌ها را بنویسید، سپس «آزمایش آزمون» را بزنید و نظر خود را ثبت کنید."
    "teacher_preview" -> "آزمایش را تا انتها انجام دهید، سپس «ثبت نظر پس از آزمایش» را بزنید."
    "ready_to_publish" -> "آزمون تأیید شد. هر تغییر در سؤال‌ها یا پایه و سطح، آن را به پیش‌نویس برمی‌گرداند و آزمایش دوباره لازم می‌شود."
    "published" -> "منتشر شده: دانش‌آموزان با لینک شخصی خود آزمون را انجام می‌دهند."
    else -> "این آزمون آرشیو شده است."
}

@Composable
private fun QuestionCard(q: AssessmentQuestion, index: Int, editable: Boolean, onEdit: () -> Unit, onDelete: () -> Unit, onCopy: () -> Unit, onUp: () -> Unit, onDown: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${(index + 1).fa()}. ${q.text}", style = MaterialTheme.typography.bodyLarge)
            Text(q.typeLabel, style = MaterialTheme.typography.labelSmall)
            when (q.type) {
                "multiple_choice" -> {
                    val ok = (q.correct as? JsonPrimitive)?.intOrNull
                    q.options.orEmpty().forEachIndexed { i, o -> Text((if (i == ok) "✔ " else "○ ") + o, style = MaterialTheme.typography.bodySmall) }
                }
                "true_false" -> Text("پاسخ صحیح: " + if ((q.correct as? JsonPrimitive)?.booleanOrNull == true) "درست" else "نادرست", style = MaterialTheme.typography.bodySmall)
                else -> Text("پاسخ‌های قابل‌قبول: " + q.answers.orEmpty().joinToString("، "), style = MaterialTheme.typography.bodySmall)
            }
            q.explanation?.let { Text("توضیح: $it", style = MaterialTheme.typography.bodySmall) }
            if (editable) Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                TextButton(onClick = onEdit) { Text("ویرایش") }
                TextButton(onClick = onCopy) { Text("کپی") }
                TextButton(onClick = onUp) { Text("↑") }
                TextButton(onClick = onDown) { Text("↓") }
                TextButton(onClick = onDelete) { Text("حذف", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

private fun AssessmentQuestion.toDraft(): QuestionDraft = QuestionDraft(
    type = type, text = text,
    options = (options ?: emptyList()).let { o -> if (o.size == 4) o else listOf("", "", "", "") },
    correctIndex = (correct as? JsonPrimitive)?.intOrNull.takeIf { type == "multiple_choice" },
    correctBool = (correct as? JsonPrimitive)?.booleanOrNull.takeIf { type == "true_false" },
    answers = (answers ?: listOf("")).ifEmpty { listOf("") }, explanation = explanation.orEmpty(),
)

@Composable
private fun QuestionDialog(initial: QuestionDraft, onDismiss: () -> Unit, onSave: (QuestionDraft) -> Unit) {
    var text by remember { mutableStateOf(initial.text) }
    var options by remember { mutableStateOf(initial.options) }
    var correctIndex by remember { mutableStateOf(initial.correctIndex) }
    var correctBool by remember { mutableStateOf(initial.correctBool) }
    var answers by remember { mutableStateOf(initial.answers) }
    var explanation by remember { mutableStateOf(initial.explanation) }
    val hasDuplicates = options.map { it.trim().lowercase() }.filter { it.isNotEmpty() }.let { it.size != it.toSet().size }
    val valid = text.isNotBlank() && when (initial.type) {
        "multiple_choice" -> options.all { it.isNotBlank() } && correctIndex != null && !hasDuplicates
        "true_false" -> correctBool != null
        else -> answers.any { it.isNotBlank() }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(when (initial.type) { "multiple_choice" -> "سؤال چهارگزینه‌ای"; "true_false" -> "سؤال درست / نادرست"; else -> "سؤال جای خالی" }) },
        text = {
            Column(Modifier.verticalScrollCompat(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(text, { text = it }, label = { Text("متن سؤال") }, modifier = Modifier.fillMaxWidth())
                when (initial.type) {
                    "multiple_choice" -> {
                        Text("گزینه‌ها (پاسخ صحیح را انتخاب کنید)", style = MaterialTheme.typography.labelMedium)
                        if (hasDuplicates) Text("گزینه‌ها نباید تکراری باشند.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        options.forEachIndexed { i, o ->
                            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                RadioButton(selected = correctIndex == i, onClick = { correctIndex = i })
                                OutlinedTextField(o, { v -> options = options.toMutableList().also { it[i] = v } }, label = { Text("گزینه ${listOf("الف", "ب", "ج", "د")[i]}") }, singleLine = true, modifier = Modifier.weight(1f))
                            }
                        }
                    }
                    "true_false" -> {
                        Text("پاسخ صحیح", style = MaterialTheme.typography.labelMedium)
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            RadioButton(selected = correctBool == true, onClick = { correctBool = true }); Text("درست")
                            Spacer(Modifier.width(16.dp))
                            RadioButton(selected = correctBool == false, onClick = { correctBool = false }); Text("نادرست")
                        }
                    }
                    else -> {
                        Text("پاسخ صحیح (در صورت نیاز چند پاسخ قابل‌قبول)", style = MaterialTheme.typography.labelMedium)
                        answers.forEachIndexed { i, a -> OutlinedTextField(a, { v -> answers = answers.toMutableList().also { it[i] = v } }, label = { Text("پاسخ ${(i + 1).fa()}") }, singleLine = true, modifier = Modifier.fillMaxWidth()) }
                        if (answers.size < 10) TextButton(onClick = { answers = answers + "" }) { Text("+ پاسخ قابل‌قبول دیگر") }
                    }
                }
                OutlinedTextField(explanation, { explanation = it }, label = { Text("توضیح پاسخ (اختیاری)") }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton(enabled = valid, onClick = { onSave(QuestionDraft(initial.type, text, options, correctIndex, correctBool, answers, explanation)) }) { Text("ذخیره") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
}

@Composable
private fun EditInfoDialog(a: AssessmentInfo, onDismiss: () -> Unit, onSave: (String, String?, String?, String?, String?, Int?) -> Unit) {
    var title by remember { mutableStateOf(a.title) }
    var subject by remember { mutableStateOf(a.subject.orEmpty()) }
    var grade by remember { mutableStateOf(a.gradeCode) }
    var level by remember { mutableStateOf(a.level) }
    var desc by remember { mutableStateOf(a.description.orEmpty()) }
    var minutes by remember { mutableStateOf(a.suggestedMinutes?.toString().orEmpty()) }
    val changesContent = grade != a.gradeCode || level != a.level
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text("اطلاعات آزمون") },
        text = {
            Column(Modifier.verticalScrollCompat(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text("عنوان آزمون") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(subject, { subject = it }, label = { Text("درس / موضوع") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                GradeDropdown("پایهٔ تحصیلی", grade, { grade = it }, allowNone = true)
                OptionDropdown("سطح", Edu.levels, level, { level = it }, allowNone = true)
                OutlinedTextField(desc, { desc = it }, label = { Text("توضیح") }, modifier = Modifier.fillMaxWidth())
                AgeField("زمان پیشنهادی (دقیقه)", minutes, { minutes = it })
                if (changesContent) NoticeText("تغییر پایه یا سطح، آزمایش قبلی را باطل می‌کند و آزمایش دوباره لازم می‌شود.")
            }
        },
        confirmButton = { TextButton(enabled = title.isNotBlank(), onClick = { onSave(title, subject.ifBlank { null }, grade, level, desc.ifBlank { null }, parseIntFa(minutes)) }) { Text("ذخیره") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
}

@Composable
private fun FeedbackDialog(onDismiss: () -> Unit, onSelect: (String) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text("آزمایش آزمون چطور بود؟") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("suitable" to "مناسب است", "too_easy" to "خیلی آسان است", "too_hard" to "خیلی سخت است", "needs_edit" to "نیاز به ویرایش دارد").forEach { (code, label) ->
                    OutlinedButton(onClick = { onSelect(code) }, modifier = Modifier.fillMaxWidth()) { Text(label) }
                }
            }
        },
        confirmButton = {}, dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
}

/** Step 1: pick a class (or publish only). Step 2: whole class or hand-picked students of that class. */
@Composable
private fun PublishDialog(
    classes: List<ClassSummary>, studentsUi: Ui<List<StudentRef>>?, live: Boolean,
    onDismiss: () -> Unit, onLoadStudents: (String) -> Unit, onPick: (String?, List<String>?) -> Unit,
) {
    var picked by remember { mutableStateOf<ClassSummary?>(null) }
    var wholeClass by remember { mutableStateOf(true) }
    var selected by remember { mutableStateOf(setOf<String>()) }
    val cls = picked
    val students = (studentsUi as? Ui.Ready<List<StudentRef>>)?.data.orEmpty()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (cls == null) (if (live) "اختصاص به کلاس" else "انتشار برای کدام کلاس؟") else "برای چه کسانی؟ (${cls.name})") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (cls == null) {
                    if (classes.isEmpty()) Text("کلاسی پیدا نشد. ابتدا یک کلاس بسازید.", style = MaterialTheme.typography.bodySmall)
                    classes.forEach { cl ->
                        OutlinedButton(onClick = { picked = cl; wholeClass = true; selected = emptySet(); onLoadStudents(cl.id) }, modifier = Modifier.fillMaxWidth()) { Text(cl.name) }
                    }
                    if (!live) TextButton(onClick = { onPick(null, null) }) { Text("فقط منتشر کن (بدون اختصاص)") }
                } else when (studentsUi) {
                    null, Ui.Loading -> LoadingBox(Modifier.height(120.dp))
                    is Ui.Error -> ErrorBox(studentsUi.message) { onLoadStudents(cls.id) }
                    is Ui.Ready -> {
                        if (students.isEmpty()) Text("این کلاس دانش‌آموزی ندارد.", style = MaterialTheme.typography.bodySmall)
                        else {
                            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                RadioButton(selected = wholeClass, onClick = { wholeClass = true })
                                Text("کل کلاس (${students.size.fa()} نفر)")
                            }
                            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                RadioButton(selected = !wholeClass, onClick = { wholeClass = false })
                                Text("انتخاب دانش‌آموزان")
                            }
                            if (!wholeClass) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TextButton(onClick = { selected = students.map { it.id }.toSet() }) { Text("انتخاب همه") }
                                    TextButton(onClick = { selected = emptySet() }) { Text("پاک کردن") }
                                }
                                LazyColumn(Modifier.heightIn(max = 280.dp)) {
                                    items(students, key = { it.id }) { st ->
                                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                            Checkbox(checked = st.id in selected, onCheckedChange = { selected = if (it) selected + st.id else selected - st.id })
                                            Text(st.name)
                                        }
                                    }
                                }
                                Text("${selected.size.fa()} نفر انتخاب‌شده", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (cls != null) {
                val canGo = students.isNotEmpty() && (wholeClass || selected.isNotEmpty())
                Button(enabled = canGo, onClick = { onPick(cls.id, if (wholeClass) null else students.map { it.id }.filter { it in selected }) }) {
                    Text(if (live) "اختصاص" else "انتشار")
                }
            }
        },
        dismissButton = {
            if (cls != null) TextButton(onClick = { picked = null }) { Text("بازگشت") }
            else TextButton(onClick = onDismiss) { Text("انصراف") }
        },
    )
}

@Composable
private fun ReportBlock(report: Ui<AssessmentReport>?, retry: () -> Unit) {
    when (report) {
        null -> {}
        Ui.Loading -> LoadingBox(Modifier.height(120.dp))
        is Ui.Error -> ErrorBox(report.message, retry)
        is Ui.Ready -> {
            val r = report.data
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (!r.sufficientData) { Text("هنوز دانش‌آموزی آزمون را کامل نکرده است.", style = MaterialTheme.typography.bodyMedium) }
                else {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SummaryCard(r.participants.fa(), "شرکت‌کننده", Modifier.weight(1f))
                        SummaryCard(pct(r.averagePercent), "میانگین", Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SummaryCard(pct(r.highestPercent), "بالاترین (آماری)", Modifier.weight(1f))
                        SummaryCard(pct(r.lowestPercent), "پایین‌ترین (آماری)", Modifier.weight(1f))
                    }
                }
                if (r.notFinished > 0) Text("${r.notFinished.fa()} دانش‌آموز هنوز کامل نکرده‌اند.", style = MaterialTheme.typography.bodySmall)
                r.questions.forEach { q ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(10.dp)) {
                            Text("${q.position.fa()}. ${q.text}", style = MaterialTheme.typography.bodyMedium)
                            Text("صحیح ${q.correct.fa()} • غلط ${q.incorrect.fa()} • بی‌پاسخ ${q.unanswered.fa()} • ${pct(q.percentCorrect)} درست", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                NoticeText(r.notice.ifBlank { "این گزارش برای تحلیل خود آزمون است؛ رتبه‌بندی دانش‌آموزان نمایش داده نمی‌شود." })
            }
        }
    }
}

internal fun pct(v: Double?): String = if (v == null) "—" else "${Math.round(v).toInt().fa()}٪"

private fun openUrl(ctx: Context, url: String) {
    ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
private fun copyLink(ctx: Context, url: String) {
    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("لینک آزمون", url))
    android.widget.Toast.makeText(ctx, "لینک کپی شد.", android.widget.Toast.LENGTH_SHORT).show()
}
private fun shareLink(ctx: Context, url: String) {
    val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, "لطفاً این آزمون را انجام دهید:\n$url") }
    ctx.startActivity(Intent.createChooser(send, "ارسال لینک").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
