package com.yadbin.teacher.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.Validators
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.ui.common.LocalContainer
import com.yadbin.teacher.ui.common.VmFactory
import com.yadbin.teacher.ui.common.errorText
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AuthState(val loading: Boolean = false, val error: String? = null)

class AuthViewModel(private val repo: Repository) : ViewModel() {
    private val _state = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = _state.asStateFlow()

    fun login(phone: String, password: String, onDone: () -> Unit) {
        val p = Validators.normalizePhone(phone) ?: return fail("شماره موبایل معتبر نیست (مثال: 09123456789).")
        if (password.isEmpty()) return fail("رمز عبور را وارد کنید.")
        submit(onDone) { repo.login(p, password) }
    }

    fun register(name: String, phone: String, password: String, repeat: String, onDone: () -> Unit) {
        Validators.nameError(name)?.let { return fail(it) }
        val p = Validators.normalizePhone(phone) ?: return fail("شماره موبایل معتبر نیست (مثال: 09123456789).")
        Validators.passwordError(password)?.let { return fail(it) }
        if (password != repeat) return fail("رمز عبور و تکرار آن یکسان نیست.")
        submit(onDone) { repo.register(name.trim(), p, password) }
    }

    private fun fail(message: String) { _state.value = AuthState(error = message) }

    private fun submit(onDone: () -> Unit, block: suspend () -> Unit) {
        viewModelScope.launch {
            _state.value = AuthState(loading = true)
            try {
                block()
                _state.value = AuthState()
                onDone()
            } catch (e: ApiException) {
                _state.value = AuthState(error = errorText(e))
            } catch (e: NetworkException) {
                _state.value = AuthState(error = errorText(e))
            }
        }
    }
}

@Composable
fun SplashScreen(onNext: (loggedIn: Boolean) -> Unit) {
    val c = LocalContainer.current
    LaunchedEffect(Unit) {
        delay(700)
        onNext(c.repository.isLoggedIn)
    }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text("👁️", style = MaterialTheme.typography.displayLarge)
        Spacer(Modifier.height(8.dp))
        Text("یادبین", style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.primary)
        Text("دستیار هوشمند معلم", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(24.dp))
        CircularProgressIndicator()
    }
}

@Composable
private fun AuthColumn(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("یادبین", style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(4.dp))
        Text(title, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(20.dp))
        content()
    }
}

@Composable
fun LoginScreen(onLoggedIn: () -> Unit, onRegister: () -> Unit) {
    val c = LocalContainer.current
    val vm: AuthViewModel = viewModel(factory = VmFactory { AuthViewModel(c.repository) })
    val s by vm.state.collectAsStateWithLifecycle()
    var phone by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val expired by c.sessionExpired.collectAsStateWithLifecycle()

    AuthColumn("ورود معلم") {
        if (expired) {
            Text("نشست شما منقضی شده است. دوباره وارد شوید.", color = MaterialTheme.colorScheme.tertiary, textAlign = TextAlign.Center)
            Spacer(Modifier.height(8.dp))
        }
        OutlinedTextField(phone, { phone = it }, label = { Text("شماره موبایل") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(password, { password = it }, label = { Text("رمز عبور") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
        s.error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { vm.login(phone, password) { c.sessionExpired.value = false; onLoggedIn() } },
            enabled = !s.loading, modifier = Modifier.fillMaxWidth(),
        ) { if (s.loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("ورود") }
        TextButton(onClick = onRegister) { Text("ثبت‌نام") }
    }
}

@Composable
fun RegisterScreen(onRegistered: () -> Unit, onBackToLogin: () -> Unit) {
    val c = LocalContainer.current
    val vm: AuthViewModel = viewModel(factory = VmFactory { AuthViewModel(c.repository) })
    val s by vm.state.collectAsStateWithLifecycle()
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var repeat by rememberSaveable { mutableStateOf("") }

    AuthColumn("ثبت‌نام معلم") {
        OutlinedTextField(name, { name = it }, label = { Text("نام و نام خانوادگی") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(phone, { phone = it }, label = { Text("شماره موبایل") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(password, { password = it }, label = { Text("رمز عبور") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(repeat, { repeat = it }, label = { Text("تکرار رمز عبور") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
        s.error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { vm.register(name, phone, password, repeat) { c.sessionExpired.value = false; onRegistered() } },
            enabled = !s.loading, modifier = Modifier.fillMaxWidth(),
        ) { if (s.loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("ثبت‌نام") }
        TextButton(onClick = onBackToLogin) { Text("حساب دارید؟ ورود") }
    }
}
