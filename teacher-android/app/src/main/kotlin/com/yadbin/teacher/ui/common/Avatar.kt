package com.yadbin.teacher.ui.common

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.yadbin.teacher.core.avatar.AvatarLogic
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** The student's picture, with NO empty state: own photo → chosen preset → default preset (spec §7). Local only. */
@Composable
fun StudentAvatar(studentId: String, modifier: Modifier = Modifier, size: Dp = 48.dp, onClick: (() -> Unit)? = null) {
    val store = LocalContainer.current.avatars
    val version by store.version.collectAsStateWithLifecycle()
    val px = with(LocalDensity.current) { size.roundToPx() }
    val photo by produceState<ImageBitmap?>(null, studentId, version, px) {
        value = if (store.hasPhoto(studentId)) store.loadBitmap(studentId, px)?.asImageBitmap() else null
    }
    val base = modifier.size(size).clip(CircleShape).let { if (onClick != null) it.clickable(onClick = onClick) else it }
    val img = photo
    if (img != null) {
        Image(bitmap = img, contentDescription = "تصویر دانش‌آموز", contentScale = ContentScale.Crop, modifier = base)
    } else {
        val src = AvatarLogic.resolve(store.hasPhoto(studentId), store.chosenPreset(studentId), studentId)
        PresetAvatar((src as? AvatarLogic.Source.Preset)?.index ?: AvatarLogic.defaultIndex(studentId), base)
    }
}

private val AvatarBg = listOf(Color(0xFFCCFBF1), Color(0xFFFEF3C7), Color(0xFFE0E7FF), Color(0xFFFCE7F3), Color(0xFFDCFCE7), Color(0xFFFFEDD5))
private val AvatarFg = listOf(Color(0xFF2DD4BF), Color(0xFFFBBF24), Color(0xFF818CF8), Color(0xFFF472B6), Color(0xFF4ADE80), Color(0xFFFB923C))
private val Ink = Color(0xFF1F2937)

/** Six friendly, gender-neutral illustrations in one style (bear, cat, rabbit, owl, robot, sun). Drawn in code: no image files, no real children's photos. */
@Composable
fun PresetAvatar(index: Int, modifier: Modifier = Modifier) {
    val i = index.mod(AvatarLogic.PRESET_COUNT)
    Canvas(modifier.background(AvatarBg[i])) {
        val s = size.minDimension
        fun p(x: Float, y: Float) = Offset(x * s, y * s)
        val face = AvatarFg[i]
        fun eyes(y: Float = 0.52f, dx: Float = 0.11f, r: Float = 0.036f) {
            drawCircle(Ink, r * s, p(0.5f - dx, y)); drawCircle(Ink, r * s, p(0.5f + dx, y))
        }
        when (i) {
            0 -> { // bear
                drawCircle(face, 0.11f * s, p(0.27f, 0.32f)); drawCircle(face, 0.11f * s, p(0.73f, 0.32f))
                drawCircle(face, 0.30f * s, p(0.5f, 0.56f))
                drawOval(Color.White.copy(alpha = 0.55f), topLeft = p(0.38f, 0.58f), size = Size(0.24f * s, 0.18f * s))
                eyes(); drawCircle(Ink, 0.04f * s, p(0.5f, 0.63f))
            }
            1 -> { // cat
                drawPath(Path().apply { moveTo(0.22f * s, 0.46f * s); lineTo(0.27f * s, 0.16f * s); lineTo(0.45f * s, 0.32f * s); close() }, face)
                drawPath(Path().apply { moveTo(0.78f * s, 0.46f * s); lineTo(0.73f * s, 0.16f * s); lineTo(0.55f * s, 0.32f * s); close() }, face)
                drawCircle(face, 0.30f * s, p(0.5f, 0.58f))
                eyes(0.54f); drawCircle(Color(0xFFFDA4AF), 0.035f * s, p(0.5f, 0.62f))
                val w = 0.012f * s
                drawLine(Ink, p(0.18f, 0.62f), p(0.35f, 0.64f), w); drawLine(Ink, p(0.18f, 0.69f), p(0.35f, 0.67f), w)
                drawLine(Ink, p(0.82f, 0.62f), p(0.65f, 0.64f), w); drawLine(Ink, p(0.82f, 0.69f), p(0.65f, 0.67f), w)
            }
            2 -> { // rabbit
                drawRoundRect(face, topLeft = p(0.33f, 0.05f), size = Size(0.12f * s, 0.40f * s), cornerRadius = CornerRadius(0.06f * s))
                drawRoundRect(face, topLeft = p(0.55f, 0.05f), size = Size(0.12f * s, 0.40f * s), cornerRadius = CornerRadius(0.06f * s))
                drawCircle(face, 0.27f * s, p(0.5f, 0.64f))
                eyes(0.60f); drawCircle(Color(0xFFFDA4AF), 0.04f * s, p(0.5f, 0.69f))
            }
            3 -> { // owl
                drawPath(Path().apply { moveTo(0.24f * s, 0.40f * s); lineTo(0.26f * s, 0.14f * s); lineTo(0.42f * s, 0.27f * s); close() }, face)
                drawPath(Path().apply { moveTo(0.76f * s, 0.40f * s); lineTo(0.74f * s, 0.14f * s); lineTo(0.58f * s, 0.27f * s); close() }, face)
                drawCircle(face, 0.31f * s, p(0.5f, 0.57f))
                drawCircle(Color.White, 0.10f * s, p(0.38f, 0.51f)); drawCircle(Color.White, 0.10f * s, p(0.62f, 0.51f))
                drawCircle(Ink, 0.045f * s, p(0.38f, 0.52f)); drawCircle(Ink, 0.045f * s, p(0.62f, 0.52f))
                drawPath(Path().apply { moveTo(0.45f * s, 0.62f * s); lineTo(0.55f * s, 0.62f * s); lineTo(0.5f * s, 0.72f * s); close() }, Color(0xFFF59E0B))
            }
            4 -> { // robot
                drawLine(Ink, p(0.5f, 0.12f), p(0.5f, 0.27f), 0.02f * s); drawCircle(Ink, 0.04f * s, p(0.5f, 0.11f))
                drawRoundRect(face, topLeft = p(0.22f, 0.26f), size = Size(0.56f * s, 0.50f * s), cornerRadius = CornerRadius(0.10f * s))
                drawCircle(Color.White, 0.07f * s, p(0.38f, 0.47f)); drawCircle(Color.White, 0.07f * s, p(0.62f, 0.47f))
                drawCircle(Ink, 0.035f * s, p(0.38f, 0.47f)); drawCircle(Ink, 0.035f * s, p(0.62f, 0.47f))
                drawLine(Ink, p(0.38f, 0.64f), p(0.62f, 0.64f), 0.025f * s, cap = StrokeCap.Round)
            }
            else -> { // sun
                val c = p(0.5f, 0.5f)
                for (k in 0 until 8) {
                    val a = k * PI.toFloat() / 4f
                    drawLine(face, Offset(c.x + cos(a) * 0.33f * s, c.y + sin(a) * 0.33f * s), Offset(c.x + cos(a) * 0.43f * s, c.y + sin(a) * 0.43f * s), 0.04f * s, cap = StrokeCap.Round)
                }
                drawCircle(face, 0.27f * s, c)
                eyes(0.46f)
                drawArc(Ink, 20f, 140f, false, topLeft = p(0.38f, 0.46f), size = Size(0.24f * s, 0.20f * s), style = Stroke(width = 0.02f * s, cap = StrokeCap.Round))
            }
        }
    }
}
