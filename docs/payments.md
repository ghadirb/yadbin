# پرداخت (v1.4)

## اصل‌های ثابت

1. اشتراک **فقط پس از Verify سمت سرور** فعال می‌شود. «برگشت کاربر از درگاه / ارسال یک request از اپ» هرگز اشتراک را فعال نمی‌کند.
2. مبلغ/محصول از جدول `plans` می‌آید، نه از کلاینت. بدنه‌ی `POST /api/payment/create` فقط `{planId}` را می‌پذیرد (فیلد اضافه ⇒ ۴۰۰).
3. `user_id` از توکن ورود می‌آید، نه از بدنه.
4. هر پرداخت حداکثر **یک دوره** اشتراک می‌سازد: `subscriptions.payment_id` یکتاست و `payments` روی `(provider, authority)` و `(provider, ref_id)` یکتا هستند. Callback تکراری یا هم‌زمان چیزی اضافه نمی‌کند.
5. خطای درگاه جزئیات حساس به کلاینت نمی‌دهد (فقط در لاگ سرور).
6. endpointهای پرداخت rate-limit دارند.

## معماری (Payment Abstraction)

```
App → /api/payment/create → PaymentProvider.createPayment()
        ... (درگاه/استور) ...
App/Gateway → callback یا /myket/confirm → PaymentProvider.verifyPayment() → D1 → Subscription ACTIVE
```

اینترفیس `PaymentProvider` (`worker/src/payments/provider.ts`): `createPayment()`، `verifyPayment()`، `extractAuthority()` و `kind`:

- `redirect`: مرورگر به درگاه می‌رود و به `/api/payment/callback` برمی‌گردد. (برای درگاه ایرانیِ آینده؛ فعلاً هیچ درگاه واقعی ثبت نشده.)
- `store`: خرید داخل اپِ استور انجام می‌شود (مایکت) و اپ خرید امضاشده را به `/api/payment/myket/confirm` می‌فرستد.

ثبت provider فقط در `getProvider()` است. اضافه‌کردن درگاه جدید = یک کلاس + یک خط؛ UI و منطق اشتراک تغییر نمی‌کنند.

وضعیت پرداخت: `pending → verified | failed | expired` و هیچ‌وقت برنمی‌گردد (تراکنش failed با callback بعدی «زنده» نمی‌شود).

## مایکت (مطابق مستندات مایکت)

نکته‌ی تعیین‌کننده در مستندات: **«مایکت از اشتراک پشتیبانی نمی‌کند»**. پس هر دوره یک **محصول مصرف‌شدنی** است: یک خرید = یک دوره؛ بعد از تحویل، اپ آن را Consume می‌کند تا دوباره قابل خرید شود.

### جریان

1. اپ `POST /api/payment/create {planId}` می‌زند. سرور یک `developerPayload` یک‌بارمصرف (۱۲۸ بیت تصادفی، متصل به همین کاربر و پلن) و `sku` را برمی‌گرداند.
2. اپ `launchPurchaseFlow(sku, developerPayload)` را اجرا می‌کند؛ مایکت پرداخت را انجام می‌دهد (قیمت از پنل مایکت می‌آید).
3. اپ `originalJson` و `signature` را به `POST /api/payment/myket/confirm` می‌فرستد (با توکن ورود).
4. سرور به‌ترتیب بررسی می‌کند: امضای RSA/SHA1 با کلید عمومی برنامه ← `packageName` ← `purchaseState == 0` ← `developerPayload` متعلق به **همین کاربر** است ← `productId` برابر `plans.store_sku` ← فراخوانی **سرور‌به‌سرور** API صحت‌سنجی مایکت با `X-Access-Token` (و تطبیق `developerPayload` پاسخ) ← تغییر اتمیک `pending→verified` با توکن خرید یکتا ← ثبت یک دوره اشتراک.
5. فقط پس از `ok: true` اپ `consumeAsync` را صدا می‌زند.
6. **هنگام شروع اپ** (طبق هشدار مستندات) `queryInventory` اجرا می‌شود؛ هر خرید مصرف‌نشده دوباره به `confirm` فرستاده و بعد Consume می‌شود. چون confirm idempotent است، تکرار بی‌خطر است و پولی که کسر شده گم نمی‌شود.

