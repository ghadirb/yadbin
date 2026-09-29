package com.yadbin.teacher.data.local

import com.yadbin.teacher.core.database.CacheDao
import com.yadbin.teacher.core.database.CacheEntry

interface CacheStore {
    suspend fun get(key: String): String?
    suspend fun put(key: String, json: String)
    suspend fun clear()
}

class RoomCacheStore(private val dao: CacheDao) : CacheStore {
    override suspend fun get(key: String): String? = dao.get(key)?.json
    override suspend fun put(key: String, json: String) = dao.put(CacheEntry(key, json, System.currentTimeMillis()))
    override suspend fun clear() = dao.clear()
}

class MemoryCacheStore : CacheStore {
    private val map = HashMap<String, String>()
    override suspend fun get(key: String): String? = map[key]
    override suspend fun put(key: String, json: String) { map[key] = json }
    override suspend fun clear() = map.clear()
}
