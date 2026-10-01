-- v1.2 step 3: the difficulty tuning (-1 lower / 0 default / +1 upper) is fixed when a session is created,
-- so resuming a session (or editing a student's grade later) never changes the questions. NULL = old session = 0.
ALTER TABLE game_sessions ADD COLUMN tuning INTEGER;
