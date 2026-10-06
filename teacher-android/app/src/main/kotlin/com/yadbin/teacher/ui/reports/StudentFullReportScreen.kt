@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.reports

import android.content.Context
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.Jalali
import com.yadbin.teacher.core.utils.ReportPeriods
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.ReportHtml
import com.yadbin.teacher.domain.models.ReportMeta
import com.yadbin.teacher.domain.models.ReportQuery
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * «گزارش جامع پرونده دانش‌آموز»: period / academic-year / custom-range chooser, full | summary, live A4 preview, and print / save-as-PDF.
 * The report itself (numbers, charts, analysis, disclaimer) is built and drawn by the server (`/report/print`); the app never recomputes it.
 * PDF = Android's own print engine (PrintManager) over the same HTML → a real PDF the teacher can save, share or print.
 */
class StudentFullReportViewModel(private val repo: Repository, private val id: String) : ViewModel() {
    private val _html = MutableStateFlow<Ui<ReportHtml>>(Ui.Loading)
    val html: StateFlow<Ui<ReportHtml>> = _html.asStateFlow()
    private val _query = MutableStateFlow(ReportQuery())
    val query: StateFlow<ReportQuery> = _query.asStateFlow()
    private val _meta = MutableStateFlow<ReportMeta?>(null)
    val meta: StateFlow<ReportMeta?> = _meta.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private var job: Job? = null

    init {
        load()
        viewModelScope.launch { _meta.value = try { repo.fullReportMeta(id) } catch (e: ApiException) { null } catch (e: NetworkException) { null } }
    }

    fun setQuery(q: ReportQuery) {
        if (q == _query.value) return
        _query.value = q
        load()
    }

    fun load() {
        job?.cancel()
        job = viewModelScope.launch {
            _busy.value = true
            if (_html.value !is Ui.Ready) _html.value = Ui.Loading
            _html.value = try {
                Ui.Ready(repo.fullReportHtml(id, _query.value))
            } catch (e: ApiException) {
                Ui.Error(errorText(e))
            } catch (e: NetworkException) {
                Ui.Error(errorText(e))
            }
            _busy.value = false
        }
    }
}

