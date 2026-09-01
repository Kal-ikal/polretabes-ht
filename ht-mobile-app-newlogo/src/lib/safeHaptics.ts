/**
 * Safe Haptics Wrapper for Web Compatibility
 * On web, expo-haptics is not supported and will throw.
 * This module wraps all Haptics calls with Platform checks and try/catch.
 */
import { Platform } from "react-native";

// Dynamically import expo-haptics only on native
let HapticsModule: typeof import("expo-haptics") | null = null;

if (Platform.OS !== "web") {
  try {
    HapticsModule = require("expo-haptics");
  } catch {
    HapticsModule = null;
  }
}

export const SafeHaptics = {
  selectionAsync: () => {
    if (Platform.OS === "web" || !HapticsModule) return;
    try {
      HapticsModule.selectionAsync();
    } catch {}
  },

  impactAsync: (style?: any) => {
    if (Platform.OS === "web" || !HapticsModule) return;
    try {
      HapticsModule.impactAsync(style ?? HapticsModule.ImpactFeedbackStyle.Light);
    } catch {}
  },

  notificationAsync: (type?: any) => {
    if (Platform.OS === "web" || !HapticsModule) return;
    try {
      HapticsModule.notificationAsync(type ?? HapticsModule.NotificationFeedbackType.Success);
    } catch {}
  },
};

// Re-export feedback types for convenience
export const ImpactFeedbackStyle = {
  Light: "Light" as const,
  Medium: "Medium" as const,
  Heavy: "Heavy" as const,
};

export const NotificationFeedbackType = {
  Success: "Success" as const,
  Warning: "Warning" as const,
  Error: "Error" as const,
};
