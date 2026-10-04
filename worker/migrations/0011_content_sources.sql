-- v1.5: Content Sources (کتاب‌ها و منابع درسی) for source-grounded assessments. Additive only: no existing column changes meaning.
-- A source belongs to exactly one teacher (teacher_id). Every query filters by it. Deleting a source cascades to sections and chunks.
-- Only the EXTRACTED TEXT is stored. The uploaded file itself is processed in memory and never persisted (see docs/content-sources.md).

CREATE TABLE content_sources (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  subject TEXT,
  grade_code TEXT,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf','docx','txt','paste')),
  original_file_name TEXT,
  -- pending_file: created, waiting for the file. processing: being extracted. ready: usable.
  -- needs_review: extracted but the structure is uncertain (teacher picks ranges by hand). needs_ocr: scanned PDF, no text layer. failed: unreadable.
  status TEXT NOT NULL DEFAULT 'pending_file' CHECK (status IN ('pending_file','processing','ready','needs_review','needs_ocr','failed')),
  status_message TEXT,
  char_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_content_sources_teacher ON content_sources(teacher_id, created_at);

CREATE TABLE content_source_sections (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES content_sources(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES content_source_sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  section_type TEXT NOT NULL DEFAULT 'section' CHECK (section_type IN ('chapter','lesson','section','exercise','summary','other')),
  order_index INTEGER NOT NULL
);
CREATE INDEX idx_content_sections_source ON content_source_sections(source_id, order_index);

CREATE TABLE content_source_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES content_sources(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES content_source_sections(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  page_number INTEGER,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_content_chunks_source ON content_source_chunks(source_id, chunk_index);
CREATE INDEX idx_content_chunks_section ON content_source_chunks(section_id, chunk_index);

-- Where each AI question came from. All nullable: manually written questions and every existing row stay valid.
-- source_reference is human-readable Persian text built by the server from real section/page data, never taken from the model.
ALTER TABLE assessment_questions ADD COLUMN source_id TEXT;
ALTER TABLE assessment_questions ADD COLUMN section_id TEXT;
ALTER TABLE assessment_questions ADD COLUMN chunk_id TEXT;
ALTER TABLE assessment_questions ADD COLUMN page_number INTEGER;
ALTER TABLE assessment_questions ADD COLUMN source_reference TEXT;

-- The source an assessment was generated from (for the teacher report). A snapshot of the title is kept so the report survives deleting the source.
ALTER TABLE assessments ADD COLUMN source_id TEXT;
ALTER TABLE assessments ADD COLUMN source_title TEXT;
