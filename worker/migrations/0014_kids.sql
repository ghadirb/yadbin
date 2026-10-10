-- Yadbin Kids (additive only: no existing table is touched). See docs/kids/database.md.
-- Parent accounts are separate from teachers (own table, own JWT key); a child plays with an opaque device token (only its hash is stored).

CREATE TABLE kids_parent_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Minimal child data: a first name / nickname, an age, an emoji avatar. No phone, location, contacts or device identifiers.
CREATE TABLE kids_profiles (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES kids_parent_accounts(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  age_years INTEGER NOT NULL,
  age_set_at TEXT NOT NULL,
  avatar TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  xp INTEGER NOT NULL DEFAULT 0,
  stars INTEGER NOT NULL DEFAULT 0,
  total_play_ms INTEGER NOT NULL DEFAULT 0,
  games_completed INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  current_level INTEGER NOT NULL DEFAULT 1,
  current_stage TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_kids_profiles_parent ON kids_profiles(parent_id);

-- (child_id, id) is the idempotency key: a session id sent twice (retry, double tap, reconnect) is stored once.
-- Raw trials are stored here (not in a separate events table) so nothing is duplicated; every score is recomputed from them.
CREATE TABLE kids_game_sessions (
  id TEXT NOT NULL,
  child_id TEXT NOT NULL REFERENCES kids_profiles(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  level_before INTEGER NOT NULL,
  level_after INTEGER NOT NULL,
  seed TEXT NOT NULL,
  theme_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  completed INTEGER NOT NULL,
  trials_json TEXT NOT NULL,
  performance REAL NOT NULL,
  accuracy REAL NOT NULL,
  median_rt_ms INTEGER,
  errors INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  signals_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (child_id, id)
);
CREATE INDEX idx_kids_sessions_child_time ON kids_game_sessions(child_id, ended_at);

-- Adaptive state per child and game (level + recent performance window).
CREATE TABLE kids_game_progress (
  child_id TEXT NOT NULL REFERENCES kids_profiles(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  best_performance REAL,
  plays INTEGER NOT NULL DEFAULT 0,
  last_theme TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (child_id, game_id)
);

-- Cache of the growth engine's output (observed-performance index per skill). Recomputable from kids_game_sessions.signals_json.
CREATE TABLE kids_skill_progress (
  child_id TEXT NOT NULL REFERENCES kids_profiles(id) ON DELETE CASCADE,
  skill TEXT NOT NULL,
  score INTEGER,
  trend TEXT NOT NULL,
  samples INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (child_id, skill)
);

CREATE TABLE kids_daily_journeys (
  child_id TEXT NOT NULL REFERENCES kids_profiles(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  journey_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (child_id, day)
);

CREATE TABLE kids_rewards (
  child_id TEXT NOT NULL REFERENCES kids_profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('badge','world')),
  code TEXT NOT NULL,
  earned_at TEXT NOT NULL,
  PRIMARY KEY (child_id, kind, code)
);
