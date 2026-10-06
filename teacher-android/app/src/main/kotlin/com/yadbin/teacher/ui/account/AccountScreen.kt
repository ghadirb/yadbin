@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.account

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.BuildConfig
import com.yadbin.teacher.core.avatar.StudentAvatarStore
import com.yadbin.teacher.core.diagnostics.CrashLog
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.Support
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.ui.common.LocalContainer
import com.yadbin.teacher.ui.common.VmFactory
import com.yadbin.teacher.ui.common.YadbinTopBar
import com.yadbin.teacher.ui.common.errorText
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AccountUi(val deleting: Boolean = false, val error: String? = null)

class AccountViewModel(private val repo: Repository, private val avatars: StudentAvatarStore) : ViewModel() {
    private val _state = MutableStateFlow(AccountUi())
    val state: StateFlow<AccountUi> = _state.asStateFlow()

    fun clearError() { _state.value = AccountUi() }

    fun deleteAccount(password: String, onDone: () -> Unit) {
        if (password.isEmpty()) { _state.value = AccountUi(error = "رمز عبور را وارد کنید."); return }
        viewModelScope.launch {
            _state.value = AccountUi(deleting = true)
            try {
                repo.deleteAccount(password)
                avatars.deleteEverything()
                _state.value = AccountUi()
                onDone()
            } catch (e: ApiException) {
                _state.value = AccountUi(error = errorText(e))
            } catch (e: NetworkException) {
                _state.value = AccountUi(error = errorText(e))
            }
        }
    }
}

@Composable
fun AccountScreen(onBack: () -> Unit, onAccountDeleted: () -> Unit) {
    val c = LocalContainer.current
    val vm: AccountViewModel = viewModel(factory = VmFactory { AccountViewModel(c.repository, c.avatars) })
    val s by vm.state.collectAsStateWithLifecycle()
    val uri = LocalUriHandler.current
    val context = LocalContext.current
    var showDelete by rememberSaveable { mutableStateOf(false) }
    var crash by remember { mutableStateOf(CrashLog.read(context)) }
    val base = BuildConfig.API_BASE_URL
    fun open(url: String) { runCatching { uri.openUri(url) }.onFailure { Toast.makeText(context, "بازکردن لینک ممکن نشد.", Toast.LENGTH_SHORT).show() } }

    Scaffold(topBar = { YadbinTopBar("حساب، پشتیبانی و حریم خصوصی", onBack) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("پشتیبانی", style = MaterialTheme.typography.titleMedium)
            Text("برای سؤال، گزارش مشکل یا پیشنهاد پیام بدهید (${Support.HANDLE}).", style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(onClick = { open(Support.TELEGRAM_URL) }, modifier = Modifier.weight(1f)) { Text("تلگرام") }
                FilledTonalButton(onClick = { open(Support.RUBIKA_URL) }, modifier = Modifier.weight(1f)) { Text("روبیکا") }
                FilledTonalButton(onClick = { open(Support.EITAA_URL) }, modifier = Modifier.weight(1f)) { Text("ایتا") }
            }
            crash?.let { report ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("اپ دفعهٔ قبل ناگهانی بسته شد.", style = MaterialTheme.typography.titleSmall)
                        Text("گزارش فنی فقط روی گوشی شماست و خودکار ارسال نمی‌شود. اگر خواستید، برای پشتیبانی بفرستید (شامل نام یا اطلاعات دانش‌آموزان نیست).", style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = {
                                val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, report) }
                                runCatching { context.startActivity(Intent.createChooser(send, "ارسال گزارش")) }
                            }) { Text("ارسال گزارش") }
                            TextButton(onClick = { CrashLog.clear(context); crash = null }) { Text("پاک کردن") }
                        }
                    }
                }
            }
            HorizontalDivider()
            Text("حریم خصوصی و قوانین", style = MaterialTheme.typography.titleMedium)
            TextButton(onClick = { open(Support.privacyUrl(base)) }) { Text("سیاست حریم خصوصی") }
            TextButton(onClick = { open(Support.termsUrl(base)) }) { Text("شرایط استفاده") }
            HorizontalDivider()
            Text("کد بازیابی رمز", style = MaterialTheme.typography.titleMedium)
            Text("رمز فراموش‌شده فقط با «کد بازیابی» ثبت‌نام قابل بازیابی است و پیامکی نیست. اگر کد را ندارید، با رمز فعلی دوباره وارد شوید و در جای امن یادداشت کنید؛ در صورت گم شدن هر دو، با پشتیبانی تماس بگیرید.", style = MaterialTheme.typography.bodyMedium)
            HorizontalDivider()
            Text("درباره", style = MaterialTheme.typography.titleMedium)
            Text("یادبین — دستیار هوشمند معلم · نسخهٔ ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyMedium)
            HorizontalDivider()
            Text("حذف حساب", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.error)
            Text("حساب و همهٔ داده‌ها (کلاس‌ها، دانش‌آموزان، نتایج، آزمون‌ها، منابع و اشتراک) برای همیشه پاک می‌شود. این کار بازگشت‌پذیر نیست و لینک دانش‌آموزان از کار می‌افتد. اشتراک فعال هم از بین می‌رود و بازپرداخت انجام نمی‌شود.", style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = { vm.clearError(); showDelete = true }, modifier = Modifier.fillMaxWidth()) { Text("حذف حساب من", color = MaterialTheme.colorScheme.error) }
        }
    }

    if (showDelete) {
        var password by rememberSaveable { mutableStateOf("") }
        var confirmed by rememberSaveable { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { if (!s.deleting) showDelete = false },
            title = { Text("حذف همیشگی حساب") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("برای تأیید، رمز عبور خود را وارد کنید.")
                    OutlinedTextField(password, { password = it }, label = { Text("رمز عبور") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Checkbox(confirmed, { confirmed = it })
                        Text("می‌دانم که حذف بازگشت‌پذیر نیست.", style = MaterialTheme.typography.bodyMedium)
                    }
                    s.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {
                TextButton(enabled = Support.canDelete(password, confirmed) && !s.deleting, onClick = { vm.deleteAccount(password, onAccountDeleted) }) {
                    if (s.deleting) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("حذف برای همیشه", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(enabled = !s.deleting, onClick = { showDelete = false }) { Text("انصراف") } },
        )
    }
}
