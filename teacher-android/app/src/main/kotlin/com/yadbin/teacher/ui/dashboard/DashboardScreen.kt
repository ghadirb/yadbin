@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.dashboard

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.ClassesResponse
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class DashboardViewModel(private val repo: Repository) : ViewModel() {
    private val _state = MutableStateFlow<Ui<ClassesResponse>>(Ui.Loading)
    val state: StateFlow<Ui<ClassesResponse>> = _state.asStateFlow()
    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            if (_state.value !is Ui.Ready) _state.value = Ui.Loading
            _state.value = loadUi { repo.classes() }
        }
    }

    fun logout(onDone: () -> Unit) { viewModelScope.launch { repo.logout(); onDone() } }
}

@Composable
fun DashboardScreen(onOpenClass: (String) -> Unit, onCreateClass: () -> Unit, onLoggedOut: () -> Unit) {
    val c = LocalContainer.current
    val vm: DashboardViewModel = viewModel(factory = VmFactory { DashboardViewModel(c.repository) })
    val state by vm.state.collectAsStateWithLifecycle()

    // refresh when coming back from Create Class / Class Detail
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, e -> if (e == androidx.lifecycle.Lifecycle.Event.ON_RESUME) vm.refresh() }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }

    Scaffold(
        topBar = {
            YadbinTopBar("داشبورد", actions = {
                TextButton(onClick = { vm.logout(onLoggedOut) }) { Text("خروج") }
            })
        },
        floatingActionButton = {
            val s = state
            if (s is Ui.Ready && s.data.classes.isNotEmpty()) {
                ExtendedFloatingActionButton(onClick = onCreateClass, icon = { Icon(Icons.Default.Add, null) }, text = { Text("ساخت کلاس") })
            }
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            when (val s = state) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(s.message, vm::refresh)
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    if (s.data.classes.isEmpty()) {
                        Spacer(Modifier.height(48.dp))
                        EmptyState("هنوز کلاسی ایجاد نکرده‌اید.", "ساخت اولین کلاس", onCreateClass)
                    } else {
                        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            items(s.data.classes, key = { it.id }) { cls ->
                                Card(Modifier.fillMaxWidth().clickable { onOpenClass(cls.id) }) {
                                    Column(Modifier.padding(16.dp)) {
                                        Text(cls.name, style = MaterialTheme.typography.titleMedium)
                                        Text(cls.grade, style = MaterialTheme.typography.bodyMedium)
                                        Spacer(Modifier.height(8.dp))
                                        Text("دانش‌آموزان: ${cls.studentCount.fa()}   •   فعالیت‌های اخیر: ${cls.recentActivityCount.fa()}", style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                            item { Spacer(Modifier.height(72.dp)) }
                        }
                    }
                }
            }
        }
    }
}
