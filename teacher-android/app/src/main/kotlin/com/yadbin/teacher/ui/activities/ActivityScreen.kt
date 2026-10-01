@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.activities

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
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
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.Labels
import com.yadbin.teacher.core.utils.Qr
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.core.utils.jalaliFa
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.ActivityDetail
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
    fun save(title: String, description: String, minutes: Int?) = doAction("تغییرات ذخیره شد.") { repo.updateActivity(id, title, description, minutes) }
    fun setArchived(archived: Boolean) = doAction(if (archived) "فعالیت آرشیو شد." else "فعالیت از آرشیو خارج شد.") { repo.setActivityArchived(id, archived) }
    fun regenerate(studentId: String) = doAction("لینک جدید ساخته شد؛ لینک قبلی دیگر کار نمی‌کند.") { repo.regenerateLink(id, studentId) }
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
                    Column(Modifier.padding(16.dp)) {
                        Text(a.title ?: Labels.game(a.gameType), style = MaterialTheme.typography.titleMedium)
                        Text("${Labels.game(a.gameType)} • ${Labels.difficulty(a.difficultyMode)} • ${a.questionCount.fa()} سؤال • ${a.lifecycleLabel.ifBlank { Labels.activityStatus(a.status) }}", style = MaterialTheme.typography.bodySmall)
                        a.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        Text(listOfNotNull(a.createdAt.jalaliFa().takeIf { it.isNotBlank() }?.let { "ساخته‌شده: $it" }, a.expiresAt.jalaliFa().takeIf { it.isNotBlank() }?.let { "انقضا: $it" }).joinToString(" • "), style = MaterialTheme.typography.bodySmall)
                        a.suggestedMinutes?.let { Text("زمان پیشنهادی: ${it.fa()} دقیقه", style = MaterialTheme.typography.bodySmall) }
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(onClick = { showEdit = true }) { Text("ویرایش") }
                            TextButton(onClick = { vm.duplicate(onOpenActivity) }) { Text("ساخت نسخه جدید") }
                            TextButton(onClick = { vm.setArchived(a.lifecycle != "archived") }) { Text(if (a.lifecycle == "archived") "خروج از آرشیو" else "آرشیو") }
                        }
                        Text("هر دانش‌آموز لینک اختصاصی خودش را دارد؛ لینک را فقط برای همان دانش‌آموز بفرستید.", style = MaterialTheme.typography.bodySmall)
                        if (a.status == "active") TextButton(onClick = { confirmCancel = true }) { Text("لغو فعالیت", color = MaterialTheme.colorScheme.error) }
                    }
                    LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(s.data.students, key = { it.studentId }) { st ->
                            Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(12.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(st.name, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                                        AssistChip(onClick = {}, label = { Text(Labels.studentStatus(st.status)) })
                                    }
                                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        TextButton(onClick = { copyLink(ctx, st.url); }) { Text("کپی لینک") }
                                        TextButton(onClick = { qrFor = st }) { Text("QR") }
                                        TextButton(onClick = { shareLink(ctx, st.url) }) { Icon(Icons.Default.Share, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("اشتراک‌گذاری") }
                                        if (st.status != "completed" && a.status == "active") TextButton(onClick = { regenFor = st }) { Text("لینک جدید") }
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
        val cur = (state as? Ui.Ready)?.data?.activity
        if (cur != null) EditActivityDialog(cur.title ?: "", cur.description ?: "", cur.suggestedMinutes, { showEdit = false }) { t, d, m -> showEdit = false; vm.save(t, d, m) }
    }
    if (confirmCancel) ConfirmDialog("لغو فعالیت", "لینک‌های این فعالیت غیرفعال می‌شوند.", "لغو فعالیت", { confirmCancel = false; vm.cancel() }, { confirmCancel = false })
}

@Composable
private fun EditActivityDialog(title: String, description: String, minutes: Int?, onDismiss: () -> Unit, onSave: (String, String, Int?) -> Unit) {
    var t by remember { mutableStateOf(title) }
    var d by remember { mutableStateOf(description) }
    var m by remember { mutableStateOf(minutes?.toString() ?: "") }
    val mins = m.trim().toIntOrNull()
    val valid = m.isBlank() || (mins != null && mins in 1..120)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("ویرایش فعالیت") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(t, { t = it.take(80) }, label = { Text("عنوان") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(d, { d = it.take(500) }, label = { Text("توضیحات") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(m, { m = it.filter { ch -> ch.isDigit() }.take(3) }, label = { Text("زمان پیشنهادی (دقیقه)") }, singleLine = true, isError = !valid, modifier = Modifier.fillMaxWidth())
                Text("سطح دشواری و تعداد سؤال پس از شروع دانش‌آموزان قابل تغییر نیست؛ برای آن از «ساخت نسخه جدید» استفاده کنید.", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(enabled = valid, onClick = { onSave(t, d, if (m.isBlank()) null else mins) }) { Text("ذخیره") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
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
