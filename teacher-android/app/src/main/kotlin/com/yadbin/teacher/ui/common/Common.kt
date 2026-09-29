@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.common

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.yadbin.teacher.AppContainer
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.data.repository.Loaded

val LocalContainer = compositionLocalOf<AppContainer> { error("AppContainer not provided") }

class VmFactory(private val make: () -> ViewModel) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = make() as T
}

/** Loading / Error / Ready — every screen has explicit loading and error states. */
sealed interface Ui<out T> {
    data object Loading : Ui<Nothing>
    data class Error(val message: String) : Ui<Nothing>
    data class Ready<T>(val data: T, val offline: Boolean = false) : Ui<T>
}

fun errorText(e: Exception): String = when (e) {
    is ApiException -> e.message ?: "خطا رخ داد."
    is NetworkException -> e.message ?: "اتصال اینترنت برقرار نیست."
    else -> "خطای غیرمنتظره رخ داد."
}

suspend fun <T> loadUi(block: suspend () -> Loaded<T>): Ui<T> = try {
    val l = block()
    Ui.Ready(l.data, l.fromCache)
} catch (e: ApiException) {
    Ui.Error(errorText(e))
} catch (e: NetworkException) {
    Ui.Error(errorText(e))
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
fun ErrorBox(message: String, onRetry: (() -> Unit)?) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(message, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.error)
        if (onRetry != null) {
            Spacer(Modifier.height(12.dp))
            Button(onClick = onRetry) { Text("تلاش دوباره") }
        }
    }
}

@Composable
fun EmptyState(text: String, actionLabel: String? = null, onAction: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge)
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(12.dp))
            Button(onClick = onAction) { Text(actionLabel) }
        }
    }
}

@Composable
fun OfflineBanner() {
    Surface(color = MaterialTheme.colorScheme.tertiaryContainer, modifier = Modifier.fillMaxWidth()) {
        Text(
            "اتصال اینترنت برقرار نیست؛ آخرین اطلاعات ذخیره‌شده نمایش داده می‌شود.",
            Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
fun YadbinTopBar(title: String, onBack: (() -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) {
    TopAppBar(
        title = { Text(title) },
        navigationIcon = {
            if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "بازگشت") }
        },
        actions = actions,
    )
}

@Composable
fun ConfirmDialog(title: String, text: String, confirmLabel: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirmLabel, color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
}
