package com.yadbin.teacher

import android.app.Application
import androidx.room.Room
import com.yadbin.teacher.core.auth.EncryptedTokenStore
import com.yadbin.teacher.core.auth.TokenStore
import com.yadbin.teacher.core.avatar.StudentAvatarStore
import com.yadbin.teacher.core.billing.KeyMask
import com.yadbin.teacher.core.billing.MyketBilling
import com.yadbin.teacher.core.billing.PurchaseCoordinator
import com.yadbin.teacher.core.database.AppDatabase
import com.yadbin.teacher.core.network.ApiClient
import com.yadbin.teacher.data.local.RoomCacheStore
import com.yadbin.teacher.data.remote.ApiService
import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.usecases.CreateActivityUseCase
import kotlinx.coroutines.flow.MutableStateFlow

/** Tiny manual DI container (no framework needed at this size). */
class AppContainer(app: Application) {
    val tokens: TokenStore = EncryptedTokenStore(app)
    /** true after the server rejected our token (expired / invalid) -> UI returns to Login. */
    val sessionExpired = MutableStateFlow(false)
    /** Server said a Free-plan limit was reached (FEATURE_LIMIT_REACHED): message to show with an «ارتقا» button. null = nothing to show. */
    val limitMessage = MutableStateFlow<String?>(null)

    private val db = Room.databaseBuilder(app, AppDatabase::class.java, "yadbin.db").build()
    private val client = ApiClient(
        baseUrl = BuildConfig.API_BASE_URL,
        tokenProvider = { tokens.token() },
        onUnauthorized = { tokens.clear(); sessionExpired.value = true },
        onLimitReached = { limitMessage.value = it.ifBlank { "به سقف پلن رایگان رسیده‌اید." } },
    )
    val repository = Repository(ApiService(client), RoomCacheStore(db.cacheDao()), tokens)
    val createActivity = CreateActivityUseCase(repository)
    /** Reads a book PDF on the phone (text layer, or page images via the server's vision endpoint) — the Worker never parses a PDF. */
    val pdfReader = com.yadbin.teacher.core.pdf.PdfReader(
        app,
        readPages = { images, batch, pageStart, documentHash -> repository.readSourcePages(images, batch, pageStart, documentHash) },
        loadQuota = { repository.visionQuota() },
    )
    /** Myket in-app purchase. Without IAB key in the build it stays inert and the UI says «به‌زودی فعال می‌شود». */
    val purchases = PurchaseCoordinator(repository, MyketBilling(app, KeyMask.decode(BuildConfig.IAB_KEY_MASKED)))
    /** Student pictures: local-only (never uploaded). */
    val avatars = StudentAvatarStore(app)
    /** One-shot hand-over from the AI builder / recommendations to the create-activity form (the form is then read-and-cleared). */
    @Volatile var prefill: com.yadbin.teacher.domain.models.ActivityPrefill? = null
}

class YadbinApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        com.yadbin.teacher.core.diagnostics.CrashLog.install(this, "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}, Android ${android.os.Build.VERSION.RELEASE}")
        container = AppContainer(this)
    }
}
