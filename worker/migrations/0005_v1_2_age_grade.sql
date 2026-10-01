-- v1.2 step 1: age / grade / level / skills. Additive only: every new column is nullable, old rows stay valid.
-- Grades are stored as an ordinal (0 = preschool, 1..12 = grade 1..12) + a code, so the list can grow later.
ALTER TABLE classes ADD COLUMN grade_code TEXT;
ALTER TABLE classes ADD COLUMN grade_order INTEGER;
ALTER TABLE classes ADD COLUMN age_min INTEGER;
ALTER TABLE classes ADD COLUMN age_max INTEGER;
ALTER TABLE classes ADD COLUMN education_stage TEXT;

-- Age is NEVER stored: it is computed from birth_date (full date) or birth_year (year only / age entered by the teacher).
ALTER TABLE students ADD COLUMN birth_date TEXT;
ALTER TABLE students ADD COLUMN birth_year INTEGER;
ALTER TABLE students ADD COLUMN grade_code TEXT;
ALTER TABLE students ADD COLUMN grade_order INTEGER;
ALTER TABLE students ADD COLUMN gender TEXT;
ALTER TABLE students ADD COLUMN teacher_note TEXT;

ALTER TABLE activities ADD COLUMN age_min INTEGER;
ALTER TABLE activities ADD COLUMN age_max INTEGER;
ALTER TABLE activities ADD COLUMN grade_min INTEGER;
ALTER TABLE activities ADD COLUMN grade_max INTEGER;
ALTER TABLE activities ADD COLUMN activity_level TEXT;
ALTER TABLE activities ADD COLUMN skills_json TEXT;
ALTER TABLE activities ADD COLUMN template_id TEXT;
