@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.classes

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.Validators
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class FormState(val loading: Boolean = false, val error: String? = null)

class CreateClassViewModel(private val repo: Repository) : ViewModel() {
    private val _state = MutableStateFlow(FormState())
    val state: StateFlow<FormState> = _state.asStateFlow()

    fun create(name: String, grade: String, school: String, onCreated: (String) -> Unit) {
        Validators.nameError(name, "نام کلاس")?.let { _state.value = FormState(error = it); return }
        Validators.nameError(grade, "پایه")?.let { _state.value = FormState(error = it); return }
        viewModelScope.launch {
            _state.value = FormState(loading = true)
            try {
                val cls = repo.createClass(name.trim(), grade.trim(), school.trim().ifBlank { null })
                _state.value = FormState()
                onCreated(cls.id)
            } catch (e: ApiException) { _state.value = FormState(error = errorText(e)) }
            catch (e: NetworkException) { _state.value = FormState(error = errorText(e)) }
        }
    }
}

@Composable
fun CreateClassScreen(onBack: () -> Unit, onCreated: (String) -> Unit) {
    val c = LocalContainer.current
    val vm: CreateClassViewModel = viewModel(factory = VmFactory { CreateClassViewModel(c.repository) })
    val s by vm.state.collectAsStateWithLifecycle()
    var name by rememberSaveable { mutableStateOf("") }
    var grade by rememberSaveable { mutableStateOf("") }
    var school by rememberSaveable { mutableStateOf("") }

    Scaffold(topBar = { YadbinTopBar("ساخت کلاس", onBack) }) { pad ->
        Column(Modifier.padding(pad).padding(16.dp).fillMaxSize().verticalScroll(rememberScrollState())) {
            OutlinedTextField(name, { name = it }, label = { Text("نام کلاس") }, placeholder = { Text("کلاس سوم الف") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(grade, { grade = it }, label = { Text("پایه") }, placeholder = { Text("پایه سوم") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(school, { school = it }, label = { Text("نام مدرسه (اختیاری)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            s.error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
            Spacer(Modifier.height(16.dp))
            Button(onClick = { vm.create(name, grade, school, onCreated) }, enabled = !s.loading, modifier = Modifier.fillMaxWidth()) {
                if (s.loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("ساخت کلاس")
            }
        }
    }
}
