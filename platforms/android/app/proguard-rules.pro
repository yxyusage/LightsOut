# 熄灯早睡 · 混淆规则
#
# 默认 build 未开启 minify（见 app/build.gradle.kts 的说明）。
# 若自行开启 R8，至少需要保留下面这些入口。

# 无障碍服务、设备管理员接收器、Service 都由系统通过清单实例化
-keep class com.xideng.sleep.service.** { *; }
-keep class com.xideng.sleep.receiver.** { *; }
-keep class com.xideng.sleep.ui.** { *; }

# 供 WebView 调用的 JS 桥接口（@JavascriptInterface 依赖名称反射）
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
