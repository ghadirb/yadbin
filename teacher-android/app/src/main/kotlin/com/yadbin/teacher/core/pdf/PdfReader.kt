package com.yadbin.teacher.core.pdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.Base64
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.yadbin.teacher.core.network.ApiException
import com.yadbin.teacher.core.network.NetworkException
import com.yadbin.teacher.core.utils.PdfTextRules
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import kotlin.math.min
import kotlin.math.roundToInt

/** Monthly image-reading allowance from GET /api/content-sources/vision-quota. */
@kotlinx.serialization.Serializable
data class VisionQuota(val allowed: Boolean = false, val limit: Int = 0, val used: Int = 0, val remaining: Int = 0, val maxPagesPerBook: Int = 120)

/** Result of reading a book PDF on the phone. */
sealed interface PdfReadResult {
    /** [text] = one string, pages separated by \f (what the Worker expects). [viaVision] = the pages were read from images. */
    class Text(val text: String, val viaVision: Boolean) : PdfReadResult
    /** Plain Persian reason (never technical) why this file cannot be read here. */
    data class Failed(val message: String) : PdfReadResult
}

/**
 * Reads a PDF WITHOUT the server parsing it (the free Cloudflare plan cannot afford that: a 150-page book exceeds its CPU limit).
 *  1. text layer on the phone with PdfBox-Android, page by page;
 *  2. when that text is missing / broken / letter-reversed Persian (typical for school textbooks and scans) → render pages to JPEG with the
 *     built-in PdfRenderer and let the server's vision endpoint read them [BATCH] pages at a time.
 * Nothing is stored: the file is copied to the app cache only while reading and deleted afterwards.
 * [readPages] sends one batch of base64 JPEGs and returns their text (Repository.readSourcePages); its ApiException / NetworkException pass through to the caller.
 */
