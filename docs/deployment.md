# دیپلوی

```bash
cd worker
npx wrangler d1 create yadbin-db            # database_id را در wrangler.toml بگذارید
npm run db:migrate:remote
npx wrangler secret put JWT_SECRET
npm run deploy
```
Student Web روی Cloudflare Pages (بعد از ساخت `student-web`). توکن‌های API هرگز داخل ریپو نگهداری نمی‌شوند؛ فقط در Secrets گیت‌هاب/Cloudflare.
