-- v1.1: class archive, activity metadata/archive. Additive only (old rows stay valid; all new columns are nullable).
ALTER TABLE classes ADD COLUMN archived_at TEXT;
ALTER TABLE activities ADD COLUMN title TEXT;
ALTER TABLE activities ADD COLUMN description TEXT;
ALTER TABLE activities ADD COLUMN suggested_minutes INTEGER;
ALTER TABLE activities ADD COLUMN archived_at TEXT;
CREATE INDEX idx_classes_teacher_archived ON classes(teacher_id, archived_at);
