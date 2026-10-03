# دیتابیس (D1)

اسکیما: `worker/migrations/0001_init.sql`. تفاوت‌ها با سند (با دلیل):
- `students.teacher_id` اضافه شد تا مالکیت و حذف داده قابل اعمال باشد.
- `class_students.removed_at` برای تفکیک «حذف از کلاس» از «حذف داده».
- `activities.status` (`active|canceled`) برای حالت «فعالیت لغو شده».
- `game_sessions.activity_student_id` یکتاست (Resume، بدون session تکراری).
- `game_results.session_id` کلید اصلی است (Idempotency) و `sample_count` اضافه شد.
- جدول `questions` ساخته شده اما **در MVP استفاده نمی‌شود**؛ بانک سؤال نسخه‌ی ۱ در کد است (`worker/src/questions/bank.ts`) و جدول برای محتوای مدیریت‌شده‌ی بعدی رزرو است.
- ایندکس روی `teacher_id`، `class_id`، `student_id`، `token` (UNIQUE) و جستجوی سؤال.

## v1.1 — migration `0004_v1_1_expansion.sql`
فقط افزایشی و nullable (داده‌ی قبلی معتبر می‌ماند): `classes.archived_at`، `activities.title|description|suggested_minutes|archived_at`.
«پایان‌یافته» ستون ندارد و از `status`/`expires_at`/تعداد تکمیل‌ها محاسبه می‌شود، چون SQLite امکان تغییر CHECK قدیمی را بدون بازسازی جدول نمی‌دهد.
**قبل از دیپلوی:** `npm run db:migrate:remote` (یا اجرای workflow دیپلوی).


## v1.2.x additions (migrations 0007–0008)
* `activities`: `publish_state` (`draft|testing|ready_to_publish|published`, existing rows = `published`), `requires_preview`, `previewed_at`, `preview_feedback` (`suitable|too_easy|too_hard|needs_edit|skipped`), `teacher_approved_at`.
* `teacher_preview_sessions`: isolated teacher runs (`token`, `status`, `tuning`, `gen_version`, `compare_mode`); deleted when an unpublished activity's settings change.
* `game_sessions.gen_version`: generator version fixed at session creation (`NULL` = v1, `2` = progressive-difficulty generator).
