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

/** What the teacher typed / picked in آ«ط§ظپط²ظˆط¯ظ† ظ…ظ†ط¨ط¹آ». Exactly one of [text] (pasted) and [file] is set. */
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
            _busy.value = if (draft.file != null) "ط¯ط± ط­ط§ظ„ ط§ط±ط³ط§ظ„ ظˆ ط®ظˆط§ظ†ط¯ظ† ظپط§غŒظ„â€¦" else "ط¯ط± ط­ط§ظ„ ط®ظˆط§ظ†ط¯ظ† ظ…طھظ†â€¦"
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
        topBar = { YadbinTopBar("ع©طھط§ط¨â€Œظ‡ط§ ظˆ ظ…ظ†ط§ط¨ط¹ ط¯ط±ط³غŒ", onBack) },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = { ExtendedFloatingActionButton(onClick = { showAdd = true }, icon = { Icon(Icons.Default.Add, null) }, text = { Text("ط§ظپط²ظˆط¯ظ† ظ…ظ†ط¨ط¹") }) },
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
                        EmptyState("ظ‡ظ†ظˆط² ع©طھط§ط¨ غŒط§ ظ…ظ†ط¨ط¹غŒ ط§ط¶ط§ظپظ‡ ظ†ع©ط±ط¯ظ‡â€Œط§غŒط¯. ظپط§غŒظ„ PDFطŒ Word غŒط§ ظ…طھظ† ط¯ط±ط³ ط±ط§ ط§ط¶ط§ظپظ‡ ع©ظ†غŒط¯ طھط§ ط¢ط²ظ…ظˆظ† ظپظ‚ط· ط§ط² ط±ظˆغŒ ظ‡ظ…ط§ظ† ط³ط§ط®طھظ‡ ط´ظˆط¯.", "ط§ظپط²ظˆط¯ظ† ط§ظˆظ„غŒظ† ظ…ظ†ط¨ط¹") { showAdd = true }
                    } else {
                        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            item { NoticeText("ظ…ظ†ط¨ط¹â€Œظ‡ط§ ظپظ‚ط· ط¨ط±ط§غŒ ط´ظ…ط§ ظ‚ط§ط¨ظ„ ظ…ط´ط§ظ‡ط¯ظ‡â€Œط§ظ†ط¯. ط¢ط²ظ…ظˆظ†ظگ ط³ط§ط®طھظ‡â€Œط´ط¯ظ‡ ط§ط² غŒع© ظ…ظ†ط¨ط¹طŒ ظپظ‚ط· ط§ط² ظ…طھظ† ظ‡ظ…ط§ظ† ظ…ظ†ط¨ط¹ ط³ط¤ط§ظ„ ظ…غŒâ€Œع¯غŒط±ط¯ ظˆ ظ‡ظ…غŒط´ظ‡ ظ¾غŒط´â€Œظ†ظˆغŒط³ ط§ط³طھط› ط´ظ…ط§ ط¢ظ† ط±ط§ ط¨ط±ط±ط³غŒ ظˆ طھط£غŒغŒط¯ ظ…غŒâ€Œع©ظ†غŒط¯.") }
                            if (list.sources.any { SourceRules.isUsable(it) }) item {
                            }
                            items(list.sources, key = { it.id }) { src -> SourceCard(src) { onOpen(src.id) } }
                            item { NoticeText("ط­ط¯ط§ع©ط«ط± ${list.limit.fa()} ظ…ظ†ط¨ط¹طŒ ظ‡ط± ظپط§غŒظ„ طھط§ ${list.maxFileMegabytes.toInt().fa()} ظ…ع¯ط§ط¨ط§غŒطھ ظˆ ${list.maxPages.fa()} طµظپط­ظ‡. ط¨ط±ط§غŒ ع©طھط§ط¨ ط¨ط²ط±ع¯â€Œطھط±طŒ ظپطµظ„â€Œظ‡ط§ ط±ط§ ط¬ط¯ط§ع¯ط§ظ†ظ‡ ط§ط¶ط§ظپظ‡ ع©ظ†غŒط¯.") }
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
            title = { Text("ظ„ط·ظپط§ظ‹ طµط¨ط± ع©ظ†غŒط¯") },
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
        title = { Text("ط§ظپط²ظˆط¯ظ† ع©طھط§ط¨ غŒط§ ظ…ظ†ط¨ط¹") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !paste, onClick = { paste = false }, label = { Text("ظپط§غŒظ„") })
                    FilterChip(selected = paste, onClick = { paste = true }, label = { Text("ظˆط§ط±ط¯ ع©ط±ط¯ظ† ظ…طھظ†") })
                }
                OutlinedTextField(title, { title = it.take(SourceRules.MAX_TITLE) }, label = { Text("ط¹ظ†ظˆط§ظ† (ظ…ط«ظ„ط§ظ‹ ط±غŒط§ط¶غŒ ط´ط´ظ…)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(subject, { subject = it.take(60) }, label = { Text("ط¯ط±ط³ (ط§ط®طھغŒط§ط±غŒ)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                GradeDropdown("ظ¾ط§غŒظ‡ظ” طھط­طµغŒظ„غŒ (ط§ط®طھغŒط§ط±غŒ)", grade, { grade = it }, allowNone = true)
                OutlinedTextField(desc, { desc = it.take(500) }, label = { Text("طھظˆط¶غŒط­ (ط§ط®طھغŒط§ط±غŒ)") }, modifier = Modifier.fillMaxWidth())
                if (paste) {
                    OutlinedTextField(
                        text, { text = it }, label = { Text("ظ…طھظ† ط¯ط±ط³ غŒط§ ع©طھط§ط¨") }, minLines = 5, maxLines = 10, modifier = Modifier.fillMaxWidth(),
                    )
                    NoticeText("${text.length.fa()} ظ†ظˆغŒط³ظ‡. ط¹ظ†ظˆط§ظ†â€Œظ‡ط§غŒغŒ ظ…ط«ظ„ آ«ظپطµظ„ ط§ظˆظ„آ» ظˆ آ«ط¯ط±ط³ غ²آ» ط¯ط± ط®ط· ط¬ط¯ط§ ظ†ظˆط´طھظ‡ ط´ظˆظ†ط¯ طھط§ ظپطµظ„ ظˆ ط¯ط±ط³ طھط´ط®غŒطµ ط¯ط§ط¯ظ‡ ط´ظˆط¯.")
                } else {
                    OutlinedButton(onClick = { launcher.launch(SourceFiles.MIME_TYPES) }, modifier = Modifier.fillMaxWidth()) { Text(if (file != null) "طھط؛غŒغŒط± ظپط§غŒظ„" else "ط§ظ†طھط®ط§ط¨ ظپط§غŒظ„") }
                    when (val p = picked) {
                        is PickResult.Ok -> Text("ظپط§غŒظ„ ط§ظ†طھط®ط§ط¨â€Œط´ط¯ظ‡: ${p.name}", style = MaterialTheme.typography.bodySmall)
                        is PickResult.Bad -> Text(p.message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                        null -> NoticeText("PDF ظ…طھظ†غŒطŒ Word (ط¨ط§ ظ¾ط³ظˆظ†ط¯ docx) غŒط§ ظ…طھظ† ط³ط§ط¯ظ‡ط› ط­ط¯ط§ع©ط«ط± ${maxMegabytes.toInt().fa()} ظ…ع¯ط§ط¨ط§غŒطھ. PDF ط§ط³ع©ظ†â€Œط´ط¯ظ‡ (ط¹ع©ط³ طµظپط­ظ‡â€Œظ‡ط§) ظ‡ظ†ظˆط² ظ¾ط´طھغŒط¨ط§ظ†غŒ ظ†ظ…غŒâ€Œط´ظˆط¯. ط®ظˆط¯ ظپط§غŒظ„ ظ†ع¯ظ‡ ط¯ط§ط´طھظ‡ ظ†ظ…غŒâ€Œط´ظˆط¯ط› ظپظ‚ط· ظ…طھظ† ط¢ظ† ط°ط®غŒط±ظ‡ ظ…غŒâ€Œط´ظˆط¯.")
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
            ) { Text("ط§ظپط²ظˆط¯ظ†") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("ط§ظ†طµط±ط§ظپ") } },
    )
}

