import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TextInput,
  Modal,
  Image,
  ActivityIndicator,
  Platform,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeHaptics } from "@/lib/safeHaptics";
import { useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useAppTheme } from "@/context/ThemeContext";
import { useTheme } from "@/hooks/useTheme";
import { StatusBadge } from "@/components/StatusBadge";
import { SkeletonCard } from "@/components/SkeletonCard";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppBottomSheet } from "@/components/AppBottomSheet";
import { getFriendlyErrorMessage } from "@/lib/errorHandler";
import type { Asset, AssetStatus } from "@/types/database";

interface AssetListItemProps {
  item: Asset;
  isAdmin: boolean;
  borrowerName?: string;
  onOpenQR: () => void;
  onOverride: () => void;
  onEdit: () => void;
}

const AssetListItem = ({ item, isAdmin, borrowerName, onOpenQR, onOverride, onEdit }: AssetListItemProps) => {
  const { colors, isDark } = useTheme();
  const isBorrowed = (item.status || "").toLowerCase() === "dipinjam";

  return (
    <View
      style={{
        backgroundColor: colors.cardBg,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        padding: 16,
        marginBottom: 14,
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 10,
        elevation: 2,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: colors.primary, letterSpacing: 0.5, backgroundColor: isDark ? "rgba(2, 132, 199, 0.2)" : "rgba(2, 132, 199, 0.1)", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
              {item.code}
            </Text>
            <Text style={{ fontSize: 11, color: colors.textMuted }}>
              SN: {item.serial_number}
            </Text>
          </View>
          <Text style={{ fontSize: 16, fontWeight: "800", color: colors.textPrimary }}>
            {item.name}
          </Text>
          {isBorrowed && borrowerName && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
              <Ionicons name="person-outline" size={12} color={colors.textSecondary} />
              <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: "600" }}>
                Dipinjam oleh: {borrowerName}
              </Text>
            </View>
          )}
        </View>

        <StatusBadge status={item.status} />
      </View>

      {/* Divider */}
      <View style={{ height: 1, backgroundColor: colors.cardBorder, marginVertical: 10 }} />

      {/* Actions Footer */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <AnimatedPressable
          onPress={onOpenQR}
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(2, 132, 199, 0.08)",
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
            gap: 6,
          }}
        >
          <Ionicons name="qr-code-outline" size={16} color={colors.primary} />
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.primary }}>
            Lihat QR
          </Text>
        </AnimatedPressable>

        {isAdmin && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <AnimatedPressable
              onPress={onOverride}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: isDark ? "rgba(245, 158, 11, 0.15)" : "rgba(245, 158, 11, 0.1)",
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                gap: 4,
              }}
            >
              <Ionicons name="swap-horizontal-outline" size={15} color="#F59E0B" />
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#F59E0B" }}>
                Override
              </Text>
            </AnimatedPressable>

            <AnimatedPressable
              onPress={onEdit}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: isDark ? "rgba(255, 255, 255, 0.1)" : "#F1F5F9",
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                gap: 4,
              }}
            >
              <Ionicons name="create-outline" size={15} color={colors.textPrimary} />
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.textPrimary }}>
                Edit
              </Text>
            </AnimatedPressable>
          </View>
        )}
      </View>
    </View>
  );
};

