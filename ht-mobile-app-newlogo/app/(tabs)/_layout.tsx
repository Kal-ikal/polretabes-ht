import React, { useState, useEffect, useCallback } from "react";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeHaptics } from "@/lib/safeHaptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useAppTheme } from "@/context/ThemeContext";
import { supabase } from "@/lib/supabase";

export default function TabsLayout() {
  const { session, profile, loading } = useAuth();
  const { theme, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [pendingCount, setPendingCount] = useState<number>(0);

  const isAdmin = profile?.role === "admin";

  const fetchPendingCount = useCallback(async () => {
    if (!isAdmin) return;
    const { count } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("action", "BORROW")
      .eq("status", "PENDING");

    setPendingCount(count ?? 0);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;

    fetchPendingCount();

    const channelId = `tabs-pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions" },
        () => fetchPendingCount()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin, fetchPendingCount]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: theme.backgroundGradient[0],
        }}
      >
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/login" />;
  }

  const triggerHaptic = () => {
    try {
      SafeHaptics.selectionAsync();
    } catch {}
  };

  const bottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 10 : 0);
  const tabBarHeight = 60 + bottomInset;

  return (
    <Tabs
      screenOptions={{
        animation: "fade",
        headerShown: true,
        headerStyle: {
          backgroundColor: isDark ? "#0B132B" : "#0284C7",
        },
        headerTintColor: "#FFFFFF",
        headerTitleStyle: {
          fontWeight: "800",
          fontSize: 18,
          letterSpacing: 0.3,
        },
        tabBarStyle: {
          backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
          borderTopColor: theme.cardBorder,
          elevation: 10,
          shadowColor: theme.shadowColor,
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.12,
          shadowRadius: 8,
          height: tabBarHeight,
          paddingBottom: bottomInset > 0 ? bottomInset : 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarLabelStyle: {
          fontWeight: "700",
          fontSize: 11,
          marginTop: 2,
        },
      }}
    >
      {/* TAB 1: INDEX (Approval for Admin, Peminjaman for Petugas) */}
      <Tabs.Screen
        name="index"
        options={{
          title: isAdmin ? "Verifikasi" : "Peminjaman",
          tabBarBadge: isAdmin && pendingCount > 0 ? pendingCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: "#EF4444",
            color: "#FFFFFF",
            fontSize: 10,
            fontWeight: "800",
          },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={
                isAdmin
                  ? focused
                    ? "checkmark-done-circle"
                    : "checkmark-done-circle-outline"
                  : focused
                  ? "radio"
                  : "radio-outline"
              }
              size={23}
              color={color}
            />
          ),
        }}
        listeners={{ tabPress: triggerHaptic }}
      />

      {/* TAB 2: SCAN QR (Only for Petugas - Hidden for Admin) */}
      <Tabs.Screen
        name="scan"
        options={{
          title: "Scan QR",
          href: isAdmin ? null : "/(tabs)/scan",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "qr-code" : "qr-code-outline"}
              size={22}
              color={color}
            />
          ),
        }}
        listeners={{ tabPress: triggerHaptic }}
      />

      {/* TAB 3: KELOLA ASET (Only for Admin - Hidden for Petugas) */}
      <Tabs.Screen
        name="assets"
        options={{
          title: "Kelola Aset",
          href: isAdmin ? "/(tabs)/assets" : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "cube" : "cube-outline"}
              size={22}
              color={color}
            />
          ),
        }}
        listeners={{ tabPress: triggerHaptic }}
      />

      {/* TAB 4: AUDIT LOG / RIWAYAT (Adapted for Both) */}
      <Tabs.Screen
        name="history"
        options={{
          title: isAdmin ? "Audit Log" : "Riwayat",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={
                isAdmin
                  ? focused
                    ? "receipt"
                    : "receipt-outline"
                  : focused
                  ? "time"
                  : "time-outline"
              }
              size={22}
              color={color}
            />
          ),
        }}
        listeners={{ tabPress: triggerHaptic }}
      />

      {/* TAB 5: PROFIL (Profil Admin / Profil Petugas with Avatar Change) */}
      <Tabs.Screen
        name="profile"
        options={{
          title: isAdmin ? "Profil Admin" : "Profil Saya",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={
                isAdmin
                  ? focused
                    ? "shield-checkmark"
                    : "shield-checkmark-outline"
                  : focused
                  ? "person-circle"
                  : "person-circle-outline"
              }
              size={23}
              color={color}
            />
          ),
        }}
        listeners={{ tabPress: triggerHaptic }}
      />
    </Tabs>
  );
}
