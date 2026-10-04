package com.yadbin.teacher.core.billing

import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.data.repository.Repository
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

sealed interface BuyResult {
    data object Delivered : BuyResult
    data object Canceled : BuyResult
    /** Paid, but the server could not confirm right now. Nothing is lost: the purchase is retried at the next start / when this screen opens. */
    data class Pending(val message: String) : BuyResult
    data class Failed(val message: String) : BuyResult
}

/**
 * Buy -> server confirms -> only then consume.
 * The server decides everything (docs/payments.md): this class never activates anything locally and never sends a price, user or date.
 */
class PurchaseCoordinator(private val repo: Repository, private val billing: MyketBilling) {
    private val recoverLock = Mutex()

    val available: Boolean get() = billing.configured

    suspend fun buy(activity: android.app.Activity, planId: String): BuyResult {
        if (!billing.configured) return BuyResult.Failed(COMING_SOON)
        val created = try { repo.createPayment(planId) } catch (e: ApiException) { return BuyResult.Failed(e.message ?: COMING_SOON) } catch (e: NetworkException) { return BuyResult.Failed(e.message ?: "ارتباط با سرور برقرار نشد.") }
        val sku = created.sku
        val payload = created.developerPayload
        if (created.kind != "store" || sku.isNullOrBlank() || payload.isNullOrBlank()) return BuyResult.Failed(COMING_SOON)
        return when (val o = billing.purchase(activity, sku, payload)) {
            PurchaseOutcome.Canceled -> BuyResult.Canceled
            PurchaseOutcome.AlreadyOwned -> { recover(); BuyResult.Pending("این خرید قبلاً انجام شده بود؛ در حال ثبت آن هستیم.") }
            is PurchaseOutcome.Unavailable -> BuyResult.Failed(o.message)
            is PurchaseOutcome.Failed -> BuyResult.Failed(o.message)
            is PurchaseOutcome.Success -> confirmAndConsume(o.purchase)
        }
    }

    private suspend fun confirmAndConsume(p: StorePurchase): BuyResult = try {
        val r = repo.confirmMyketPurchase(p.originalJson, p.signature)
        if (r.ok) { billing.consume(p); BuyResult.Delivered } // a failed consume is retried by recover(); confirm is idempotent
        else BuyResult.Failed("خرید تأیید نشد.")
    } catch (e: NetworkException) {
        BuyResult.Pending("پرداخت شما انجام شد؛ ارتباط با سرور برقرار نشد. به‌محض اتصال، اشتراک فعال می‌شود.")
    } catch (e: ApiException) {
        if (e.status >= 500) BuyResult.Pending("پرداخت شما انجام شد؛ تأیید از مایکت اکنون ممکن نیست. چند دقیقه بعد دوباره بررسی می‌شود.")
        else BuyResult.Failed(e.message ?: "خرید تأیید نشد.")
    }

    /**
     * Docs: "queryInventory must run at start" - otherwise money can be taken and the product never delivered.
     * Every unconsumed purchase is re-sent to the Worker (idempotent) and consumed only after ok:true.
     * A purchase that belongs to ANOTHER account on this phone is answered 404 by the Worker: it is left untouched for its owner.
     * Returns how many purchases were delivered now.
     */
    suspend fun recover(): Int {
        if (!billing.configured) return 0
        return recoverLock.withLock {
            val list = billing.unconsumed() ?: return@withLock 0
            var delivered = 0
            for (p in list) {
                try {
                    if (repo.confirmMyketPurchase(p.originalJson, p.signature).ok) { billing.consume(p); delivered++ }
                } catch (e: ApiException) { /* not ours / not verifiable now: leave it */ } catch (e: NetworkException) { return@withLock delivered }
            }
            delivered
        }
    }

    companion object { const val COMING_SOON = "پرداخت آنلاین به‌زودی فعال می‌شود." }
}