export default function AdminAssetsScreen() {
  const { profile } = useAuth();
  const { theme, isDark } = useAppTheme();
  const isAdmin = profile?.role === "admin";

  const [assetsList, setAssetsList] = useState<Asset[]>([]);
  const [borrowerByAssetId, setBorrowerByAssetId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | AssetStatus>("all");

  // Add / Edit Modal State
  const [assetModalVisible, setAssetModalVisible] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [assetCode, setAssetCode] = useState("");
  const [assetName, setAssetName] = useState("");
  const [assetSN, setAssetSN] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // QR Code Modal State
  const [qrModalAsset, setQrModalAsset] = useState<Asset | null>(null);

  // Status Override Modal State
  const [overrideAsset, setOverrideAsset] = useState<Asset | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<AssetStatus>("tersedia");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  // Toast / Feedback Modal
  const [toastConfig, setToastConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon: string;
    isDanger?: boolean;
  }>({ visible: false, title: "", message: "", icon: "✅" });

  const fetchAssets = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    const { data: rawAssets } = await supabase
      .from("assets")
      .select("*")
      .order("name", { ascending: true });

    const { data: reservedRows } = await supabase.rpc("get_reserved_asset_ids");

    // Nama peminjam TERBARU per aset -- dipakai untuk menampilkan siapa yang
    // sedang membawa unit HT berstatus 'dipinjam' langsung di kartu unitnya.
    const { data: borrowTxs } = await supabase
      .from("transactions")
      .select("asset_id, borrower_name, created_at")
      .eq("action", "BORROW")
      .order("created_at", { ascending: false })
      .limit(500);

    const borrowerMap: Record<string, string> = {};
    if (borrowTxs) {
      for (const tx of borrowTxs as { asset_id: string; borrower_name: string | null }[]) {
        if (!borrowerMap[tx.asset_id]) {
          borrowerMap[tx.asset_id] = tx.borrower_name || "-";
        }
      }
    }
    setBorrowerByAssetId(borrowerMap);

    if (rawAssets) {
      const pendingAssetIds = new Set((reservedRows || []).map((t: { asset_id: string }) => t.asset_id));
      const updatedList = (rawAssets as Asset[]).map((asset) => {
        if (pendingAssetIds.has(asset.id) && (asset.status || "").toLowerCase() === "tersedia") {
          return { ...asset, status: "pending" as AssetStatus };
        }
        return asset;
      });

      setAssetsList(updatedList);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAssets(true);

    const channelId = `admin-assets-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assets" },
        () => fetchAssets(false)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAssets]);

  useFocusEffect(
    useCallback(() => {
      fetchAssets(false);
    }, [fetchAssets])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchAssets(false);
    setRefreshing(false);
  }

  // Open modal to add asset
  const handleOpenAddAsset = () => {
    setEditingAsset(null);
    setAssetCode("");
    setAssetName("");
    setAssetSN("");
    setAssetModalVisible(true);
  };

  // Open modal to edit asset
  const handleOpenEditAsset = (asset: Asset) => {
    setEditingAsset(asset);
    setAssetCode(asset.code);
    setAssetName(asset.name);
    setAssetSN(asset.serial_number);
    setAssetModalVisible(true);
  };

  // Save / Update Asset
  const handleSaveAsset = async () => {
    if (!assetCode.trim() || !assetName.trim() || !assetSN.trim()) {
      setToastConfig({
        visible: true,
        title: "Data Belum Lengkap",
        message: "Kode QR, Nama Unit, dan Nomor Seri wajib diisi.",
        icon: "⚠️",
        isDanger: true,
      });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("admin_upsert_asset", {
        p_id: editingAsset ? editingAsset.id : null,
        p_code: assetCode.trim().toUpperCase(),
        p_name: assetName.trim(),
        p_serial_number: assetSN.trim().toUpperCase(),
      });

      setSubmitting(false);

      if (error) {
        setToastConfig({
          visible: true,
          title: "Gagal Menyimpan",
          message: getFriendlyErrorMessage(error, "Terjadi kesalahan saat menyimpan aset."),
          icon: "❌",
          isDanger: true,
        });
      } else {
        try {
          SafeHaptics.notificationAsync();
        } catch {}
        setAssetModalVisible(false);
        setToastConfig({
          visible: true,
          title: editingAsset ? "Aset Diperbarui" : "Aset Ditambahkan",
          message: `Unit HT "${assetName.trim()}" berhasil disimpan ke sistem.`,
          icon: "✅",
        });
        fetchAssets(false);
      }
    } catch (err: any) {
      setSubmitting(false);
      setToastConfig({
        visible: true,
        title: "Kesalahan Sistem",
        message: getFriendlyErrorMessage(err),
        icon: "❌",
        isDanger: true,
      });
    }
  };

  // Handle Manual Status Override
  const handleExecuteOverride = async () => {
    if (!overrideAsset) return;

    setOverrideSubmitting(true);
    try {
      let { error } = await supabase.rpc("admin_override_asset_status", {
        p_asset_id: overrideAsset.id,
        p_new_status: overrideStatus,
        p_reason: overrideReason.trim() || `Override manual ke ${overrideStatus} oleh admin`,
      });

      if (error) {
        // Direct table fallback if RPC fails
        const { error: directErr } = await supabase
          .from("assets")
          .update({ status: overrideStatus, updated_at: new Date().toISOString() })
          .eq("id", overrideAsset.id);

        if (!directErr) {
          error = null;
          try {
            await supabase.from("asset_state_logs").insert({
              asset_id: overrideAsset.id,
              from_state: overrideAsset.status,
              to_state: overrideStatus,
              reason: `Admin Override Status: ${overrideReason.trim() || "Manual Admin"}`,
            });
          } catch {}
        }
      }

      setOverrideSubmitting(false);

      if (error) {
        setToastConfig({
          visible: true,
          title: "Override Gagal",
          message: getFriendlyErrorMessage(error),
          icon: "❌",
          isDanger: true,
        });
      } else {
        try {
          SafeHaptics.notificationAsync();
        } catch {}
        setOverrideAsset(null);
        setOverrideReason("");
        setToastConfig({
          visible: true,
          title: "Status Berhasil Diubah",
          message: `Status unit "${overrideAsset.name}" berhasil diubah menjadi "${overrideStatus.toUpperCase()}".`,
          icon: "✅",
        });
        fetchAssets(false);
      }
    } catch (err: any) {
      setOverrideSubmitting(false);
      setToastConfig({
        visible: true,
        title: "Kesalahan",
        message: err.message || "Gagal mengubah status aset.",
        icon: "❌",
        isDanger: true,
      });
    }
  };

  // Filtered assets
  const filteredAssets = assetsList.filter((a) => {
    const matchesSearch =
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.serial_number.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = filterStatus === "all" || a.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const countAvailable = assetsList.filter((a) => a.status === "tersedia").length;
  const countBorrowed = assetsList.filter((a) => a.status === "dipinjam").length;
  const countDamaged = assetsList.filter((a) => a.status === "rusak").length;

  return (
    <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1 }}>
      <View style={{ flex: 1, maxWidth: 840, width: "100%", alignSelf: "center" }}>
        {/* Header Stats Bar */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: 12,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <View>
              <Text style={{ fontSize: 20, fontWeight: "800", color: theme.textPrimary }}>
                {isAdmin ? "Kelola Inventaris HT" : "Status Inventaris HT"}
              </Text>
              <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 2 }}>
                Total {assetsList.length} unit radio komunikasi terdaftar
              </Text>
            </View>

            {isAdmin && (
              <AnimatedPressable
                onPress={handleOpenAddAsset}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: theme.primary,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 12,
                  gap: 6,
                  shadowColor: theme.primary,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 4,
                }}
              >
                <Ionicons name="add-circle" size={18} color="#FFFFFF" />
                <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 13 }}>
                  Tambah HT
                </Text>
              </AnimatedPressable>
            )}
          </View>
          {/* Proportional Segmented Filter Bar with Color-Coded Active States */}
          <View
            style={{
              flexDirection: "row",
              backgroundColor: isDark ? "rgba(30, 41, 59, 0.75)" : "#E2E8F0",
              borderRadius: 14,
              padding: 4,
              gap: 4,
              marginBottom: 10,
            }}
          >
            {[
              {
                id: "all",
                label: "Semua",
                count: assetsList.length,
                color: "#0284C7",
                activeBg: "#0284C7",
                inactiveText: isDark ? "#94A3B8" : "#475569",
                badgeBg: isDark ? "rgba(2, 132, 199, 0.2)" : "rgba(2, 132, 199, 0.12)",
              },
              {
                id: "tersedia",
                label: "Tersedia",
                count: countAvailable,
                color: isDark ? "#4ADE80" : "#16A34A",
                activeBg: "#16A34A",
                inactiveText: isDark ? "#4ADE80" : "#15803D",
                badgeBg: isDark ? "rgba(34, 197, 94, 0.2)" : "rgba(34, 197, 94, 0.12)",
              },
              {
                id: "dipinjam",
                label: "Dipinjam",
                count: countBorrowed,
                color: isDark ? "#FB923C" : "#EA580C",
                activeBg: "#EA580C",
                inactiveText: isDark ? "#FB923C" : "#C2410C",
                badgeBg: isDark ? "rgba(249, 115, 22, 0.2)" : "rgba(249, 115, 22, 0.12)",
              },
              {
                id: "rusak",
                label: "Rusak",
                count: countDamaged,
                color: isDark ? "#F87171" : "#DC2626",
                activeBg: "#DC2626",
                inactiveText: isDark ? "#F87171" : "#B91C1C",
                badgeBg: isDark ? "rgba(239, 68, 68, 0.2)" : "rgba(239, 68, 68, 0.12)",
              },
            ].map((tab) => {
              const isActive = filterStatus === tab.id;
              return (
                <AnimatedPressable
                  key={tab.id}
                  onPress={() => {
                    setFilterStatus(tab.id as any);
                    SafeHaptics.selectionAsync();
                  }}
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    paddingVertical: 8,
                    borderRadius: 10,
                    backgroundColor: isActive
                      ? isDark
                        ? tab.activeBg
                        : "#FFFFFF"
                      : "transparent",
                    borderWidth: isActive && !isDark ? 1.5 : 0,
                    borderColor: isActive && !isDark ? tab.color : "transparent",
                    shadowColor: tab.color,
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: isActive ? (isDark ? 0.35 : 0.15) : 0,
                    shadowRadius: 3,
                    elevation: isActive ? 2 : 0,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11.5,
                      fontWeight: isActive ? "800" : "700",
                      color: isActive
                        ? isDark
                          ? "#FFFFFF"
                          : tab.color
                        : tab.inactiveText,
                    }}
                  >
                    {tab.label}
                  </Text>
                  <View
                    style={{
                      backgroundColor: isActive
                        ? isDark
                          ? "rgba(255, 255, 255, 0.25)"
                          : tab.badgeBg
                        : isDark
                        ? "rgba(255, 255, 255, 0.1)"
                        : "#CBD5E1",
                      paddingHorizontal: 5,
                      paddingVertical: 1,
                      borderRadius: 8,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: "800",
                        color: isActive
                          ? isDark
                            ? "#FFFFFF"
                            : tab.color
                          : isDark
                          ? "#CBD5E1"
                          : tab.inactiveText,
                      }}
                    >
                      {tab.count}
                    </Text>
                  </View>
                </AnimatedPressable>
              );
            })}
          </View>

          {/* Clean Live Search Input Bar */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: isDark ? "rgba(30, 41, 59, 0.6)" : "#FFFFFF",
              borderWidth: 1,
              borderColor: isDark ? "rgba(255, 255, 255, 0.08)" : "#CBD5E1",
              borderRadius: 12,
              paddingHorizontal: 12,
              height: 42,
            }}
          >
            <Ionicons name="search-outline" size={17} color={theme.primary} style={{ marginRight: 8 }} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Cari kode, nama, atau serial number HT..."
              placeholderTextColor={theme.inputPlaceholder}
              style={{
                flex: 1,
                color: theme.inputText,
                fontSize: 13,
                fontWeight: "500",
              }}
            />
            {searchQuery.length > 0 && (
              <AnimatedPressable onPress={() => setSearchQuery("")} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={17} color={theme.textMuted} />
              </AnimatedPressable>
            )}
          </View>
        </View>

        {/* List Content */}
        {loading ? (
          <View style={{ padding: 20 }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : (
          <FlatList
            data={filteredAssets}
            keyExtractor={(item) => item.id}
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={Platform.OS === "android"}
            updateCellsBatchingPeriod={30}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
            }
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingBottom: 40,
              flexGrow: 1,
            }}
            ListEmptyComponent={
              <View
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                  paddingVertical: 60,
                }}
              >
                <View
                  style={{
                    width: 70,
                    height: 70,
                    borderRadius: 35,
                    backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(2,132,199,0.08)",
                    justifyContent: "center",
                    alignItems: "center",
                    marginBottom: 16,
                  }}
                >
                  <Ionicons name="radio-outline" size={36} color={theme.textMuted} />
                </View>
                <Text style={{ fontSize: 16, fontWeight: "700", color: theme.textPrimary }}>
                  Tidak Ada Unit HT
                </Text>
                <Text style={{ fontSize: 13, color: theme.textSecondary, textAlign: "center", marginTop: 4, paddingHorizontal: 30 }}>
                  {searchQuery ? "Tidak ditemukan unit HT yang sesuai dengan pencarian." : "Belum ada master unit HT yang terdaftar."}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <AssetListItem
                item={item}
                isAdmin={isAdmin}
                borrowerName={borrowerByAssetId[item.id]}
                onOpenQR={() => setQrModalAsset(item)}
                onOverride={() => {
                  setOverrideAsset(item);
                  setOverrideStatus(item.status);
                  setOverrideReason("");
                }}
                onEdit={() => handleOpenEditAsset(item)}
              />
            )}
          />
        )}
      </View>

      {/* MODAL 1: ADD / EDIT ASSET */}
      <Modal
        visible={assetModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAssetModalVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.65)",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: theme.cardBg,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: theme.cardBorder,
              padding: 24,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.3,
              shadowRadius: 20,
              elevation: 10,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <View>
                <Text style={{ fontSize: 18, fontWeight: "800", color: theme.textPrimary }}>
                  {editingAsset ? "Edit Data Aset HT" : "Tambah Master Aset HT"}
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                  Informasi identitas radio komunikasi
                </Text>
              </View>
              <AnimatedPressable onPress={() => setAssetModalVisible(false)}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </AnimatedPressable>
            </View>

            <View style={{ gap: 12, marginBottom: 20 }}>
              <View>
                <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginBottom: 6 }}>
                  Kode QR / Identifier (Contoh: HT-001)
                </Text>
                <TextInput
                  value={assetCode}
                  onChangeText={setAssetCode}
                  placeholder="HT-001"
                  placeholderTextColor={theme.inputPlaceholder}
                  autoCapitalize="characters"
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    color: theme.inputText,
                    fontSize: 14,
                    fontWeight: "700",
                  }}
                />
              </View>

              <View>
                <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginBottom: 6 }}>
                  Nama Perangkat / Model
                </Text>
                <TextInput
                  value={assetName}
                  onChangeText={setAssetName}
                  placeholder="Contoh: Motorola APX 8000 / Hytera HP788"
                  placeholderTextColor={theme.inputPlaceholder}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    color: theme.inputText,
                    fontSize: 14,
                  }}
                />
              </View>

              <View>
                <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginBottom: 6 }}>
                  Nomor Seri (Serial Number)
                </Text>
                <TextInput
                  value={assetSN}
                  onChangeText={setAssetSN}
                  placeholder="SN-MOT-8890"
                  placeholderTextColor={theme.inputPlaceholder}
                  autoCapitalize="characters"
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    color: theme.inputText,
                    fontSize: 14,
                  }}
                />
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <AnimatedPressable
                onPress={() => setAssetModalVisible(false)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                }}
              >
                <Text style={{ color: theme.textSecondary, fontWeight: "700", fontSize: 14 }}>
                  Batal
                </Text>
              </AnimatedPressable>

              <AnimatedPressable
                onPress={handleSaveAsset}
                disabled={submitting}
                style={{
                  flex: 1,
                  backgroundColor: theme.primary,
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>
                    Simpan
                  </Text>
                )}
              </AnimatedPressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL 2: QR CODE VIEWER */}
      <Modal
        visible={!!qrModalAsset}
        transparent
        animationType="fade"
        onRequestClose={() => setQrModalAsset(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.75)",
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 24,
              padding: 24,
              alignItems: "center",
              width: "100%",
              maxWidth: 340,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.4,
              shadowRadius: 20,
              elevation: 10,
            }}
          >
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: "#0F172A" }}>
                {qrModalAsset?.name}
              </Text>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#0284C7", marginTop: 2 }}>
                KODE: {qrModalAsset?.code}
              </Text>
              <Text style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                SN: {qrModalAsset?.serial_number}
              </Text>
            </View>

            <View
              style={{
                padding: 16,
                backgroundColor: "#F8FAFC",
                borderRadius: 18,
                borderWidth: 1,
                borderColor: "#E2E8F0",
                marginBottom: 16,
              }}
            >
              <Image
                source={{
                  uri: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
                    qrModalAsset?.code || ""
                  )}`,
                }}
                style={{ width: 200, height: 200, borderRadius: 8 }}
                resizeMode="contain"
              />
            </View>

            <Text style={{ fontSize: 11, color: "#64748B", textAlign: "center", marginBottom: 20 }}>
              Scan QR Code ini dengan aplikasi Petugas untuk proses peminjaman / pengembalian cepat.
            </Text>

            <AnimatedPressable
              onPress={() => setQrModalAsset(null)}
              style={{
                backgroundColor: "#0F172A",
                paddingVertical: 12,
                paddingHorizontal: 28,
                borderRadius: 12,
                width: "100%",
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>
                Tutup
              </Text>
            </AnimatedPressable>
          </View>
        </View>
      </Modal>

      {/* MODAL 3: STATUS OVERRIDE */}
      <Modal
        visible={!!overrideAsset}
        transparent
        animationType="fade"
        onRequestClose={() => setOverrideAsset(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.65)",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: theme.cardBg,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: theme.cardBorder,
              padding: 24,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "800", color: theme.textPrimary, marginBottom: 4 }}>
              Override Status Aset
            </Text>
            <Text style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 16 }}>
              Ubah status unit "{overrideAsset?.name}" secara langsung.
            </Text>

            <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
              {(["tersedia", "dipinjam", "rusak"] as AssetStatus[]).map((st) => (
                <AnimatedPressable
                  key={st}
                  onPress={() => setOverrideStatus(st)}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 12,
                    borderWidth: 1.5,
                    borderColor: overrideStatus === st ? theme.primary : theme.cardBorder,
                    backgroundColor:
                      overrideStatus === st
                        ? isDark
                          ? "rgba(2,132,199,0.2)"
                          : "rgba(2,132,199,0.1)"
                        : theme.cardBg,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "700",
                      color: overrideStatus === st ? theme.primary : theme.textSecondary,
                      textTransform: "capitalize",
                    }}
                  >
                    {st}
                  </Text>
                </AnimatedPressable>
              ))}
            </View>

            <View style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginBottom: 6 }}>
                Alasan Perubahan Status (Opsional)
              </Text>
              <TextInput
                value={overrideReason}
                onChangeText={setOverrideReason}
                placeholder="Contoh: Selesai perbaikan teknisi / unit hilang"
                placeholderTextColor={theme.inputPlaceholder}
                style={{
                  backgroundColor: theme.inputBackground,
                  borderWidth: 1,
                  borderColor: theme.inputBorder,
                  borderRadius: 12,
                  padding: 12,
                  color: theme.inputText,
                  fontSize: 13,
                }}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <AnimatedPressable
                onPress={() => setOverrideAsset(null)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                }}
              >
                <Text style={{ color: theme.textSecondary, fontWeight: "700", fontSize: 14 }}>
                  Batal
                </Text>
              </AnimatedPressable>

              <AnimatedPressable
                onPress={handleExecuteOverride}
                disabled={overrideSubmitting}
                style={{
                  flex: 1,
                  backgroundColor: "#F59E0B",
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: overrideSubmitting ? 0.7 : 1,
                }}
              >
                {overrideSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>
                    Terapkan
                  </Text>
                )}
              </AnimatedPressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* FEEDBACK TOAST */}
      <AppBottomSheet
        visible={toastConfig.visible}
        onClose={() => setToastConfig((prev) => ({ ...prev, visible: false }))}
        title={toastConfig.title}
        message={toastConfig.message}
        icon={toastConfig.icon}
        isDanger={toastConfig.isDanger}
      />
    </LinearGradient>
  );
}
