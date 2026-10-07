@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.growth

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.Growth
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.core.utils.jalaliDateTimeFa
import com.yadbin.teacher.core.utils.jalaliFa
import com.yadbin.teacher.core.utils.relativeDayFa
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.*
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** State of the optional AI wording of the analysis. The rule-based text is always available underneath. */
sealed interface GrowthAiState {
    data object Idle : GrowthAiState
    data object Loading : GrowthAiState
    data class Done(val summary: GrowthSummary) : GrowthAiState
    data class Failed(val message: String) : GrowthAiState
}

class StudentGrowthViewModel(private val repo: Repository, private val id: String) : ViewModel() {
    private val _state = MutableStateFlow<Ui<StudentGrowth>>(Ui.Loading)
    val state: StateFlow<Ui<StudentGrowth>> = _state.asStateFlow()
    private val _query = MutableStateFlow(GrowthQuery())
    val query: StateFlow<GrowthQuery> = _query.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _ai = MutableStateFlow<GrowthAiState>(GrowthAiState.Idle)
    val ai: StateFlow<GrowthAiState> = _ai.asStateFlow()
    private var job: Job? = null

    init { load() }

    fun setQuery(q: GrowthQuery) {
        if (q == _query.value) return
        _query.value = q
        _ai.value = GrowthAiState.Idle // an AI text belongs to the filters it was made for
        load()
    }

    fun load() {
        job?.cancel()
        job = viewModelScope.launch {
            _busy.value = true
            if (_state.value !is Ui.Ready) _state.value = Ui.Loading
            _state.value = try {
                val l = repo.studentGrowth(id, _query.value)
                Ui.Ready(l.data, l.fromCache)
            } catch (e: com.yadbin.teacher.core.network.ApiException) {
                // A bare 404 «یافت نشد.» (error code not_found, no student/assessment name) means the server has no growth endpoint yet.
                if (e.status == 404 && e.message.orEmpty().trim() == "یافت نشد.") Ui.Error("سرور هنوز به نسخهٔ جدید «روند رشد و تحلیل» به‌روز نشده است. پس از به‌روزرسانی سرور دوباره تلاش کنید.")
                else Ui.Error(errorText(e))
            } catch (e: com.yadbin.teacher.core.network.NetworkException) {
                Ui.Error(errorText(e))
            }
            _busy.value = false
        }
    }

    fun summarize() {
        if (_ai.value is GrowthAiState.Loading) return
        viewModelScope.launch {
            _ai.value = GrowthAiState.Loading
            _ai.value = try {
                GrowthAiState.Done(repo.growthSummary(id, _query.value))
            } catch (e: ApiException) {
                GrowthAiState.Failed(errorText(e))
            } catch (e: NetworkException) {
                GrowthAiState.Failed(errorText(e))
            }
        }
    }
}

private val TABS = listOf("نمای کلی", "روند عملکرد", "مهارت‌ها", "فعالیت‌ها", "آزمون‌های درسی", "تحلیل")
private const val TAB_ASSESSMENTS = 4

