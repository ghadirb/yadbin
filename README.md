# یادبین (Yadbin) — دستیار هوشمند معلم

ابزار کمک به معلم برای شناخت **عملکرد مشاهده‌شده** هر دانش‌آموز در طول زمان، از طریق بازی‌ها و فعالیت‌های کوتاه و غیرامتحانی.

> این محصول هوش، شخصیت، اختلال یادگیری، ADHD یا «سبک یادگیری ثابت» را تشخیص نمی‌دهد و رتبه‌بندی نمی‌کند.
> همه‌ی خروجی‌ها «عملکرد مشاهده‌شده در فعالیت‌های این سیستم» است؛ تصمیم نهایی با معلم است.

## معماری

```
Teacher Android (Kotlin/Compose) ──HTTPS──► Cloudflare Worker API ──► Cloudflare D1
Student Web/PWA (بدون ورود) ─────HTTPS──► Cloudflare Worker API
```

| پوشه | محتوا |
|---|---|
| `worker/` | API (Cloudflare Worker + D1)، امتیازدهی، بانک سؤال، تست‌ها |
| `student-web/` | PWA دانش‌آموز و سه بازی |
| `teacher-android/` | اپ معلم |
| `docs/` | معماری، دیتابیس، API، دیپلوی، تست |

## وضعیت پیاده‌سازی (صادقانه)

| بخش | وضعیت |
|---|---|
| Worker + D1 (auth، کلاس، دانش‌آموز، فعالیت، آزمون‌های معلم، منابع کتاب، رشد و گزارش، اشتراک، حذف حساب) | ✅ تست خودکار روی workerd + D1 واقعی (`npm test`؛ تعداد دقیق را خروجی تست نشان می‌دهد) |
| Scoring / Trend / Recommendation / Adaptive | ✅ تست واحد |
| Student Web (سه بازی، Resume، Offline، Sync) | ✅ ۲۴ تست + **۷ تست در Chromium واقعی** (`e2e/`، اجرا در CI) |
| سناریوی پذیرش بند ۴۴ | ✅ سمت سرور (Node) و سمت مرورگر (Playwright)؛ شامل قطع اینترنت وسط بازی و ارسال تکراری |
| Teacher Android (Compose) | ✅ تست‌های واحد JVM (قرارداد API، Repository/آفلاین، رشد، حذف حساب، گزارش خطا و …) و APK دیباگ در CI. صفحهٔ «حساب، پشتیبانی و حریم خصوصی» (لینک‌های پشتیبانی/حریم/شرایط، حذف حساب با رمز، کد بازیابی، گزارش خطای محلی) پیاده‌سازی شده. ⚠️ **روی دستگاه/شبیه‌ساز اجرا و تست رابط کاربری نشده** (نیازمند امتحان دستی شما) |
| امنیت (rate limit، header، CORS، قفل ورود، fail-closed secret) | ✅ تست خودکار |
| حذف حساب و صفحه‌های `/privacy` `/terms` `/support` | ✅ Worker + تست؛ ⚠️ متن حقوقی پیش‌نویس است و باید مشاور حقوقی ببیندش |
| دیپلوی Cloudflare | ✅ workflow دستی `deploy.yml` (Worker + Student Web از یک آدرس workers.dev)؛ APK امضاشده: `release-apk.yml` (`docs/release.md`) |
| AI | ✅ فقط کمکی و قابل‌کنترل (پیش‌نویس فعالیت/آزمون، خلاصهٔ رشد با fallback قاعده‌محور، سهمیه)؛ هیچ تشخیص یا برچسب هوش/اختلال نمی‌دهد |
| Leaderboard / رتبه‌بندی دانش‌آموزان | ⛔ عمداً ساخته نشده (طبق سند) |

## اجرای Worker به‌صورت local

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars        # JWT_SECRET را عوض کنید
npm run db:migrate:local
npm run dev                           # http://localhost:8787
npm test                              # همهٔ تست‌های Worker
```

## متغیرهای محیطی (Worker)

| نام | نوع | توضیح |
|---|---|---|
| `JWT_SECRET` | secret | کلید امضای نشست معلم (`wrangler secret put JWT_SECRET`) |
| `ALLOWED_ORIGIN` | var | مبدأ مجاز CORS (در production آدرس Student Web) |
| `PLAY_BASE_URL` | var | پایه‌ی لینک دانش‌آموز، مثل `https://yadbin-api.ghadir-baraty3.workers.dev` |
| `DB` | binding | پایگاه D1 |

جزئیات بیشتر: `docs/` (آزمون‌های معلم: `docs/teacher-assessments.md`).

## اپ معلم (Android)

Kotlin + Jetpack Compose (Material 3، RTL)، MVVM + Repository، Room برای cache آفلاین، OkHttp + kotlinx.serialization.

```bash
cd teacher-android
API_BASE_URL=https://<your-worker>.workers.dev gradle assembleDebug   # آدرس API هرگز داخل کد نیست
gradle testDebugUnitTest                                              # تست‌های واحد (قرارداد API، اعتبارسنجی، آفلاین، QR)
```

بدون `API_BASE_URL` آدرس پیش‌فرض `http://10.0.2.2:8787` است (Worker محلی از دید شبیه‌ساز).
بیلد و تست در CI (job با نام `android`) اجرا می‌شود و APK دیباگ به‌صورت artifact ذخیره می‌شود.

## یادبین کودک (Yadbin Kids)
بازی‌های کوتاه برای کودکان ۴ تا ۱۲ سال + داشبورد رشد والدین، offline-first، روی همین Worker. جزئیات: [`docs/kids/`](docs/kids/README.md).
