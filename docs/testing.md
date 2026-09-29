# تست

```bash
cd worker && npm test
```
- `test/scoring.test.ts`: امتیازدهی سه بازی، وضعیت/روند/Adaptive، توصیه‌گر، بانک و تولید سؤال (بدون تکرار توالی، seed).
- `test/api.test.ts`: روی workerd + D1 واقعی (Miniflare) — Auth، CRUD کلاس، دانش‌آموزان، فعالیت/توکن، مالکیت (معلم A/B)، توکن نامعتبر/منقضی/لغو، Resume، Idempotency (حتی هم‌زمان)، جعل‌ناپذیری جواب مسئله، و **سناریوی پذیرش بند ۴۴** (سمت سرور).
- تست آفلاین سمت مرورگر و تست Android: در مراحل بعد (بخش وضعیت در README).
- `test/security.test.ts`: headerهای امنیتی، قفل ورود پس از ۸ تلاش ناموفق، ریست با ورود موفق، rate limit ثبت‌نام به‌ازای IP، CORS در production، رد `JWT_SECRET` ضعیف.
