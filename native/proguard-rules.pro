# FRIDAY OS — ProGuard / R8 rules (Phase 14 release build)
# Copied into android/app/proguard-rules.pro by codemagic.yaml release job.

# Capacitor + plugins: keep bridge classes
-keep class com.getcapacitor.** { *; }
-keep class com.rishu.fridayos.** { *; }

# Custom native plugins called from JS via reflection
-keep class com.rishu.fridayos.FridayNative { *; }
-keep class com.rishu.fridayos.FridaySpeech { *; }
-keep class com.rishu.fridayos.FridayWakeWord { *; }
-keep class com.rishu.fridayos.FridayVosk { *; }
-keep class com.rishu.fridayos.FridayTranslate { *; }
-keep class com.rishu.fridayos.FridaySherpa { *; }
-keep class com.rishu.fridayos.LlamaCpp { *; }
-keep class com.rishu.fridayos.FridaySensors { *; }
-keep class com.rishu.fridayos.FridayHealthConnect { *; }
-keep class com.rishu.fridayos.FridayCallGuard { *; }

# Vendored sherpa-onnx java-api (JNI-backed)
-keep class com.k2fsa.sherpa.onnx.** { *; }
-keepclasseswithmembernames class com.k2fsa.sherpa.onnx.** { native <methods>; }

# Vosk / Porcupine native libs
-keep class org.vosk.** { *; }
-keep class ai.picovoice.** { *; }

# llama.cpp Java binding
-keep class de.kherud.llama.** { *; }

# Keep annotations used by Capacitor plugin runtime
-keepattributes *Annotation*, InnerClasses, Signature
-keepclassmembers class * { @com.getcapacitor.annotation.CapacitorPlugin *; }

# Health Connect (reflection-based access)
-dontwarn androidx.health.connect.**
-keep class androidx.health.connect.** { *; }

# Gson/JSON used by plugins
-keepclassmembers class * { @com.google.gson.annotations.SerializedName <fields>; }

# No obfuscation issues for XML-referenced classes
-keep public class * extends android.app.Service { *; }
-keep public class * extends android.content.BroadcastReceiver { *; }
-keep public class * extends android.appwidget.AppWidgetProvider { *; }
-keep public class * extends android.accessibilityservice.AccessibilityService { *; }
-keep public class * extends android.service.quicksettings.TileService { *; }
