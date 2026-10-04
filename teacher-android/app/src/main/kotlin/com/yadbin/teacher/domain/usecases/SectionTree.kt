package com.yadbin.teacher.domain.usecases

import com.yadbin.teacher.domain.models.ContentSection

/**
 * Chapter → lesson picking for «ساخت آزمون از کتاب». Pure logic (no Android) so it is unit-tested.
 *
 * The server includes everything inside a chosen chapter, so the selection is a set of section ids where
 * a checked chapter means «all its lessons». Un-checking one lesson of a checked chapter therefore replaces the chapter by its other lessons.
 */
class SectionTree(sections: List<ContentSection>) {
    private val byId: Map<String, ContentSection> = sections.associateBy { it.id }
    private val children: Map<String, List<ContentSection>> = sections.filter { it.parentId != null && it.parentId in byId }.sortedBy { it.orderIndex }.groupBy { it.parentId!! }
    /** Sections without a (known) parent: chapters, or the single «کل متن» section of a book with no recognisable structure. */
    val roots: List<ContentSection> = sections.filter { it.parentId == null || it.parentId !in byId }.sortedBy { it.orderIndex }

    fun childrenOf(id: String): List<ContentSection> = children[id].orEmpty()

    fun descendants(id: String): List<ContentSection> = childrenOf(id).flatMap { listOf(it) + descendants(it.id) }

    private fun parentOf(id: String): String? = byId[id]?.parentId?.takeIf { it in byId }

    /** The nearest selected ancestor of [id] (not [id] itself), or null. */
    private fun selectedAncestor(selected: Set<String>, id: String): String? {
        var p = parentOf(id)
        while (p != null) { if (p in selected) return p; p = parentOf(p) }
        return null
    }

    /** Shown as checked: chosen itself, or inside a chosen chapter. */
    fun isChecked(selected: Set<String>, id: String): Boolean = id in selected || selectedAncestor(selected, id) != null

    fun toggle(selected: Set<String>, id: String): Set<String> {
        if (id !in byId) return selected
        if (!isChecked(selected, id)) return selected - descendants(id).map { it.id }.toSet() + id
        val anc = selectedAncestor(selected, id) ?: return selected - id // chosen itself: just un-choose it
        // Inside a chosen chapter: drop the chapter and keep every other branch on the way down to [id].
        var result = selected - anc
        var cur = anc
        val path = ArrayDeque<String>().also { d -> var p: String? = id; while (p != null && p != anc) { d.addFirst(p); p = parentOf(p) } }
        for (step in path) {
            childrenOf(cur).filter { it.id != step }.forEach { result = result + it.id }
            cur = step
        }
        return result
    }

    /** Everything the server will read: the chosen sections and all that is inside them. */
    fun effectiveIds(selected: Set<String>): Set<String> = selected.filter { it in byId }.flatMap { listOf(it) + descendants(it).map { d -> d.id } }.toSet()

    fun chars(selected: Set<String>): Int = effectiveIds(selected).sumOf { byId[it]?.charCount ?: 0 }

    fun titles(selected: Set<String>): List<String> = selected.mapNotNull { byId[it] }.sortedBy { it.orderIndex }.map { it.title }

    /** The ids to send: chapters collapse into one id, which already covers their lessons. */
    fun idsToSend(selected: Set<String>): List<String> = selected.filter { it in byId }.sortedBy { byId[it]!!.orderIndex }

    /** Every section in reading order (chapter, then its lessons …) with its depth, for drawing the indented list. */
    fun flatten(): List<Pair<ContentSection, Int>> {
        val out = ArrayList<Pair<ContentSection, Int>>()
        fun walk(s: ContentSection, depth: Int) {
            out.add(s to depth)
            childrenOf(s.id).forEach { walk(it, depth + 1) }
        }
        roots.forEach { walk(it, 0) }
        return out
    }
}
