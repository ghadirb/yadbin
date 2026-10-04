@file:OptIn(ExperimentalMaterial3Api::class)

package com.yadbin.teacher.ui.subscription

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yadbin.teacher.core.billing.BuyResult
import com.yadbin.teacher.core.billing.PurchaseCoordinator
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.fa
import com.yadbin.teacher.core.utils.jalaliFa
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.PlanDto
import com.yadbin.teacher.domain.models.PlansResponse
import com.yadbin.teacher.domain.models.SubscriptionResponse
import com.yadbin.teacher.ui.common.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SubscriptionData(val sub: SubscriptionResponse, val plans: PlansResponse?)

class SubscriptionViewModel(private val repo: Repository, private val purchases: PurchaseCoordinator) : ViewModel() {
    private val _state = MutableStateFlow<Ui<SubscriptionData>>(Ui.Loading)
    val state: StateFlow<Ui<SubscriptionData>> = _state.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    val billingAvailable: Boolean get() = purchases.available

    init { refresh() }
    fun clearMessage() { _message.value = null }

    fun refresh() {
        viewModelScope.launch {
            if (_state.value !is Ui.Ready) _state.value = Ui.Loading
            // A purchase that was paid but never delivered (app closed, offline...) is delivered first - the Myket docs require this check at start.
            if (purchases.recover() > 0) _message.value = "اشتراک شما فعال شد."
            val sub = loadUi { repo.subscription() }
            val plans = try { repo.plans().data } catch (e: ApiException) { null } catch (e: NetworkException) { null }
            _state.value = when (sub) {
                is Ui.Ready -> Ui.Ready(SubscriptionData(sub.data, plans), sub.offline)
                is Ui.Error -> sub
                Ui.Loading -> Ui.Loading
            }
        }
    }

    fun buy(activity: Activity, planId: String) {
        if (_busy.value) return
        _busy.value = true
        viewModelScope.launch {
            when (val r = purchases.buy(activity, planId)) {
                BuyResult.Delivered -> { _message.value = "پرداخت انجام شد و اشتراک حرفه‌ای شما فعال شد."; refresh() }
                BuyResult.Canceled -> Unit
                is BuyResult.Pending -> { _message.value = r.message; refresh() }
                is BuyResult.Failed -> _message.value = r.message
            }
            _busy.value = false
        }
    }
}

private fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) { if (c is Activity) return c; c = c.baseContext }
    return null
}

/** «اشتراک من» – state of the account, exactly as the server reports it. */
@Composable
fun SubscriptionScreen(onBack: () -> Unit, onUpgrade: () -> Unit) {
    val c = LocalContainer.current
    val vm: SubscriptionViewModel = viewModel(factory = VmFactory { SubscriptionViewModel(c.repository, c.purchases) })
    val state by vm.state.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    Scaffold(topBar = { YadbinTopBar("اشتراک من", onBack) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            when (val s = state) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(s.message, vm::refresh)
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    val e = s.data.sub.subscription
                    val u = s.data.sub.usage
                    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        message?.let { m -> item { Card(Modifier.fillMaxWidth()) { Text(m, Modifier.padding(14.dp), style = MaterialTheme.typography.bodyMedium) } } }
                        item {
                            Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    when (e.plan) {
                                        "PRO" -> StatusChip("فعال", Tone.Success)
                                        "TRIAL" -> StatusChip("آزمایشی", Tone.Info)
                                        else -> StatusChip(if (e.status == "EXPIRED") "پایان‌یافته" else "رایگان", Tone.Warning)
                                    }
                                    Text(SubscriptionText.title(e), style = MaterialTheme.typography.titleLarge)
                                    Text(SubscriptionText.headline(e), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    if (e.plan == "TRIAL" && e.trialExpiresAt != null) Text("پایان دورهٔ آزمایشی: ${e.trialExpiresAt.jalaliFa()}", style = MaterialTheme.typography.bodySmall)
                                    if (e.plan == "PRO" && e.expiresAt != null) Text("پایان اشتراک: ${e.expiresAt.jalaliFa()}", style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                        item { SectionTitle(if (e.plan == "FREE") "محدودیت‌های پلن رایگان" else "امکانات فعال") }
                        item {
                            Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(SubscriptionText.limitLine("کلاس", e.limits.maxClasses, u.classes))
                                    Text(SubscriptionText.limitLine("دانش‌آموز", e.limits.maxStudents, u.students))
                                    Text(SubscriptionText.limitLine("آزمون معلم", e.limits.maxAssessments, u.assessments))
                                    Text(SubscriptionText.aiLine(e.limits.aiRequestsPerMonth, u.aiRequests))
                                    Text(if (e.features.fullReports) "گزارش‌های کامل: فعال" else "گزارش‌های کامل: فقط در اشتراک آزمایشی/حرفه‌ای")
                                }
                            }
                        }
                        if (e.plan != "PRO") item { Button(onClick = onUpgrade, modifier = Modifier.fillMaxWidth()) { Text(if (e.plan == "TRIAL") "ارتقا به اشتراک حرفه‌ای" else "مشاهده پلن‌ها و ارتقا") } }
                        else item { OutlinedButton(onClick = onUpgrade, modifier = Modifier.fillMaxWidth()) { Text("تمدید اشتراک") } }
                        item { Spacer(Modifier.height(24.dp)) }
                    }
                }
            }
        }
    }
}