class PdfReader(
    private val app: Context,
    private val readPages: suspend (images: List<String>, batchIndex: Int, pageStart: Int, documentHash: String) -> List<String>,
    /** Loads the teacher's image-reading allowance; null when it cannot be loaded (the server still enforces it). */
    private val loadQuota: suspend () -> VisionQuota? = { null },
) {
    companion object {
        const val BATCH = 4
        /** More pages than this by image reading would take too long and cost too many AI requests: ask for chapters instead. */
        const val VISION_MAX_PAGES = 120
        private val WIDTHS = intArrayOf(1100, 900, 700)
        private val QUALITIES = intArrayOf(70, 50)
        /** Worker limit per image (VISION.maxImageChars). */
        private const val MAX_IMAGE_CHARS = 600_000
    }

    /** [progress] gets (pagesDone, pagesTotal, viaVision) so the screen can say «صفحهٔ ۱۲ از ۱۵۳». */
    /**
     * [chooseRange] is asked ONLY when the text layer is unusable and pages must be read from images (paid, metered): it gets the page count and the
     * allowance and returns the 1-based inclusive page range to read, or null when the teacher cancels.
     */
    suspend fun read(
        bytes: ByteArray,
        progress: (Int, Int, Boolean) -> Unit,
        chooseRange: suspend (pageCount: Int, quota: VisionQuota?) -> IntRange? = { n, _ -> 1..minOf(n, VISION_MAX_PAGES) },
    ): PdfReadResult = withContext(Dispatchers.IO) {
        val file = File.createTempFile("book", ".pdf", app.cacheDir)
        try {
            file.writeBytes(bytes)
            val own = try { textLayer(file, progress) } catch (e: TooManyPages) { return@withContext PdfReadResult.Failed(TOO_MANY_PAGES) }
            if (own != null && PdfTextRules.isUsable(own)) return@withContext PdfReadResult.Text(PdfTextRules.join(own), false)
            visionRead(file, progress, sha256(bytes), chooseRange)
        } finally { file.delete() }
    }

    private class TooManyPages : Exception()

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    /** Text of every page, or null when PdfBox cannot open / read the file (then the image path is tried). */
    private suspend fun textLayer(file: File, progress: (Int, Int, Boolean) -> Unit): List<String>? {
        return try {
            PDFBoxResourceLoader.init(app)
            PDDocument.load(file, MemoryUsageSetting.setupTempFileOnly()).use { doc ->
                val n = doc.numberOfPages
                if (n > PdfTextRules.MAX_PAGES) throw TooManyPages()
                val stripper = PDFTextStripper()
                val pages = ArrayList<String>(n)
                for (i in 1..n) {
                    currentCoroutineContext().ensureActive()
                    stripper.startPage = i
                    stripper.endPage = i
                    pages += stripper.getText(doc).orEmpty().trim()
                    progress(i, n, false)
                }
                pages as List<String>
            }
        } catch (e: TooManyPages) { throw e
        } catch (e: CancellationException) { throw e
        } catch (e: Throwable) { null } // broken / encrypted file or out of memory: let the renderer try
    }

    private suspend fun visionRead(
        file: File,
        progress: (Int, Int, Boolean) -> Unit,
        documentHash: String,
        chooseRange: suspend (Int, VisionQuota?) -> IntRange?,
    ): PdfReadResult {
        val pfd = try { ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY) } catch (e: Exception) { return PdfReadResult.Failed(UNREADABLE) }
        try {
            val renderer = try { PdfRenderer(pfd) } catch (e: Exception) { return PdfReadResult.Failed(UNREADABLE) } // password-protected or damaged
            try {
                val n = renderer.pageCount
                if (n == 0) return PdfReadResult.Failed(UNREADABLE)
                // Look at the allowance BEFORE rendering or sending anything: a Free account must not even start.
                val quota = try { loadQuota() } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
                if (quota != null && !quota.allowed) return PdfReadResult.Failed(SUBSCRIPTION_REQUIRED)
                val range = chooseRange(n, quota) ?: return PdfReadResult.Failed(CANCELLED)
                val first = range.first.coerceAtLeast(1) - 1
                val last = min(n, range.last)
                val count = last - first
                if (count <= 0) return PdfReadResult.Failed(BAD_RANGE)
                if (count > VISION_MAX_PAGES) return PdfReadResult.Failed(TOO_MANY_FOR_IMAGES)
                val out = ArrayList<String>(count)
                var batch = 0
                var i = first
                while (i < last) {
                    currentCoroutineContext().ensureActive()
                    val end = min(last, i + BATCH)
                    val images = (i until end).map { renderJpegBase64(renderer, it) }
                    out += sendBatch(images, batch, i, documentHash)
                    batch++
                    i = end
                    progress(i - first, count, true)
                }
                if (!PdfTextRules.isUsable(out)) return PdfReadResult.Failed(NO_TEXT_FOUND)
                return PdfReadResult.Text(PdfTextRules.join(out), true)
            } finally { renderer.close() }
        } finally { pfd.close() }
    }

    /** One batch, with a single quiet retry for a temporary AI / network failure (pages already read are cached on the server, so a retry is free). */
    private suspend fun sendBatch(images: List<String>, batch: Int, pageStart: Int, documentHash: String): List<String> {
        try {
            return readPages(images, batch, pageStart, documentHash)
        } catch (e: NetworkException) {
        } catch (e: ApiException) { if (e.status != 502 && e.status != 503) throw e }
        return readPages(images, batch, pageStart, documentHash)
    }

    private fun renderJpegBase64(r: PdfRenderer, index: Int): String {
        r.openPage(index).use { page ->
            var last = ""
            for (w in WIDTHS) {
                val h = (page.height.toFloat() * w / page.width).roundToInt().coerceAtLeast(1)
                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                try {
                    bmp.eraseColor(Color.WHITE)
                    page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    for (q in QUALITIES) {
                        val bos = ByteArrayOutputStream()
                        bmp.compress(Bitmap.CompressFormat.JPEG, q, bos)
                        last = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
                        if (last.length <= MAX_IMAGE_CHARS) return last
                    }
                } finally { bmp.recycle() }
            }
            return last // still too big: the server refuses it with a clear message
        }
    }
}

private const val UNREADABLE = "فایل خوانده نشد؛ ممکن است رمزدار یا آسیب‌دیده باشد. فایل دیگری را امتحان کنید یا متن کتاب را وارد کنید."
private const val TOO_MANY_PAGES = "تعداد صفحات از حد مجاز (۳۰۰ صفحه) بیشتر است. فصل‌های موردنظر را جداگانه وارد کنید."
private const val TOO_MANY_FOR_IMAGES = "خواندن تصویری در هر بار فقط تا ۱۲۰ صفحه ممکن است. بازهٔ کوچک‌تری (مثلاً یک یا چند فصل) را انتخاب کنید."
private const val NO_TEXT_FOUND = "از صفحه‌های این فایل متن قابل‌استفاده‌ای خوانده نشد. فایل دیگری را امتحان کنید یا متن کتاب را وارد کنید."
private const val SUBSCRIPTION_REQUIRED = "متن این PDF از روی خود فایل قابل خواندن نیست و خواندن تصویری فقط با اشتراک فعال ممکن است. می‌توانید اشتراک تهیه کنید یا متن کتاب را وارد کنید."
private const val CANCELLED = "خواندن تصویری لغو شد."
private const val BAD_RANGE = "بازهٔ صفحه‌ها معتبر نیست."
