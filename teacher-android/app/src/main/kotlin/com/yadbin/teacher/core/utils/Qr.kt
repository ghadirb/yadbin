package com.yadbin.teacher.core.utils

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter

/** Pure-JVM QR module matrix (rows of booleans); drawn on a Compose Canvas. No Bitmap / Android dependency. */
object Qr {
    fun matrix(text: String): Array<BooleanArray> {
        val hints = mapOf<EncodeHintType, Any>(EncodeHintType.MARGIN to 2, EncodeHintType.CHARACTER_SET to "UTF-8")
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints)
        return Array(m.height) { y -> BooleanArray(m.width) { x -> m.get(x, y) } }
    }
}
