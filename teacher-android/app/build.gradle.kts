plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.yadbin.teacher"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.yadbin.teacher"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        // Never hard-coded: pass -PAPI_BASE_URL=... or env API_BASE_URL. Default = local `wrangler dev` seen from the emulator.
        val apiBase = (System.getenv("API_BASE_URL") ?: "").ifBlank {
            (project.findProperty("API_BASE_URL") as String?) ?: "http://10.0.2.2:8787"
        }
        buildConfigField("String", "API_BASE_URL", "\"${apiBase.trimEnd('/')}\"")

        // Myket in-app purchase (docs/payments.md). The PUBLIC key of the app (not a secret, but Myket asks to keep it out of plain strings):
        // pass -PMYKET_PUBLIC_KEY=... or env MYKET_PUBLIC_KEY. Empty = billing disabled in this build ("coming soon" in the UI).
        // It is stored XOR-masked (hex) and rebuilt at run time (core/billing/KeyMask.kt). The Access Token is NEVER in the app: it lives only in the Worker.
        val marketApplicationId = "ir.mservices.market"
        val marketBindAddress = "ir.mservices.market.InAppBillingService.BIND"
        manifestPlaceholders["marketApplicationId"] = marketApplicationId
        manifestPlaceholders["marketBindAddress"] = marketBindAddress
        manifestPlaceholders["marketPermission"] = "$marketApplicationId.BILLING"
        val myketKey = (System.getenv("MYKET_PUBLIC_KEY") ?: "").ifBlank { (project.findProperty("MYKET_PUBLIC_KEY") as String?) ?: "" }.trim()
        val mask = "com.yadbin.teacher".toByteArray()
        val maskedKey = myketKey.toByteArray().mapIndexed { i, b -> "%02x".format((b.toInt() xor mask[i % mask.size].toInt()) and 0xff) }.joinToString("")
        buildConfigField("String", "IAB_KEY_MASKED", "\"$maskedKey\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.4")

    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.security:security-crypto:1.0.0")
    implementation("com.google.zxing:core:3.5.3")
    // Version pinned to the one in the Myket docs.
    implementation("com.github.myketstore:myket-billing-client:1.6")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
