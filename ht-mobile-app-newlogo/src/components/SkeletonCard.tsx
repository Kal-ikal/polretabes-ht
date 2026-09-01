import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";

export function SkeletonCard() {
  const theme = useTheme();
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.85, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const skeletonBg = theme.isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)";

  return (
    <Animated.View
      style={[
        animatedStyle,
        {
          backgroundColor: theme.cardBackground,
          borderColor: theme.cardBorder,
          borderWidth: 1,
          borderRadius: 20,
          padding: 16,
          marginBottom: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
        },
      ]}
    >
      {/* Circle Icon Skeleton */}
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          backgroundColor: skeletonBg,
        }}
      />

      {/* Content Skeleton Lines */}
      <View style={{ flex: 1, gap: 8 }}>
        <View style={{ width: "60%", height: 16, borderRadius: 8, backgroundColor: skeletonBg }} />
        <View style={{ width: "85%", height: 12, borderRadius: 6, backgroundColor: skeletonBg }} />
        <View style={{ width: "40%", height: 10, borderRadius: 5, backgroundColor: skeletonBg, marginTop: 4 }} />
      </View>
    </Animated.View>
  );
}
