/**
 * Cross-platform Alert Wrapper.
 * react-native-web's Alert.alert() is a total no-op, so on web every native
 * Alert.alert(...) call silently does nothing and the user gets zero feedback.
 * This wraps it with window.alert/confirm on web while delegating to the
 * native Alert module on iOS/Android, mirroring safeHaptics/safePrint.
 */
import { Alert, Platform } from "react-native";

export interface SafeAlertButton {
  text: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
}

function showWebAlert(title: string, message?: string, buttons?: SafeAlertButton[]) {
  if (typeof window === "undefined") return;
  const fullText = message ? `${title}\n\n${message}` : title;

  if (!buttons || buttons.length <= 1) {
    window.alert(fullText);
    buttons?.[0]?.onPress?.();
    return;
  }

  const cancelButton = buttons.find((b) => b.style === "cancel");
  const confirmButton = buttons.find((b) => b.style !== "cancel") || buttons[buttons.length - 1];

  if (window.confirm(fullText)) {
    confirmButton?.onPress?.();
  } else {
    cancelButton?.onPress?.();
  }
}

export const SafeAlert = {
  alert: (title: string, message?: string, buttons?: SafeAlertButton[]) => {
    if (Platform.OS === "web") {
      showWebAlert(title, message, buttons);
      return;
    }
    Alert.alert(title, message, buttons as any);
  },
};
