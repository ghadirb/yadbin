-- v1.3: Teacher Assessments (آزمون‌های معلم). Additive only: no existing table or column is changed.
-- Separate from cognitive activities: its own content type, its own questions, its own results.
-- Nothing here is ever written to game_sessions / game_results / student_metrics.

CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  -- all versions of one assessment share root_id. A published version is immutable: editing it creates version + 1.
  root_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  content_type TEXT NOT NULL DEFAULT 'teacher_assessment' CHECK (content_type = 'teacher_assessment'),
  title TEXT NOT NULL,
  description TEXT,
  subject TEXT,
  grade_code TEXT,
  level TEXT,
  suggested_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','teacher_preview','ready_to_publish','published','archived')),
  -- bumped by every change that alters what a student sees; a preview is only valid for the revision it ran on
  content_rev INTEGER NOT NULL DEFAULT 1,
  previewed_at TEXT,
  preview_feedback TEXT,
  teacher_approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  archived_at TEXT,
  UNIQUE (root_id, version)
);
CREATE INDEX idx_assessments_teacher ON assessments(teacher_id, status);
CREATE INDEX idx_assessments_root ON assessments(root_id);

CREATE TABLE assessment_questions (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('multiple_choice','true_false','fill_blank')),
  text TEXT NOT NULL,
  options_json TEXT,
  correct_json TEXT NOT NULL,
  explanation TEXT,
  source_question_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_assessment_questions ON assessment_questions(assessment_id, position);

-- Same idea as teacher_preview_sessions (which is bound to activities by a foreign key): isolated from students.
CREATE TABLE assessment_preview_sessions (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  content_rev INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed'))
);
CREATE INDEX idx_assessment_preview ON assessment_preview_sessions(assessment_id, teacher_id);

-- One link per student (the same model as activity_students). The link is /play/{token}.
CREATE TABLE assessment_students (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','started','completed')),
  assigned_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (assessment_id, student_id)
);
CREATE INDEX idx_assessment_students_student ON assessment_students(student_id);
CREATE INDEX idx_assessment_students_class ON assessment_students(class_id);

-- UNIQUE(assessment_student_id): refresh / reopening the link always returns the SAME attempt.
CREATE TABLE assessment_attempts (
  id TEXT PRIMARY KEY,
  assessment_student_id TEXT NOT NULL UNIQUE REFERENCES assessment_students(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL,
  assessment_version INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed'))
);

-- Minimal data only: no names, no device ids.
CREATE TABLE assessment_answers (
  attempt_id TEXT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL,
  assessment_version INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  selected_answer INTEGER,
  answer_text TEXT,
  is_correct INTEGER NOT NULL DEFAULT 0,
  response_time_ms INTEGER,
  answered_at TEXT,
  PRIMARY KEY (attempt_id, question_id)
);
CREATE INDEX idx_assessment_answers_question ON assessment_answers(assessment_id, question_id);

-- attempt_id is the PRIMARY KEY => exactly one result per attempt (idempotent submission).
CREATE TABLE assessment_results (
  attempt_id TEXT PRIMARY KEY REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  total INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  unanswered INTEGER NOT NULL,
  percent REAL NOT NULL,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);