@Composable
fun StudentFullReportScreen(studentId: String, onBack: () -> Unit) {
    val c = LocalContainer.current
    val vm: StudentFullReportViewModel = viewModel(key = "full-report-$studentId", factory = VmFactory { StudentFullReportViewModel(c.repository, studentId) })
    val state by vm.html.collectAsStateWithLifecycle()
    val query by vm.query.collectAsStateWithLifecycle()
    val meta by vm.meta.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var webView by remember { mutableStateOf<WebView?>(null) }
    var pageReady by remember { mutableStateOf(false) }
    var customDialog by rememberSaveable { mutableStateOf(false) }
    var hint by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current

    fun print(fileName: String) {
        val wv = webView
        if (wv == null || !pageReady) { hint = "گزارش هنوز کامل بارگذاری نشده است؛ چند لحظه صبر کنید."; return }
        val job = fileName.removeSuffix(".pdf") // becomes the default PDF name in the system dialog
        val pm = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
        pm.print(job, wv.createPrintDocumentAdapter(job), PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).setColorMode(PrintAttributes.COLOR_MODE_COLOR).build())
    }

    Scaffold(topBar = { YadbinTopBar("گزارش جامع دانش‌آموز", onBack) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            meta?.student?.name?.takeIf { it.isNotBlank() }?.let {
                Text(it, Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp), style = MaterialTheme.typography.titleMedium)
            }
            // period: 7d … academic year … custom
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ReportPeriods.ALL.forEach { (code, label) ->
                    if (code == ReportPeriods.YEAR_PREVIOUS && meta?.periodOptions?.hasPreviousYearData != true) return@forEach
                    val text = when (code) {
                        ReportPeriods.YEAR_CURRENT -> meta?.periodOptions?.currentYear?.takeIf { it.isNotBlank() }?.let { "سال تحصیلی $it" } ?: label
                        ReportPeriods.YEAR_PREVIOUS -> meta?.periodOptions?.previousYear?.takeIf { it.isNotBlank() }?.let { "سال تحصیلی $it" } ?: label
                        else -> label
                    }
                    FilterChip(
                        selected = query.period == code, label = { Text(text) },
                        onClick = { if (code == ReportPeriods.CUSTOM) customDialog = true else vm.setQuery(query.copy(period = code, from = null, to = null)) },
                    )
                }
            }
            // type: summary | full
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = query.type == "full", onClick = { vm.setQuery(query.copy(type = "full")) }, label = { Text("گزارش کامل") })
                FilterChip(selected = query.type == "summary", onClick = { vm.setQuery(query.copy(type = "summary")) }, label = { Text("گزارش خلاصه") })
            }
            when (val s = state) {
                Ui.Loading -> LoadingBox(Modifier.weight(1f))
                is Ui.Error -> Box(Modifier.weight(1f)) { ErrorBox(s.message, vm::load) }
                is Ui.Ready -> {
                    Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { print(s.data.fileName) }, modifier = Modifier.weight(1f), enabled = pageReady) { Text("دانلود / ذخیره PDF") }
                        OutlinedButton(onClick = { print(s.data.fileName) }, modifier = Modifier.weight(1f), enabled = pageReady) { Text("چاپ گزارش") }
                    }
                    Text(
                        hint ?: "در پنجرهٔ باز‌شده برای ساخت فایل، «ذخیره به‌صورت PDF» را انتخاب کنید؛ همان‌جا می‌توانید چاپ یا اشتراک‌گذاری هم بزنید.",
                        Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    // live A4 preview of exactly what will be printed
                    AndroidView(
                        modifier = Modifier.weight(1f).fillMaxWidth().padding(top = 8.dp),
                        factory = { ctx ->
                            WebView(ctx).apply {
                                settings.javaScriptEnabled = false // the report has no scripts (and its CSP forbids them)
                                settings.allowFileAccess = false
                                settings.allowContentAccess = false
                                settings.setSupportZoom(true)
                                settings.builtInZoomControls = true
                                settings.displayZoomControls = false
                                settings.useWideViewPort = true
                                settings.loadWithOverviewMode = true
                                webViewClient = object : WebViewClient() {
                                    override fun onPageFinished(view: WebView?, url: String?) { pageReady = true }
                                }
                                webView = this
                            }
                        },
                        update = { wv ->
                            if (wv.tag != s.data.html) {
                                wv.tag = s.data.html
                                pageReady = false
                                wv.loadDataWithBaseURL(null, s.data.html, "text/html", "utf-8", null)
                            }
                        },
                    )
                }
            }
        }
    }
    if (customDialog) CustomRangeDialog(
        onDismiss = { customDialog = false },
        onApply = { from, to -> customDialog = false; vm.setQuery(query.copy(period = ReportPeriods.CUSTOM, from = from, to = to)) },
    )
}

/** Custom range in Jalali (what the teacher thinks in); converted to Gregorian ISO dates for the server. */
@Composable
private fun CustomRangeDialog(onDismiss: () -> Unit, onApply: (from: String, to: String) -> Unit) {
    var from by rememberSaveable { mutableStateOf("") }
    var to by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("بازهٔ سفارشی (تاریخ شمسی)") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(from, { from = it; error = null }, label = { Text("از تاریخ (مثلاً ۱۴۰۵/۰۷/۰۱)") }, singleLine = true, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Text))
                OutlinedTextField(to, { to = it; error = null }, label = { Text("تا تاریخ (مثلاً ۱۴۰۵/۱۲/۲۹)") }, singleLine = true, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Text))
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val a = ReportPeriods.parseJalali(from)?.let { Jalali.toGregorian(it.year, it.month, it.day) }
                val b = ReportPeriods.parseJalali(to)?.let { Jalali.toGregorian(it.year, it.month, it.day) }
                when {
                    a == null || b == null -> error = "تاریخ را به‌صورت سال/ماه/روز و معتبر وارد کنید؛ مثل ۱۴۰۵/۰۷/۰۱."
                    a.iso() > b.iso() -> error = "تاریخ شروع باید قبل از تاریخ پایان باشد."
                    else -> onApply(a.iso(), b.iso())
                }
            }) { Text("نمایش گزارش") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
}
