@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.reports

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.Alignment
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
import com.yadbin.teacher.core.utils.relativeDayFa
import com.yadbin.teacher.core.utils.secondsFa
import com.yadbin.teacher.core.utils.jalaliFa
import com.yadbin.teacher.core.utils.jalaliDateTimeFa
import com.yadbin.teacher.domain.models.HistoryItem
import com.yadbin.teacher.domain.models.ActivityPrefill
import com.yadbin.teacher.domain.models.EducationalProfile
import com.yadbin.teacher.domain.models.Recommendation
import com.yadbin.teacher.domain.models.RecommendationsResponse
import com.yadbin.teacher.core.utils.Edu
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
    private val _profile = MutableStateFlow<EducationalProfile?>(null)
    val profile: StateFlow<EducationalProfile?> = _profile.asStateFlow()
    private val _recs = MutableStateFlow<RecommendationsResponse?>(null)
    val recs: StateFlow<RecommendationsResponse?> = _recs.asStateFlow()
    init { refresh() }
    fun refresh() {
        viewModelScope.launch {
            if (_state.value !is Ui.Ready) _state.value = Ui.Loading
            _state.value = loadUi { repo.studentReport(id) }
            // History is a bonus section: a failure here must not hide the report.
            try { _history.value = repo.studentHistory(id).data.history } catch (e: Exception) { /* keep previous */ }
            // v1.2 sections are optional too (older server / offline): the classic report always stays visible.
            try { _profile.value = repo.studentProfile(id).data } catch (e: Exception) { /* keep previous */ }
            try { _recs.value = repo.recommendations(id).data } catch (e: Exception) { /* keep previous */ }
        }
    }
}

@Composable
fun StudentReportScreen(studentId: String, classId: String? = null, onBack: () -> Unit, onCreateActivity: () -> Unit = {}, onAiBuilder: () -> Unit = {}, onOpenGrowth: () -> Unit = {}, onOpenFullReport: () -> Unit = {}) {
    val c = LocalContainer.current
    val vm: StudentReportViewModel = viewModel(key = "student-$studentId", factory = VmFactory { StudentReportViewModel(c.repository, studentId) })
    val state by vm.state.collectAsStateWithLifecycle()
    val history by vm.history.collectAsStateWithLifecycle()
    val profile by vm.profile.collectAsStateWithLifecycle()
    val recs by vm.recs.collectAsStateWithLifecycle()
    val title = (state as? Ui.Ready)?.data?.student?.name ?: "گزارش دانش‌آموز"

    Scaffold(topBar = { YadbinTopBar(title, onBack) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            when (val s = state) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(s.message, vm::refresh)
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    ReportContent(s.data, history, profile, recs, classId != null, { r -> c.prefill = ActivityPrefill(templateId = r.templateId, gameType = r.gameType, difficultyMode = r.difficultyMode, level = r.level, skills = listOf(r.skill), studentId = studentId); onCreateActivity() }, onAiBuilder, onOpenGrowth, onOpenFullReport)
                }
            }
        }
    }
}

