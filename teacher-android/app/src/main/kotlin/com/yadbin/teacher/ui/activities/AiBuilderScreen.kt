@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.activities

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import com.yadbin.teacher.core.utils.Labels
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.ActivityDraft
import com.yadbin.teacher.domain.models.DraftResponse
import com.yadbin.teacher.domain.models.toPrefill
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class AiBuilderViewModel(private val repo: Repository, private val classId: String, private val studentId: String?) : ViewModel() {
    private val _result = MutableStateFlow<DraftResponse?>(null)
    val result: StateFlow<DraftResponse?> = _result.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    fun ask(prompt: String) {
        viewModelScope.launch {
            _busy.value = true; _error.value = null
            try { _result.value = repo.aiDraft(prompt, classId, studentId) }
            catch (e: ApiException) { _error.value = errorText(e) }
            catch (e: NetworkException) { _error.value = errorText(e) }
            finally { _busy.value = false }
        }
    }
}

/** AI Activity Builder: prompt -> DRAFT -> the teacher opens it in the normal (fully editable) form and approves there.
 *  This screen never creates or sends anything. */
@Composable
fun AiBuilderScreen(classId: String, studentId: String?, onBack: () -> Unit, onUseDraft: () -> Unit) {
    val c = LocalContainer.current
    val vm: AiBuilderViewModel = viewModel(key = "ai-$classId-$studentId", factory = VmFactory { AiBuilderViewModel(c.repository, classId, studentId) })
    val result by vm.result.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var prompt by rememberSaveable { mutableStateOf("") }

    fun use(d: ActivityDraft) { c.prefill = d.toPrefill().copy(studentId = studentId); onUseDraft() }

    Scaffold(topBar = { YadbinTopBar("ساخت فعالیت با هوش مصنوعی", onBack) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("بنویسید چه فعالیتی می‌خواهید؛ مثلاً: «برای دانش‌آموز پایه دوم، یک فعالیت برای تقویت توجه و حافظه می‌خواهم.»", style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(prompt, { prompt = it.take(500) }, label = { Text("توضیح فعالیت") }, minLines = 3, modifier = Modifier.fillMaxWidth())
            Button(onClick = { vm.ask(prompt) }, enabled = prompt.trim().length >= 5 && !busy, modifier = Modifier.fillMaxWidth()) {
                if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("دریافت پیشنهاد")
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            result?.let { r ->
                NoticeText(r.notice.ifBlank { "این فقط یک پیشنهاد است؛ هیچ فعالیتی بدون ویرایش و تأیید شما ساخته نمی‌شود." })
                DraftCard(r.draft, "پیشنهاد اصلی", ::use)
                r.alternatives.forEachIndexed { i, d -> DraftCard(d, "پیشنهاد جایگزین ${(i + 1).fa()}", ::use) }
            }
        }
    }
}

@Composable
private fun DraftCard(d: ActivityDraft, heading: String, onUse: (ActivityDraft) -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(heading, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(d.title, style = MaterialTheme.typography.titleMedium)
            if (d.educationalGoal.isNotBlank()) Text("هدف آموزشی: ${d.educationalGoal}", style = MaterialTheme.typography.bodyMedium)
            if (d.description.isNotBlank()) Text(d.description, style = MaterialTheme.typography.bodySmall)
            Text("${Labels.game(d.gameType)} • ${Labels.difficulty(d.difficultyMode)} • ${d.questionCount.fa()} سؤال • ${d.suggestedMinutes.fa()} دقیقه", style = MaterialTheme.typography.bodySmall)
            InfoChips(
                listOfNotNull(
                    d.levelLabel.ifBlank { Edu.levelLabel(d.level) },
                    Edu.gradeRange(Edu.gradeLabel(d.gradeMin), Edu.gradeLabel(d.gradeMax)),
                    Edu.ageRange(d.ageMin, d.ageMax),
                ) + d.skillLabels,
            )
            Button(onClick = { onUse(d) }, modifier = Modifier.fillMaxWidth()) { Text("ویرایش و ادامه") }
        }
    }
}