@Composable
fun StudentGrowthScreen(studentId: String, studentName: String? = null, classId: String? = null, onBack: () -> Unit, onCreateActivity: () -> Unit = {}, onOpenReport: () -> Unit = {}) {
    val c = LocalContainer.current
    val vm: StudentGrowthViewModel = viewModel(key = "growth-$studentId", factory = VmFactory { StudentGrowthViewModel(c.repository, studentId) })
    val state by vm.state.collectAsStateWithLifecycle()
    val query by vm.query.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val ai by vm.ai.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(0) }

    Scaffold(topBar = { YadbinTopBar("روند رشد و تحلیل", onBack) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            when (val s = state) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(s.message, vm::load)
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    FilterBar(s.data, query, tab, vm::setQuery)
                    TextButton(onClick = onOpenReport, modifier = Modifier.padding(horizontal = 8.dp)) { Text("گزارش جامع سال تحصیلی / چاپ و PDF") }
                    ScrollableTabRow(selectedTabIndex = tab, edgePadding = 8.dp, containerColor = androidx.compose.ui.graphics.Color.Transparent) {
                        TABS.forEachIndexed { i, t ->
                            Tab(selected = tab == i, onClick = { tab = i }, text = { Text(t, fontWeight = if (tab == i) FontWeight.Bold else FontWeight.Normal) })
                        }
                    }
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (!studentName.isNullOrBlank()) Text(studentName, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        when (tab) {
                            0 -> OverviewTab(s.data)
                            1 -> TimelineTab(s.data)
                            2 -> SkillsTab(s.data)
                            3 -> ActivitiesTab(s.data)
                            4 -> AssessmentsTab(s.data)
                            else -> AnalysisTab(
                                g = s.data, ai = ai, onSummarize = vm::summarize,
                                canCreate = classId != null,
                                onUseSuggestion = { sug ->
                                    c.prefill = ActivityPrefill(
                                        templateId = sug.prefill.templateId, gameType = sug.prefill.gameType ?: sug.gameType,
                                        level = sug.prefill.level ?: sug.level, skills = sug.prefill.skills, studentId = studentId,
                                    )
                                    onCreateActivity()
                                },
                            )
                        }
                        NoticeText(s.data.notice)
                    }
                }
            }
        }
    }
}

// ---- filters (simple, mobile-friendly: the range is always visible, the rest is one tap away) -------------

