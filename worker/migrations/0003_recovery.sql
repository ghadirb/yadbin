-- Password recovery without SMS: a one-time recovery code is shown to the teacher at
-- registration (hash only is stored). NULL for accounts created before this migration.
ALTER TABLE teachers ADD COLUMN recovery_hash TEXT;
