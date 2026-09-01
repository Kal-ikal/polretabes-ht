# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# React Native & TurboModules
-keep class com.facebook.react.** { *; }
-keepclassmembers class * implements com.facebook.react.bridge.JavaScriptModule { *; }
-keepclassmembers class * implements com.facebook.react.bridge.NativeModule { *; }

# AsyncStorage
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# Gesture Handler & Screens
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.swmansion.rnscreens.** { *; }

# Expo Modules
-keep class expo.modules.** { *; }
-keep class * extends expo.modules.kotlin.modules.Module { *; }

# OkHttp & Networking
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
