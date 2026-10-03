# آزمون‌های معلم (Teacher Assessments)

آزمونی که **خود معلم** می‌سازد (چهارگزینه‌ای، درست/نادرست، جای خالی). کاملاً جدا از «فعالیت‌های یادبین» (بازی‌های شناختی) است:
نمرهٔ آن یک سنجش درسی است و **هیچ‌وقت** وارد حافظه، توجه، حل مسئله، کنترل پاسخ یا پروفایل شناختی نمی‌شود.

## چرخهٔ کار
`draft → teacher_preview → ready_to_publish → published → archived` (همان چرخهٔ فعالیت‌ها)

1. معلم آزمون و سؤال‌ها را می‌سازد (دستی؛ یا پیش‌نویس AI که فقط Draft است).
2. «آزمایش آزمون» → لینک `/preview/{token}` (مثل دانش‌آموز؛ هیچ دانش‌آموز/نتیجه‌ای ساخته نمی‌شود).
3. بازخورد: «مناسب است»/«خیلی آسان است» → `ready_to_publish`؛ «خیلی سخت است»/«نیاز به ویرایش دارد» → `draft`.
4. انتشار برای کلاس → برای هر دانش‌آموز یک لینک شخصی `/play/{token}` (همان سیستم لینک فعالیت‌ها؛ کپی، ارسال، QR).
5. دانش‌آموز پاسخ می‌دهد؛ تصحیح در **سرور** انجام می‌شود (کلید پاسخ هرگز به مرورگر دانش‌آموز نمی‌رسد).
6. معلم گزارش آزمون را می‌بیند (بدون رتبه‌بندی) و در گزارش دانش‌آموز بخش جدای «آزمون‌های معلم» دارد.

هر تغییری که محتوای آزمون را عوض کند (متن، گزینه، پاسخ، حذف/افزودن/ترتیب سؤال، پایه، سطح) آزمایش قبلی را باطل می‌کند و `ready_to_publish` را به `draft` برمی‌گرداند.
آزمون منتشرشده **تغییرناپذیر** است؛ برای ویرایش «ساخت نسخهٔ جدید» (draft مستقل با version بالاتر) و نتیجه‌های نسخهٔ قبل دست‌نخورده می‌مانند.
حذف مخرب فقط برای پیش‌نویس‌های هرگز منتشرنشده؛ در بقیه حالت‌ها آرشیو.

## API (Worker) – همه نیازمند ورود معلم و بررسی مالکیت
| متد | مسیر | کار |
|---|---|---|
| GET/POST | `/api/assessments` (`?status=all|draft|ready_to_publish|published|archived`) | فهرست / ساخت |
| GET/PUT/DELETE | `/api/assessments/:id` | جزئیات / ویرایش اطلاعات / حذف پیش‌نویس |
| POST | `/api/assessments/:id/questions` ، PUT/DELETE `/questions/:qid` ، POST `/questions/:qid/duplicate` ، POST `/reorder` | ویرایشگر سؤال |
| POST | `/api/assessments/:id/preview` ، `/preview-feedback` | آزمایش و تأیید |
| POST | `/api/assessments/:id/publish` ، `/assign` | انتشار / اختصاص به کلاس |
| POST | `/api/assessments/:id/duplicate` ، `/new-version` ، `/archive` ، `/unarchive` | کپی، نسخهٔ جدید، آرشیو |
| GET | `/api/assessments/:id/report` | تحلیل آزمون (میانگین، بیشترین/کمترین، درصد صحیح هر سؤال، بی‌پاسخ‌ها) |
| GET | `/api/students/:id/assessments` | بخش «آزمون‌های معلم» دانش‌آموز |
| POST | `/api/ai/assessment-draft` | فقط پیش‌نویس؛ بدون اطلاعات دانش‌آموز؛ با خطای AI ساخت دستی کامل کار می‌کند |

عمومی (بدون ورود): `GET /api/play/:token`، `POST /api/play/:token/complete`، `GET /api/preview/:token`، `POST /api/preview/:token/complete` – همان مسیرهای فعالیت‌ها؛ توکن آزمون ابتدا بررسی می‌شود و در غیر این صورت کد فعالیت‌ها اجرا می‌شود.

## دیتابیس
مهاجرت افزایشی `worker/migrations/0009_teacher_assessments.sql`: `assessments` (+ `root_id`/`version`)، `assessment_questions` (شناسهٔ پایدار)، `assessment_preview_sessions`، `assessment_students` (لینک شخصی)، `assessment_attempts`، `assessment_answers`، `assessment_results`. جدول‌های فعلی تغییر مخرب نکرده‌اند.

## حریم خصوصی
بدون GPS/دوربین/میکروفون/مخاطبین/پیامک؛ برای هر سؤال فقط assessment_id، version، question_id، پاسخ، درستی، زمان پاسخ و زمان ثبت ذخیره می‌شود. به AI هیچ نام/شناسهٔ دانش‌آموز ارسال نمی‌شود. حذف داده‌های دانش‌آموز/کلاس، سوابق آزمون را هم پاک می‌کند.

## پایداری (دانش‌آموز)
ارسال نتیجه idempotent است (یک نتیجه برای هر تلاش)؛ پاسخ‌ها پیش از ارسال روی دستگاه ذخیره می‌شوند؛ refresh به همان سؤال‌ها و ترتیب برمی‌گردد؛ قطع اینترنت باعث ثبت تکراری نمی‌شود.

## تست
Worker: `worker/test/assessments.test.ts` (سناریوهای ۱ تا ۲۴). Student Web: `student-web/test/assessment.test.ts` (کنترلر واقعی روی Worker واقعی، شامل قطع شبکه و refresh). Android: `AssessmentModelsTest` با JSON واقعی سرور.