/** «ارتقا» – Free vs Pro and the two plans. Prices come from the server; payment goes through Myket and is confirmed by the server. */
@Composable
fun UpgradeScreen(onBack: () -> Unit) {
    val c = LocalContainer.current
    val vm: SubscriptionViewModel = viewModel(factory = VmFactory { SubscriptionViewModel(c.repository, c.purchases) })
    val state by vm.state.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findActivity()
    Scaffold(topBar = { YadbinTopBar("ارتقا به اشتراک حرفه‌ای", onBack) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            when (val s = state) {
                Ui.Loading -> LoadingBox()
                is Ui.Error -> ErrorBox(s.message, vm::refresh)
                is Ui.Ready -> {
                    if (s.offline) OfflineBanner()
                    val plans = s.data.plans
                    val payOk = s.data.sub.paymentsAvailable && vm.billingAvailable && !s.offline
                    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        message?.let { m -> item { Card(Modifier.fillMaxWidth()) { Text(m, Modifier.padding(14.dp)) } } }
                        item {
                            Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text("چه چیزی تغییر می‌کند؟", style = MaterialTheme.typography.titleMedium)
                                    val f = plans?.free ?: s.data.sub.subscription.limits
                                    Text("پلن رایگان: ${f.maxClasses?.fa() ?: "نامحدود"} کلاس، ${f.maxStudents?.fa() ?: "نامحدود"} دانش‌آموز، ${f.maxAssessments?.fa() ?: "نامحدود"} آزمون، ${f.aiRequestsPerMonth?.fa() ?: "نامحدود"} درخواست هوش مصنوعی در ماه")
                                    Text("اشتراک حرفه‌ای: کلاس، دانش‌آموز و آزمون نامحدود، هوش مصنوعی بدون سقف و گزارش‌های کامل", color = MaterialTheme.colorScheme.primary)
                                    Text("اطلاعات و فعالیت‌های فعلی شما هرگز پاک یا پنهان نمی‌شوند؛ فقط ساخت مورد جدید بالاتر از سقف رایگان نیاز به اشتراک دارد.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                        if (plans == null || plans.plans.isEmpty()) item { Text("پلنی برای نمایش وجود ندارد.", style = MaterialTheme.typography.bodyMedium) }
                        else items(plans.plans, key = { it.id }) { p -> PlanCard(p, payOk, busy, onBuy = { activity?.let { a -> vm.buy(a, p.id) } }) }
                        if (!payOk) item { Text(com.yadbin.teacher.core.billing.PurchaseCoordinator.COMING_SOON, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        item { Text("پرداخت داخل برنامهٔ مایکت انجام می‌شود و پس از تأیید سرور، اشتراک فعال می‌شود. تمدید خودکار وجود ندارد؛ هر خرید یک دوره است و در صورت خرید در طول اشتراک فعال، به انتهای آن اضافه می‌شود.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        item { Spacer(Modifier.height(24.dp)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlanCard(p: PlanDto, payOk: Boolean, busy: Boolean, onBuy: () -> Unit) {
    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), elevation = CardDefaults.cardElevation(1.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Pro ${SubscriptionText.periodLabel(p)}", style = MaterialTheme.typography.titleMedium)
            Text("${p.durationDays.fa()} روز دسترسی کامل", style = MaterialTheme.typography.bodyMedium)
            Text(SubscriptionText.priceToman(p) ?: "قیمت در صفحهٔ خرید مایکت نمایش داده می‌شود.", style = MaterialTheme.typography.titleSmall)
            Button(onClick = onBuy, enabled = payOk && !busy, modifier = Modifier.fillMaxWidth()) {
                Text(if (busy) "در حال انجام…" else if (payOk) "خرید" else "پرداخت به‌زودی فعال می‌شود")
            }
        }
    }
}
