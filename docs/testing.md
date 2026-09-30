# تست

```bash
cd worker && npm test
```
- `test/scoring.test.ts`: امتیازدهی سه بازی، وضعیت/روند/Adaptive، توصیه‌گر، بانک و تولید سؤال (بدون تکرار توالی، seed).
- `test/api.test.ts`: روی workerd + D1 واقعی (Miniflare) — Auth، CRUD کلاس، دانش‌آموزان، فعالیت/توکن، مالکیت (معلم A/B)، توکن نامعتبر/منقضی/لغو، Resume، Idempotency (حتی هم‌زمان)، جعل‌ناپذیری جواب مسئله، و **سناریوی پذیرش بند ۴۴** (سمت سرور).
- `test/security.test.ts`: headerهای امنیتی، قفل ورود پس از ۸ تلاش ناموفق، ریست با ورود موفق، rate limit ثبت‌نام به‌ازای IP، CORS در production، رد `JWT_SECRET` ضعیف.
- `student-web/test/resilience.test.ts`: قطع‌شدن درخواست معلق (timeout)، fallback به حافظه وقتی IndexedDB جواب نمی‌دهد، و پاسخ غیر JSON (بدون crash).
- `student-web/test/e2e.test.ts`: کنترلر واقعی جلسه + «بات کودک» روی Worker واقعی (Node): هر سه بازی، Resume، آفلاین و sync، پیام‌های خطا، Adaptive.
- **`e2e/` (Playwright + Chromium واقعی)** — سناریوی بند ۴۴ روی `wrangler dev` (Worker + Student Web ساخته‌شده + D1 محلی):
  ثبت‌نام/ورود معلم ← کلاس ← ۵ دانش‌آموز ← فعالیت ← ۵ لینک یکتا ← متن «سلام 👋» ← Tutorial ← بازی کامل ← نتیجه در گزارش معلم ← جلسه‌ی دوم ← ظهور «روند عملکرد مشاهده‌شده» و «پیشنهاد سیستم» ← «پیداش کن» و «راهش را پیدا کن» (با Hint) ← **قطع اینترنت وسط بازی** ← ذخیره در IndexedDB ← اتصال مجدد ← sync ← ارسال مجدد همان نتیجه بدون duplicate ← Resume پس از بستن صفحه.
  بات مثل کودک فقط از طریق DOM بازی می‌کند (کلیک روی دکمه‌ها). اجرا: job با نام `e2e` در CI.
- Android: `teacher-android/app/src/test` (قرارداد API، اعتبارسنجی، cache آفلاین، QR) در job `android`. **تست رابط کاربری روی شبیه‌ساز انجام نشده.**

## آنچه هنوز به‌صورت خودکار تست نشده
- اجرای اپ Android روی دستگاه/شبیه‌ساز و تست Compose UI.
- بازی روی Safari/iOS و WebViewهای قدیمی (فقط Chromium در CI).
- بار واقعی یک کلاس ۳۰ نفره هم‌زمان روی آدرس production.
