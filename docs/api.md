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
| DELETE `/api/students/:id/data` | فقط پاک‌کردن نتایج/تاریخچه/متریک‌ها؛ **دانش‌آموز در کلاس می‌ماند** (لینک‌های قدیمی او از کار می‌افتد) |
| DELETE `/api/students/:id` | حذف کامل خود دانش‌آموز همراه با همه‌ی داده‌ها |
| POST `/api/activities` | `{classId, gameType, difficultyMode, questionCount 5..12, studentIds: 'all'\|[..], expiresInDays?}` → `links[]` |
| GET `/api/activities/:id` | وضعیت + لینک هر دانش‌آموز |
| POST `/api/activities/:id/cancel` | لغو |
| GET `/api/play/:token` | شروع/Resume؛ حداقل اطلاعات (بدون نام و شناسه‌ها) |
| POST `/api/play/:token/complete` | `{sessionId, events[], durationMs?}` — idempotent |
| GET `/api/reports/student/:id` | گزارش (وضعیت، روند، پیشنهاد سیستم) |
| GET `/api/students/:id/growth` | «روند رشد و تحلیل» دانش‌آموز نسبت به گذشتهٔ خودش. پرسش‌ها: `range=7d\|30d\|3m\|6m\|all` (پیش‌فرض `30d`)، `game`، `skill`، `level`، `subject`. پاسخ: `overview`, `cognitive{timeline,skills,activities}`, `assessments`, `analysis`, `suggestion`. جزئیات: [student-growth.md](student-growth.md) |
| POST `/api/students/:id/growth/summary` | بدنهٔ اختیاریِ همان فیلترها. متن تحلیل را (در صورت امکان) با AI روان‌تر می‌کند؛ هر خطا یا متن مشکوک → متن قاعده‌محور (`source: 'rules'`) |
| GET `/api/students/:id/report` | «گزارش جامع پرونده دانش‌آموز» (JSON ساخت‌یافته). پرسش‌ها: `period=7d\|30d\|3m\|6m\|year_current\|year_previous\|year\|custom` (پیش‌فرض `year_current`)، `year` (سال شمسیِ شروع تحصیلی، با `period=year`)، `from` و `to` (`YYYY-MM-DD`، با `custom`)، `type=full\|summary`، `page`، `pageSize` (≤۵۰). پاسخ: `student`, `period`, `overview`, `cognitiveGrowth`, `skillTrends{skills,responseControl,learning}`, `academicAssessments`, `activities{total,page,pages,items}`, `analysis`, `periodOptions`, `metadata`. جزئیات: [student-reports.md](student-reports.md) |
| GET `/api/students/:id/report/print` | همان گزارش به‌صورت HTML آمادهٔ چاپ A4 (فارسی، RTL، نمودار SVG داخلی). همان پرسش‌ها؛ هدرها: `X-Report-Filename`، CSP بسته، `no-store`. اپ آن را با چاپ/ذخیرهٔ PDF سیستم‌عامل خروجی می‌دهد |
| GET `/api/reports/class/:id` | آمار کلی (بدون رتبه‌بندی) |
| GET `/api/health` | سلامت |

کدهای play: `404 invalid_token`، `410 canceled`، `410 expired`، `200 {status:'completed'}`.
نکته: نتیجه‌ی ارسالی برای جلسه‌ای که قبل از انقضا شروع شده حتی پس از انقضا پذیرفته می‌شود (بازی آفلاین نباید داده را از دست بدهد).


## v1.1 (افزوده‌شده، سازگار با نسخه‌ی قبل)

همه‌ی مسیرها با پیشوند `/api/v1/` هم کار می‌کنند (`/api/v1/classes` ≡ `/api/classes`). کلاینت‌های قدیمی بدون تغییر ادامه می‌دهند.

