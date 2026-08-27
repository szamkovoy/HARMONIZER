# Harmonizer — release ProGuard / R8 keep rules (Android store builds only).
# Applied via expo-build-properties extraProguardRules in app.config.ts.

# --- React Native / Hermes ---
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.soloader.** { *; }
-keep class com.facebook.imagepipeline.** { *; }
-keep class com.facebook.drawee.** { *; }
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keepattributes InnerClasses,EnclosingMethod
-keepattributes Signature
-keepattributes Exceptions
-keep public class * extends com.facebook.react.bridge.JavaScriptModule { *; }
-keep public class * extends com.facebook.react.bridge.NativeModule { *; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactProp <methods>; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>; }

# --- Expo modules ---
-keep class expo.modules.** { *; }
-keep @expo.modules.core.interfaces.DoNotStrip class *
-keepclassmembers class * { @expo.modules.core.interfaces.DoNotStrip *; }

# --- Harmonizer local native modules ---
-keep class com.harmonizer.** { *; }

# --- Reanimated / Worklets ---
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.worklets.** { *; }
-keep class com.mrousavy.worklets.** { *; }

# --- Vision Camera / Frame processors ---
-keep class com.mrousavy.camera.** { *; }
-keep class com.harmonizer.biofeedbackfingerframeprocessor.** { *; }

# --- Skia ---
-keep class com.shopify.reactnative.skia.** { *; }

# --- BLE ---
-keep class com.polidea.** { *; }
-keep class com.sfourdrinier.** { *; }

# --- Firebase / App Check ---
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# --- Health Connect ---
-keep class dev.matinzd.healthconnect.** { *; }
-keep class androidx.health.connect.** { *; }

# --- Google Maps ---
-keep class com.google.android.libraries.maps.** { *; }
-keep class com.google.android.gms.maps.** { *; }

# --- WebView ---
-keep class com.reactnativecommunity.webview.** { *; }

# --- Credential Manager / Restore Credentials ---
-keep class androidx.credentials.** { *; }
-dontwarn androidx.credentials.**

# --- Sentry (mapping uploaded separately) ---
-keepattributes LineNumberTable,SourceFile
-dontwarn io.sentry.**

# --- OkHttp / networking (Supabase fetch stack) ---
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# --- Kotlin / coroutines ---
-dontwarn kotlin.**
-dontwarn kotlinx.**
-keepclassmembers class kotlin.Metadata { public <methods>; }

# --- Serialization / JSON ---
-keepclassmembers class * {
  @com.google.gson.annotations.SerializedName <fields>;
}
