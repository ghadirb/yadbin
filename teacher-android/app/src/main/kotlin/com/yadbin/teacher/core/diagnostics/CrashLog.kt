package com.yadbin.teacher.core.diagnostics

import android.content.Context
import java.io.File

/**
 * Local-only crash report (no SDK, nothing is sent automatically). The last uncaught exception is saved to app-private storage; the teacher
 * can share it with support from the account screen. Only class names, stack frames and device/app versions are stored — never the exception
 * message (it may contain user text).
 */
object CrashLog {
    private const val FILE = "last_crash.txt"

    fun format(t: Throwable, version: String, device: String): String = buildString {
        appendLine("Yadbin crash report")
        appendLine("app=$version")
        appendLine("device=$device")
        var cur: Throwable? = t
        var depth = 0
        while (cur != null && depth < 4) {
            appendLine(if (depth == 0) "exception=${cur.javaClass.name}" else "caused by=${cur.javaClass.name}")
            cur.stackTrace.take(25).forEach { appendLine("  at $it") }
            cur = cur.cause; depth++
        }
    }

    fun install(context: Context, version: String, device: String) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            runCatching { File(app.filesDir, FILE).writeText(format(e, version, device)) }
            previous?.uncaughtException(thread, e)
        }
    }

    fun read(context: Context): String? = File(context.applicationContext.filesDir, FILE).takeIf { it.isFile }?.readText()?.takeIf { it.isNotBlank() }
    fun clear(context: Context) { File(context.applicationContext.filesDir, FILE).delete() }
}
