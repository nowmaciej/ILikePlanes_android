# JavaScript interface
-keepclassmembers class com.ilikeplanes.app.MainActivity$LocationJSInterface {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep WebView classes
-keep class android.webkit.** { *; }

# Keep coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}

# Keep JSON
-dontwarn org.json.**

# Keep Google Play Services
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**
