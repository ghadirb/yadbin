# دیپلوی

```bash
cd worker
npx wrangler d1 create yadbin-db            # database_id را در wrangler.toml بگذارید
npm run db:migrate:remote
npx wrangler secret put JWT_SECRET
npm run deploy
```
Student Web روی Cloudflare Pages (بعد از ساخت `student-web`). توکن‌های API هرگز داخل ریپو نگهداری نمی‌شوند؛ فقط در Secrets گیت‌هاب/Cloudflare.

## دیپلوی خودکار (GitHub Actions)

workflow دستی `Deploy (Cloudflare)` (فایل `.github/workflows/deploy.yml`) دیتابیس D1 را در صورت نبود می‌سازد، migrationها را اعمال می‌کند، Worker و Student Web (Pages) را دیپلوی می‌کند.

Secrets لازم در ریپو: `CLOUDFLARE_API_TOKEN` (دسترسی Workers Scripts، D1، Pages ویرایش و Account Settings خواندن) و `JWT_SECRET` (حداقل ۳۲ کاراکتر تصادفی). `CLOUDFLARE_ACCOUNT_ID` اختیاری است.

پس از اولین دیپلوی، `PLAY_BASE_URL` و `ALLOWED_ORIGIN` در `worker/wrangler.toml` باید دقیقاً برابر آدرس Pages باشند (مقدار فعلی: آدرس `workers.dev` خود Worker).

## امنیت

- Rate limit (جدول `rate_limits` در D1): ثبت‌نام ۱۰/ساعت به‌ازای IP؛ ورود ۳۰/۱۰ دقیقه به‌ازای IP و ۸/۱۰ دقیقه به‌ازای شماره موبایل؛ بازی ۱۲۰/دقیقه به‌ازای IP و سقف به‌ازای هر توکن. پاسخ `429` همراه `Retry-After`.
- Headerهای امنیتی روی API (`nosniff`، `DENY`، `no-referrer`، HSTS، CSP) و روی Student Web (فایل `student-web/public/_headers`).
- CORS در production بدون `ALLOWED_ORIGIN` هرگز `*` نمی‌فرستد.
- `JWT_SECRET` کوتاه‌تر از ۳۲ کاراکتر یا خالی ⇒ سرور خطای پیکربندی می‌دهد (fail closed).

## بارگذاری سریع در شبکه‌های کند/فیلترشده

بعد از `vite build` اسکریپت `student-web/scripts/inline.mjs` همهٔ JS و CSS را داخل `index.html` قرار می‌دهد، تا شروع بازی فقط به **یک درخواست** برای صفحه نیاز داشته باشد. CSP با hash دقیق همان اسکریپت‌ها به‌روز می‌شود، بنابراین `script-src` همچنان سخت‌گیر می‌ماند.

## Student Web روی همان Worker (بدون pages.dev)

از این نسخه، صفحهٔ بازی (`student-web/dist`) به‌صورت static assets توسط خود Worker سرو می‌شود و لینک‌ها به شکل `https://<worker>.workers.dev/play/{token}` هستند. دلیل: آدرس `pages.dev` در بعضی شبکه‌های ایران قطع می‌شود، ولی `workers.dev` باز است. API و صفحه هم‌مبدأ هستند (بدون CORS). فقط مسیر `/api/*` کد Worker را اجرا می‌کند.

- قبل از هر دستور `wrangler` (حتی `db:migrate:local`) یک بار `npm run build` را در `student-web` بزنید تا پوشهٔ `dist` وجود داشته باشد.
- پروژهٔ قدیمی Pages دیگر دیپلوی نمی‌شود و می‌توان آن را از داشبورد Cloudflare حذف کرد.
- اگر بعداً دامنهٔ اختصاصی گرفتید، آن را به Worker وصل کنید و `PLAY_BASE_URL` را عوض کنید.

## AI Activity Builder با AvalAI (v1.2)