@Composable
private fun FilterBar(g: StudentGrowth, q: GrowthQuery, tab: Int, onChange: (GrowthQuery) -> Unit) {
    var more by rememberSaveable { mutableStateOf(false) }
    val av = g.filters.available
    val onAssessments = tab == TAB_ASSESSMENTS
    val hasMore = if (onAssessments) av.subjects.isNotEmpty() else (av.games.isNotEmpty() || av.levels.isNotEmpty())
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        ChipRow(Growth.RANGES.map { it.first to it.second }, q.range) { code -> if (code != null) onChange(q.copy(range = code)) }
        if (hasMore) {
            TextButton(onClick = { more = !more }, modifier = Modifier.padding(horizontal = 8.dp)) {
                val active = if (onAssessments) q.subject != null else (q.game != null || q.level != null)
                Text(if (more) "بستن فیلترها" else if (active) "فیلترها (فعال)" else "فیلترهای بیشتر")
            }
            if (more) {
                if (onAssessments) {
                    Text("درس", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.labelMedium)
                    ChipRow(listOf<Pair<String?, String>>(null to "همه") + av.subjects.map { it to it }, q.subject) { onChange(q.copy(subject = it)) }
                } else {
                    if (av.games.isNotEmpty()) {
                        Text("مهارت", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.labelMedium)
                        ChipRow(listOf<Pair<String?, String>>(null to "همه") + av.games.map { it.code to it.label }, q.game) { onChange(q.copy(game = it)) }
                    }
                    if (av.levels.isNotEmpty()) {
                        Text("سطح", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.labelMedium)
                        ChipRow(listOf<Pair<String?, String>>(null to "همه") + av.levels.map { it.code to it.label }, q.level) { onChange(q.copy(level = it)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChipRow(options: List<Pair<String?, String>>, selected: String?, onSelect: (String?) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (code, label) ->
            FilterChip(selected = selected == code, onClick = { onSelect(code) }, label = { Text(label) })
        }
    }
}

// ---- 1. overview -------------------------------------------------------------------------------------------

@Composable
private fun OverviewTab(g: StudentGrowth) {
    val o = g.overview
    if (o.activityCount == 0 && o.assessmentCount == 0) {
        MessageCard(Growth.MSG_NOT_ENOUGH_RANGE)
        return
    }
    val stats = buildList {
        add("عملکرد فعلی" to (o.cognitiveAverage?.let { Growth.percent(it) } ?: "—"))
        add("تغییر نسبت به دورهٔ قبل" to (o.changeVsPrevious?.let { Growth.pointsPhrase(it.points) } ?: "—"))
        add("فعالیت انجام‌شده" to o.activityCount.fa())
        add("آزمون درسی" to o.assessmentCount.fa())
        add("آخرین عملکرد ثبت‌شده" to (o.lastPerformance?.let { Growth.percent(it) } ?: "—"))
        add("روزهای دارای فعالیت" to o.activeDays.fa())
        add("آخرین فعالیت" to o.lastActivityAt.relativeDayFa().ifBlank { "—" })
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        stats.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (label, value) -> StatCard(label, value, Modifier.weight(1f)) }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
    if (o.changeVsPrevious == null) o.changeNote?.let { NoticeText(it) }
    o.startVsCurrent?.let { sc ->
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("شروع دوره و وضعیت فعلی", style = MaterialTheme.typography.titleMedium)
                KeyValue("شروع دوره", Growth.percent(sc.startPercent))
                KeyValue("وضعیت فعلی", Growth.percent(sc.currentPercent))
                KeyValue("تغییر", o.startVsCurrentLabel ?: Growth.pointsPhrase(sc.changePoints))
                NoticeText("تغییر به «واحد درصد» است و با «درصد نسبی» تفاوت دارد.")
            }
        }
    }
    if (o.activityCount in 1..2) NoticeText(Growth.MSG_NOT_ENOUGH_ACTIVITIES)
    if (o.cognitiveAverage == null && o.activityCount > 0) NoticeText("برای نمایش میانگین عملکرد، پاسخ‌های بیشتری لازم است.")
}

// ---- 2. performance trend chart ----------------------------------------------------------------------------

@Composable
private fun TimelineTab(g: StudentGrowth) {
    val t = g.cognitive.timeline
    SectionTitle("روند عملکرد در فعالیت‌های شناختی")
    if (!t.available || t.points.size < 2) {
        MessageCard(t.message ?: Growth.MSG_NOT_ENOUGH_ACTIVITIES)
        return
    }
    var selected by remember(t) { mutableStateOf<Int?>(null) }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TrendLine(t.trend)
            GrowthLineChart(t.points.map { it.percent }, selected, { selected = it }, height = 180.dp)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                // RTL: the first child sits on the right = the oldest point
                Text(t.points.first().bucketStart.jalaliFa(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(t.points.last().bucketStart.jalaliFa(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            NoticeText("محور عمودی: درصد عملکرد (۰ تا ۱۰۰) • محور افقی: زمان؛ " + bucketNote(t.bucket) + " برای دیدن جزئیات، روی یک نقطه بزنید.")
        }
    }
    selected?.let { i -> t.points.getOrNull(i)?.let { PointDetail(it, t.bucket) } }
}

private fun bucketNote(bucket: String) = when (bucket) {
    "day" -> "هر نقطه میانگین یک روز است."
    "week" -> "هر نقطه میانگین یک هفته است."
    else -> "هر نقطه میانگین یک بلوک ۴ هفته‌ای است."
}

@Composable
private fun PointDetail(p: GrowthPoint, bucket: String) {
    val whenText = when (bucket) {
        "day" -> p.bucketStart.jalaliFa()
        "week" -> "هفتهٔ شروع از ${p.bucketStart.jalaliFa()}"
        else -> "بلوک ۴ هفته‌ای از ${p.bucketStart.jalaliFa()}"
    }
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(whenText, style = MaterialTheme.typography.titleSmall)
            KeyValue("میانگین عملکرد", Growth.percent(p.percent))
            KeyValue("تعداد فعالیت", p.results.fa())
            KeyValue("تعداد پاسخ", p.samples.fa())
            p.averageResponseSeconds?.let { KeyValue("میانگین زمان پاسخ", Growth.seconds(it)) }
            p.byGame.entries.sortedBy { it.key }.forEach { (game, b) ->
                KeyValue(Growth.gameLabel(game), "${Growth.percent(b.percent)} (${b.results.fa()} فعالیت)")
            }
        }
    }
}

// ---- 3. skills ---------------------------------------------------------------------------------------------

@Composable
private fun SkillsTab(g: StudentGrowth) {
    SectionTitle("رشد در مهارت‌های ثبت‌شده")
    val skills = g.cognitive.skills
    if (skills.isEmpty()) {
        MessageCard(g.cognitive.skillsMessage ?: Growth.MSG_NOT_ENOUGH_RANGE)
        return
    }
    skills.forEach { k ->
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("${k.skill} ${Growth.trendArrow(k.trend.direction)}", style = MaterialTheme.typography.titleMedium)
                    TrendChip(k.trend.direction)
                }
                if (k.sufficient && k.start != null && k.current != null) {
                    KeyValue("شروع", Growth.percent(k.start))
                    KeyValue("اکنون", Growth.percent(k.current))
                    KeyValue("تغییر", k.changeLabel ?: Growth.pointsPhrase(k.changePoints ?: 0.0))
                    k.responseTime?.let {
                        KeyValue("زمان پاسخ", "از ${Growth.seconds(it.startSeconds)} به ${Growth.seconds(it.currentSeconds)}")
                    }
                    if (k.series.size >= 3) GrowthLineChart(k.series.map { it.percent }, null, null, height = 90.dp)
                } else {
                    Text("تعداد نتیجهٔ ثبت‌شده: ${k.results.fa()}", style = MaterialTheme.typography.bodyMedium)
                    NoticeText(Growth.MSG_NOT_ENOUGH_ACTIVITIES)
                }
            }
        }
    }
    NoticeText("فقط مهارت‌هایی نمایش داده می‌شوند که در این بازه نتیجهٔ معتبر دارند. این‌ها توصیف آماریِ عملکرد ثبت‌شده‌اند، نه تشخیص.")
}

