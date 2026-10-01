package com.yadbin.teacher.core.utils

/** Static education catalog (mirrors worker/src/education/catalog.ts). Grades are plain data (code + order), so the list can grow. */
data class GradeOption(val code: String, val order: Int, val label: String)
data class CodeLabel(val code: String, val label: String)

object Edu {
    val grades: List<GradeOption> = listOf(
        GradeOption("preschool", 0, "پیش‌دبستانی"),
        GradeOption("g1", 1, "اول ابتدایی"), GradeOption("g2", 2, "دوم ابتدایی"), GradeOption("g3", 3, "سوم ابتدایی"),
        GradeOption("g4", 4, "چهارم ابتدایی"), GradeOption("g5", 5, "پنجم ابتدایی"), GradeOption("g6", 6, "ششم ابتدایی"),
        GradeOption("g7", 7, "هفتم"), GradeOption("g8", 8, "هشتم"), GradeOption("g9", 9, "نهم"),
        GradeOption("g10", 10, "دهم"), GradeOption("g11", 11, "یازدهم"), GradeOption("g12", 12, "دوازدهم"),
    )
    val levels: List<CodeLabel> = listOf(
        CodeLabel("introductory", "مقدماتی"), CodeLabel("basic", "پایه"),
        CodeLabel("intermediate", "متوسط"), CodeLabel("advanced", "پیشرفته"),
    )
    val skills: List<CodeLabel> = listOf(
        CodeLabel("memory", "حافظه"), CodeLabel("attention", "توجه"), CodeLabel("focus", "تمرکز"),
        CodeLabel("reaction_speed", "سرعت واکنش"), CodeLabel("response_control", "کنترل پاسخ"),
        CodeLabel("problem_solving", "حل مسئله"), CodeLabel("pattern_recognition", "تشخیص الگو"),
        CodeLabel("decision_making", "تصمیم‌گیری"), CodeLabel("visual_accuracy", "دقت دیداری"),
    )

    fun gradeLabel(code: String?): String? = grades.firstOrNull { it.code == code }?.label
    fun levelLabel(code: String?): String? = levels.firstOrNull { it.code == code }?.label
    fun skillLabel(code: String): String = skills.firstOrNull { it.code == code }?.label ?: code

    fun fitLabel(fit: String): String = when (fit) {
        "suitable" -> "مناسب"
        "easier_possible" -> "قابل استفاده با سطح ساده‌تر"
        "out_of_range" -> "خارج از محدوده پیشنهادی"
        "unrestricted" -> "بدون محدوده سنی/پایه"
        else -> "اطلاعات سن/پایه ثبت نشده"
    }

    fun genderLabel(g: String?): String? = when (g) { "female" -> "دختر"; "male" -> "پسر"; else -> null }

    /** «۸ تا ۹ سال» / «از ۸ سال» / «تا ۹ سال» / null */
    fun ageRange(min: Int?, max: Int?): String? = when {
        min != null && max != null -> "${min.fa()} تا ${max.fa()} سال"
        min != null -> "از ${min.fa()} سال"
        max != null -> "تا ${max.fa()} سال"
        else -> null
    }

    /** «سوم ابتدایی تا ششم ابتدایی» / single grade / null */
    fun gradeRange(minLabel: String?, maxLabel: String?): String? = when {
        minLabel != null && maxLabel != null -> if (minLabel == maxLabel) minLabel else "$minLabel تا $maxLabel"
        minLabel != null -> "از $minLabel"
        maxLabel != null -> "تا $maxLabel"
        else -> null
    }

    fun performanceLabel(status: String): String = when (status) {
        "good" -> "خوب"; "average" -> "متوسط"; "needs_practice" -> "نیاز به تمرین بیشتر"; else -> "داده کافی نیست"
    }
}
