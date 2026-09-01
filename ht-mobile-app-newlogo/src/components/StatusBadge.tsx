import { View, Text } from "react-native";
import type { AssetStatus } from "@/types/database";
import { statusLabel } from "@/lib/assetStateMachine";
import { useTheme } from "@/hooks/useTheme";

export function StatusBadge({ status }: { status: string }) {
  const theme = useTheme();
  const normalized = (status || "").toLowerCase() as keyof typeof theme.status;
  const themeStatus = theme?.status?.[normalized] ?? theme?.status?.tersedia ?? {
    bg: "rgba(34, 197, 94, 0.18)",
    text: "#4ADE80",
    border: "rgba(74, 222, 128, 0.35)",
  };

  return (
    <View
      style={{
        backgroundColor: themeStatus.bg,
        borderColor: themeStatus.border,
        borderWidth: 1,
        borderRadius: 999,
        height: 26,
        paddingHorizontal: 12,
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: themeStatus.text,
          shadowColor: themeStatus.text,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius: 4,
        }}
      />
      <Text
        style={{
          color: themeStatus.text,
          fontWeight: "700",
          fontSize: 12,
          letterSpacing: 0.2,
          includeFontPadding: false,
          textAlignVertical: "center",
        }}
      >
        {statusLabel((normalized as AssetStatus) || "tersedia")}
      </Text>
    </View>
  );
}

