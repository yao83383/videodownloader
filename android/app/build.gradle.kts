plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.chaquo.python")
}

// 从 ../../key/android-release-password.txt 读密码；gitignore 已排除，不会进仓库
val releaseKeystorePassword: String? = run {
    val pwdFile = rootProject.file("../key/android-release-password.txt")
    if (pwdFile.exists()) pwdFile.readText().trim() else null
}
val releaseKeystoreFile = rootProject.file("../key/android-release.jks")

android {
    namespace = "com.starluck.downloader"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.starluck.downloader"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    signingConfigs {
        if (releaseKeystorePassword != null && releaseKeystoreFile.exists()) {
            create("release") {
                storeFile = releaseKeystoreFile
                storePassword = releaseKeystorePassword
                keyAlias = "starluck-release"
                keyPassword = releaseKeystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // 有 release keystore 就自动签；没有则保持 unsigned 让 apksigner 自己处理
            if (releaseKeystorePassword != null && releaseKeystoreFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    packaging {
        jniLibs {
            // QuickJS 二进制需要解压到文件系统，subprocess 才能 exec
            useLegacyPackaging = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.10"
    }
}

chaquopy {
    defaultConfig {
        version = "3.14"
            pip {
                options("--upgrade")
                install("yt-dlp>=2025.6.0")
                // yt-dlp 的 challenge solver JS 脚本，给 QuickJS 用来解 sig/n
                // YouTube 风控；PC 端 standalone 自带，pip 装 yt-dlp 不带
                install("yt-dlp-ejs")
            }
            extractPackages("yt_dlp")
    }
}

dependencies {
    // Compose BOM
    val composeBom = platform("androidx.compose:compose-bom:2024.02.00")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")

    // Networking & JSON
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.code.gson:gson:2.10.1")

    // Ed25519 验签（minSdk=26 没有原生支持）
    implementation("org.bouncycastle:bcprov-jdk15on:1.70")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Image loading
    implementation("io.coil-kt:coil-compose:2.5.0")

    // Core
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
}
