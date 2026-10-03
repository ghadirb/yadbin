package com.yadbin.teacher.ui.assessments

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.domain.models.StudentAssessments
import com.yadbin.teacher.ui.common.LocalContainer
import com.yadbin.teacher.ui.common.NoticeText

/**
 * «آزمون‌های معلم» in the student report. Deliberately a separate block with its own title and notice:
 * a school score (e.g. science 80%) is never shown as, or mixed into, a cognitive indicator.
 * Optional like the other v1.2 sections: if it cannot load, the classic report stays untouched.
 */
@Composable
fun StudentAssessmentsSection(studentId: String) {
    val repo = LocalContainer.current.repository
    val data by produceState<StudentAssessments?>(initialValue = null, studentId) {
        value = try { repo.studentAssessments(studentId).data } catch (e: Exception) { null }
    }
    val d = data ?: return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("آزمون‌های معلم", style = MaterialTheme.typography.titleLarge)
        if (d.assessments.isEmpty()) Text("هنوز آزمون معلمی برای این دانش‌آموز ثبت نشده است.", style = MaterialTheme.typography.bodySmall)
        d.assessments.forEach { r ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(listOfNotNull(r.subject, r.title).joinToString(" – "), style = MaterialTheme.typography.titleSmall)
                    if (r.percent != null && r.questionCount != null && r.correct != null) {
                        Text("${r.correct.fa()} از ${r.questionCount.fa()}  •  ${pct(r.percent)}" + (r.minutes?.let { "  •  ${it.fa()} دقیقه" } ?: ""), style = MaterialTheme.typography.bodyMedium)
                    } else Text(r.statusLabel, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        NoticeText(d.notice.ifBlank { "نمرهٔ آزمون‌های معلم، سنجش درسی است و در پروفایل شناختی یادبین هیچ نقشی ندارد." })
    }
}
