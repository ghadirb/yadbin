package com.yadbin.teacher.core.utils

/** Support contacts and public legal pages. The pages are served by the same Worker as the API, so their base is the API origin. */
object Support {
    const val HANDLE = "@MaliarProSupport"
    const val TELEGRAM_URL = "https://t.me/MaliarProSupport"
    const val RUBIKA_URL = "https://rubika.ir/MaliarProSupport"
    const val EITAA_URL = "https://eitaa.com/MaliarProSupport"

    fun privacyUrl(apiBase: String) = page(apiBase, "privacy")
    fun termsUrl(apiBase: String) = page(apiBase, "terms")
    fun supportUrl(apiBase: String) = page(apiBase, "support")
    private fun page(apiBase: String, name: String) = apiBase.trimEnd('/') + "/" + name

    /** Why the delete button stays disabled: the teacher must type the password and tick the confirmation. */
    fun canDelete(password: String, confirmed: Boolean) = password.isNotEmpty() && confirmed
}
