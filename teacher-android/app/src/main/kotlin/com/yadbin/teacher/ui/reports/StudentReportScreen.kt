@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.reports

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.utils.Labels
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.core.utils.percentFa
import com.yadbin.teacher.core.utils.secondsFa
import com.yadbin.teacher.core.utils.jalaliFa
import com.yadbin.teacher.domain.models.HistoryItem
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.SeriesPoint
import com.yadbin.teacher.domain.models.SkillCard
import com.yadbin.teacher.domain.models.StudentReport
import com.yadbin.teacher.domain.models.Suggestion
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class StudentReportViewModel(private val repo: Repository, private val id: String) : ViewModel() {
    private val _state = MutableStateFlow<Ui<StudentReport>>(Ui.Loading)
    val state: StateFlow<Ui<StudentReport>> = _state.asStateFlow()
    private val _history = MutableStateFlow<List<HistoryItem>>(emptyList())
    val history: StateFlow<List<HistoryItem>> = _history.asStateFlow()
    init { refresh() }
    fun refresh() {
        viewModelScope.launch {
            if (_state.value !is Ui.Ready) _state.value = Ui.Loading
            _state.value = loadUi { repo.studentReport(id) }
            // History is a bonus section: a failure here must not hide the report.
            try { _history.value = repo.studentHistory(id).data.history } catch (e: Exception) { /* keep previous */ }
        }
    }
}

@Composable
fun StudentReportScreen(studentId: String, onBack: () -> Unit) {
    val c = LocalContainer.current
    val vm: StudentReportViewModel = viewModel(key = "student-$studentId", factory = VmFactory { StudentReportViewModel(c.repository, studentId) })
    val state by vm.state.collectAsStateWithLifecycle()
    val history by vm.history.collectAsStateWithLifecycle()
    val title = (state as? Ui.Ready)?.data?.student?.name ?: "گزارش دانش‌آموز"

    Scaffold(topBar = { YadbinTopBar(title, onBack) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            when (val s = state) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(s.message, vm::refresh)
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    ReportContent(s.data, history)
                }
            }
        }
    }
}

