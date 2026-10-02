-- Teacher previews are deliberately separate from student assignments and sessions.
ALTER TABLE activities ADD COLUMN previewed_at TEXT;
ALTER TABLE activities ADD COLUMN preview_feedback TEXT;
ALTER TABLE activities ADD COLUMN teacher_approved_at TEXT;
-- `status` is retained for legacy active/canceled compatibility. This workflow state is additive.
ALTER TABLE activities ADD COLUMN publish_state TEXT NOT NULL DEFAULT 'published';
ALTER TABLE activities ADD COLUMN requires_preview INTEGER NOT NULL DEFAULT 0;

CREATE TABLE teacher_preview_sessions (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
  tuning INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_teacher_preview_activity ON teacher_preview_sessions(activity_id, teacher_id);
