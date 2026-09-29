-- Yadbin D1 schema (MVP)

CREATE TABLE teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE classes (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  grade TEXT NOT NULL,
  school_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_classes_teacher ON classes(teacher_id);

-- teacher_id added (not in the spec table) so ownership can be enforced and
-- so that "delete student data" can be scoped to one teacher.
CREATE TABLE students (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  grade TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_students_teacher ON students(teacher_id);

-- removed_at: "remove from class" (soft) is different from deleting data.
CREATE TABLE class_students (
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY (class_id, student_id)
);
CREATE INDEX idx_class_students_student ON class_students(student_id);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL CHECK (game_type IN ('memory','attention','problem_solving')),
  difficulty_mode TEXT NOT NULL CHECK (difficulty_mode IN ('adaptive','easy','medium','hard')),
  question_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled')),
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX idx_activities_class ON activities(class_id, created_at);
CREATE INDEX idx_activities_teacher ON activities(teacher_id);

CREATE TABLE activity_students (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','started','completed')),
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (activity_id, student_id)
);
CREATE INDEX idx_activity_students_student ON activity_students(student_id);

-- One session per activity_student (UNIQUE) -> resume, never duplicate.
CREATE TABLE game_sessions (
  id TEXT PRIMARY KEY,
  activity_student_id TEXT NOT NULL UNIQUE REFERENCES activity_students(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed'))
);

-- session_id is the PRIMARY KEY => exactly one valid result per session (idempotency).
CREATE TABLE game_results (
  session_id TEXT PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
  accuracy REAL,
  average_response_time REAL,
  difficulty_reached INTEGER,
  hints_used INTEGER,
  independence_score REAL,
  help_response_score REAL,
  improvement_score REAL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  raw_result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  game_type TEXT NOT NULL,
  question_type TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  hint1 TEXT,
  hint2 TEXT,
  example_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_questions_lookup ON questions(game_type, difficulty, active);

CREATE TABLE student_metrics (
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL,
  accuracy REAL,
  speed_score REAL,
  independence_score REAL,
  help_response_score REAL,
  trend TEXT,
  sample_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (student_id, game_type)
);