@Composable
private fun ReportContent(r: StudentReport, history: List<HistoryItem>) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("عملکرد مشاهده‌شده", style = MaterialTheme.typography.titleLarge)
        Text("فعالیت‌های انجام‌شده: ${r.completedActivities.fa()}", style = MaterialTheme.typography.bodyMedium)
        if (r.summary.sessions > 0) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("خلاصه", style = MaterialTheme.typography.titleMedium)
                    Metric("تعداد موفقیت‌ها", "${r.summary.successes.fa()} از ${r.summary.sessions.fa()}")
                    if (r.summary.sufficientData) r.summary.performance?.let { Metric("درصد عملکرد", it.percentFa()) }
                    else Text("برای نمایش درصد عملکرد، فعالیت‌های بیشتری لازم است.", style = MaterialTheme.typography.bodySmall)
                    Metric("زمان صرف‌شده", "${r.summary.timeSpentMinutes.fa()} دقیقه")
                }
            }
        }
        if (r.notice.isNotBlank()) {
            Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) {
                Text(r.notice, Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
            }
        }
        r.skills.forEach { SkillCardView(it) }

        if (history.isNotEmpty()) {
            Text("تاریخچه‌ی فعالیت‌ها", style = MaterialTheme.typography.titleMedium)
            history.take(20).forEach { h ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text(h.title.ifBlank { Labels.game(h.gameType) }, style = MaterialTheme.typography.titleSmall)
                        val state = when (h.status) { "completed" -> "انجام شد"; "started" -> "در حال انجام"; else -> "شروع نشده" }
                        val date = (h.completedAt ?: h.startedAt).jalaliFa().takeIf { it.isNotBlank() }
                        Text(listOfNotNull(state, date).joinToString(" • "), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }

        Text("پیشنهاد سیستم", style = MaterialTheme.typography.titleMedium)
        if (r.suggestions.isEmpty()) {
            Text(r.suggestionFallback ?: "برای ارائه پیشنهاد، فعالیت‌های بیشتری لازم است.", style = MaterialTheme.typography.bodyMedium)
        } else {
            r.suggestions.forEach { SuggestionView(it) }
            Text("تصمیم نهایی با معلم است.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun SuggestionView(s: Suggestion) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text("${s.label} • ${Labels.game(s.gameType)} • ${Labels.difficulty(s.difficultyMode)}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(4.dp))
            Text(s.text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun SkillCardView(k: SkillCard) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(k.title, style = MaterialTheme.typography.titleMedium)
            Text("بازی: ${k.gameName}", style = MaterialTheme.typography.bodySmall)
            Text("وضعیت: ${k.statusLabel}", style = MaterialTheme.typography.titleSmall)
            Text("تعداد جلسه: ${k.sessionCount.fa()}   •   تعداد نمونه: ${k.sampleCount.fa()}", style = MaterialTheme.typography.bodySmall)

            if (!k.sufficientData) {
                // No numbers and no conclusions from insufficient data.
                Text(k.message ?: "داده کافی نیست.", style = MaterialTheme.typography.bodyMedium)
            } else {
                k.accuracy?.let { Metric("دقت", it.percentFa()) }
                k.averageResponseTime?.let { Metric("میانگین زمان پاسخ", it.secondsFa()) }
                k.highestDifficulty?.let { Metric("بالاترین سطح رسیده‌شده", it.toInt().fa()) }
                k.independentAccuracy?.let { Metric("دقت مستقل (بدون راهنمایی)", it.percentFa()) }
                k.guidedAccuracy?.let { Metric("دقت با راهنمایی", it.percentFa()) }
                k.helpResponsiveness?.let { Metric("پاسخ‌دهی پس از راهنمایی", it.percentFa()) }
                k.ruleAdaptation?.let { Metric("سازگاری با تغییر قانون", it.percentFa()) }
                k.reverseTaskAccuracy?.let { Metric("دقت در حالت معکوس", it.percentFa()) }
            }

            HorizontalDivider()
            Text(k.trend.title, style = MaterialTheme.typography.titleSmall)   // «روند عملکرد مشاهده‌شده»
            Text(k.trend.label, style = MaterialTheme.typography.bodySmall)
            k.trend.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary) }
            // The chart is only drawn from 2 sessions on.
            if (k.series.size >= 2) TrendChart(k.series)
        }
    }
}

@Composable
private fun Metric(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.titleSmall)
    }
}

/** Accuracy per session (0–100٪). Descriptive only — a personal history, never a comparison between students. */
@Composable
private fun TrendChart(series: List<SeriesPoint>) {
    val pts = series.mapNotNull { p -> p.accuracy?.let { p.session to it.coerceIn(0.0, 1.0) } }
    if (pts.size < 2) return
    val line = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    Canvas(Modifier.fillMaxWidth().height(120.dp).padding(vertical = 8.dp)) {
        val w = size.width; val h = size.height
        for (g in listOf(0f, 0.5f, 1f)) drawLine(grid, Offset(0f, h - g * h), Offset(w, h - g * h), strokeWidth = 1f)
        val n = pts.size
        fun px(i: Int) = if (n == 1) w / 2 else i * (w / (n - 1))
        fun py(v: Double) = (h - v.toFloat() * h)
        val path = Path()
        pts.forEachIndexed { i, p -> if (i == 0) path.moveTo(px(i), py(p.second)) else path.lineTo(px(i), py(p.second)) }
        drawPath(path, line, style = Stroke(width = 4f))
        pts.forEachIndexed { i, p -> drawCircle(line, radius = 7f, center = Offset(px(i), py(p.second))) }
    }
    Text("جلسه ۱ تا ${pts.size.fa()}", style = MaterialTheme.typography.labelSmall)
}
