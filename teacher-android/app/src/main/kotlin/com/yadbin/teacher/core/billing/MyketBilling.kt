package com.yadbin.teacher.core.billing

import android.app.Activity
import android.content.Context
import ir.myket.billingclient.IabHelper
import ir.myket.billingclient.util.IabResult
import ir.myket.billingclient.util.Inventory
import ir.myket.billingclient.util.Purchase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

/** A purchase as the Myket client returns it. [originalJson] + [signature] are what the Worker verifies; the app never decides anything from them. */
class StorePurchase(val originalJson: String, val signature: String, val sku: String, internal val raw: Purchase)

sealed interface PurchaseOutcome {
    data class Success(val purchase: StorePurchase) : PurchaseOutcome
    data object Canceled : PurchaseOutcome
    /** Myket is not installed / billing cannot be used on this device. */
    data class Unavailable(val message: String) : PurchaseOutcome
    /** The product is already owned but not consumed yet (an earlier purchase was never delivered) -> run recovery. */
    data object AlreadyOwned : PurchaseOutcome
    data class Failed(val message: String) : PurchaseOutcome
}

/**
 * Thin coroutine wrapper over the Myket IabHelper (docs «جاوا (Java)»). It only talks to the Myket app; delivery of the purchase is decided by the Worker.
 * Callbacks of the library run on the main thread, so every call is made on Dispatchers.Main.
 * Without a public key in the build ([configured] == false) every call is a harmless no-op.
 */
class MyketBilling(context: Context, publicKey: String) {
    /** Only a well-formed RSA key enables billing: a malformed one would make the library throw while it verifies a purchase. */
    val configured: Boolean = validKey(publicKey)
    private val helper: IabHelper? = if (configured) IabHelper(context.applicationContext, publicKey) else null
    private val setupLock = Mutex()
    @Volatile private var ready = false

    private suspend fun ensureSetup(): IabResult? {
        val h = helper ?: return null
        if (ready) return null
        return setupLock.withLock {
            if (ready) return@withLock null
            withContext(Dispatchers.Main) {
                suspendCancellableCoroutine<IabResult?> { cont ->
                    try {
                        h.startSetup { r -> if (r.isSuccess) { ready = true; if (cont.isActive) cont.resume(null) } else if (cont.isActive) cont.resume(r) }
                    } catch (e: Exception) {
                        if (cont.isActive) cont.resume(IabResult(IabHelper.BILLING_RESPONSE_RESULT_ERROR, e.message ?: "setup failed"))
                    }
                }
            }
        }
    }

    suspend fun purchase(activity: Activity, sku: String, developerPayload: String): PurchaseOutcome {
        val h = helper ?: return PurchaseOutcome.Unavailable("پرداخت آنلاین به‌زودی فعال می‌شود.")
        ensureSetup()?.let { return unavailable(it) }
        return withContext(Dispatchers.Main) {
            suspendCancellableCoroutine<PurchaseOutcome> { cont ->
                fun done(o: PurchaseOutcome) { if (cont.isActive) cont.resume(o) }
                try {
                    h.launchPurchaseFlow(activity, sku, { result, p ->
                        done(
                            when {
                                result.isSuccess && p != null -> PurchaseOutcome.Success(StorePurchase(p.originalJson, p.signature, p.sku, p))
                                result.response == IabHelper.BILLING_RESPONSE_RESULT_USER_CANCELED || result.response == IabHelper.IABHELPER_USER_CANCELLED -> PurchaseOutcome.Canceled
                                result.response == IabHelper.BILLING_RESPONSE_RESULT_ITEM_ALREADY_OWNED -> PurchaseOutcome.AlreadyOwned
                                result.response == IabHelper.BILLING_RESPONSE_RESULT_BILLING_UNAVAILABLE -> PurchaseOutcome.Unavailable(NOT_INSTALLED)
                                else -> PurchaseOutcome.Failed("خرید انجام نشد. دوباره تلاش کنید.")
                            },
                        )
                    }, developerPayload)
                } catch (e: Exception) {
                    done(PurchaseOutcome.Failed("خرید انجام نشد. دوباره تلاش کنید."))
                }
            }
        }
    }

    /** Purchases that were paid but never consumed (the app was closed / offline / the server was unreachable). null = could not ask Myket. */
    suspend fun unconsumed(): List<StorePurchase>? {
        val h = helper ?: return null
        if (ensureSetup() != null) return null
        return withContext(Dispatchers.Main) {
            suspendCancellableCoroutine<List<StorePurchase>?> { cont ->
                try {
                    h.queryInventoryAsync(false) { result: IabResult, inv: Inventory? ->
                        if (!cont.isActive) return@queryInventoryAsync
                        cont.resume(if (result.isSuccess && inv != null) inv.allPurchases.map { StorePurchase(it.originalJson, it.signature, it.sku, it) } else null)
                    }
                } catch (e: Exception) {
                    if (cont.isActive) cont.resume(null)
                }
            }
        }
    }

    /** Tell Myket the product was delivered so it can be bought again. Call ONLY after the Worker answered ok:true. */
    suspend fun consume(p: StorePurchase): Boolean {
        val h = helper ?: return false
        if (ensureSetup() != null) return false
        return withContext(Dispatchers.Main) {
            suspendCancellableCoroutine<Boolean> { cont ->
                try {
                    h.consumeAsync(p.raw) { _, result -> if (cont.isActive) cont.resume(result.isSuccess) }
                } catch (e: Exception) {
                    if (cont.isActive) cont.resume(false)
                }
            }
        }
    }

    private fun unavailable(r: IabResult) = PurchaseOutcome.Unavailable(if (r.response == IabHelper.BILLING_RESPONSE_RESULT_BILLING_UNAVAILABLE) NOT_INSTALLED else "اتصال به مایکت برقرار نشد. دوباره تلاش کنید.")

    companion object {
        private fun validKey(k: String): Boolean = k.isNotBlank() && try {
            java.security.KeyFactory.getInstance("RSA").generatePublic(java.security.spec.X509EncodedKeySpec(android.util.Base64.decode(k, android.util.Base64.DEFAULT)))
            true
        } catch (e: Exception) { false }

        const val NOT_INSTALLED = "برای خرید، برنامهٔ مایکت باید روی گوشی نصب باشد." }
}
