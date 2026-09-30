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