### حالت‌های خاص

- قطعی/۵xx مایکت: پرداخت `pending` می‌ماند (کاربر پول داده)؛ هر زمان بعد، حتی پس از ۳۰ دقیقه، تلاش دوباره تحویل می‌دهد.
- Access Token ما نادرست باشد (۴۰۱/۴۰۳): خطای سمت ما است؛ پرداخت failed نمی‌شود.
- توکن خرید تکراری یا payload متعلق به حساب دیگر: رد می‌شود.

### راه‌اندازی (کارهایی که فقط خود شما می‌توانید انجام دهید)

1. در پنل توسعه‌دهندگان مایکت برنامه را با **Package Name** `com.yadbin.teacher` رزرو/تعریف کنید.
2. **کلید عمومی** برنامه را از پنل بگیرید (آیکن کلید روی کارت برنامه).
3. دو محصول **مصرف‌شدنی** بسازید (ماهانه / سالانه) و قیمت را همان‌جا تعیین کنید. برای تست قیمت خیلی کم (مثلاً ۱۰۰ ریال) بگذارید.
4. در بخش «محصولات درون‌برنامه‌ای» **X-Access-Token** را بگیرید.
5. شناسه‌ی محصول‌ها (`pro_monthly` و `pro_yearly`) با migration شمارهٔ `0013_myket_skus.sql` هنگام دیپلوی در D1 ثبت می‌شوند (فقط اگر `store_sku` هنوز خالی باشد). برای تغییر بعدی، دستور `UPDATE plans SET store_sku = '<شناسه>' WHERE id = '<planId>';` را روی D1 بزنید.
6. در GitHub: secret `MYKET_ACCESS_TOKEN` و variable `MYKET_PUBLIC_KEY` را بسازید و workflow دیپلوی را اجرا کنید. (توکن را هرگز داخل اپ یا ریپو نگذارید؛ مایکت صراحتاً می‌گوید فقط Server-to-Server.)
7. در ساخت APK: `-PMYKET_PUBLIC_KEY=...` (برای کلید داخل اپ؛ نگاه کنید به `docs/android.md`).

تا وقتی مراحل بالا تمام نشده، دکمه‌ی خرید «پرداخت آنلاین به‌زودی فعال می‌شود» را نشان می‌دهد و هیچ چیز خراب نمی‌شود.

### امنیت (توصیه‌های مایکت که رعایت شده)

تأیید امضا روی سرور · Access Token فقط روی سرور · developerPayload تصادفی و یک‌بارمصرف که روی سرور تطبیق داده می‌شود · محتوای پولی در APK نیست (محدودیت‌ها سمت Worker است) · کلید عمومی در APK به‌صورت تکه‌های XOR ساخته می‌شود · قوانین ProGuard مربوط به billing.

## Mock Provider (فقط توسعه)

`PAYMENT_PROVIDER=mock` + `PAYMENT_MOCK_ENABLED=true` و `ENVIRONMENT≠production`. در production ساخته نمی‌شود (تست دارد). سناریوها با پارامتر callback: `status=OK|NOK|INVALID` و `mock_amount=N` (مبلغ اشتباه).

## تست‌ها

`worker/test/subscription.test.ts`: موفق، ناموفق، Verify ناموفق، callback تکراری و هم‌زمان، مبلغ اشتباه، تراکنش منقضی/نامعتبر، تمدید، امضای جعلی/دست‌کاری‌شده، پکیج/محصول اشتباه، payload حساب دیگر، توکن تکراری، قطعی مایکت و تلاش دوباره.