// ---- 4. activities -----------------------------------------------------------------------------------------

@Composable
private fun ActivitiesTab(g: StudentGrowth) {
    val a = g.cognitive.activities
    var open by remember { mutableStateOf<GrowthActivity?>(null) }
    if (a.recent.isEmpty()) {
        MessageCard("در این بازه فعالیت معتبری ثبت نشده است.")
        return
    }
    if (a.mostChanged.isNotEmpty()) {
        SectionTitle("بیشترین تغییر نسبت به نتیجهٔ قبلیِ همان مهارت")
        a.mostChanged.forEach { ActivityCard(it) { open = it } }
    }
    SectionTitle("فعالیت‌های اخیر")
    a.recent.forEach { ActivityCard(it) { open = it } }
    open?.let { ActivityDialog(it) { open = null } }
}

@Composable
private fun ActivityCard(a: GrowthActivity, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(a.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    listOf(a.date.jalaliFa(), a.skill, a.levelLabel).filter { it.isNotBlank() }.joinToString(" • "),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                a.averageResponseSeconds?.let { Text("زمان پاسخ: ${Growth.seconds(it)}", style = MaterialTheme.typography.bodySmall) }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(Growth.percent(a.percent), style = MaterialTheme.typography.titleMedium)
                a.changePoints?.let { StatusChip(Growth.signedPoints(it) + " واحد") }
            }
        }
    }
}

@Composable
private fun ActivityDialog(a: GrowthActivity, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(a.title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                KeyValue("تاریخ", a.date.jalaliDateTimeFa())
                if (a.skill.isNotBlank()) KeyValue("مهارت هدف", a.skill)
                if (a.levelLabel.isNotBlank()) KeyValue("سطح", a.levelLabel)
                KeyValue("عملکرد", Growth.percent(a.percent))
                KeyValue("تعداد پاسخ", a.answers.fa())
                a.averageResponseSeconds?.let { KeyValue("میانگین زمان پاسخ", Growth.seconds(it)) }
                a.difficultyReached?.let { KeyValue("بالاترین سطح رسیده‌شده", it.toInt().fa()) }
                a.changePoints?.let { KeyValue("تغییر نسبت به نتیجهٔ قبلی همین مهارت", Growth.pointsPhrase(it)) }
                KeyValue("وضعیت", a.statusLabel.ifBlank { "انجام‌شده" })
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("بستن") } },
    )
}

// ---- 5. academic assessments (kept apart from the cognitive data) --------------------------------------------

