# یادبین کودک (Yadbin Kids)

بازی‌های کوتاه و شاد برای کودکان ۴ تا ۱۲ سال + داشبورد رشد برای والدین، ساخته‌شده روی همان زیرساخت یادبین (Worker + D1 + Student Web).
محصول معلم (Teacher) **دست‌نخورده** است: همهٔ کد جدید در فضاهای جدا قرار دارد.

| بخش | مسیر |
|---|---|
| هستهٔ مشترک و deterministic (Adaptive، Scoring، Growth، Journey، ۶ بازی) | `core/kids/` |
| API و دیتابیس | `worker/src/routes/kids.ts`، `worker/migrations/0014_kids.sql` |
| اپ کودک + اپ والد (PWA، offline-first) | `student-web/src/kids/` ، مسیرهای `/kids`، `/kids/c/<link>`، `/kids/parent` |
| تست‌ها | `worker/test/kids-*.test.ts`، `student-web/test/kids-*.test.ts`، `e2e/tests/kids.spec.ts` |

اسناد: [architecture](architecture.md) · [api](api.md) · [database](database.md) · [privacy](privacy.md) · [adaptive-and-growth](adaptive-and-growth.md) · [games](games.md) · [testing](testing.md)

## اجرا (محلی)
```bash
cd worker && npm ci && npx wrangler d1 migrations apply yadbin --local
cd ../student-web && npm ci && npm run build          # خروجی در dist/ توسط Worker سرو می‌شود
cd ../worker && npx wrangler dev                      # http://localhost:8787/kids/parent
```
والد در `/kids/parent` ثبت‌نام می‌کند، کودک اضافه می‌کند و «پیوند بازی» را روی دستگاه کودک باز می‌کند؛ از آن پس کودک بدون ورود (و بدون اینترنت) بازی می‌کند.

## انتشار (Deploy)
مثل بقیهٔ پروژه: `docs/deployment.md`. مایگریشن `0014_kids.sql` فقط جدول جدید می‌سازد (additive) و روی داده‌های فعلی اثری ندارد.
بعد از deploy: `JWT_SECRET` همان مقدار قبلی است؛ توکن والد با کلید مشتق‌شده (`JWT_SECRET|kids-parent`) امضا می‌شود، پس نیازی به secret تازه نیست.
