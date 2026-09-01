import React from "react";
import { View, Text, Modal, Pressable, StyleSheet, Platform } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { AnimatedPressable } from "@/components/AnimatedPressable";

interface AppBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  title: string;
  message: string;
  icon?: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

export function AppBottomSheet({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  icon = "ℹ️",
  confirmText = "Konfirmasi",
  cancelText = "Batal",
  isDanger = false,
}: AppBottomSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  const handleConfirm = () => {
    onClose();
    if (onConfirm) {
      setTimeout(() => {
        onConfirm();
      }, 100);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: 24,
            paddingTop: insets.top,
            paddingBottom: Math.max(insets.bottom, 24),
            zIndex: 9999,
          },
        ]}
      >
        {/* Backdrop */}
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "rgba(0, 0, 0, 0.65)" },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={handleCancel} />
        </Animated.View>

        {/* Centered Floating Dialog Card (Elevated & Prominent) */}
        <Animated.View
          entering={ZoomIn.duration(220)}
          exiting={ZoomOut.duration(150)}
          style={{
            width: "100%",
            maxWidth: 390,
            backgroundColor: theme.isDark ? "#111827" : "#FFFFFF",
            borderColor: theme.cardBorder,
            borderWidth: 1,
            borderRadius: 24,
            paddingHorizontal: 24,
            paddingTop: 28,
            paddingBottom: 24,
            alignItems: "center",
            shadowColor: theme.shadowColor,
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.35,
            shadowRadius: 24,
            elevation: 16,
            zIndex: 10000,
          }}
        >
          {/* Icon Badge */}
          <View
            style={{
              width: 68,
              height: 68,
              borderRadius: 34,
              backgroundColor: isDanger
                ? theme.isDark
                  ? "rgba(239, 68, 68, 0.18)"
                  : "rgba(239, 68, 68, 0.12)"
                : theme.isDark
                ? "rgba(2, 132, 199, 0.18)"
                : "rgba(2, 132, 199, 0.10)",
              borderWidth: 1.5,
              borderColor: isDanger
                ? "rgba(239, 68, 68, 0.35)"
                : "rgba(2, 132, 199, 0.25)",
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <Text style={{ fontSize: 32 }}>{icon}</Text>
          </View>

          {/* Title */}
          <Text
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={{
              fontSize: 19,
              fontWeight: "800",
              color: theme.textPrimary,
              textAlign: "center",
              letterSpacing: -0.3,
              marginBottom: 8,
            }}
          >
            {title}
          </Text>

          {/* Message Content */}
          <Text
            style={{
              fontSize: 14,
              color: theme.textSecondary,
              textAlign: "center",
              lineHeight: 21,
              marginBottom: 24,
              paddingHorizontal: 4,
            }}
          >
            {message}
          </Text>

          {/* Action Buttons */}
          <View style={{ width: "100%", gap: 10 }}>
            <AnimatedPressable
              onPress={handleConfirm}
              style={{
                backgroundColor: isDanger ? "#EF4444" : theme.primary,
                paddingVertical: 14,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: isDanger ? "#EF4444" : theme.primary,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25,
                shadowRadius: 8,
                elevation: 4,
              }}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={{
                  color: "#FFFFFF",
                  fontWeight: "700",
                  fontSize: 15,
                  includeFontPadding: false,
                }}
              >
                {confirmText}
              </Text>
            </AnimatedPressable>

            {cancelText ? (
              <AnimatedPressable
                onPress={handleCancel}
                style={{
                  backgroundColor: theme.isDark
                    ? "rgba(255, 255, 255, 0.08)"
                    : "#F1F5F9",
                  borderColor: theme.cardBorder,
                  borderWidth: 1,
                  paddingVertical: 13,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={{
                    color: theme.textSecondary,
                    fontWeight: "600",
                    fontSize: 14,
                    includeFontPadding: false,
                  }}
                >
                  {cancelText}
                </Text>
              </AnimatedPressable>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
