import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

/*
 * 固定签名配置。
 *
 * 为什么需要它：Android 的 debug 密钥默认是**每台机器临时生成**的，
 * 所以每次 CI 构建出来的 APK 签名都不同，用户装新版时会遇到
 * INSTALL_FAILED_UPDATE_INCOMPATIBLE —— 必须先卸载旧版，设置和数据全丢。
 *
 * 这里从 keystore.properties 读取一个固定密钥（该文件**不入库**，见 .gitignore），
 * 文件不存在时**回退到 Android 默认的 debug 密钥**，保证任何人 clone 下来都能直接构建。
 */
val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val hasFixedSigning = keystoreProperties.getProperty("storeFile") != null

android {
    namespace = "com.xideng.sleep"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.xideng.sleep"
        // PRD 6、兼容性：Android 10（API 29）及以上
        minSdk = 29
        targetSdk = 34
        // 这一版开始用固定密钥签名，因此从 1 提上来：
        // 用户可以在装了旧版的前提下直接覆盖升级（旧版用的是临时 debug 密钥，
        // 那一次仍然需要先卸载）。
        // 每次修复都要能被区分出来 —— 用户就是靠页脚那行版本号判断"装的是不是新版"。
        // 之前一连串修复都停在 (2)，页脚毫无变化，等于没给出任何判断依据。
        // 5 / 2.14.1：修 2.14.0 引入的回归。
        //   · 入场动画被 onResume 的收尾分支掐断（用户反馈"拉绳动画没了"）
        //   · 前台服务 onCreate 里 armSchedules 未兜异常，可能起不来
        //   · 防护降级通知每 15 分钟重复发一次
        //   · 第二次要求拉绳时 pullDone 未复位
        versionCode = 5
        versionName = "2.14.1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // ⚠️ signingConfigs 必须写在 buildTypes **之前**：Kotlin DSL 自上而下执行，
    // buildTypes 里那句 signingConfigs.getByName("fixed") 在块还没定义时会抛
    // "SigningConfig 'fixed' not found"。
    signingConfigs {
        if (hasFixedSigning) {
            create("fixed") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // 刻意不开混淆：本项目大量使用反射式 XML 绑定与无障碍服务声明，
            // 开启 R8 需要额外维护 keep 规则，收益有限。发布前可自行打开并验证。
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            // 有固定密钥就用它签 debug 包，让后续版本可以覆盖安装
            if (hasFixedSigning) {
                signingConfig = signingConfigs.getByName("fixed")
            }
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
        viewBinding = true
        // 打开 BuildConfig，让界面能显示真实的 versionName / versionCode。
        // 之前界面上的版本号是代码里写死的常量，装的是哪一版根本看不出来 ——
        // 结果"修复到底生效没有"只能靠猜，非常容易误判。
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    lint {
        abortOnError = false
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.material)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