@Composable
private fun AssessmentsTab(g: StudentGrowth) {
    val a = g.assessments
    SectionTitle(a.title)
    if (a.count == 0) {
        MessageCard(a.message ?: "در این بازه آزمون درسیِ انجام‌شده‌ای ثبت نشده است.")
        NoticeText(a.note)
        return
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StatCard("تعداد آزمون", a.count.fa(), Modifier.weight(1f))
        StatCard("میانگین نمره", a.average?.let { Growth.percent(it) } ?: "—", Modifier.weight(1f))
        StatCard("آخرین نمره", a.last?.let { Growth.percent(it) } ?: "—", Modifier.weight(1f))
    }
    if (a.chartAvailable && a.series.size >= 2) {
        var selected by remember(a) { mutableStateOf<Int?>(null) }
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("روند نمرات", style = MaterialTheme.typography.titleSmall)
                GrowthLineChart(a.series.map { it.percent }, selected, { selected = it }, height = 150.dp)
                selected?.let { i ->
                    a.series.getOrNull(i)?.let { p ->
                        Text("${p.subject} • ${p.at.jalaliFa()} • ${Growth.percent(p.percent)}", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    } else a.message?.let { NoticeText(it) }
    a.subjects.forEach { s ->
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(s.subject, style = MaterialTheme.typography.titleMedium)
                    if (s.exams.size >= 3) TrendChip(s.trend.direction)
                }
                Text("${s.count.fa()} آزمون • میانگین ${Growth.percent(s.average)}", style = MaterialTheme.typography.bodySmall)
                Text(Growth.examLine(s), style = MaterialTheme.typography.bodyMedium)
                s.changePoints?.let { Text("تغییر از اولین تا آخرین آزمون: ${s.changeLabel ?: Growth.pointsPhrase(it)}", style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
    NoticeText(a.note.ifBlank { "نمرهٔ آزمون‌های درسی در شاخص‌های شناختی هیچ نقشی ندارد." })
}

// ---- 6. analysis + educational suggestion ------------------------------------------------------------------

@Composable
private fun AnalysisTab(g: StudentGrowth, ai: GrowthAiState, onSummarize: () -> Unit, canCreate: Boolean, onUseSuggestion: (GrowthSuggestion) -> Unit) {
    val an = g.analysis
    SectionTitle("تحلیل عملکرد")
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(an.text.ifBlank { "برای ارائه تحلیل قابل اعتماد، فعالیت‌های بیشتری لازم است." }, style = MaterialTheme.typography.bodyLarge)
            an.statements.drop(1).forEach { Text("• " + it.text, style = MaterialTheme.typography.bodyMedium) }
            NoticeText(an.notice)
        }
    }
    if (an.sufficient) {
        when (ai) {
            GrowthAiState.Idle -> OutlinedButton(onClick = onSummarize, modifier = Modifier.fillMaxWidth()) { Text("بازنویسی خلاصه با هوش مصنوعی") }
            GrowthAiState.Loading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Text("در حال آماده‌سازی خلاصه…", style = MaterialTheme.typography.bodyMedium)
            }
            is GrowthAiState.Failed -> {
                Text(ai.message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                OutlinedButton(onClick = onSummarize) { Text("تلاش مجدد") }
            }
            is GrowthAiState.Done -> {
                val s = ai.summary
                if (s.source == "ai") {
                    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            StatusChip("خلاصهٔ هوش مصنوعی", Tone.Info)
                            Text(s.text, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                } else NoticeText(aiFallbackMessage(s.reason))
            }
        }
        NoticeText("به هوش مصنوعی فقط یک خلاصهٔ آماری و ناشناس داده می‌شود؛ نه نام، نه شناسه، نه نتایج خام.")
    }
    g.suggestion?.let { sug ->
        SectionTitle("پیشنهاد فعالیت بعدی")
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(sug.text, style = MaterialTheme.typography.titleSmall)
                if (sug.reason.isNotBlank()) Text(sug.reason, style = MaterialTheme.typography.bodySmall)
                InfoChips(listOf(sug.skill, sug.levelLabel))
                if (canCreate) TextButton(onClick = { onUseSuggestion(sug) }) { Text("ویرایش و ساخت این فعالیت") }
                NoticeText("این فقط یک پیشنهاد آموزشی است؛ فعالیت بدون ویرایش و تأیید شما ساخته نمی‌شود.")
            }
        }
    }
}

private fun aiFallbackMessage(reason: String?) = when (reason) {
    "ai_limit_reached" -> "سهمیهٔ هوش مصنوعی پلن شما تمام شده است؛ تحلیل بر پایهٔ داده نمایش داده شد."
    "insufficient_data" -> Growth.MSG_NOT_ENOUGH_ACTIVITIES
    else -> "بازنویسی با هوش مصنوعی در دسترس نبود؛ تحلیل بر پایهٔ داده نمایش داده شد."
}

// ---- shared pieces -----------------------------------------------------------------------------------------

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(modifier, color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.padding(vertical = 10.dp, horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 2)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
    }
}

@Composable
private fun KeyValue(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.titleSmall)
    }
}

