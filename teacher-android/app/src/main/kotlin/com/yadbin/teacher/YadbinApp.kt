package com.yadbin.teacher

import android.app.Application
import androidx.room.Room
import com.yadbin.teacher.core.auth.EncryptedTokenStore
import com.yadbin.teacher.core.auth.TokenStore
import com.yadbin.teacher.core.avatar.StudentAvatarStore
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

    private val db = Room.databaseBuilder(app, AppDatabase::class.java, "yadbin.db").build()
    private val client = ApiClient(
        baseUrl = BuildConfig.API_BASE_URL,
        tokenProvider = { tokens.token() },
        onUnauthorized = { tokens.clear(); sessionExpired.value = true },
    )
    val repository = Repository(ApiService(client), RoomCacheStore(db.cacheDao()), tokens)
    val createActivity = CreateActivityUseCase(repository)
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
        container = AppContainer(this)
    }
}
