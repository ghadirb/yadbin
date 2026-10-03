@file:OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.activities

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.Edu
import com.yadbin.teacher.core.utils.Labels
import com.yadbin.teacher.core.utils.Qr
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.core.utils.jalaliFa
import com.yadbin.teacher.core.utils.jalaliDateTimeFa
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.ActivityDetail
import com.yadbin.teacher.domain.models.ActivityEdit
import com.yadbin.teacher.domain.models.ActivityInfo
import com.yadbin.teacher.domain.models.ActivityStudent
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ActivityViewModel(private val repo: Repository, private val id: String) : ViewModel() {
    private val _state = MutableStateFlow<Ui<ActivityDetail>>(Ui.Loading)
    val state: StateFlow<Ui<ActivityDetail>> = _state.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init { refresh() }
    fun refresh() { viewModelScope.launch { if (_state.value !is Ui.Ready) _state.value = Ui.Loading; _state.value = loadUi { repo.activity(id) } } }
    fun clearMessage() { _message.value = null }
    fun duplicate(onCreated: (String) -> Unit) {
        viewModelScope.launch {
            try { val r = repo.duplicateActivity(id); _message.value = "نسخه‌ی جدید ساخته شد."; onCreated(r.activity.id) }
            catch (e: ApiException) { _message.value = errorText(e) }
            catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }
    fun save(edit: ActivityEdit, needsRetest: Boolean) = doAction(if (needsRetest) "تغییرات ذخیره شد؛ پیش از انتشار فعالیت را دوباره آزمایش کنید." else "تغییرات ذخیره شد.") { repo.updateActivityFull(id, edit) }
    fun setArchived(archived: Boolean) = doAction(if (archived) "فعالیت آرشیو شد." else "فعالیت از آرشیو خارج شد.") { repo.setActivityArchived(id, archived) }
    fun regenerate(studentId: String) = doAction("لینک جدید ساخته شد؛ لینک قبلی دیگر کار نمی‌کند.") { repo.regenerateLink(id, studentId) }
    fun preview(compareMode: String? = null, onOpen: (String) -> Unit) {
        viewModelScope.launch {
            try { onOpen(repo.startPreview(id, compareMode).url); _message.value = if (compareMode != null) "مقایسهٔ سطح در مرورگر باز شد." else "آزمایش فعالیت در مرورگر باز شد."; refresh() }
            catch (e: ApiException) { _message.value = errorText(e) }
            catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }
    fun feedback(value: String) = doAction(when (value) {
        "suitable" -> "فعالیت برای انتشار آماده شد."
        "too_easy" -> "ثبت شد. می‌توانید منتشر کنید یا دشواری را بالا ببرید و دوباره آزمایش کنید."
        else -> "بازخورد ثبت شد؛ فعالیت را ویرایش و دوباره آزمایش کنید."
    }) { repo.previewFeedback(id, value) }
    /** [withoutPreview] only after the teacher confirmed it explicitly. */
    fun publish(withoutPreview: Boolean = false, onNeedsApproval: () -> Unit = {}) {
        viewModelScope.launch {
            try { repo.publishActivity(id, withoutPreview); _message.value = "فعالیت منتشر شد و لینک‌های دانش‌آموزان فعال هستند."; refresh() }
            catch (e: ApiException) { if (e.code == "teacher_approval_required") onNeedsApproval() else _message.value = errorText(e) }
            catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }
    private fun doAction(success: String, block: suspend () -> Any) {
        viewModelScope.launch {
            try { block(); _message.value = success; refresh() }
            catch (e: ApiException) { _message.value = errorText(e) }
            catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }
    fun cancel() {
        viewModelScope.launch {
            try { repo.cancelActivity(id); _message.value = "فعالیت لغو شد."; refresh() }
            catch (e: ApiException) { _message.value = errorText(e) }
            catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }
}

@Composable
fun ActivityScreen(activityId: String, onBack: () -> Unit, onOpenStudent: (String) -> Unit, onOpenActivity: (String) -> Unit = {}) {
    val c = LocalContainer.current
    val ctx = LocalContext.current
    val vm: ActivityViewModel = viewModel(key = "activity-$activityId", factory = VmFactory { ActivityViewModel(c.repository, activityId) })
    val state by vm.state.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    var qrFor by remember { mutableStateOf<ActivityStudent?>(null) }
    var confirmCancel by remember { mutableStateOf(false) }
    var showEdit by remember { mutableStateOf(false) }
    var regenFor by remember { mutableStateOf<ActivityStudent?>(null) }
    var showFeedback by remember { mutableStateOf(false) }
    var showPreviewSummary by remember { mutableStateOf(false) }
    var compareFor by remember { mutableStateOf<String?>(null) }
    var askPublishWithout by remember { mutableStateOf(false) }
    var showCompareMenu by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); vm.clearMessage() } }

    Scaffold(
        topBar = { YadbinTopBar("لینک‌های فعالیت", onBack, actions = { TextButton(onClick = vm::refresh) { Text("به‌روزرسانی") } }) },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            when (val s = state) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(s.message, vm::refresh)
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    val a = s.data.activity
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                    item {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(a.title ?: Labels.game(a.gameType), style = MaterialTheme.typography.titleMedium)
                        Text("${Labels.game(a.gameType)} • ${Labels.difficulty(a.difficultyMode)} • ${a.questionCount.fa()} سؤال • ${a.lifecycleLabel.ifBlank { Labels.activityStatus(a.status) }}", style = MaterialTheme.typography.bodySmall)
                        a.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        workflowHint(a)?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary) }
                        Text(listOfNotNull(a.createdAt.jalaliDateTimeFa().takeIf { it.isNotBlank() }?.let { "ساخته‌شده: $it" }, a.expiresAt.jalaliDateTimeFa().takeIf { it.isNotBlank() }?.let { "انقضا: $it" }).joinToString(" • "), style = MaterialTheme.typography.bodySmall)
                        a.suggestedMinutes?.let { Text("زمان پیشنهادی: ${it.fa()} دقیقه", style = MaterialTheme.typography.bodySmall) }
                        InfoChips(listOfNotNull(a.levelLabel, com.yadbin.teacher.core.utils.Edu.gradeRange(a.gradeMinLabel, a.gradeMaxLabel), com.yadbin.teacher.core.utils.Edu.ageRange(a.ageMin, a.ageMax)) + a.skillLabels)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            if (a.status == "active" && a.lifecycle != "archived") {
                                if (a.publishState == "published") TextButton(onClick = { showPreviewSummary = true }) { Text("آزمایش فعالیت") }
                                else Button(onClick = { showPreviewSummary = true }) { Text(if (a.publishState == "draft") "آزمایش فعالیت" else "آزمایش دوباره") }
                                Box {
                                    TextButton(onClick = { showCompareMenu = true }) { Text("مقایسهٔ سطح‌ها") }
                                    DropdownMenu(expanded = showCompareMenu, onDismissRequest = { showCompareMenu = false }) {
                                        listOf("easy", "medium", "hard").filter { it != a.difficultyMode }.forEach { m ->
                                            DropdownMenuItem(text = { Text("آزمایش سطح ${Labels.difficulty(m)}") }, onClick = { showCompareMenu = false; compareFor = m })
                                        }
                                    }
                                }
                            }
                            if (a.publishState == "testing") TextButton(onClick = { showFeedback = true }) { Text("ثبت نتیجه آزمایش") }
                            if (a.publishState == "ready_to_publish") Button(onClick = { vm.publish(false) { askPublishWithout = true } }) { Text("تأیید و انتشار") }
                            if (a.publishState != "published" && a.status == "active" && a.lifecycle != "archived") TextButton(onClick = { askPublishWithout = true }) { Text("انتشار بدون آزمایش") }
                            TextButton(onClick = { showEdit = true }) { Text("ویرایش") }
                            TextButton(onClick = { vm.duplicate(onOpenActivity) }) { Text("ساخت نسخه جدید") }
                            TextButton(onClick = { vm.setArchived(a.lifecycle != "archived") }) { Text(if (a.lifecycle == "archived") "خروج از آرشیو" else "آرشیو") }
                        }
                        Text("هر دانش‌آموز لینک اختصاصی خودش را دارد؛ لینک را فقط برای همان دانش‌آموز بفرستید.", style = MaterialTheme.typography.bodySmall)
                        if (a.status == "active") TextButton(onClick = { confirmCancel = true }) { Text("لغو فعالیت", color = MaterialTheme.colorScheme.error) }
                    }
                    }
                        items(s.data.students, key = { it.studentId }) { st ->
                            Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(12.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(st.name, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                                        AssistChip(onClick = {}, label = { Text(Labels.studentStatus(st.status)) })
                                    }
                                    if (a.hasSuitabilityRange) {
                                        FitBadge(st.fit, st.fitLabel)
                                        st.fitReasons.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                                    }
                                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        TextButton(onClick = { copyLink(ctx, st.url); }) { Text("کپی لینک") }
                                        TextButton(onClick = { qrFor = st }) { Text("QR") }
                                        TextButton(onClick = { shareLink(ctx, st.url) }) { Icon(Icons.Default.Share, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("اشتراک‌گذاری") }
                                        if (st.status != "completed" && a.status == "active" && a.publishState == "published") TextButton(onClick = { regenFor = st }) { Text("لینک جدید") }
                                        if (st.status == "completed") TextButton(onClick = { onOpenStudent(st.studentId) }) { Text("گزارش") }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    qrFor?.let { st ->
        AlertDialog(
            onDismissRequest = { qrFor = null },
            title = { Text(st.name) },
            text = {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                    QrView(st.url, Modifier.size(240.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("دانش‌آموز می‌تواند این کد را با دوربین گوشی اسکن کند.", style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
                }
            },
            confirmButton = { TextButton(onClick = { qrFor = null }) { Text("بستن") } },
        )
    }
    regenFor?.let { st ->
        ConfirmDialog("ساخت لینک جدید", "لینک فعلی «${st.name}» باطل می‌شود و لینک تازه ساخته می‌شود. اگر بازی را شروع کرده باشد، ادامه‌ی همان بازی حفظ می‌شود.", "ساخت لینک جدید",
            { regenFor = null; vm.regenerate(st.studentId) }, { regenFor = null })
    }
    if (showEdit) {
        val ready = (state as? Ui.Ready)?.data
        if (ready != null) {
            val started = ready.students.any { it.status != "pending" }
            EditActivityFullDialog(ready.activity, started, { showEdit = false }) { e, retest -> showEdit = false; vm.save(e, retest) }
        }
    }
    if (confirmCancel) ConfirmDialog("لغو فعالیت", "لینک‌های این فعالیت غیرفعال می‌شوند.", "لغو فعالیت", { confirmCancel = false; vm.cancel() }, { confirmCancel = false })
    compareFor?.let { m ->
        ConfirmDialog("مقایسهٔ سطح‌ها", "سطح «${Labels.difficulty(m)}» فقط برای مشاهدهٔ تجربهٔ فعالیت اجرا می‌شود. تنظیمات فعالیت تغییر نمی‌کند، نتیجه ثبت نمی‌شود و این اجرا به‌منزلهٔ تأیید نیست. سیستم دربارهٔ مناسب بودن هیچ سطحی برای دانش‌آموز نظر نمی‌دهد.", "شروع",
            { compareFor = null; vm.preview(m) { url -> ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }, { compareFor = null })
    }
    if (askPublishWithout) ConfirmDialog("انتشار بدون آزمایش", "این فعالیت را خودتان آزمایش نکرده‌اید. اگر منتشر شود دانش‌آموزان بلافاصله می‌توانند آن را انجام دهند. مطمئنید؟", "منتشر کن",
        { askPublishWithout = false; vm.publish(true) }, { askPublishWithout = false })
    if (showFeedback) PreviewFeedbackDialog({ showFeedback = false }) { feedback -> showFeedback = false; vm.feedback(feedback) }
    val activity = (state as? Ui.Ready)?.data?.activity
    if (showPreviewSummary && activity != null) PreviewSummaryDialog(activity, { showPreviewSummary = false }) { showPreviewSummary = false; vm.preview { url -> ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
}

@Composable
private fun PreviewSummaryDialog(activity: ActivityInfo, onDismiss: () -> Unit, onStart: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text("آزمایش فعالیت") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text("نوع: ${Labels.game(activity.gameType)}")
            com.yadbin.teacher.core.utils.Edu.gradeRange(activity.gradeMinLabel, activity.gradeMaxLabel)?.let { Text("پایه: $it") }
            com.yadbin.teacher.core.utils.Edu.ageRange(activity.ageMin, activity.ageMax)?.let { Text("سن پیشنهادی: $it") }
            if (activity.skillLabels.isNotEmpty()) Text("مهارت هدف: ${activity.skillLabels.joinToString("، ")}")
            activity.levelLabel?.let { Text("سطح فعالیت: $it") }
            Text("سطح دشواری: ${Labels.difficulty(activity.difficultyMode)}")
            Text("تعداد مراحل: ${activity.questionCount.fa()}")
            activity.suggestedMinutes?.let { Text("زمان پیشنهادی: ${it.fa()} دقیقه") }
            Text("همان بازی و همان پارامترهایی که دانش‌آموزان این کلاس دریافت می‌کنند اجرا می‌شود. نتیجهٔ این اجرا در هیچ گزارشی ثبت نمی‌شود.", style = MaterialTheme.typography.bodySmall)
        }
    }, confirmButton = { TextButton(onClick = onStart) { Text("شروع آزمایش") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } })
}

@Composable
private fun PreviewFeedbackDialog(onDismiss: () -> Unit, onSelect: (String) -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text("آزمایش تمام شد") }, text = {
        Column {
            Text("تجربه شما چگونه بود؟")
            listOf("suitable" to "مناسب است", "too_easy" to "کمی آسان است", "too_hard" to "کمی سخت است", "needs_edit" to "نیاز به ویرایش دارد").forEach { (value, label) ->
                TextButton(onClick = { onSelect(value) }, modifier = Modifier.fillMaxWidth()) { Text(label, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Start) }
            }
        }
    }, confirmButton = { TextButton(onClick = onDismiss) { Text("بستن") } })
}

/** What the teacher should do next, in plain words (spec §7). */
private fun workflowHint(a: ActivityInfo): String? = when {
    a.status != "active" || a.lifecycle == "archived" -> null
    a.publishState == "draft" && a.previewFeedback == "too_hard" || a.publishState == "draft" && a.previewFeedback == "needs_edit" -> "وضعیت: پیش‌نویس — فعالیت نیاز به ویرایش دارد. آن را ویرایش و دوباره آزمایش کنید."
    a.publishState == "draft" -> "وضعیت: پیش‌نویس — ابتدا فعالیت را آزمایش کنید (یا آگاهانه بدون آزمایش منتشر کنید)."
    a.publishState == "testing" -> "وضعیت: در حال آزمایش — بعد از پایان آزمایش، نتیجه را ثبت کنید."
    a.publishState == "ready_to_publish" -> "وضعیت: آماده انتشار — لینک‌ها بعد از «تأیید و انتشار» فعال می‌شوند."
    else -> null
}

/** Full editor: EVERY setting of the activity. Difficulty and question count lock once a child has started (the server enforces it too). */
@Composable
private fun EditActivityFullDialog(a: ActivityInfo, started: Boolean, onDismiss: () -> Unit, onSave: (ActivityEdit, Boolean) -> Unit) {
    var title by remember { mutableStateOf(a.title ?: "") }
    var description by remember { mutableStateOf(a.description ?: "") }
    var minutes by remember { mutableStateOf(a.suggestedMinutes?.toString() ?: "") }
    var difficulty by remember { mutableStateOf(a.difficultyMode) }
    var count by remember { mutableStateOf(a.questionCount.toFloat().coerceIn(5f, 12f)) }
    var level by remember { mutableStateOf(a.level) }
    var skills by remember { mutableStateOf((a.skills ?: emptyList()).toSet()) }
    var gradeMin by remember { mutableStateOf(a.gradeMin) }
    var gradeMax by remember { mutableStateOf(a.gradeMax) }
    var ageMin by remember { mutableStateOf(a.ageMin?.toString() ?: "") }
    var ageMax by remember { mutableStateOf(a.ageMax?.toString() ?: "") }

    val mins = parseIntFa(minutes); val minA = parseIntFa(ageMin); val maxA = parseIntFa(ageMax)
    val minutesBad = minutes.isNotBlank() && (mins == null || mins !in 1..120)
    val ageBad = (ageMin.isNotBlank() && (minA == null || minA !in 3..25)) || (ageMax.isNotBlank() && (maxA == null || maxA !in 3..25)) || (minA != null && maxA != null && minA > maxA)
    val gradeBad = gradeMin != null && gradeMax != null && (Edu.grades.firstOrNull { it.code == gradeMin }?.order ?: 0) > (Edu.grades.firstOrNull { it.code == gradeMax }?.order ?: 0)
    val valid = !minutesBad && !ageBad && !gradeBad

    val unpublished = a.publishState != "published"
    val countInt = count.toInt()
    // Same rule as the server: anything that changes what the child plays needs a new preview (only while unpublished).
    val playChanged = difficulty != a.difficultyMode || countInt != a.questionCount || level != a.level ||
        gradeMin != a.gradeMin || gradeMax != a.gradeMax || minA != a.ageMin || maxA != a.ageMax ||
        skills != (a.skills ?: emptyList()).toSet()

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
                Text("ویرایش فعالیت", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(16.dp))
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    EditSection("مشخصات")
                    OutlinedTextField(title, { title = it.take(80) }, label = { Text("عنوان") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(description, { description = it.take(500) }, label = { Text("توضیحات") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                    AgeField("زمان پیشنهادی (دقیقه)", minutes, { minutes = it.take(3) }, Modifier.fillMaxWidth())
                    if (minutesBad) Text("زمان باید بین ۱ تا ۱۲۰ دقیقه باشد.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)

                    EditSection("پایه و سن")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GradeDropdown("از پایه", gradeMin, { gradeMin = it }, Modifier.weight(1f), allowNone = true, noneLabel = "—")
                        GradeDropdown("تا پایه", gradeMax, { gradeMax = it }, Modifier.weight(1f), allowNone = true, noneLabel = "—")
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AgeField("از سن", ageMin, { ageMin = it }, Modifier.weight(1f))
                        AgeField("تا سن", ageMax, { ageMax = it }, Modifier.weight(1f))
                    }
                    if (gradeBad) Text("پایهٔ شروع نباید بالاتر از پایهٔ پایان باشد.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    if (ageBad) Text("بازهٔ سنی معتبر نیست (۳ تا ۲۵ سال).", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    Text("پایه و سن فقط برای راهنمایی هستند؛ پارامترهای بازی از پایهٔ کلاس و دشواری انتخابی تعیین می‌شوند.", style = MaterialTheme.typography.bodySmall)

                    EditSection("هدف آموزشی")
                    OptionDropdown("سطح فعالیت", Edu.levels, level, { level = it }, Modifier.fillMaxWidth(), allowNone = true, noneLabel = "تعیین نشده")
                    SkillChips(skills, { k -> skills = if (k in skills) skills - k else if (skills.size < 5) skills + k else skills })

                    EditSection("دشواری و تعداد سؤال")
                    listOf("adaptive", "easy", "medium", "hard").forEach { m -> EditChoice(Labels.difficulty(m), difficulty == m, !started) { difficulty = m } }
                    Text("تعداد سؤال: ${countInt.fa()}", style = MaterialTheme.typography.titleSmall)
                    Slider(value = count, onValueChange = { count = it }, valueRange = 5f..12f, steps = 6, enabled = !started)
                    if (started) Text("دانش‌آموزی بازی را شروع کرده است؛ دشواری و تعداد سؤال قابل تغییر نیست. برای آن از «ساخت نسخه جدید» استفاده کنید.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    if (playChanged && unpublished) Text("با این تغییرات، آزمایش قبلی بی‌اعتبار می‌شود و پیش از انتشار باید فعالیت را دوباره آزمایش کنید.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
                    if (playChanged && !unpublished) Text("فعالیت منتشر شده است؛ تغییرات فقط برای دانش‌آموزانی که هنوز شروع نکرده‌اند اعمال می‌شود.", style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(8.dp))
                }
                Surface(tonalElevation = 3.dp) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("انصراف") }
                        Button(enabled = valid, modifier = Modifier.weight(2f), onClick = {
                            onSave(ActivityEdit(title, description, if (minutes.isBlank()) null else mins, difficulty, countInt, level, skills.toList(), gradeMin, gradeMax, minA, maxA), playChanged && unpublished)
                        }) { Text("ذخیره") }
                    }
                }
            }
        }
    }
}

@Composable
private fun EditSection(text: String) {
    Spacer(Modifier.height(8.dp))
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
}

@Composable
private fun EditChoice(label: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected = selected, onClick = onClick, enabled = enabled)
        Text(label)
    }
}

@Composable
fun QrView(text: String, modifier: Modifier = Modifier) {
    val matrix = remember(text) { Qr.matrix(text) }
    Canvas(modifier.background(Color.White)) {
        val n = matrix.size
        val cell = size.width / n
        for (y in 0 until n) for (x in 0 until n) {
            if (matrix[y][x]) drawRect(Color.Black, topLeft = Offset(x * cell, y * cell), size = Size(cell + 0.6f, cell + 0.6f))
        }
    }
}

private fun copyLink(ctx: Context, url: String) {
    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("لینک فعالیت", url))
    android.widget.Toast.makeText(ctx, "لینک کپی شد.", android.widget.Toast.LENGTH_SHORT).show()
}

/** Android Share Sheet: the teacher picks Shad / Eitaa / Rubika / WhatsApp / anything. No messenger-specific API. */
private fun shareLink(ctx: Context, url: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, Labels.shareText(url))
    }
    ctx.startActivity(Intent.createChooser(send, "ارسال لینک").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
