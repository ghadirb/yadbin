@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.sources

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
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
import com.yadbin.teacher.domain.models.ContentSourceInfo
import com.yadbin.teacher.domain.models.ContentSourceList
import com.yadbin.teacher.domain.usecases.SourceRules
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the teacher typed / picked in آ«افزودن منبعآ». Exactly one of [text] (pasted) and [file] is set. */
data class NewSource(
    val title: String,
    val subject: String?,
    val gradeCode: String?,
    val description: String?,
    val text: String?,
    val file: PickResult.Ok?,
)

class SourcesViewModel(private val repo: Repository) : ViewModel() {
    private val _state = MutableStateFlow<Ui<ContentSourceList>>(Ui.Loading)
    val state: StateFlow<Ui<ContentSourceList>> = _state.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()
    /** Text shown while a source is being added and read (null = idle). Also blocks a second tap. */
    private val _busy = MutableStateFlow<String?>(null)
    val busy: StateFlow<String?> = _busy.asStateFlow()

    init { refresh() }
    fun clearMessage() { _message.value = null }
    fun refresh() { viewModelScope.launch { if (_state.value !is Ui.Ready) _state.value = Ui.Loading; _state.value = loadUi { repo.contentSources() } } }

    /** Pasted text is read in the same request. A file is created first and then sent (the server reads it and drops it). */
    fun add(draft: NewSource, onDone: (String) -> Unit) {
        if (_busy.value != null) return
        viewModelScope.launch {
            _busy.value = if (draft.file != null) "در حال ارسال و خواندن فایل…" else "در حال خواندن متن…"
            var createdId: String? = null
            try {
                val file = draft.file
                if (file == null) {
                    val d = repo.createContentSource(draft.title, draft.subject, draft.gradeCode, draft.description, "paste", null, draft.text)
                    createdId = d.source.id
                } else {
                    val d = repo.createContentSource(draft.title, draft.subject, draft.gradeCode, draft.description, file.type, file.name, null)
                    val id = d.source.id
                    createdId = id
                    repo.processContentSource(id, file.bytes)
                }
            } catch (e: ApiException) { _message.value = errorText(e) }
            catch (e: NetworkException) { _message.value = errorText(e) }
            _busy.value = null
            // Even when reading the file failed the source exists: its page shows the reason and lets the teacher send the file again.
            createdId?.let(onDone)
            refresh()
        }
    }
}

@Composable
fun SourceStatusChip(s: ContentSourceInfo) {
    val label = SourceRules.statusLabel(s)
    when (SourceRules.statusGroup(s.status)) {
        "ok" -> StatusChip(label, Tone.Success)
        "warn" -> StatusChip(label, Tone.Warning)
        "error" -> StatusChip(label, Tone.Error)
        else -> StatusChip(label, Tone.Info)
    }
}

@Composable
fun SourcesScreen(onBack: () -> Unit, onOpen: (String) -> Unit, onMakeQuiz: () -> Unit) {
    val c = LocalContainer.current
    val vm: SourcesViewModel = viewModel(factory = VmFactory { SourcesViewModel(c.repository) })
    val state by vm.state.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var showAdd by remember { mutableStateOf(false) }
    androidx.activity.compose.BackHandler(enabled = !showAdd && busy == null, onBack = onBack)
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); vm.clearMessage() } }

    // refresh when coming back from a source page (it may have been deleted or finished processing)
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, e -> if (e == androidx.lifecycle.Lifecycle.Event.ON_RESUME) vm.refresh() }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }

    Scaffold(
        topBar = { YadbinTopBar("کتاب‌ها و منابع درسی", onBack) },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = { ExtendedFloatingActionButton(onClick = { showAdd = true }, icon = { Icon(Icons.Default.Add, null) }, text = { Text("افزودن منبع") }) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            when (val s = state) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(s.message, vm::refresh)
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    val list = s.data
                    if (list.sources.isEmpty()) {
                        Spacer(Modifier.height(32.dp))
                        EmptyState("هنوز کتاب یا منبعی اضافه نکرده‌اید. فایل PDF، Word یا متن درس را اضافه کنید تا آزمون فقط از روی همان ساخته شود.", "افزودن اولین منبع") { showAdd = true }
                    } else {
                        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {                            item { NoticeText("منابع فقط برای شما قابل مشاهده‌اند. آزمون ساخته‌شده از یک منبع فقط از متن همان منبع سؤال می‌گیرد و همیشه پیش‌نویس است؛ شما آن را بررسی و تأیید می‌کنید.") }
                            if (list.sources.any { SourceRules.isUsable(it) }) item {
                            }
                            items(list.sources, key = { it.id }) { src -> SourceCard(src) { onOpen(src.id) } }
                            item { NoticeText("حداکثر ${list.limit.fa()} منبع، هر فایل تا ${list.maxFileMegabytes.toInt().fa()} مگابایت و ${list.maxPages.fa()} صفحه. برای کتاب بزرگ‌تر، فصل‌ها را جداگانه اضافه کنید.") }
                            item { Spacer(Modifier.height(72.dp)) }
                        }
                    }
                }
            }
        }
    }

    if (showAdd) {
        val maxMb = ((state as? Ui.Ready<ContentSourceList>)?.data?.maxFileMegabytes ?: 5.0)
        AddSourceDialog(maxMb, onDismiss = { showAdd = false }) { draft -> showAdd = false; vm.add(draft, onOpen) }
    }
    busy?.let { text ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text("لطفاً صبر کنید") },
            text = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
                    Text(text)
                }
            },
            confirmButton = {},
        )
    }
}

