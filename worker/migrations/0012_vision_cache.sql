-- v1.6: shared cache and monthly page accounting for paid PDF image reading.
-- Only OCR text is cached; page images and source files are never stored.
CREATE TABLE content_source_vision_cache (
  document_hash TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_hash, page_index)
);
CREATE INDEX idx_vision_cache_hash ON content_source_vision_cache(document_hash);
