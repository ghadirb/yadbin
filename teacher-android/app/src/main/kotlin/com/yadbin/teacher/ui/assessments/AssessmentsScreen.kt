@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.assessments

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.Edu
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.AssessmentInfo
import com.yadbin.teacher.domain.models.AssessmentList
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

val ASSESSMENT_FILTERS: List<Pair<String, String>> = listOf(
    "all" to "همه", "draft" to "پیش‌نویس", "ready_to_publish" to "آماده انتشار", "published" to "منتشرشده", "archived" to "آرشیوشده",
)

@Composable
fun AssessmentStatusChip(status: String, label: String) {
    when (status) {
        "published" -> StatusChip(label, Tone.Success)
        "ready_to_publish" -> StatusChip(label, Tone.Info)
        "draft", "teacher_preview" -> StatusChip(label, Tone.Warning)
        else -> StatusChip(label)
    }
}

class AssessmentsViewModel(private val repo: Repository) : ViewModel() {
    private val _state = MutableStateFlow<Ui<AssessmentList>>(Ui.Loading)
    val state: StateFlow<Ui<AssessmentList>> = _state.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private var filter = "all"

    init { refresh() }
    fun clearMessage() { _message.value = null }
    fun setFilter(f: String) { filter = f; refresh() }
    fun refresh() { viewModelScope.launch { if (_state.value !is Ui.Ready) _state.value = Ui.Loading; _state.value = loadUi { repo.assessments(filter) } } }

    /** The form stays open (with its text) while the request runs; it closes only on success, so an error never loses what the teacher typed. */
    fun create(title: String, subject: String?, gradeCode: String?, level: String?, description: String?, minutes: Int?, onCreated: (String) -> Unit) =
        launchBusy({ repo.createAssessment(title, subject, gradeCode, level, description, minutes).assessment.id }, onCreated)

    /** AI only writes a DRAFT; the teacher still edits, previews and approves. If AI is down, manual creation keeps working. */
    fun aiDraft(prompt: String, subject: String?, gradeCode: String?, level: String?, count: Int, onCreated: (String) -> Unit) =
        launchBusy({ repo.aiAssessmentDraft(prompt, subject, gradeCode, level, count).assessment.id }, onCreated)

    private fun launchBusy(block: suspend () -> String, onCreated: (String) -> Unit) {
        if (_busy.value) return
        viewModelScope.launch {
            _busy.value = true
            try { onCreated(block()) }
            catch (e: ApiException) { _message.value = errorText(e) }
            catch (e: NetworkException) { _message.value = errorText(e) }
            finally { _busy.value = false }
        }
    }
}