@Composable
private fun SourceCard(s: ContentSourceInfo, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(s.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                SourceStatusChip(s)
            }
            val meta = listOfNotNull(s.subject, s.gradeLabel, s.fileTypeLabel.ifBlank { null })
            if (meta.isNotEmpty()) Text(meta.joinToString(" â€¢ "), style = MaterialTheme.typography.bodySmall)
            val size = SourceRules.sizeLine(s)
            if (size.isNotEmpty()) Text(size, style = MaterialTheme.typography.bodySmall)
            // the plain Persian reason for a source that cannot be used (scanned PDF, damaged file â€¦)
            if (!SourceRules.isUsable(s)) s.statusMessage?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun AddSourceDialog(maxMegabytes: Double, onDismiss: () -> Unit, onAdd: (NewSource) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var paste by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var subject by remember { mutableStateOf("") }
    var grade by remember { mutableStateOf<String?>(null) }
    var desc by remember { mutableStateOf("") }
    var text by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf<PickResult?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            val r = readPickedFile(ctx, uri)
            picked = r
            if (r is PickResult.Ok && title.isBlank()) title = SourceFiles.titleFromFileName(r.name)
        }
    }
    val file = picked as? PickResult.Ok
    val valid = title.trim().length >= 2 && (if (paste) text.isNotBlank() else file != null)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("افزودن کتاب یا منبع") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !paste, onClick = { paste = false }, label = { Text("فایل") })
                    FilterChip(selected = paste, onClick = { paste = true }, label = { Text("وارد کردن متن") })
                }
                OutlinedTextField(title, { title = it.take(SourceRules.MAX_TITLE) }, label = { Text("عنوان (مثلاً ریاضی ششم)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(subject, { subject = it.take(60) }, label = { Text("درس (اختیاری)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                GradeDropdown("پایهٔ تحصیلی (اختیاری)", grade, { grade = it }, allowNone = true)
                OutlinedTextField(desc, { desc = it.take(500) }, label = { Text("توضیح (اختیاری)") }, modifier = Modifier.fillMaxWidth())
                if (paste) {
                    OutlinedTextField(
                        text, { text = it }, label = { Text("متن درس یا کتاب") }, minLines = 5, maxLines = 10, modifier = Modifier.fillMaxWidth(),
                    )
                    NoticeText("${text.length.fa()} نویسه. عنوان‌های فصل و درس را در خط جدا بنویسید تا فصل و درس تشخیص داده شود.")
                } else {
                    OutlinedButton(onClick = { launcher.launch(SourceFiles.MIME_TYPES) }, modifier = Modifier.fillMaxWidth()) { Text(if (file != null) "تغییر فایل" else "انتخاب فایل") }
                    when (val p = picked) {
                        is PickResult.Ok -> Text("فایل انتخاب‌شده: ${p.name}", style = MaterialTheme.typography.bodySmall)
                        is PickResult.Bad -> Text(p.message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                        null -> NoticeText("PDF متنی، Word با پسوند docx یا متن ساده پشتیبانی می‌شود؛ حداکثر ${maxMegabytes.toInt().fa()} مگابایت. PDF اسکن‌شده فعلاً پشتیبانی نمی‌شود. فایل خام نگهداری نمی‌شود و فقط متن آن ذخیره می‌شود.")
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = valid,
                onClick = {
                    onAdd(NewSource(title.trim(), subject.ifBlank { null }, grade, desc.ifBlank { null }, if (paste) text else null, if (paste) null else file))
                },
            ) { Text("افزودن") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
}

