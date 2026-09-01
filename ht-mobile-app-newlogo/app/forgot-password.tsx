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

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const { theme, isDark, toggleColorScheme } = useAppTheme();
  const insets = useSafeAreaInsets();

  const [identifier, setIdentifier] = useState("");
  const [isInputFocused, setIsInputFocused] = useState(false);
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

  async function handleResetPassword() {
    const inputStr = identifier.trim();

    if (!inputStr) {
      setModalConfig({
        visible: true,
        title: "Lengkapi Data",
        message: "Silakan masukkan alamat email atau Nama/NRP yang terdaftar.",
        icon: "⚠️",
        onConfirm: () => {},
      });
      return;
    }

    setSubmitting(true);
    let targetEmail = inputStr.toLowerCase();

    try {
      // If user inputs Name or NRP (without @), lookup their registered email
      if (!inputStr.includes("@")) {
        const { data: rpcEmail } = await supabase
          .rpc("get_email_by_identifier", { p_identifier: inputStr });

        if (rpcEmail) {
          targetEmail = rpcEmail;
        } else {
          const { data: matchedProfile } = await supabase
            .from("profiles")
            .select("email")
            .or(`full_name.ilike.%${inputStr}%,nrp.ilike.%${inputStr}%`)
            .maybeSingle();

          if (matchedProfile?.email) {
            targetEmail = matchedProfile.email;
          }
        }
      }

      // Call Supabase Auth reset password
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(targetEmail, {
        redirectTo: "https://dwyqwbmnouiyhcpsyivn.supabase.co/auth/v1/verify",
      });

      setSubmitting(false);

      if (resetErr) {
        setModalConfig({
          visible: true,
          title: "Permintaan Gagal",
          message: getFriendlyErrorMessage(resetErr, "Gagal mengirimkan instruksi reset kata sandi. Pastikan email terdaftar atau hubungi Admin Logistik TIK."),
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
        title: "Instruksi Terkirim",
        message: `Instruksi pemulihan kata sandi telah dikirim ke alamat ${targetEmail}. Silakan periksa kotak masuk atau spam email Anda.\n\nJika tidak memiliki akses email, silakan hubungi Admin Logistik TIK untuk reset instan.`,
        icon: "📬",
        onConfirm: () => router.replace("/login"),
      });
    } catch (err: any) {
      setSubmitting(false);
      setModalConfig({
        visible: true,
        title: "Kesalahan Sistem",
        message: err.message || "Gagal memproses reset kata sandi.",
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
            paddingVertical: 36,
          }}
          keyboardShouldPersistTaps="handled"
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
              Pemulihan Sandi
            </Text>

            <Text
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              style={{
                fontSize: 13.5,
                color: theme.textSecondary,
                textAlign: "center",
                marginTop: 4,
                fontWeight: "500",
                lineHeight: 19,
                paddingHorizontal: 12,
              }}
            >
              Masukkan email atau ID akun untuk menerima tautan pemulihan kata sandi
            </Text>
          </Animated.View>

          {/* Form Card */}
          <Animated.View
            entering={FadeIn.duration(400).delay(100)}
            style={{
              backgroundColor: theme.cardBackground,
              borderColor: theme.cardBorder,
              borderWidth: 1,
              borderRadius: 24,
              padding: 24,
              gap: 18,
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
            {/* Input Identifier */}
            <View>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={{ fontSize: 13, fontWeight: "600", color: theme.textSecondary, marginBottom: 6 }}
              >
                Alamat Email / Nama Petugas
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: theme.inputBackground,
                  borderWidth: 1.5,
                  borderColor: isInputFocused ? theme.primary : theme.inputBorder,
                  borderRadius: 16,
                  paddingHorizontal: 14,
                  height: 52,
                }}
              >
                <Ionicons
                  name="mail-outline"
                  size={20}
                  color={isInputFocused ? theme.primary : theme.textMuted}
                  style={{ marginRight: 10 }}
                />
                <TextInput
                  placeholder="Email (cth: budi@polri.go.id) atau Nama"
                  placeholderTextColor={theme.inputPlaceholder}
                  autoCapitalize="none"
                  value={identifier}
                  onChangeText={setIdentifier}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
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

            {/* Submit Button */}
            <AnimatedPressable
              onPress={handleResetPassword}
              disabled={submitting}
              style={{ marginTop: 4 }}
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
                    Kirim Tautan Pemulihan
                  </Text>
                )}
              </LinearGradient>
            </AnimatedPressable>

            {/* Back to Login Link */}
            <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 4 }}>
              <Text style={{ fontSize: 13, color: theme.textSecondary }}>
                Ingat kata sandi Anda?{" "}
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