@Composable
fun AssessmentsScreen(onBack: () -> Unit, onOpen: (String) -> Unit) {
    val c = LocalContainer.current
    val vm: AssessmentsViewModel = viewModel(factory = VmFactory { AssessmentsViewModel(c.repository) })
    val state by vm.state.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf("all") }
    // The forms open ONLY from the «ساخت آزمون جدید» button (see SourcesScreen): not saved across restarts, and a tap right after the screen
    // opened or right after a form closed is ignored.
    var showCreate by remember { mutableStateOf(false) }
    var showAi by remember { mutableStateOf(false) }
    var lastChange by remember { mutableLongStateOf(System.currentTimeMillis()) }
    fun openCreate() { if (System.currentTimeMillis() - lastChange > 700) { showCreate = true; lastChange = System.currentTimeMillis() } }
    fun closeForms() { showCreate = false; showAi = false; lastChange = System.currentTimeMillis() }
    androidx.activity.compose.BackHandler(enabled = !showCreate && !showAi, onBack = onBack)
    androidx.activity.compose.BackHandler(enabled = (showCreate || showAi) && !busy) { closeForms() }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); vm.clearMessage() } }

    // refresh when coming back from the editor
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, e -> if (e == androidx.lifecycle.Lifecycle.Event.ON_RESUME) vm.refresh() }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }

    // The forms are full screens inside this screen (not floating dialogs), so Cancel / Back always closes them.
    if (showAi) {
        AiAssessmentForm(
            onBack = { closeForms() },
            busy = busy, snackbar = snackbar,
            onCreate = { p, sub, g, l, n -> vm.aiDraft(p, sub, g, l, n) { id -> closeForms(); onOpen(id) } },
        )
        return
    }
    if (showCreate) {
        CreateAssessmentForm(
            onBack = { closeForms() },
            onAi = { showCreate = false; showAi = true; lastChange = System.currentTimeMillis() },
            busy = busy, snackbar = snackbar,
            onCreate = { t, sub, g, l, d, m -> vm.create(t, sub, g, l, d, m) { id -> closeForms(); onOpen(id) } },
        )
        return
    }

    Scaffold(
        topBar = { YadbinTopBar("آزمون‌های من", onBack) },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = { ExtendedFloatingActionButton(onClick = { openCreate() }, icon = { Icon(Icons.Default.Add, null) }, text = { Text("ساخت آزمون جدید") }) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ASSESSMENT_FILTERS.forEach { (code, label) ->
                    FilterChip(selected = filter == code, onClick = { filter = code; vm.setFilter(code) }, label = { Text(label) })
                }
            }
            NoticeText("آزمون معلم با فعالیت یادبین فرق دارد: نمرهٔ آن یک سنجش درسی است و در پروفایل شناختی (حافظه، توجه، حل مسئله…) هیچ نقشی ندارد.")
            when (val s = state) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(s.message, vm::refresh)
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    if (s.data.assessments.isEmpty()) {
                        EmptyState("هنوز آزمونی در این بخش نیست. با دکمهٔ «ساخت آزمون جدید» پایین صفحه شروع کنید.")
                    } else {
                        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(s.data.assessments, key = { it.id }) { a -> AssessmentCard(a) { onOpen(a.id) } }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AssessmentCard(a: AssessmentInfo, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(a.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                AssessmentStatusChip(a.status, a.statusLabel)
            }
            val meta = listOfNotNull(a.subject, a.gradeLabel, a.levelLabel, if (a.version > 1) "نسخه ${a.version.fa()}" else null)
            if (meta.isNotEmpty()) Text(meta.joinToString(" • "), style = MaterialTheme.typography.bodySmall)
            Text(
                "${a.questionCount.fa()} سؤال" + if (a.assigned > 0) " • ${a.completed.fa()} از ${a.assigned.fa()} دانش‌آموز انجام داده‌اند" else "",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun CreateAssessmentForm(busy: Boolean, snackbar: SnackbarHostState, onBack: () -> Unit, onAi: () -> Unit, onCreate: (String, String?, String?, String?, String?, Int?) -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var subject by rememberSaveable { mutableStateOf("") }
    var grade by rememberSaveable { mutableStateOf<String?>(null) }
    var level by rememberSaveable { mutableStateOf<String?>(null) }
    var desc by rememberSaveable { mutableStateOf("") }
    var minutes by rememberSaveable { mutableStateOf("") }
    Scaffold(topBar = { YadbinTopBar("ساخت آزمون جدید", onBack) }, snackbarHost = { SnackbarHost(snackbar) }) { pad ->
        Column(
            Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            OutlinedTextField(title, { title = it }, label = { Text("عنوان آزمون") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(subject, { subject = it }, label = { Text("درس / موضوع") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            GradeDropdown("پایهٔ تحصیلی", grade, { grade = it }, allowNone = true)
            OptionDropdown("سطح", Edu.levels, level, { level = it }, allowNone = true)
            OutlinedTextField(desc, { desc = it }, label = { Text("توضیح (اختیاری)") }, modifier = Modifier.fillMaxWidth())
            AgeField("زمان پیشنهادی به دقیقه (اختیاری)", minutes, { minutes = it }, Modifier.fillMaxWidth())
            TextButton(onClick = onAi, enabled = !busy) { Text("ساخت پیش‌نویس با هوش مصنوعی") }
            Button(
                enabled = title.isNotBlank() && !busy,
                onClick = { onCreate(title, subject.ifBlank { null }, grade, level, desc.ifBlank { null }, parseIntFa(minutes)) },
                modifier = Modifier.fillMaxWidth(),
            ) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("ساخت و افزودن سؤال") }
            OutlinedButton(onClick = onBack, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("انصراف") }
        }
    }
}

@Composable
private fun AiAssessmentForm(busy: Boolean, snackbar: SnackbarHostState, onBack: () -> Unit, onCreate: (String, String?, String?, String?, Int) -> Unit) {
    var prompt by rememberSaveable { mutableStateOf("") }
    var subject by rememberSaveable { mutableStateOf("") }
    var grade by rememberSaveable { mutableStateOf<String?>(null) }
    var level by rememberSaveable { mutableStateOf<String?>(null) }
    var count by rememberSaveable { mutableStateOf("10") }
    Scaffold(topBar = { YadbinTopBar("پیش‌نویس آزمون با هوش مصنوعی", onBack) }, snackbarHost = { SnackbarHost(snackbar) }) { pad ->
        Column(
            Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            NoticeText("فقط پیش‌نویس ساخته می‌شود. شما آن را ویرایش، آزمایش و تأیید می‌کنید؛ هیچ آزمونی خودکار منتشر نمی‌شود. نام و اطلاعات دانش‌آموزان هرگز ارسال نمی‌شود.")
            OutlinedTextField(prompt, { prompt = it }, label = { Text("مثلاً: از فصل دوم علوم ششم یک آزمون متوسط بساز") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(subject, { subject = it }, label = { Text("درس (اختیاری)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            GradeDropdown("پایه", grade, { grade = it }, allowNone = true)
            OptionDropdown("سطح", Edu.levels, level, { level = it }, allowNone = true)
            AgeField("تعداد سؤال (۳ تا ۲۰)", count, { count = it }, Modifier.fillMaxWidth())
            Button(
                enabled = prompt.trim().length >= 5 && !busy,
                onClick = { onCreate(prompt, subject.ifBlank { null }, grade, level, (parseIntFa(count) ?: 10).coerceIn(3, 20)) },
                modifier = Modifier.fillMaxWidth(),
            ) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("ساخت پیش‌نویس") }
            if (busy) Text("در حال ساخت پیش‌نویس… ممکن است تا یک دقیقه طول بکشد.", style = MaterialTheme.typography.bodySmall)
            OutlinedButton(onClick = onBack, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("انصراف") }
        }
    }
}

/** Dialog content can be taller than the screen on small phones. */
@Composable
internal fun Modifier.verticalScrollCompat(): Modifier = this.then(Modifier.verticalScroll(rememberScrollState()))