ترتیب provider: **AvalAI → Cloudflare Workers AI (اختیاری) → موتور قانون‌محور داخلی**. هر خطا (۴۲۹، قطعی، timeout ‏۱۵ ثانیه، خروجی نامعتبر) بی‌صدا به موتور قانون‌محور برمی‌گردد و معلم همیشه یک پیشنهاد می‌گیرد. خروجی مدل فقط **پیش‌نویس** است و فیلد‌به‌فیلد دوباره اعتبارسنجی می‌شود.

- Secret ریپو: `AVALAI_API_KEY` (در دیپلوی خودکار به‌صورت Worker secret ثبت می‌شود؛ هرگز داخل ریپو نمی‌رود).
- اختیاری (در `wrangler.toml` بخش `[vars]`): `AVALAI_MODEL` برای pin کردن مدل (پیش‌فرض کد: `gpt-5.4-mini`) و `AVALAI_BASE_URL` (پیش‌فرض `https://api.avalai.ir/v1`).
- فقط جملهٔ معلم + کد پایه/سن + برچسب مهارت‌های ناشناس به مدل می‌رسد؛ نام، شناسه یا داده‌ی کلاس دیگر هرگز ارسال نمی‌شود.

## آدرس‌ها، workers.dev و دامنه‌ی آینده (`yadbinapp.ir`)

| تنظیم | کجا | نقش |
|---|---|---|
| `PLAY_BASE_URL` | `worker/wrangler.toml` | پایه‌ی همه‌ی لینک‌های دانش‌آموز (`/play/{token}`، `/preview/{token}`) |
| `API_BASE_URL` | `worker/wrangler.toml` (اختیاری) | پایه‌ی callback پرداخت؛ اگر نباشد برابر `PLAY_BASE_URL` |
| `API_BASE_URL` | build اپ اندروید (`-PAPI_BASE_URL` یا env) | آدرس API در اپ؛ داخل کد نیست |

در Worker فقط یک نقطه آدرس می‌سازد: `worker/src/config/urls.ts`. **هیچ وابستگی اجباری به `yadbinapp.ir` در کد وجود ندارد.** `workers.dev` الان کار می‌کند و باید تا پایدارشدن دامنه‌ی جدید دست‌نخورده بماند؛ لینک‌های قبلی (که کامل ذخیره نمی‌شوند، فقط توکن ذخیره می‌شود) روی هر دو آدرس کار می‌کنند.

### اتصال دامنه (مرحله‌ی بعد، پس از ثبت دامنه)

1. دامنه را به Cloudflare اضافه و NS را عوض کنید (DNS).
2. Worker ← Settings ← Domains & Routes ← Custom Domain: `yadbinapp.ir` (SSL خودکار).
3. تست: `https://yadbinapp.ir/api/health` و یک `/play/{token}` واقعی.
4. `PLAY_BASE_URL` (و در صورت نیاز `ALLOWED_ORIGIN` و `API_BASE_URL`) را به `https://yadbinapp.ir` تغییر دهید و دیپلوی کنید. `workers.dev` را حذف نکنید.
5. APK جدید با `API_BASE_URL=https://yadbinapp.ir` بسازید.
6. توجه: پرداخت **مایکت به دامنه نیاز ندارد** (پرداخت داخل اپ مایکت انجام می‌شود). دامنه برای درگاه‌های ایرانیِ redirect و لینک‌های دانش‌آموز لازم است.

## اشتراک و مایکت

راه‌اندازی کامل در `docs/payments.md`. متغیرهای مرتبط: `TRIAL_DAYS`, `FREE_MAX_CLASSES`, `FREE_MAX_STUDENTS`, `FREE_MAX_ASSESSMENTS`, `FREE_AI_REQUESTS`, `PAYMENT_PROVIDER`, `MYKET_PACKAGE_NAME`؛ و برای مایکت: variable `MYKET_PUBLIC_KEY` + secret `MYKET_ACCESS_TOKEN` در GitHub. migration `0010` همراه دیپلوی اعمال می‌شود.

