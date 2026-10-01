# اپ معلم (Android)

## ساختار
```
app/src/main/kotlin/com/yadbin/teacher/
├── core/{network,auth,database,utils}    ApiClient (OkHttp)، TokenStore (رمزنگاری‌شده)، Room، اعتبارسنجی/قالب‌بندی/QR
├── data/{remote,local,repository}        ApiService (یک تابع برای هر endpoint)، CacheStore، Repository (شبکه‌ی اول، کش هنگام آفلاین)
├── domain/{models,usecases}              مدل‌های JSON مطابق Worker، CreateActivityUseCase
└── ui/{auth,dashboard,classes,activities,reports}   صفحه‌ها + ViewModel
```

## رفتارهای مهم
- نشست: فقط JWT در EncryptedSharedPreferences؛ رمز عبور ذخیره نمی‌شود. ردشدن توکن توسط سرور (۴۰۱) → بازگشت به ورود.
- آفلاین: آخرین پاسخ موفق هر صفحه در Room ذخیره می‌شود و هنگام قطع اینترنت با نوار «اتصال اینترنت برقرار نیست…» نمایش داده می‌شود. عملیات نوشتن (ساخت کلاس، افزودن دانش‌آموز، ساخت فعالیت) نیازمند اینترنت است.
- خروج: کش پاک می‌شود تا داده‌ی معلم قبلی دیده نشود.
- اشتراک لینک: Android Share Sheet (هر پیام‌رسانی) + کپی + QR (ZXing، محلی). هیچ API اختصاصی پیام‌رسان وجود ندارد.
- «حذف از کلاس» با «حذف داده‌ها» جدا و با تأیید جداگانه است.
- گزارش: اگر `sufficientData=false` هیچ عددی نمایش داده نمی‌شود؛ نمودار روند فقط با ≥۲ جلسه؛ برچسب‌ها «عملکرد مشاهده‌شده» و «پیشنهاد سیستم»؛ رتبه‌بندی/مقایسه وجود ندارد.
- مجوزها: فقط `INTERNET`.

## تست
`gradle testDebugUnitTest` (JVM): قرارداد API با MockWebServer (هدر Authorization، خطاهای فارسی، ۴۰۱، قطع شبکه)، اعتبارسنجی موبایل/رمز/افزودن سریع، fallback آفلاین Repository، پارس JSON گزارش‌ها، QR، و نبودن واژه‌های تشخیصی در برچسب‌ها.
تست UI روی دستگاه (Espresso/Compose test) هنوز نوشته نشده است.

## UI v1.2 — مرحله ۲ (سیستم طراحی + داشبورد)
- فونت فارسی Vazirmatn (مجوز OFL) در `res/font` و اعمال‌شده روی کل Typography (`ui/theme/Theme.kt`).
- واژگان طراحی محدود در `ui/common/Design.kt`: `Tone` (موفقیت/هشدار/خطا/اطلاعات)، `SummaryCard`، `SectionTitle`، `SkeletonBlock/List`، `EmptyIllustration`.
- Loading همه صفحات به Skeleton تبدیل شد (`LoadingBox`)؛ خطا با پیام دوستانه + «تلاش مجدد»؛ خطای فنی مثل «خطای 500» دیگر نمایش داده نمی‌شود.
- داشبورد: سلام + خلاصه وضعیت، ۴ کارت خلاصه، کارت کلاس با «ورود به کلاس». آمار فعالیت از `/dashboard` به‌صورت best-effort (آفلاین از کش؛ نبودنش لیست کلاس‌ها را خراب نمی‌کند).
- صفحه کلاس: هدر با نام/مشخصات/چیپ‌های آمار + تب‌های بولد‌شونده.
