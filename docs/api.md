# API

همه‌ی پاسخ‌ها JSON. خطاها: `{ "error": code, "message": فارسی }`. مسیرهای معلم: `Authorization: Bearer <JWT>`.

| متد و مسیر | توضیح |
|---|---|
| POST `/api/auth/register` `/api/auth/login` | `{name?, phone, password}` → `{token, teacher}` |
| GET/POST `/api/classes` | لیست (با `studentCount`, `recentActivityCount`) / ساخت |
| GET/PUT/DELETE `/api/classes/:id` | جزئیات (دانش‌آموزان فعال + فعالیت‌ها) / ویرایش / حذف |
| POST `/api/classes/:id/students` | `{name}` یا `{text}` (هر خط یک نام) یا `{names[]}` (حداکثر ۱۰۰) |
| DELETE `/api/classes/:id/students/:sid` | حذف از کلاس (داده حفظ می‌شود) |
| POST `/api/students` | `{name, classId?}` |
| GET `/api/students/:id` | پروفایل با سه کارت عملکرد |
| DELETE `/api/students/:id` | حذف کامل داده |
| POST `/api/activities` | `{classId, gameType, difficultyMode, questionCount 5..12, studentIds: 'all'\|[..], expiresInDays?}` → `links[]` |
| GET `/api/activities/:id` | وضعیت + لینک هر دانش‌آموز |
| POST `/api/activities/:id/cancel` | لغو |
| GET `/api/play/:token` | شروع/Resume؛ حداقل اطلاعات (بدون نام و شناسه‌ها) |
| POST `/api/play/:token/complete` | `{sessionId, events[], durationMs?}` — idempotent |
| GET `/api/reports/student/:id` | گزارش (وضعیت، روند، پیشنهاد سیستم) |
| GET `/api/reports/class/:id` | آمار کلی (بدون رتبه‌بندی) |
| GET `/api/health` | سلامت |

کدهای play: `404 invalid_token`، `410 canceled`، `410 expired`، `200 {status:'completed'}`.
نکته: نتیجه‌ی ارسالی برای جلسه‌ای که قبل از انقضا شروع شده حتی پس از انقضا پذیرفته می‌شود (بازی آفلاین نباید داده را از دست بدهد).