@Composable
private fun ReportContent(
    r: StudentReport, history: List<HistoryItem>, profile: EducationalProfile?, recs: RecommendationsResponse?,
    canCreate: Boolean, onUseRecommendation: (Recommendation) -> Unit, onAiBuilder: () -> Unit, onOpenGrowth: () -> Unit, onOpenFullReport: () -> Unit,
) {
    var editAvatar by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        StudentHeader(r, profile, onAvatar = { editAvatar = true })
        if (editAvatar) AvatarEditorDialog(r.student.id, r.student.name, profile?.student?.gender) { editAvatar = false }
        profile?.let { ProfileCard(it) }
        GrowthEntryCard(onOpenGrowth)
        FullReportEntryCard(onOpenFullReport)
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

        OverallTrendCard(history)
        RecentActivities(history)
        com.yadbin.teacher.ui.assessments.StudentAssessmentsSection(r.student.id) // separate from the cognitive indicators

        if (recs != null && recs.recommendations.isNotEmpty()) {
            Text("پیشنهاد فعالیت بعدی", style = MaterialTheme.typography.titleMedium)
            recs.recommendations.forEach { RecommendationCard(it, canCreate, onUseRecommendation) }
            NoticeText(recs.notice.ifBlank { "این‌ها فقط پیشنهاد هستند؛ فعالیت بدون ویرایش و تأیید شما ساخته نمی‌شود." })
            if (canCreate) OutlinedButton(onClick = onAiBuilder, modifier = Modifier.fillMaxWidth()) { Text("ساخت فعالیت با هوش مصنوعی برای این دانش‌آموز") }
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


/** Educational profile: performance INDICATORS from activities - never a medical or psychological assessment. */
/** Top of the student profile (spec §10): picture/avatar, name, grade • age, and three headline numbers. */
@Composable
private fun StudentHeader(r: StudentReport, profile: EducationalProfile?, onAvatar: () -> Unit) {
    val st = profile?.student
    val sub = listOfNotNull(st?.gradeLabel, st?.age?.let { (if (st.ageApproximate) "حدود " else "") + it.fa() + " ساله" }).joinToString(" • ")
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        StudentAvatar(r.student.id, size = 96.dp, gender = st?.gender, onClick = onAvatar)
        Text(r.student.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (sub.isNotBlank()) Text(sub, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(4.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HeaderStat("فعالیت‌ها", r.completedActivities.fa(), Modifier.weight(1f))
            HeaderStat("آخرین فعالیت", r.lastActivityAt.relativeDayFa().ifBlank { "—" }, Modifier.weight(1f))
            HeaderStat("میانگین عملکرد", if (r.summary.sufficientData) r.summary.performance?.percentFa() ?: "—" else "—", Modifier.weight(1f))
        }
    }
}

@Composable
private fun HeaderStat(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(modifier, color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.padding(vertical = 10.dp, horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

@Composable
private fun ProfileCard(p: EducationalProfile) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("پروفایل آموزشی", style = MaterialTheme.typography.titleMedium)
            if (p.student.gradeLabel == null && p.student.age == null) Text("سن و پایه ثبت نشده است؛ از منوی دانش‌آموز در صفحه‌ی کلاس می‌توانید آن را اضافه کنید.", style = MaterialTheme.typography.bodySmall)
            if (p.skills.isNotEmpty()) SkillGrid(p.skills)
            if (p.summary.text.isNotBlank()) {
                Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) {
                    Text(p.summary.text, Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (p.assessments.count > 0) {
                Text("آزمون‌های معلم", style = MaterialTheme.typography.titleSmall)
                Metric("تعداد آزمون‌های انجام‌شده", p.assessments.count.fa())
                p.assessments.average?.let { Metric("میانگین نمره", "${it.toInt().fa()}٪") }
                p.assessments.last?.let { Metric("نمرهٔ آخرین آزمون", "${it.toInt().fa()}٪") }
                p.assessments.subjects.forEach { s -> Text("${s.subject}: ${s.count.fa()} آزمون • میانگین ${s.average.toInt().fa()}٪", style = MaterialTheme.typography.bodySmall) }
            }
            NoticeText(p.notice)
        }
    }
}

@Composable
private fun RecommendationCard(r: Recommendation, canCreate: Boolean, onUse: (Recommendation) -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(r.text, style = MaterialTheme.typography.titleSmall)
            if (r.reason.isNotBlank()) Text(r.reason, style = MaterialTheme.typography.bodySmall)
            InfoChips(listOfNotNull(Labels.game(r.gameType), r.levelLabel.ifBlank { Edu.levelLabel(r.level) }, r.templateTitle))
            FitBadge(r.fit)
            if (canCreate) TextButton(onClick = { onUse(r) }) { Text("ویرایش و ساخت این فعالیت") }
        }
    }
}

// ---- v1.2 UI step 3: profile skills grid, overall trend, recent activities (spec §11–13) ----------

private fun toneOf(status: String): Tone? = when (status) {
    "good" -> Tone.Success
    "average" -> Tone.Info
    "needs_practice" -> Tone.Warning // calm amber; never red, never a label on the child
    else -> null
}

/** Current skills as small cards, two per row. Wording is always «عملکرد اخیر» — observed performance only, never a diagnosis. */
@Composable
private fun SkillGrid(skills: List<com.yadbin.teacher.domain.models.SkillIndicator>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        skills.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { k ->
                    val word = k.statusLabel.ifBlank { Edu.performanceLabel(k.status) }
                    Surface(Modifier.weight(1f), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f), shape = MaterialTheme.shapes.medium) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(k.label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 2)
                            Text("عملکرد اخیر", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            val tone = toneOf(k.status)
                            if (tone != null) StatusChip(word, tone) else StatusChip(word)
                        }
                    }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

private fun doneWithAccuracy(history: List<HistoryItem>): List<Pair<HistoryItem, Double>> =
    history.filter { it.status == "completed" && it.accuracy != null }
        .sortedBy { it.completedAt ?: it.startedAt ?: "" } // oldest → newest (ISO strings sort correctly)
        .map { it to it.accuracy!!.coerceIn(0.0, 1.0) }

/** One simple line over the student's finished activities (oldest → newest). Drawn only from 2 points on; no statistics, no comparison. */
@Composable
private fun OverallTrendCard(history: List<HistoryItem>) {
    val pts = doneWithAccuracy(history).takeLast(12)
    if (pts.size < 2) return
    val line = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    Card(Modifier.fillMaxWidth(), shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("روند عملکرد فعالیت‌ها", style = MaterialTheme.typography.titleMedium)
            Canvas(Modifier.fillMaxWidth().height(110.dp).padding(vertical = 8.dp)) {
                val w = size.width; val h = size.height
                for (g in listOf(0f, 0.5f, 1f)) drawLine(grid, Offset(0f, h - g * h), Offset(w, h - g * h), strokeWidth = 1f)
                val n = pts.size
                // RTL reading order: the newest activity is on the left, earlier ones continue to the right
                fun px(i: Int) = w - i * (w / (n - 1))
                fun py(v: Double) = h - v.toFloat() * h
                val path = Path()
                pts.forEachIndexed { i, p -> if (i == 0) path.moveTo(px(i), py(p.second)) else path.lineTo(px(i), py(p.second)) }
                drawPath(path, line, style = Stroke(width = 4f))
                pts.forEachIndexed { i, p -> drawCircle(line, radius = 7f, center = Offset(px(i), py(p.second))) }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("فعالیت‌های قبلی", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("آخرین فعالیت", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text("خلاصه‌ای از دقت پاسخ‌ها در فعالیت‌های یادبین؛ برای دیدن روند کلی است، نه ارزیابی دانش‌آموز.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun RecentActivities(history: List<HistoryItem>) {
    if (history.isEmpty()) return
    SectionTitle("فعالیت‌های اخیر")
    val recent = history.sortedByDescending { it.completedAt ?: it.startedAt ?: "" }.take(8)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        recent.forEach { h ->
            val done = h.status == "completed"
            val started = h.status == "started"
            val whenText = (h.completedAt ?: h.startedAt).relativeDayFa()
            val game = h.gameName.ifBlank { Labels.game(h.gameType) }
            Card(Modifier.fillMaxWidth(), shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp)) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(h.title.ifBlank { game }, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        Text(listOf(game, whenText).filter { it.isNotBlank() }.joinToString(" • "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        if (done && h.accuracy != null && h.sampleCount > 0) {
                            Text("دقت پاسخ‌ها: ${h.accuracy.percentFa()}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    when {
                        done -> StatusChip("انجام شد", Tone.Success)
                        started -> StatusChip("در حال انجام", Tone.Info)
                        else -> StatusChip("شروع نشده")
                    }
                }
            }
        }
    }
}

/** Entry to «روند رشد و تحلیل»: this student compared with their own past (never with other students). */
@Composable
private fun GrowthEntryCard(onOpen: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onOpen), shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("روند رشد و تحلیل", style = MaterialTheme.typography.titleMedium)
            Text("تغییر عملکرد ثبت‌شدهٔ این دانش‌آموز در طول زمان، نسبت به گذشتهٔ خودش.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Entry to «گزارش جامع پرونده دانش‌آموز»: academic year / custom range, summary or full, print and save as PDF. */
@Composable
private fun FullReportEntryCard(onOpen: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onOpen), shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("گزارش جامع پرونده دانش‌آموز", style = MaterialTheme.typography.titleMedium)
            Text("گزارش سال تحصیلی یا بازهٔ دلخواه با نمودار رشد، روند مهارت‌ها و آزمون‌های درسی؛ قابل چاپ و ذخیره به‌صورت PDF.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
