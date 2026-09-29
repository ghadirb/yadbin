# دیتابیس (D1)

اسکیما: `worker/migrations/0001_init.sql`. تفاوت‌ها با سند (با دلیل):
- `students.teacher_id` اضافه شد تا مالکیت و حذف داده قابل اعمال باشد.
- `class_students.removed_at` برای تفکیک «حذف از کلاس» از «حذف داده».
- `activities.status` (`active|canceled`) برای حالت «فعالیت لغو شده».
- `game_sessions.activity_student_id` یکتاست (Resume، بدون session تکراری).
- `game_results.session_id` کلید اصلی است (Idempotency) و `sample_count` اضافه شد.
- جدول `questions` ساخته شده اما **در MVP استفاده نمی‌شود**؛ بانک سؤال نسخه‌ی ۱ در کد است (`worker/src/questions/bank.ts`) و جدول برای محتوای مدیریت‌شده‌ی بعدی رزرو است.
- ایندکس روی `teacher_id`، `class_id`، `student_id`، `token` (UNIQUE) و جستجوی سؤال.