| متد و مسیر | توضیح |
|---|---|
| GET `/api/classes?archived=false\|true\|all` | پیش‌فرض فقط کلاس‌های فعال؛ هر کلاس `archived` دارد |
| POST `/api/classes/:id/archive` · `/unarchive` | آرشیو/بازگردانی. داده‌ها حفظ می‌شود؛ در کلاس آرشیوشده فعالیت یا دانش‌آموز جدید `409 class_archived` |
| GET `/api/classes/:id` | هر دانش‌آموز: `completedActivities`, `openActivities`, `lastActivityAt`, `averagePerformance` (تا ۸ نمونه `null`), `activityState` |
| GET `/api/students/:id/history` | تاریخچه‌ی فعالیت‌های یک دانش‌آموز (جدید به قدیم) |
| GET `/api/students/:id` | گزارش + `summary` (تعداد، موفقیت‌ها ≥ ۰٫۷، عملکرد، دقیقه‌ی صرف‌شده) |
| GET `/api/activities?classId=&lifecycle=open\|active\|ended\|archived\|all` | لیست فعالیت‌ها |
| PUT `/api/activities/:id` | ویرایش `title, description, suggestedMinutes, expiresInDays` همیشه؛ `difficultyMode, questionCount` فقط پیش از شروع اولین دانش‌آموز (وگرنه `409 activity_in_progress`) |
| POST `/api/activities/:id/duplicate` | «ساخت نسخه جدید»: عنوان «… - تمرین دوم/سوم»، لینک‌های تازه، نتایج قبلی دست‌نخورده |
| POST `/api/activities/:id/preview` | «آزمایش فعالیت»: `{compareMode?: easy\|medium\|hard}` → `{token, url, summary, comparison}`؛ جلسهٔ جدا از دانش‌آموز، ۲۴ ساعت اعتبار |
| GET `/api/preview/:token` | بستهٔ بازی آزمایش (همان مولد و باند دانش‌آموزان کلاس) + `summary`؛ بدون احراز هویت معلم، بدون ثبت داده |
| POST `/api/preview/:token/complete` | `{sessionId, events}` پایان آزمایش؛ هیچ نتیجه‌ای ذخیره یا شمرده نمی‌شود |
| POST `/api/activities/:id/preview-feedback` | `{feedback: suitable\|too_easy\|too_hard\|needs_edit}` فقط پس از آزمایش کامل (غیرمقایسه‌ای) تنظیمات فعلی |
| POST `/api/activities/:id/publish` | انتشار؛ `{withoutPreview: true}` = انتشار آگاهانه بدون آزمایش؛ وگرنه `409 teacher_approval_required` |
| PUT `/api/activities/:id` | همهٔ تنظیمات: `title, description, suggestedMinutes, difficultyMode, questionCount, level, skills, gradeMin/Max, ageMin/Max, expiresInDays` |
| POST `/api/activities/:id/archive` · `/unarchive` | آرشیو فعالیت |
| POST `/api/activities/:id/regenerate-links` | `{studentId?}` لینک جدید برای کسانی که تمام نکرده‌اند؛ لینک قبلی بلافاصله باطل، جلسه‌ی شروع‌شده حفظ |
| GET `/api/reports/class/:id` | `activeStudents` (۳۰ روز اخیر)، `averagePerformance`، `byGame[]`، `weekly[]` (۶ هفته برای نمودار). بدون مقایسه‌ی دانش‌آموزان با هم |
| GET `/api/play/:token/progress` | پیشرفت شخصی خود دانش‌آموز؛ بدون نام/شناسه/امتیاز |
| POST `/api/play/:token/complete` | پاسخ حالا `feedback: {level, lines[]}` دارد (جمله‌ی تشویقی، بدون عدد) |

**وضعیت فعالیت** (`lifecycle`): `active` فعال · `ended` پایان‌یافته (لغو، منقضی، یا همه تمام کرده‌اند) · `archived` آرشیوشده. فیلد قدیمی `status` (`active|canceled`) تغییری نکرده است.

**تاریخ‌ها:** API همیشه ISO-8601 UTC برمی‌گرداند؛ تبدیل به شمسی (به وقت تهران) فقط در نمایش اپ انجام می‌شود (`core/utils/Jalali.kt`).

## اشتراک و پرداخت (v1.4)

| مسیر | توضیح |
|---|---|
| GET `/api/subscription` | 🔒 وضعیت من: `subscription{plan,status,trialActive,subscriptionActive,trialExpiresAt,expiresAt,limits,features,serverTime}`، `usage{classes,students,assessments,aiRequests}`، `paymentsAvailable` |
| GET `/api/plans` | عمومی: `plans[{id,name,period,durationDays,price,currency,priceAvailable}]`، `free{...}`، `trialDays`، `paymentsAvailable`. `price: null` = هنوز تعیین نشده |
| POST `/api/payment/create` | 🔒 `{planId}` ⇒ `{paymentId,status,provider,kind,sku,developerPayload,redirectUrl,expiresAt}`. بدون provider/قیمت: `503 payments_unavailable` («پرداخت آنلاین به‌زودی فعال می‌شود») |
| POST `/api/payment/myket/confirm` | 🔒 `{originalJson,signature}` خرید مایکت؛ پس از Verify: `{ok:true,status:"verified",alreadyProcessed}` |
| GET `/api/payment/status?paymentId=` | 🔒 فقط مالک؛ `pending|verified|failed|expired` |
| POST/GET `/api/payment/callback` | درگاه‌های redirect؛ بدون ورود، ولی هیچ‌چیز را بدون Verify سمت سرور فعال نمی‌کند |

**خطای محدودیت:** HTTP 403 با `{error:"FEATURE_LIMIT_REACHED", message, details:{feature:"classes|students|assessments|ai", limit, current, plan, upgrade:true}}`.

