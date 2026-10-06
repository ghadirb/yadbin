package com.yadbin.teacher.core.avatar

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream

/** Student pictures, LOCAL ONLY (spec §5, §8, §24): app-private internal storage + a tiny preference for the chosen preset.
 *  Never uploaded, never part of any API payload, never part of an activity link. [version] changes whenever anything changes so the UI refreshes. */
class StudentAvatarStore(context: Context) {
    private val app = context.applicationContext
    private val dir = File(app.filesDir, "student_photos")
    private val prefs = app.getSharedPreferences("student_avatar_presets", Context.MODE_PRIVATE)
    private val _version = MutableStateFlow(0)
    val version: StateFlow<Int> = _version.asStateFlow()

    private fun bump() { _version.value = _version.value + 1 }
    private fun file(id: String): File? = AvatarLogic.safeKey(id)?.let { File(dir, "$it.jpg") }

    fun hasPhoto(id: String): Boolean = file(id)?.isFile == true

    fun chosenPreset(id: String): Int? {
        val k = AvatarLogic.safeKey(id) ?: return null
        return prefs.getInt("p_$k", -1).takeIf { it in 0 until AvatarLogic.PRESET_COUNT }
    }

    fun setPreset(id: String, index: Int?) {
        val k = AvatarLogic.safeKey(id) ?: return
        prefs.edit().apply { if (index == null) remove("p_$k") else putInt("p_$k", index) }.apply()
        bump()
    }

    fun removePhoto(id: String) { file(id)?.delete(); bump() }

    /** Full student deletion: photo AND preset choice go away (spec §9). */
    fun deleteAll(id: String) {
        file(id)?.delete()
        AvatarLogic.safeKey(id)?.let { prefs.edit().remove("p_$it").apply() }
        bump()
    }

    /** Account deletion: every local student picture and preset choice goes away. */
    fun deleteEverything() {
        dir.listFiles()?.forEach { it.delete() }
        prefs.edit().clear().apply()
        bump()
    }

    suspend fun savePhotoFromUri(id: String, uri: Uri): Boolean = withContext(Dispatchers.IO) {
        val target = file(id) ?: return@withContext false
        try {
            val resolver = app.contentResolver
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            val s1 = resolver.openInputStream(uri) ?: return@withContext false
            s1.use { BitmapFactory.decodeStream(it, null, bounds) }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@withContext false
            val opts = BitmapFactory.Options().apply { inSampleSize = AvatarLogic.sampleSize(bounds.outWidth, bounds.outHeight, AvatarLogic.PHOTO_SIZE_PX) }
            val s2 = resolver.openInputStream(uri) ?: return@withContext false
            val bmp = s2.use { BitmapFactory.decodeStream(it, null, opts) } ?: return@withContext false
            val degrees = resolver.openInputStream(uri)?.use { exifDegrees(it) } ?: 0
            writeSquare(target, bmp, degrees)
        } catch (e: Exception) {
            false
        }
    }

    suspend fun savePhotoBitmap(id: String, bmp: Bitmap): Boolean = withContext(Dispatchers.IO) {
        val target = file(id) ?: return@withContext false
        try { writeSquare(target, bmp, 0) } catch (e: Exception) { false }
    }

    /** Decoded at (about) [maxPx] to keep lists light. */
    suspend fun loadBitmap(id: String, maxPx: Int): Bitmap? = withContext(Dispatchers.IO) {
        val f = file(id)?.takeIf { it.isFile } ?: return@withContext null
        try {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(f.path, bounds)
            if (bounds.outWidth <= 0) return@withContext null
            val opts = BitmapFactory.Options().apply { inSampleSize = AvatarLogic.sampleSize(bounds.outWidth, bounds.outHeight, maxPx.coerceAtLeast(32)) }
            BitmapFactory.decodeFile(f.path, opts)
        } catch (e: Exception) {
            null
        }
    }

    private fun exifDegrees(stream: InputStream): Int = try {
        when (ExifInterface(stream).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90
            ExifInterface.ORIENTATION_ROTATE_180 -> 180
            ExifInterface.ORIENTATION_ROTATE_270 -> 270
            else -> 0
        }
    } catch (e: Exception) {
        0
    }

    /** Centered square, max 512 px, JPEG; written to a temp file first so a crash never leaves a half-written picture. */
    private fun writeSquare(target: File, src: Bitmap, degrees: Int): Boolean {
        val rotated = if (degrees == 0) src else Bitmap.createBitmap(src, 0, 0, src.width, src.height, Matrix().apply { postRotate(degrees.toFloat()) }, true)
        val crop = AvatarLogic.cropSquare(rotated.width, rotated.height)
        val square = Bitmap.createBitmap(rotated, crop[0], crop[1], crop[2], crop[2])
        val out = if (crop[2] > AvatarLogic.PHOTO_SIZE_PX) Bitmap.createScaledBitmap(square, AvatarLogic.PHOTO_SIZE_PX, AvatarLogic.PHOTO_SIZE_PX, true) else square
        dir.mkdirs()
        val tmp = File(dir, target.name + ".tmp")
        FileOutputStream(tmp).use { out.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        if (!tmp.renameTo(target)) {
            target.delete()
            if (!tmp.renameTo(target)) { tmp.delete(); return false }
        }
        bump()
        return true
    }
}
