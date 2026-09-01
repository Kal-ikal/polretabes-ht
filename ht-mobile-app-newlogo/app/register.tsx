import { useState } from "react";
import { View, Text, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image } from "react-native";
import { useRouter, Redirect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SafeHaptics } from "@/lib/safeHaptics";
import { useAuth } from "@/context/AuthContext";
import { useAppTheme } from "@/context/ThemeContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppBottomSheet } from "@/components/AppBottomSheet";
import { getFriendlyErrorMessage } from "@/lib/errorHandler";
import { supabase } from "@/lib/supabase";

export default function RegisterScreen() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const { theme, isDark, toggleColorScheme } = useAppTheme();
  const insets = useSafeAreaInsets();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [isNameFocused, setIsNameFocused] = useState(false);
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

  async function handleRegister() {
    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanName || !cleanEmail || !cleanPassword) {
      setModalConfig({
        visible: true,
        title: "Lengkapi Data",
        message: "Nama Lengkap, Email, dan Kata Sandi wajib diisi.",
        icon: "⚠️",
        onConfirm: () => {},
      });
      return;
    }

    if (!cleanEmail.includes("@") || !cleanEmail.includes(".")) {
      setModalConfig({
        visible: true,
        title: "Email Tidak Valid",
        message: "Format alamat email tidak sesuai. Contoh: nama@polri.go.id atau user@gmail.com",
        icon: "⚠️",
        onConfirm: () => {},
      });
      return;
    }

    if (cleanPassword.length < 6) {
      setModalConfig({
        visible: true,
        title: "Kata Sandi Terlalu Pendek",
        message: "Kata sandi minimal harus terdiri dari 6 karakter.",
        icon: "⚠️",
        onConfirm: () => {},
      });
      return;
    }

    setSubmitting(true);

    try {
      // Register via Supabase Auth with Name metadata (role: petugas, status: PENDING)
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: cleanEmail,
        password: cleanPassword,
        options: {
          data: {
            full_name: cleanName,
            name: cleanName,
            role: "petugas",
            status: "PENDING",
          },
        },
      });

      setSubmitting(false);

      if (signUpErr) {
        setModalConfig({
          visible: true,
          title: "Registrasi Gagal",
          message: getFriendlyErrorMessage(signUpErr, "Terjadi kesalahan saat mendaftarkan akun."),
          icon: "❌",
          isDanger: true,
          onConfirm: () => {},
        });
        return;
      }

      try {
        SafeHaptics.notificationAsync();
      } catch {}

      setModalConfig({
        visible: true,
        title: "Registrasi Berhasil",
        message: "Registrasi Berhasil. Akun Anda berstatus PENDING. Silakan lapor ke Admin untuk persetujuan.",
        icon: "⏳",
        onConfirm: () => router.replace("/login"),
      });
    } catch (err: any) {
      setSubmitting(false);
      setModalConfig({
        visible: true,
        title: "Kesalahan Sistem",
        message: err.message || "Gagal memproses registrasi.",
        icon: "❌",
        isDanger: true,
        onConfirm: () => {},
      });
    }
  }

  return (
    <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1 }}>
      {/* Full-Screen Background: Logo TIK POLRI */}
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
            paddingVertical: 32,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Top-Right Theme Toggle Header Button */}
          <View style={{ position: "absolute", top: Math.max(insets.top, 16) + 4, right: 24, zIndex: 10 }}>
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
            style={{ alignItems: "center", marginBottom: 24 }}
          >
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: 24,
                justifyContent: "center",
                alignItems: "center",
                marginBottom: 14,
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
                style={{ width: 64, height: 64 }}
                resizeMode="contain"
              />
            </View>

            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={{
                fontSize: 26,
                fontWeight: "800",
                color: theme.textPrimary,
                textAlign: "center",
                letterSpacing: -0.5,
              }}
            >
              Daftar Akun Petugas
            </Text>

            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              style={{
                fontSize: 13.5,
                color: theme.textSecondary,
                textAlign: "center",
                marginTop: 3,
                fontWeight: "500",
              }}
            >
              Pendaftaran anggota untuk peminjaman unit HT
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
            {/* 1. Full Name Field */}
            <View>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={{ fontSize: 13, fontWeight: "600", color: theme.textSecondary, marginBottom: 6 }}
              >
                Nama Lengkap & Pangkat
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: theme.inputBackground,
                  borderWidth: 1.5,
                  borderColor: isNameFocused ? theme.primary : theme.inputBorder,
                  borderRadius: 16,
                  paddingHorizontal: 14,
                  height: 52,
                }}
              >
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={isNameFocused ? theme.primary : theme.textMuted}
                  style={{ marginRight: 10 }}
                />
                <TextInput
                  placeholder="Contoh: Bripka Budi Santoso"
                  placeholderTextColor={theme.inputPlaceholder}
                  autoCapitalize="words"
                  value={fullName}
                  onChangeText={setFullName}
                  onFocus={() => setIsNameFocused(true)}
                  onBlur={() => setIsNameFocused(false)}
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

            {/* 2. Email Field */}
            <View>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={{ fontSize: 13, fontWeight: "600", color: theme.textSecondary, marginBottom: 6 }}
              >
                Alamat Email
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
                  name="mail-outline"
                  size={20}
                  color={isEmailFocused ? theme.primary : theme.textMuted}
                  style={{ marginRight: 10 }}
                />
                <TextInput
                  placeholder="Contoh: nama@polri.go.id"
                  placeholderTextColor={theme.inputPlaceholder}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
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

            {/* 3. Password Field */}
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
                  placeholder="Minimal 6 karakter"
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

            {/* Register Submit Button */}
            <AnimatedPressable
              onPress={handleRegister}
              disabled={submitting}
              style={{ marginTop: 6 }}
            >
              <LinearGradient
                colors={theme.isDark ? ["#0284C7", "#1D4ED8"] : ["#0284C7", "#0369A1"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  borderRadius: 16,
                  paddingVertical: 15,
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
                    Daftar Akun
                  </Text>
                )}
              </LinearGradient>
            </AnimatedPressable>

            {/* Navigation back to Login */}
            <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 4 }}>
              <Text style={{ fontSize: 13, color: theme.textSecondary }}>
                Sudah punya akun?{" "}
              </Text>
              <AnimatedPressable onPress={() => router.replace("/login")}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.primary }}>
                  Masuk di sini
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
