// 熄灯早睡 · Android 根构建脚本
//
// 仅声明插件版本，不做任何实际配置；模块级配置见 app/build.gradle.kts。
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
}
