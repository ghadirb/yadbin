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
| Worker + D1 (auth، کلاس، دانش‌آموز، فعالیت، توکن، play، گزارش) | ✅ پیاده‌سازی و با تست خودکار روی workerd/D1 واقعی اجرا شده |
| Scoring / Trend / Recommendation / Adaptive | ✅ تست واحد |
| Student Web + سه بازی + Offline | 🚧 در حال ساخت |
| Teacher Android | 🚧 در حال ساخت (بیلد در CI گیت‌هاب) |
| دیپلوی Cloudflare | ⏳ نیازمند اجرای CI/Secrets |

## اجرای Worker به‌صورت local

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars        # JWT_SECRET را عوض کنید
npm run db:migrate:local
npm run dev                           # http://localhost:8787
npm test                              # 38 تست
```

## متغیرهای محیطی (Worker)

| نام | نوع | توضیح |
|---|---|---|
| `JWT_SECRET` | secret | کلید امضای نشست معلم (`wrangler secret put JWT_SECRET`) |
| `ALLOWED_ORIGIN` | var | مبدأ مجاز CORS (در production آدرس Student Web) |
| `PLAY_BASE_URL` | var | پایه‌ی لینک دانش‌آموز، مثل `https://yadbin.pages.dev` |
| `DB` | binding | پایگاه D1 |

جزئیات بیشتر: `docs/`.
