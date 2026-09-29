package com.yadbin.teacher.core.database

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase

/** Offline cache of teacher-side data: the last successful API response per screen, as JSON. */
@Entity(tableName = "cache_entries")
data class CacheEntry(
    @PrimaryKey val cacheKey: String,
    val json: String,
    val updatedAt: Long,
)

@Dao
interface CacheDao {
    @Query("SELECT * FROM cache_entries WHERE cacheKey = :cacheKey")
    suspend fun get(cacheKey: String): CacheEntry?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(entry: CacheEntry)

    @Query("DELETE FROM cache_entries")
    suspend fun clear()
}

@Database(entities = [CacheEntry::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun cacheDao(): CacheDao
}
