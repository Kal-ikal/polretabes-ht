import React, { useState, useEffect } from "react";
import { View, Text, Modal, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown, useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as ImagePicker from "expo-image-picker";
import { SafeHaptics } from "@/lib/safeHaptics";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/context/AuthContext";
import { Avatar } from "@/components/Avatar";
import { AnimatedPressable } from "@/components/AnimatedPressable";

interface EditProfileModalProps {
  visible: boolean;
  onClose: () => void;
}

export function EditProfileModal({ visible, onClose }: EditProfileModalProps) {
  const theme = useTheme();
  const { profile, updateProfile } = useAuth();
  const [fullName, setFullName] = useState("");
  const [nrp, setNrp] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const translateY = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = 0;
    }
  }, [visible]);

  const dismissModal = () => {
    translateY.value = withTiming(600, { duration: 180 }, (finished?: boolean) => {
      if (finished) {
        runOnJS(onClose)();
        translateY.value = 0;
      }
    });
  };

  const panGesture = Gesture.Pan()
    .onChange((event) => {
      if (event.translationY > 0) {
        translateY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      if (event.translationY > 100 || event.velocityY > 500) {
        dismissModal();
      } else {
        translateY.value = withSpring(0, { damping: 18 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setNrp(profile.nrp || "");
      setAvatarUrl(profile.avatar_url || null);
    }
  }, [profile, visible]);

  if (!visible) return null;

  async function handlePickImage() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        setErrorMsg("Izin akses galeri dibutuhkan untuk memilih foto profil.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const uri = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
        setAvatarUrl(uri);
        setErrorMsg(null);
      }
    } catch (err: any) {
      console.error("ImagePicker error:", err);
    }
  }

  async function handleSave() {
    if (!fullName.trim()) {
      setErrorMsg("Nama lengkap tidak boleh kosong.");
      return;
    }

    setErrorMsg(null);
    setSubmitting(true);
    const { error } = await updateProfile(fullName.trim(), nrp.trim(), avatarUrl);
    setSubmitting(false);

    if (error) {
      setErrorMsg(error);
    } else {
      try {
        SafeHaptics.notificationAsync();
      } catch {}
      dismissModal();
    }
  }

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={dismissModal}>
      <View style={StyleSheet.absoluteFill}>
        {/* Backdrop */}
        <Animated.View
          entering={FadeIn.duration(180)}
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0, 0, 0, 0.65)" }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={dismissModal} />
        </Animated.View>

        {/* Keyboard Avoiding Container */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, justifyContent: "flex-end" }}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {/* Sliding Modal Container with Drag Down Gesture */}
            <GestureDetector gesture={panGesture}>
              <Animated.View
                entering={SlideInDown.duration(200)}
                style={[
                  {
                    backgroundColor: theme.isDark ? "#0F172A" : "#FFFFFF",
                    borderTopLeftRadius: 24,
                    borderTopRightRadius: 24,
                    borderColor: theme.cardBorder,
                    borderWidth: 1,
                    paddingHorizontal: 24,
                    paddingTop: 12,
                    paddingBottom: 36,
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: -4 },
                    shadowOpacity: 0.25,
                    shadowRadius: 16,
                    elevation: 10,
                  },
                  animatedStyle,
                ]}
              >
              {/* Drag handle */}
              <View
                style={{
                  width: 36,
                  height: 5,
                  borderRadius: 2.5,
                  backgroundColor: theme.isDark ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.15)",
                  alignSelf: "center",
                  marginBottom: 20,
                }}
              />

              {/* Avatar Preview with Camera Selection Button */}
              <View style={{ alignItems: "center", marginBottom: 20 }}>
                <AnimatedPressable onPress={handlePickImage} style={{ alignItems: "center" }}>
                  <View style={{ position: "relative" }}>
                    <Avatar name={fullName || "Petugas"} avatarUrl={avatarUrl} size={80} />
                    <View
                      style={{
                        position: "absolute",
                        bottom: 0,
                        right: -4,
                        backgroundColor: theme.primary,
                        borderRadius: 16,
                        width: 28,
                        height: 28,
                        justifyContent: "center",
                        alignItems: "center",
                        borderWidth: 2,
                        borderColor: theme.isDark ? "#0F172A" : "#FFFFFF",
                      }}
                    >
                      <Ionicons name="camera" size={14} color="#FFFFFF" />
                    </View>
                  </View>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: theme.primary, marginTop: 8 }}>
                    Ubah Foto Profil
                  </Text>
                </AnimatedPressable>

                <Text
                  style={{
                    fontSize: 18,
                    fontWeight: "800",
                    color: theme.textPrimary,
                    marginTop: 10,
                  }}
                >
                  Ubah Profil Petugas
                </Text>
                <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 2 }}>
                  Perbarui nama, NRP, dan foto profil Anda
                </Text>
              </View>

              {errorMsg && (
                <View
                  style={{
                    backgroundColor: "rgba(239, 68, 68, 0.15)",
                    borderColor: "rgba(248, 113, 113, 0.3)",
                    borderWidth: 1,
                    borderRadius: 12,
                    padding: 10,
                    marginBottom: 14,
                  }}
                >
                  <Text style={{ color: "#F87171", fontSize: 13, textAlign: "center" }}>{errorMsg}</Text>
                </View>
              )}

              {/* Inputs */}
              <View style={{ gap: 14, marginBottom: 24 }}>
                <View>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textSecondary, marginBottom: 6 }}>
                    Nama Lengkap
                  </Text>
                  <TextInput
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder="Masukkan nama lengkap"
                    placeholderTextColor={theme.inputPlaceholder}
                    style={{
                      backgroundColor: theme.inputBackground,
                      borderWidth: 1,
                      borderColor: theme.inputBorder,
                      borderRadius: 14,
                      padding: 14,
                      color: theme.inputText,
                      fontSize: 15,
                      outlineStyle: "none" as any,
                    }}
                  />
                </View>

                <View>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textSecondary, marginBottom: 6 }}>
                    Pangkat / NRP (Opsional)
                  </Text>
                  <TextInput
                    value={nrp}
                    onChangeText={setNrp}
                    placeholder="Contoh: Bripda / 12345678"
                    placeholderTextColor={theme.inputPlaceholder}
                    style={{
                      backgroundColor: theme.inputBackground,
                      borderWidth: 1,
                      borderColor: theme.inputBorder,
                      borderRadius: 14,
                      padding: 14,
                      color: theme.inputText,
                      fontSize: 15,
                      outlineStyle: "none" as any,
                    }}
                  />
                </View>
              </View>

              {/* Action Buttons */}
              <View style={{ gap: 10 }}>
                <AnimatedPressable
                  onPress={handleSave}
                  disabled={submitting}
                  style={{
                    backgroundColor: theme.primary,
                    paddingVertical: 15,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  {submitting ? (
                    <ActivityIndicator color={theme.primaryTextOnButton} />
                  ) : (
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                      style={{ color: theme.primaryTextOnButton, fontWeight: "700", fontSize: 16, includeFontPadding: false }}
                    >
                      Simpan Perubahan
                    </Text>
                  )}
                </AnimatedPressable>

                <AnimatedPressable onPress={dismissModal} style={{ paddingVertical: 12, alignItems: "center", justifyContent: "center" }}>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                    style={{ color: theme.textSecondary, fontWeight: "600", fontSize: 15, includeFontPadding: false }}
                  >
                    Batal
                  </Text>
                </AnimatedPressable>
              </View>
              </Animated.View>
            </GestureDetector>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
