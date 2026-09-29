package com.yadbin.teacher.domain.usecases

import com.yadbin.teacher.data.repository.Repository
import com.yadbin.teacher.domain.models.ActivityCreated

/** Flow: class -> students (all / manual) -> game -> difficulty -> question count -> unique links. */
class CreateActivityUseCase(private val repo: Repository) {
    /** [selectedIds] == null means the whole class. Defaults follow the spec: adaptive, 10 questions. */
    suspend operator fun invoke(
        classId: String,
        gameType: String,
        difficultyMode: String = "adaptive",
        questionCount: Int = 10,
        selectedIds: List<String>? = null,
    ): ActivityCreated {
        require(questionCount in 5..12) { "questionCount" }
        require(selectedIds == null || selectedIds.isNotEmpty()) { "students" }
        return repo.createActivity(classId, gameType, difficultyMode, questionCount, selectedIds)
    }
}
