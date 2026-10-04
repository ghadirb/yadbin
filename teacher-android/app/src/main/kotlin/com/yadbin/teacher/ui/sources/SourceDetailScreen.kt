@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.sources

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.SourceFiles
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.ContentSectionText
import com.yadbin.teacher.domain.models.ContentSourceDetail
import com.yadbin.teacher.domain.models.ContentSourceInfo
import com.yadbin.teacher.domain.usecases.SectionTree
import com.yadbin.teacher.domain.usecases.SourceRules
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class SourceDetailViewModel(private val repo: Repository, private val id: String) : ViewModel() {
    private val _state = MutableStateFlow<Ui<ContentSourceDetail>>(Ui.Loading)
    val state: StateFlow<Ui<ContentSourceDetail>> = _state.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()
    private val _busy = MutableStateFlow<String?>(null)
    val busy: StateFlow<String?> = _busy.asStateFlow()
    private val _text = MutableStateFlow<Ui<ContentSectionText>?>(null)
    val text: StateFlow<Ui<ContentSectionText>?> = _text.asStateFlow()

    init { refresh() }
    fun clearMessage() { _message.value = null }
    fun refresh() { viewModelScope.launch { if (_state.value !is Ui.Ready) _state.value = Ui.Loading; _state.value = loadUi { repo.contentSource(id) } } }

    /** The extracted text of one chapter / lesson, so the teacher can check what the system read. */
    fun showText(sectionId: String) {
        viewModelScope.launch { _text.value = Ui.Loading; _text.value = loadUi { com.yadbin.teacher.data.repository.Loaded(repo.contentSourceSection(id, sectionId), false) } }
    }
    fun closeText() { _text.value = null }

    fun save(title: String, subject: String?, gradeCode: String?, description: String?) {
        viewModelScope.launch {
            try { _state.value = Ui.Ready(repo.updateContentSource(id, title, subject, gradeCode, description)); _message.value = "اطلاعات منبع ذخیره شد." }
            catch (e: ApiException) { _message.value = errorText(e) } catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }

    /** Sends the file again (scanned PDF replaced by a text PDF, a damaged file, an upload that was cut off). */
    fun resend(file: PickResult.Ok, info: ContentSourceInfo) {
        if (_busy.value != null) return
        if (!SourceRules.fileMatches(info, file.type)) {
            _message.value = "این منبع از نوع ${info.fileTypeLabel.ifBlank { info.fileType }} ساخته شده است؛ فایلی از همان نوع انتخاب کنید یا منبع تازه‌ای اضافه کنید."
            return
        }
        viewModelScope.launch {
            _busy.value = "در حال ارسال و خواندن فایل…"
            try {
                val d = repo.processContentSource(id, file.bytes)
                _state.value = Ui.Ready(d)
                if (d.duplicate) _message.value = "این منبع قبلاً پردازش شده است."
            } catch (e: ApiException) { _message.value = errorText(e); refresh() }
            catch (e: NetworkException) { _message.value = errorText(e) }
            _busy.value = null
        }
    }

    fun delete(onDone: () -> Unit) {
        viewModelScope.launch {
            try { repo.deleteContentSource(id); onDone() }
            catch (e: ApiException) { _message.value = errorText(e) } catch (e: NetworkException) { _message.value = errorText(e) }
        }
    }
}

@Composable
fun SourceDetailScreen(sourceId: String, onBack: () -> Unit, onMakeQuiz: (String) -> Unit) {
    val c = LocalContainer.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val vm: SourceDetailViewModel = viewModel(key = "source-$sourceId", factory = VmFactory { SourceDetailViewModel(c.repository, sourceId) })
    val state by vm.state.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val text by vm.text.collectAsStateWithLifecycle()
    var edit by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); vm.clearMessage() } }

    val current = (state as? Ui.Ready<ContentSourceDetail>)?.data?.source
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            when (val r = readPickedFile(ctx, uri)) {
                is PickResult.Ok -> current?.let { vm.resend(r, it) }
                is PickResult.Bad -> snackbar.showSnackbar(r.message)
            }
        }
    }

    // A source that is still being read is checked again every few seconds until it is finished.
    val processing = current?.status == "processing"
    LaunchedEffect(processing) { while (processing) { delay(4000); vm.refresh() } }

    Scaffold(
        topBar = { YadbinTopBar("منبع درسی", onBack, actions = { TextButton(onClick = vm::refresh) { Text("به‌روزرسانی") } }) },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            when (val s = state) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(s.message, vm::refresh)
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    val src = s.data.source
                    val tree = SectionTree(s.data.sections)
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        item {
                            Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text(src.title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                                        SourceStatusChip(src)
                                    }
                                    val meta = listOfNotNull(src.subject, src.gradeLabel, src.fileTypeLabel.ifBlank { null }, src.originalFileName)
                                    if (meta.isNotEmpty()) Text(meta.joinToString(" • "), style = MaterialTheme.typography.bodyMedium)
                                    val size = SourceRules.sizeLine(src)
                                    if (size.isNotEmpty()) Text(size, style = MaterialTheme.typography.bodySmall)
                                    src.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                                    src.statusMessage?.takeIf { it.isNotBlank() }?.let {
                                        Text(it, style = MaterialTheme.typography.bodySmall, color = if (SourceRules.isUsable(src)) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)
                                    }
                                    if (processing) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                                        Text("در حال خواندن منبع…", style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        }
                        item {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (SourceRules.isUsable(src)) Button(onClick = { onMakeQuiz(src.id) }, modifier = Modifier.fillMaxWidth()) { Text("ساخت آزمون از این منبع") }
                                if (SourceRules.canSendFile(src)) OutlinedButton(onClick = { launcher.launch(SourceFiles.MIME_TYPES) }, modifier = Modifier.fillMaxWidth()) { Text("ارسال دوبارهٔ فایل") }
                                OutlinedButton(onClick = { edit = true }, modifier = Modifier.fillMaxWidth()) { Text("ویرایش عنوان، درس و پایه") }
                                TextButton(onClick = { confirmDelete = true }) { Text("حذف منبع", color = MaterialTheme.colorScheme.error) }
                            }
                        }
                        if (src.status == "needs_review") item {
                            NoticeText("فصل‌ها و درس‌ها با اطمینان کامل تشخیص داده نشد. متن را بررسی کنید؛ هنگام ساخت آزمون می‌توانید کل متن یا بخش دلخواه را خودتان انتخاب کنید.")
                        }
                        if (src.status == "needs_ocr") item {
                            NoticeText("برای PDF اسکن‌شده فعلاً راهی جز وارد کردن یک PDF متنی یا خود متن کتاب نیست. «افزودن منبع ← وارد کردن متن» را امتحان کنید.")
                        }
                        if (tree.flatten().isNotEmpty()) {
                            item { SectionTitle("فصل‌ها و درس‌ها") }
                            items(tree.flatten(), key = { it.first.id }) { (sec, depth) ->
                                Card(Modifier.fillMaxWidth().padding(start = (depth * 16).dp)) {
                                    Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Column(Modifier.weight(1f)) {
                                            Text(sec.title, style = MaterialTheme.typography.titleSmall)
                                            Text(listOf(sec.typeLabel, "${sec.partCount.fa()} بخش متن").filter { it.isNotBlank() }.joinToString(" • "), style = MaterialTheme.typography.labelSmall)
                                        }
                                        TextButton(onClick = { vm.showText(sec.id) }) { Text("مشاهدهٔ متن") }
                                    }
                                }
                            }
                        }
                        item { Spacer(Modifier.height(24.dp)) }
                    }
                }
            }
        }
    }

    if (edit && current != null) EditSourceDialog(current, onDismiss = { edit = false }) { t, sub, g, d -> edit = false; vm.save(t, sub, g, d) }
    if (confirmDelete) ConfirmDialog(
        "حذف منبع",
        "متن و فصل‌های این منبع برای همیشه پاک می‌شود. آزمون‌هایی که قبلاً از آن ساخته‌اید می‌مانند و عنوان منبع و «منبع سؤال» در آن‌ها حفظ می‌شود.",
        "حذف", { confirmDelete = false; vm.delete(onBack) }, { confirmDelete = false },
    )
    text?.let { ui ->
        AlertDialog(
            onDismissRequest = vm::closeText,
            title = { Text((ui as? Ui.Ready<ContentSectionText>)?.data?.section?.title ?: "متن استخراج‌شده") },
            text = {
                when (ui) {
                    Ui.Loading -> LoadingBox(Modifier.height(120.dp))
                    is Ui.Error -> ErrorBox(ui.message, null)
                    is Ui.Ready -> Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (ui.data.parts.isEmpty()) Text("برای این بخش متنی ثبت نشده است.", style = MaterialTheme.typography.bodySmall)
                        ui.data.parts.forEach { p ->
                            p.page?.let { Text("صفحهٔ ${it.fa()}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary) }
                            Text(p.text, style = MaterialTheme.typography.bodySmall)
                            HorizontalDivider()
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = vm::closeText) { Text("بستن") } },
        )
    }
    busy?.let { msg ->
        AlertDialog(
            onDismissRequest = {}, title = { Text("لطفاً صبر کنید") },
            text = { Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) { CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp); Text(msg) } },
            confirmButton = {},
        )
    }
}

@Composable
private fun EditSourceDialog(s: ContentSourceInfo, onDismiss: () -> Unit, onSave: (String, String?, String?, String?) -> Unit) {
    var title by remember { mutableStateOf(s.title) }
    var subject by remember { mutableStateOf(s.subject.orEmpty()) }
    var grade by remember { mutableStateOf(s.gradeCode) }
    var desc by remember { mutableStateOf(s.description.orEmpty()) }
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text("اطلاعات منبع") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(title, { title = it.take(SourceRules.MAX_TITLE) }, label = { Text("عنوان") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(subject, { subject = it.take(60) }, label = { Text("درس") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                GradeDropdown("پایهٔ تحصیلی", grade, { grade = it }, allowNone = true)
                OutlinedTextField(desc, { desc = it.take(500) }, label = { Text("توضیح") }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton(enabled = title.trim().length >= 2, onClick = { onSave(title, subject.ifBlank { null }, grade, desc.ifBlank { null }) }) { Text("ذخیره") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
}
