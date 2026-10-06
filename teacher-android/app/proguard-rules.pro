-keep class com.yadbin.teacher.domain.models.** { *; }

# Myket in-app billing (docs «توصیه‌های امنیتی»)
-keep class com.android.vending.billing.** { *; }
-keep class ir.myket.billingclient.** { *; }

# Used only when MINIFY=true (see docs/release.md) — keep libraries that rely on reflection/resources, silence optional-class warnings.
-keep class com.tom_roush.pdfbox.** { *; }
-dontwarn com.tom_roush.pdfbox.**
-dontwarn com.gemalto.jp2.**
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-keepattributes *Annotation*, InnerClasses, Signature
-keep class androidx.security.crypto.** { *; }
