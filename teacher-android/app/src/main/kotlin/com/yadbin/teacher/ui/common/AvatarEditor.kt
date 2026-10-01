@file:OptIn(ExperimentalLayoutApi::class)

package com.yadbin.teacher.ui.common

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.yadbin.teacher.core.avatar.AvatarLogic
import kotlinx.coroutines.launch

/** Choose / change / remove the student's picture, or pick one of the preset avatars. Everything stays on this device. */
@Composable
fun AvatarEditorDialog(studentId: String, studentName: String, gender: String? = null, onDismiss: () -> Unit) {
    val store = LocalContainer.current.avatars
    val version by store.version.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    val hasPhoto = remember(version) { store.hasPhoto(studentId) }
    val selected = remember(version) { store.chosenPreset(studentId) }

    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { error = if (store.savePhotoFromUri(studentId, uri)) null else "ذخیره‌ی تصویر ممکن نشد. تصویر دیگری را امتحان کنید." }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bmp ->
        if (bmp != null) scope.launch { error = if (store.savePhotoBitmap(studentId, bmp)) null else "ذخیره‌ی تصویر ممکن نشد." }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تصویر «$studentName»") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                StudentAvatar(studentId, size = 96.dp, gender = gender)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, Modifier.weight(1f)) {
                        Text(if (hasPhoto) "تغییر تصویر" else "از گالری")
                    }
                    OutlinedButton(onClick = {
                        try { camera.launch(null) } catch (e: Exception) { error = "دوربین در دسترس نیست." }
                    }, Modifier.weight(1f)) { Text("دوربین") }
                }
                if (!hasPhoto && selected != null) TextButton(onClick = { store.setPreset(studentId, null) }) { Text(if (gender == "female" || gender == "male") "بازگشت به آواتار دختر/پسر" else "بازگشت به آواتار خودکار") }
                if (hasPhoto) TextButton(onClick = { store.removePhoto(studentId) }) { Text("حذف تصویر", color = MaterialTheme.colorScheme.error) }
                Text("آواتار پیش‌فرض", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    for (i in 0 until AvatarLogic.PRESET_COUNT) {
                        val on = !hasPhoto && selected == i
                        Box(
                            Modifier.size(54.dp).alpha(if (hasPhoto) 0.4f else 1f).clip(CircleShape)
                                .let { if (on) it.border(3.dp, MaterialTheme.colorScheme.primary, CircleShape) else it }
                                .clickable(enabled = !hasPhoto) { store.setPreset(studentId, i) },
                        ) { PresetAvatar(i, Modifier.fillMaxSize()) }
                    }
                }
                if (hasPhoto) Text("برای انتخاب آواتار، ابتدا تصویر را حذف کنید.", style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center) }
                Text("تصویر فقط روی همین دستگاه ذخیره می‌شود؛ به سرور ارسال نمی‌شود و دانش‌آموز آن را در لینک فعالیت نمی‌بیند.", style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("تمام") } },
    )
}
