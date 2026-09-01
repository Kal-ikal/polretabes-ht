import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  Image,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeHaptics } from "@/lib/safeHaptics";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAppTheme } from "@/context/ThemeContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { StatusBadge } from "@/components/StatusBadge";
import type { Transaction, Asset } from "@/types/database";

export interface GroupedTransactionItem {
  id: string;
  isBatch: boolean;
  batch_id?: string | null;
  batch_code?: string | null;
  items: Transaction[];
  mainTx: Transaction;
}

interface LoanBatchQRModalProps {
  visible: boolean;
  group: GroupedTransactionItem | null;
  onClose: () => void;
  onRefresh?: () => void;
}

export function LoanBatchQRModal({
  visible,
  group,
  onClose,
  onRefresh,
}: LoanBatchQRModalProps) {
  const { theme, isDark } = useAppTheme();
  const router = useRouter();
  const [processingAssetId, setProcessingAssetId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  if (!group) return null;

  async function handleConfirmHandover(asset: Asset, txItem: Transaction) {
    if (!asset) return;
    setProcessingAssetId(asset.id);

    try {
      // 1. Update Asset Status to dipinjam
      await supabase
        .from("assets")
        .update({ status: "dipinjam", updated_at: new Date().toISOString() })
        .eq("id", asset.id);

      // 2. Log state transition
      try {
        await supabase.from("asset_state_logs").insert({
          asset_id: asset.id,
          from_state: asset.status || "tersedia",
          to_state: "dipinjam",
          reason: `Konfirmasi Serah Terima QR Code (${txItem.borrower_name || "Petugas"})`,
        });
      } catch {}

      try {
        SafeHaptics.notificationAsync();
      } catch {}

      setToastMessage(`✓ Serah Terima unit ${asset.name} (${asset.code}) BERHASIL! Status: DIPINJAM`);
      setTimeout(() => setToastMessage(null), 3000);

      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error("Error confirming handover:", err);
    } finally {
      setProcessingAssetId(null);
    }
  }

  async function handleConfirmReturn(asset: Asset, txItem: Transaction) {
    if (!asset) return;
    setProcessingAssetId(asset.id);

    try {
      // 1. Update Asset Status to tersedia
      await supabase
        .from("assets")
        .update({ status: "tersedia", updated_at: new Date().toISOString() })
        .eq("id", asset.id);

      // 2. Log state transition
      try {
        await supabase.from("asset_state_logs").insert({
          asset_id: asset.id,
          from_state: "dipinjam",
          to_state: "tersedia",
          reason: `Konfirmasi Pengembalian QR Code (${txItem.borrower_name || "Petugas"})`,
        });
      } catch {}

      try {
        SafeHaptics.notificationAsync();
      } catch {}

      setToastMessage(`✓ Pengembalian unit ${asset.name} (${asset.code}) BERHASIL! Status: TERSEDIA`);
      setTimeout(() => setToastMessage(null), 3000);

      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error("Error confirming return:", err);
    } finally {
      setProcessingAssetId(null);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0, 0, 0, 0.7)",
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
        }}
      >
        <View
          style={{
            backgroundColor: theme.cardBg,
            borderRadius: 24,
            width: "100%",
            maxWidth: 480,
            maxHeight: "88%",
            borderWidth: 1,
            borderColor: theme.cardBorder,
            overflow: "hidden",
            elevation: 10,
          }}
        >
          {/* Modal Header */}
          <View
            style={{
              backgroundColor: isDark ? "rgba(2, 132, 199, 0.25)" : "#0284C7",
              paddingHorizontal: 20,
              paddingVertical: 16,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "800", color: "#FFFFFF" }}>
                {group.isBatch
                  ? `QR Code & Serah Terima (${group.items.length} Unit)`
                  : `QR Code & Serah Terima HT`}
              </Text>
              <Text style={{ fontSize: 11.5, color: "rgba(255, 255, 255, 0.85)", marginTop: 2 }}>
                Ref: {group.batch_code || `#${group.mainTx.id.slice(0, 8)}`} • Pemohon: {group.mainTx.borrower_name}
              </Text>
            </View>

            <AnimatedPressable
              onPress={onClose}
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.2)",
                width: 32,
                height: 32,
                borderRadius: 16,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Ionicons name="close" size={20} color="#FFFFFF" />
            </AnimatedPressable>
          </View>

          {/* Toast Notification Banner */}
          {toastMessage && (
            <View
              style={{
                backgroundColor: "#22C55E",
                paddingHorizontal: 16,
                paddingVertical: 10,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 12, textAlign: "center" }}>
                {toastMessage}
              </Text>
            </View>
          )}

          {/* Items List */}
          <ScrollView
            contentContainerStyle={{ padding: 18, gap: 16 }}
            style={{ flexShrink: 1 }}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textSecondary, textTransform: "uppercase" }}>
              Daftar Stiker QR Code & Konfirmasi Fisik ({group.items.length} Unit):
            </Text>

            {group.items.map((txItem, idx) => {
              const asset = txItem.asset;
              if (!asset) return null;
              const isBorrowed = (asset.status || "").toLowerCase() === "dipinjam";
              const isProcessing = processingAssetId === asset.id;

              return (
                <View
                  key={`${txItem.id}-${idx}`}
                  style={{
                    backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC",
                    borderRadius: 16,
                    borderWidth: 1.5,
                    borderColor: isBorrowed ? "#22C55E" : theme.cardBorder,
                    padding: 16,
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  {/* Unit Title Header */}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: isBorrowed ? "#22C55E" : theme.primary,
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "800" }}>{idx + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "800", color: theme.textPrimary }}>
                          {asset.name}
                        </Text>
                        <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                          Kode: <Text style={{ fontWeight: "700", color: theme.primary }}>{asset.code}</Text> • SN: {asset.serial_number || "-"}
                        </Text>
                      </View>
                    </View>

                    <StatusBadge status={asset.status || "tersedia"} />
                  </View>

                  {/* QR Code Image Canvas */}
                  <View
                    style={{
                      backgroundColor: "#FFFFFF",
                      padding: 12,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: "#E2E8F0",
                      alignItems: "center",
                      justifyContent: "center",
                      marginVertical: 4,
                    }}
                  >
                    <Image
                      source={{
                        uri: `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                          asset.code || ""
                        )}`,
                      }}
                      style={{ width: 140, height: 140, borderRadius: 6 }}
                      resizeMode="contain"
                    />
                    <Text style={{ fontSize: 10, fontWeight: "800", color: "#0F172A", marginTop: 6, letterSpacing: 0.5 }}>
                      STIKER QR: {asset.code}
                    </Text>
                  </View>

                  {/* Individual Action Buttons */}
                  <View style={{ flexDirection: "row", gap: 8, width: "100%" }}>
                    {!isBorrowed ? (
                      /* Konfirmasi Penyerahan (Peminjaman) */
                      <AnimatedPressable
                        onPress={() => handleConfirmHandover(asset, txItem)}
                        disabled={isProcessing}
                        style={{
                          flex: 1,
                          backgroundColor: "#22C55E",
                          paddingVertical: 10,
                          borderRadius: 12,
                          alignItems: "center",
                          justifyContent: "center",
                          flexDirection: "row",
                          gap: 6,
                          elevation: 2,
                        }}
                      >
                        {isProcessing ? (
                          <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                          <>
                            <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" />
                            <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 12 }}>
                              📷 Konfirmasi Penyerahan Fisik
                            </Text>
                          </>
                        )}
                      </AnimatedPressable>
                    ) : (
                      /* Konfirmasi Pengembalian */
                      <AnimatedPressable
                        onPress={() => handleConfirmReturn(asset, txItem)}
                        disabled={isProcessing}
                        style={{
                          flex: 1,
                          backgroundColor: isDark ? "rgba(2, 132, 199, 0.2)" : "#0284C7",
                          paddingVertical: 10,
                          borderRadius: 12,
                          alignItems: "center",
                          justifyContent: "center",
                          flexDirection: "row",
                          gap: 6,
                          elevation: 2,
                        }}
                      >
                        {isProcessing ? (
                          <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                          <>
                            <Ionicons name="arrow-undo-circle" size={16} color="#FFFFFF" />
                            <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 12 }}>
                              🔄 Konfirmasi Pengembalian Fisik
                            </Text>
                          </>
                        )}
                      </AnimatedPressable>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Modal Footer */}
          <View
            style={{
              padding: 14,
              borderTopWidth: 1,
              borderTopColor: theme.cardBorder,
              flexDirection: "row",
              gap: 10,
              backgroundColor: isDark ? "rgba(0, 0, 0, 0.2)" : "#F8FAFC",
            }}
          >
            <AnimatedPressable
              onPress={() => {
                onClose();
                router.push("/(tabs)/scan");
              }}
              style={{
                flex: 1.4,
                backgroundColor: theme.primary,
                paddingVertical: 11,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 6,
              }}
            >
              <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
              <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 12.5 }}>
                Buka Kamera Pemindai
              </Text>
            </AnimatedPressable>

            <AnimatedPressable
              onPress={onClose}
              style={{
                flex: 1,
                backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "#E2E8F0",
                paddingVertical: 11,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: theme.textPrimary, fontWeight: "700", fontSize: 13 }}>
                Tutup
              </Text>
            </AnimatedPressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
