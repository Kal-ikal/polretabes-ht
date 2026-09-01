import { useState } from "react";
import { View, Text, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useAppTheme } from "@/context/ThemeContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppBottomSheet } from "@/components/AppBottomSheet";

import { supabase } from "@/lib/supabase";

export default function LoginScreen() {
  const router = useRouter();
  const { session, signIn, loading } = useAuth();
  const { theme, isDark, toggleColorScheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isEmailFocused, setIsEmailFocused] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [modalConfig, setModalConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon: string;
    isDanger?: boolean;
    onConfirm: () => void;
  }>({
    visible: false,
    title: "",
    message: "",
    icon: "⚠️",
    onConfirm: () => {},
  });

  if (loading) {
    return (
      <LinearGradient
        colors={theme.backgroundGradient}
        style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
      >
        <ActivityIndicator color={theme.primary} size="large" />
      </LinearGradient>
    );
  }

  if (session) {
    return <Redirect href="/(tabs)" />;
  }

  async function handleLogin() {
    const inputStr = identifier.trim();
    if (!inputStr || !password.trim()) {
      setModalConfig({
        visible: true,
        title: "Lengkapi Data",
        message: "Nama / Email dan password wajib diisi untuk masuk.",
        icon: "⚠️",
        onConfirm: () => {},
      });
      return;
    }

    setSubmitting(true);
    let targetEmail = inputStr;

    // If user enters Full Name or Nickname (without '@')
    if (!inputStr.includes("@")) {
      const { data: rpcEmail } = await supabase
        .rpc("get_email_by_identifier", { p_identifier: inputStr });

      if (rpcEmail) {
        targetEmail = rpcEmail;
      } else {
        const { data: matchedProfile } = await supabase
          .from("profiles")
          .select("email, full_name")
          .or(`full_name.ilike.%${inputStr}%,nrp.ilike.%${inputStr}%`)
          .maybeSingle();

        if (matchedProfile?.email) {
          targetEmail = matchedProfile.email;
        }
      }
    }

    const { error } = await signIn(targetEmail, password.trim());
    setSubmitting(false);

    if (error) {
      setModalConfig({
        visible: true,
        title: "Login Gagal",
        message: error || "Nama / Email atau kata sandi tidak sesuai. Silakan periksa kembali.",
        icon: "❌",
        isDanger: true,
        onConfirm: () => {},
      });
    }
  }

  return (
    <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1 }}>
      {/* Full-Screen Background: Logo TIK POLRI, full-bleed cover with increased opacity */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 0,
          overflow: "hidden",
        }}
      >
        <Image
          source={require("../assets/images/logo.png")}
          style={{
            width: "100%",
            height: "100%",
            opacity: isDark ? 0.35 : 0.26,
          }}
          resizeMode="cover"
        />
        {/* Subtle gradient overlay on top of the logo so the form stays legible */}
        <LinearGradient
          colors={
            isDark
              ? ["rgba(11,15,25,0.40)", "rgba(11,15,25,0.75)"]
              : ["rgba(255,255,255,0.35)", "rgba(255,255,255,0.70)"]
          }
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, zIndex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
            paddingVertical: 36,
          }}
        >
          {/* Top-Right Theme Toggle Header Button */}
          <View style={{ position: "absolute", top: Math.max(insets.top, 16) + 8, right: 24, zIndex: 10 }}>
            <AnimatedPressable
              onPress={toggleColorScheme}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(2, 132, 199, 0.1)",
                borderColor: isDark ? "rgba(255, 255, 255, 0.2)" : "rgba(2, 132, 199, 0.25)",
                borderWidth: 1,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Ionicons
                name={isDark ? "sunny-outline" : "moon-outline"}
                size={20}
                color={isDark ? "#FACC15" : "#0284C7"}
              />
            </AnimatedPressable>
          </View>

          {/* Top Brand Moment Header */}
          <Animated.View
            entering={FadeIn.duration(400)}
            style={{ alignItems: "center", marginBottom: 32 }}
          >
            {/* Brand Emblem: actual TIK POLRI logo */}
            <View
              style={{
                width: 104,
                height: 104,
                borderRadius: 26,
                justifyContent: "center",
                alignItems: "center",
                marginBottom: 16,
                backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(2,132,199,0.06)",
                borderWidth: 2,
                borderColor: isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(2, 132, 199, 0.15)",
                shadowColor: "#0284C7",
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.25,
                shadowRadius: 16,
                elevation: 8,
              }}
            >
              <Image
                source={require("../assets/images/logo.png")}
                style={{ width: 78, height: 78 }}
                resizeMode="contain"
              />
            </View>

            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={{
                fontSize: 28,
                fontWeight: "800",
                color: theme.textPrimary,
                textAlign: "center",
                letterSpacing: -0.5,
              }}
            >
              HT Peminjaman
            </Text>

            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              style={{
                fontSize: 14,
                color: theme.textSecondary,
                textAlign: "center",
                marginTop: 4,
                fontWeight: "500",
              }}
            >
              Sistem peminjaman aset komunikasi
            </Text>
          </Animated.View>

          {/* Form Card Section */}
          <Animated.View
            entering={FadeIn.duration(400).delay(100)}
            style={{
              backgroundColor: theme.cardBackground,
              borderColor: theme.cardBorder,
              borderWidth: 1,
              borderRadius: 24,
              padding: 24,
              gap: 16,
              width: "100%",
              maxWidth: 440,
              alignSelf: "center",
              shadowColor: theme.shadowColor,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.15,
              shadowRadius: 18,
              elevation: 6,
            }}
          >
            {/* Identifier (Email / Full Name / Nickname) Field with Left Icon */}
            <View>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={{ fontSize: 13, fontWeight: "600", color: theme.textSecondary, marginBottom: 6 }}
              >
                Nama Petugas / Email
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: theme.inputBackground,
                  borderWidth: 1.5,
                  borderColor: isEmailFocused ? theme.primary : theme.inputBorder,
                  borderRadius: 16,
                  paddingHorizontal: 14,
                  height: 52,
                }}
              >
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={isEmailFocused ? theme.primary : theme.textMuted}
                  style={{ marginRight: 10 }}
                />
                <TextInput
                  placeholder="Nama (cth: ADMIN HT) atau Email"
                  placeholderTextColor={theme.inputPlaceholder}
                  autoCapitalize="none"
                  value={identifier}
                  onChangeText={setIdentifier}
                  onFocus={() => setIsEmailFocused(true)}
                  onBlur={() => setIsEmailFocused(false)}
                  style={{
                    flex: 1,
                    height: "100%",
                    color: theme.inputText,
                    fontSize: 15,
                    borderWidth: 0,
                    backgroundColor: "transparent",
                    outlineStyle: "none" as any,
                  }}
                />
              </View>
            </View>

            {/* Password Field with Left Icon & Eye Toggle */}
            <View>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={{ fontSize: 13, fontWeight: "600", color: theme.textSecondary, marginBottom: 6 }}
              >
                Kata Sandi
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: theme.inputBackground,
                  borderWidth: 1.5,
                  borderColor: isPasswordFocused ? theme.primary : theme.inputBorder,
                  borderRadius: 16,
                  paddingHorizontal: 14,
                  height: 52,
                }}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color={isPasswordFocused ? theme.primary : theme.textMuted}
                  style={{ marginRight: 10 }}
                />
                <TextInput
                  placeholder="Masukkan kata sandi"
                  placeholderTextColor={theme.inputPlaceholder}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setIsPasswordFocused(true)}
                  onBlur={() => setIsPasswordFocused(false)}
                  style={{
                    flex: 1,
                    height: "100%",
                    color: theme.inputText,
                    fontSize: 15,
                    borderWidth: 0,
                    backgroundColor: "transparent",
                    outlineStyle: "none" as any,
                  }}
                />
                <AnimatedPressable
                  onPress={() => setShowPassword(!showPassword)}
                  style={{ padding: 6 }}
                  scaleTo={0.9}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={theme.textMuted}
                  />
                </AnimatedPressable>
              </View>
            </View>

            {/* Forgot Password Link */}
            <View style={{ alignItems: "flex-end", marginTop: -4 }}>
              <AnimatedPressable onPress={() => router.push("/forgot-password")}>
                <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.primary }}>
                  Lupa kata sandi?
                </Text>
              </AnimatedPressable>
            </View>

            {/* Login Button with LinearGradient */}
            <AnimatedPressable
              onPress={handleLogin}
              disabled={submitting}
              style={{ marginTop: 8 }}
            >
              <LinearGradient
                colors={theme.isDark ? ["#0284C7", "#1D4ED8"] : ["#0284C7", "#0369A1"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  borderRadius: 16,
                  paddingVertical: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                    style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 16, includeFontPadding: false }}
                  >
                    Masuk ke Akun
                  </Text>
                )}
              </LinearGradient>
            </AnimatedPressable>

            {/* Link to Self-Registration */}
            <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 4 }}>
              <Text style={{ fontSize: 13, color: theme.textSecondary }}>
                Belum punya akun?{" "}
              </Text>
              <AnimatedPressable onPress={() => router.push("/register")}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.primary }}>
                  Daftar di sini
                </Text>
              </AnimatedPressable>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Alert Bottom Sheet Modal */}
      <AppBottomSheet
        visible={modalConfig.visible}
        onClose={() => setModalConfig((prev) => ({ ...prev, visible: false }))}
        onConfirm={modalConfig.onConfirm}
        title={modalConfig.title}
        message={modalConfig.message}
        icon={modalConfig.icon}
        isDanger={modalConfig.isDanger}
      />
    </LinearGradient>
  );
}
