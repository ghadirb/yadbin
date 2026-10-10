# تست

| لایه | فایل | چه چیزی را می‌سنجد |
|---|---|---|
| Core (۶۲ تست، سریع) | `worker/test/kids-core.test.ts` | سقف سخت و قابل‌تنظیم؛ Adaptive (افزایش، کاهش، بدون پرش، cooldown، fail-safe، نوسان)؛ Scoring؛ Growth (حداقل نمونه، پایداری در برابر یک بازی بد)؛ Journey (تنوع، تعادل مهارت، فرسودگی)؛ هر ۶ بازی در همهٔ ۱۰ سطح با bot؛ یکتایی جواب الگو؛ حل‌شدنی بودن پازل؛ واژگان ممنوع |
| API (۲۱ تست) | `worker/test/kids-api.test.ts` | auth جدا؛ ایدمپوتنسی و race؛ بازپخش صف آفلاین؛ نادیده‌گرفتن امتیاز جعلی؛ حذف داده؛ نشت بین خانواده‌ها؛ نبود لیدربورد؛ حریم خصوصی ستون‌ها |
| موتور دستگاه (۱۱) | `student-web/test/kids-engine.test.ts` | بازی کامل آفلاین؛ write-ahead؛ flush ترتیبی و بدون ارسال دوباره؛ خطای ۵xx در برابر ۴xx؛ پذیرش وضعیت سرور |
| UI با jsdom (۱۴) | `student-web/test/kids-ui.test.ts` | «کودک تصادفی» هر ۶ بازی را تا پایان می‌برد؛ دسترس‌پذیری؛ صفحات؛ داشبورد والد و نمودارها |
| E2E مرورگر واقعی | `e2e/tests/kids.spec.ts` | سفر کامل والد ← کودک (آنلاین و آفلاین) ← sync ← داشبورد؛ در CI/محلی با `wrangler dev` (نیاز به Chromium) |

```bash
cd worker && npm test                 # شامل Core و API
cd student-web && npm test && npm run build
cd e2e && npx playwright install chromium && npx playwright test tests/kids.spec.ts
```