@Composable
private fun MessageCard(text: String) {
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
        Text(text, Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun TrendChip(direction: String) {
    val title = Growth.trendTitle(direction)
    when (direction) {
        "up" -> StatusChip(title, Tone.Success)
        "down" -> StatusChip(title, Tone.Warning) // calm amber; never red, never a label on the child
        "fluctuating" -> StatusChip(title, Tone.Info)
        else -> StatusChip(title)
    }
}

@Composable
private fun TrendLine(t: GrowthTrend) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("وضعیت روند:", style = MaterialTheme.typography.bodyMedium)
        TrendChip(t.direction)
    }
}

/**
 * Line chart of 0..100 values, oldest -> newest. RTL reading order: the oldest point is on the right, the newest on the left.
 * Drawn only from 2 points on; nothing is interpolated. Tapping selects the nearest point (when [onSelect] is given).
 */
@Composable
private fun GrowthLineChart(values: List<Double>, selected: Int?, onSelect: ((Int) -> Unit)?, modifier: Modifier = Modifier, height: Dp = 160.dp) {
    if (values.size < 2) return
    val line = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    val mark = MaterialTheme.colorScheme.tertiary
    val padPx = with(LocalDensity.current) { 12.dp.toPx() }
    val onSel by rememberUpdatedState(onSelect)
    val reveal = remember(values) { Animatable(0f) }
    LaunchedEffect(values) { reveal.animateTo(1f, tween(600)) }
    Canvas(
        modifier.fillMaxWidth().height(height).pointerInput(values.size) {
            detectTapGestures { off ->
                val cb = onSel
                if (cb != null) Growth.nearestIndex(off.x, size.width.toFloat(), values.size, padPx)?.let(cb)
            }
        },
    ) {
        val w = size.width
        val h = size.height
        val usableW = w - 2 * padPx
        val usableH = h - 2 * padPx
        fun px(i: Int) = w - padPx - i * (usableW / (values.size - 1))
        fun py(v: Double) = h - padPx - (v.coerceIn(0.0, 100.0).toFloat() / 100f) * usableH
        for (g in listOf(0.0, 50.0, 100.0)) drawLine(grid, Offset(padPx, py(g)), Offset(w - padPx, py(g)), strokeWidth = 1f)
        val path = Path()
        values.forEachIndexed { i, v -> if (i == 0) path.moveTo(px(i), py(v)) else path.lineTo(px(i), py(v)) }
        val fill = Path().apply {
            addPath(path)
            lineTo(px(values.size - 1), h - padPx)
            lineTo(px(0), h - padPx)
            close()
        }
        drawPath(fill, Brush.verticalGradient(listOf(line.copy(alpha = 0.22f * reveal.value), Color.Transparent), startY = padPx, endY = h - padPx))
        drawPath(path, line.copy(alpha = reveal.value), style = Stroke(width = 5f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        values.forEachIndexed { i, v ->
            val on = i == selected
            if (on) drawLine(mark, Offset(px(i), padPx), Offset(px(i), h - padPx), strokeWidth = 2f)
            drawCircle(if (on) mark else line, radius = if (on) 11f else 7f, center = Offset(px(i), py(v)))
        }
    }
}
