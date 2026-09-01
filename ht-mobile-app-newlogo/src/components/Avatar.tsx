import React from "react";
import { View, Text, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";

// Deterministic gradient palettes
const PALETTES: [string, string][] = [
  ["#0284C7", "#38BDF8"], // Ocean Cyan
  ["#0D9488", "#2DD4BF"], // Teal Aqua
  ["#4F46E5", "#818CF8"], // Indigo Violet
  ["#2563EB", "#60A5FA"], // Royal Blue
  ["#059669", "#34D399"], // Emerald Mint
  ["#7C3AED", "#A78BFA"], // Deep Purple
];

function getHashGradient(input: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % PALETTES.length;
  return PALETTES[index];
}

function getInitials(name: string): string {
  if (!name) return "PT";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].substring(0, 2).toUpperCase();
}

interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  showDot?: boolean;
  dotColor?: string;
  showEditIcon?: boolean;
  onPress?: () => void;
}

export function Avatar({
  name,
  avatarUrl,
  size = 44,
  showDot,
  dotColor,
  showEditIcon,
  onPress,
}: AvatarProps) {
  const gradient = getHashGradient(name || "Petugas");
  const initials = getInitials(name || "Petugas");
  const fontSize = Math.round(size * 0.38);

  const innerContent = (
    <View style={{ width: size, height: size, position: "relative" }}>
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 1.5,
            borderColor: "rgba(255, 255, 255, 0.4)",
          }}
        />
      ) : (
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            justifyContent: "center",
            alignItems: "center",
            borderWidth: 1.5,
            borderColor: "rgba(255, 255, 255, 0.4)",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize }}>
            {initials}
          </Text>
        </LinearGradient>
      )}

      {showEditIcon ? (
        <View
          style={{
            position: "absolute",
            bottom: -2,
            right: -2,
            width: Math.max(18, Math.round(size * 0.4)),
            height: Math.max(18, Math.round(size * 0.4)),
            borderRadius: 999,
            backgroundColor: "#0284C7",
            borderWidth: 2,
            borderColor: "#0F172A",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Ionicons name="pencil" size={Math.max(9, Math.round(size * 0.22))} color="#FFFFFF" />
        </View>
      ) : showDot && dotColor ? (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: Math.max(10, Math.round(size * 0.26)),
            height: Math.max(10, Math.round(size * 0.26)),
            borderRadius: 999,
            backgroundColor: dotColor,
            borderWidth: 2,
            borderColor: "#0F172A",
          }}
        />
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <AnimatedPressable onPress={onPress} style={{ width: size, height: size }}>
        {innerContent}
      </AnimatedPressable>
    );
  }

  return innerContent;
}
