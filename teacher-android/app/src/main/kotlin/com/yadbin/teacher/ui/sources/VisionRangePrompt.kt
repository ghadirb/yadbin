package com.yadbin.teacher.ui.sources

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.yadbin.teacher.core.pdf.PdfReader
import com.yadbin.teacher.core.pdf.VisionQuota
import com.yadbin.teacher.core.utils.fa
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** A question to the teacher: «this PDF needs page-image reading — which pages?». Completed with the chosen 1-based range, or null for cancel. */
class VisionPrompt(val pageCount: Int, val quota: VisionQuota?, val answer: CompletableDeferred<IntRange?>)

/** Lets a ViewModel suspend [ask] until the dialog below is answered. */
class VisionPromptHost {
    private val _prompt = MutableStateFlow<VisionPrompt?>(null)
    val prompt: StateFlow<VisionPrompt?> = _prompt.asStateFlow()

    suspend fun ask(pageCount: Int, quota: VisionQuota?): IntRange? {
        val p = VisionPrompt(pageCount, quota, CompletableDeferred())
        _prompt.value = p
        try { return p.answer.await() } finally { _prompt.value = null }
    }
}

/** «۱۲۳» / «١٢٣» → 123 (teachers type Persian digits). */
internal fun parsePageNumber(s: String): Int? =
    s.map { c -> when (c) { in '۰'..'۹' -> '0' + (c - '۰'); in '٠'..'٩' -> '0' + (c - '٠'); else -> c } }.joinToString("").trim().toIntOrNull()

/** Pure rule: the range the teacher typed, or the Persian reason it cannot be used. */
internal fun validateVisionRange(lo: Int?, hi: Int?, pageCount: Int, quota: VisionQuota?): Pair<IntRange?, String?> {
    if (lo == null || hi == null) return null to "شمارهٔ صفحه را وارد کنید."
    if (lo < 1 || hi > pageCount) return null to "صفحه‌ها باید بین ۱ و ${pageCount.fa()} باشند."
    if (lo > hi) return null to "صفحهٔ شروع باید از صفحهٔ پایان بیشتر نباشد."
    val count = hi - lo + 1
    if (count > PdfReader.VISION_MAX_PAGES) return null to "در هر بار حداکثر ${PdfReader.VISION_MAX_PAGES.fa()} صفحه."
    if (quota != null && count > quota.remaining) return null to "سهمیهٔ باقی‌ماندهٔ شما ${quota.remaining.fa()} صفحه است؛ بازهٔ کوچک‌تری انتخاب کنید."
    return Pair(lo..hi, null)
}

@Composable
fun VisionRangeDialog(prompt: VisionPrompt) {
    val n = prompt.pageCount
    val q = prompt.quota
    var from by remember { mutableStateOf("1") }
    var to by remember { mutableStateOf(minOf(n, PdfReader.VISION_MAX_PAGES, q?.remaining?.takeIf { it > 0 } ?: Int.MAX_VALUE).toString()) }
    val (range, error) = validateVisionRange(parsePageNumber(from), parsePageNumber(to), n, q)
    AlertDialog(
        onDismissRequest = {},
        title = { Text("خواندن تصویری صفحه‌ها") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("متن این PDF از روی خود فایل قابل خواندن نیست؛ صفحه‌ها باید از روی تصویر خوانده شوند. فایل شما ${n.fa()} صفحه دارد.", style = MaterialTheme.typography.bodyMedium)
                Text("فقط صفحه‌های موردنیاز (مثلاً یک یا چند فصل) را انتخاب کنید تا از سهمیهٔ شما کمتر مصرف شود.", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(from, { from = it.take(4) }, label = { Text("از صفحه") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                    OutlinedTextField(to, { to = it.take(4) }, label = { Text("تا صفحه") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                }
                if (range != null) Text("${(range.last - range.first + 1).fa()} صفحه خوانده می‌شود و حداکثر همین تعداد از سهمیهٔ ماهانه کسر می‌شود (صفحه‌هایی که قبلاً خوانده شده‌اند رایگان‌اند).", style = MaterialTheme.typography.bodySmall)
                if (q != null) Text("سهمیهٔ باقی‌ماندهٔ این ماه: ${q.remaining.fa()} از ${q.limit.fa()} صفحه", style = MaterialTheme.typography.bodySmall)
                if (error != null) Text(error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = { TextButton(enabled = range != null, onClick = { prompt.answer.complete(range) }) { Text("شروع خواندن") } },
        dismissButton = { TextButton(onClick = { prompt.answer.complete(null) }) { Text("انصراف") } },
    )
}
