package com.yadbin.teacher.ui.sources

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.yadbin.teacher.core.utils.SourceFiles
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException

/** A book file the teacher picked, already read into memory (it is sent to the server once and never stored on the phone). */
sealed interface PickResult {
    class Ok(val name: String, val type: String, val bytes: ByteArray) : PickResult
    data class Bad(val message: String) : PickResult
}

/** Name of the picked document as the file manager shows it (the system file picker needs no storage permission). */
fun displayName(ctx: Context, uri: Uri): String? =
    runCatching {
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull() ?: uri.lastPathSegment

/** Reads the file in the background. Wrong type, empty or bigger than the limit → [PickResult.Bad] with a plain Persian reason (never a crash). */
suspend fun readPickedFile(ctx: Context, uri: Uri): PickResult = withContext(Dispatchers.IO) {
    val name = displayName(ctx, uri)
    SourceFiles.problemFor(name, 1L)?.let { return@withContext PickResult.Bad(it) } // type first: size is not known yet
    val type = SourceFiles.typeFor(name) ?: return@withContext PickResult.Bad("نوع فایل پشتیبانی نمی‌شود.")
    try {
        val stream = ctx.contentResolver.openInputStream(uri) ?: return@withContext PickResult.Bad("فایل باز نشد. دوباره انتخاب کنید.")
        val out = ByteArrayOutputStream()
        var tooBig = false
        stream.use { input ->
            val buf = ByteArray(16 * 1024)
            var total = 0
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                total += n
                if (total > SourceFiles.MAX_BYTES) { tooBig = true; break } // stop reading: never hold a huge file in memory
                out.write(buf, 0, n)
            }
        }
        if (tooBig) return@withContext PickResult.Bad(SourceFiles.problemFor(name, SourceFiles.MAX_BYTES + 1L) ?: "حجم فایل زیاد است.")
        val bytes = out.toByteArray()
        SourceFiles.problemFor(name, bytes.size.toLong())?.let { return@withContext PickResult.Bad(it) }
        PickResult.Ok(name ?: "book.$type", type, bytes)
    } catch (e: IOException) {
        PickResult.Bad("خواندن فایل ممکن نشد. فایل را دوباره انتخاب کنید.")
    } catch (e: SecurityException) {
        PickResult.Bad("دسترسی به فایل داده نشد. فایل را دوباره انتخاب کنید.")
    }
}
