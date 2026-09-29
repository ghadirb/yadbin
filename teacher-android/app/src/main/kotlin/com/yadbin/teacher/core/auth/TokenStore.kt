package com.yadbin.teacher.core.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

/** Teacher session storage. The JWT is the only credential kept on the device (never the password). */
interface TokenStore {
    fun token(): String?
    fun teacherName(): String?
    fun save(token: String, teacherName: String)
    fun clear()
}

class MemoryTokenStore : TokenStore {
    private var token: String? = null
    private var name: String? = null
    override fun token() = token
    override fun teacherName() = name
    override fun save(token: String, teacherName: String) { this.token = token; this.name = teacherName }
    override fun clear() { token = null; name = null }
}

/** Encrypted at rest (Android Keystore). If the keystore is unusable the session simply isn't persisted. */
class EncryptedTokenStore(context: Context) : TokenStore {
    private val fallback = MemoryTokenStore()
    private val prefs: SharedPreferences? = try {
        val alias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        EncryptedSharedPreferences.create(
            "yadbin_session", alias, context,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (e: Exception) {
        null
    }

    override fun token(): String? = prefs?.getString("token", null) ?: fallback.token()
    override fun teacherName(): String? = prefs?.getString("name", null) ?: fallback.teacherName()
    override fun save(token: String, teacherName: String) {
        if (prefs != null) prefs.edit().putString("token", token).putString("name", teacherName).apply()
        else fallback.save(token, teacherName)
    }
    override fun clear() {
        prefs?.edit()?.clear()?.apply()
        fallback.clear()
    }
}
