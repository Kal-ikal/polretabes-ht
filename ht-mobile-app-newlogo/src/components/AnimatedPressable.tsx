import React, { useCallback } from "react";
import { Pressable, PressableProps, ViewStyle, StyleProp, Platform } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { SafeHaptics } from "@/lib/safeHaptics";

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

interface AnimatedPressableProps extends PressableProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  disableHaptic?: boolean;
}

function AnimatedPressableComponent({
  children,
  style,
  scaleTo = 0.98,
  disableHaptic = false,
  onPressIn,
  onPressOut,
  ...props
}: AnimatedPressableProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback((e: any) => {
    scale.value = withSpring(scaleTo, { damping: 25, stiffness: 400 });
    if (!disableHaptic && Platform.OS !== "web") {
      SafeHaptics.impactAsync();
    }
    if (onPressIn) onPressIn(e);
  }, [scale, scaleTo, disableHaptic, onPressIn]);

  const handlePressOut = useCallback((e: any) => {
    scale.value = withSpring(1, { damping: 25, stiffness: 400 });
    if (onPressOut) onPressOut(e);
  }, [scale, onPressOut]);

  const webStyle: any = Platform.OS === "web" ? { cursor: "pointer" } : {};

  return (
    <AnimatedPressableBase
      style={[webStyle, animatedStyle, style as any]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...props}
    >
      {children}
    </AnimatedPressableBase>
  );
}

export const AnimatedPressable = React.memo(AnimatedPressableComponent);
