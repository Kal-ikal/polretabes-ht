import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  Image,
  Share,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeHaptics } from "@/lib/safeHaptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useAppTheme } from "@/context/ThemeContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { StatusBadge } from "@/components/StatusBadge";
import { AppBottomSheet } from "@/components/AppBottomSheet";
import { DocumentViewerModal } from "@/components/DocumentViewerModal";
import { formatFullDateTimeId, formatShortDateTimeId, getRemainingTimeStatus } from "@/lib/dateUtils";
import type { Transaction, Asset } from "@/types/database";

export default function LoanQRScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme, isDark } = useAppTheme();
  const { profile } = useAuth();
  const { width } = useWindowDimensions();

  const isAdmin = profile?.role === "admin";
  const [loading, setLoading] = useState(true);
  const [txItems, setTxItems] = useState<Transaction[]>([]);
  const [processingAssetId, setProcessingAssetId] = useState<string | null>(null);
  const [viewDocModal, setViewDocModal] = useState<{ visible: boolean; url: string; name: string }>({
    visible: false,
    url: "",
    name: "",
  });
  const [toastConfig, setToastConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon: string;
    isDanger?: boolean;
  }>({ visible: false, title: "", message: "", icon: "✅" });

  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  };

  const fetchLoanDetails = useCallback(async (showLoadingSpinner = false) => {
    if (!id) return;
    if (showLoadingSpinner) setLoading(true);

    try {
      let cleanId = id;
      if (cleanId.startsWith("batch-")) {
        cleanId = cleanId.replace("batch-", "");
      }

      // 1. Try querying by batch_id
      const { data: batchTxs } = await supabase
        .from("transactions")
        .select("*, asset:assets(*), reviewer:profiles!transactions_reviewed_by_fkey(*)")
        .eq("batch_id", cleanId)
        .order("created_at", { ascending: false });

      if (batchTxs && batchTxs.length > 0) {
        setTxItems(batchTxs as Transaction[]);
        setLoading(false);
        return;
      }

      // 2. Query single transaction by id
      const { data: singleTx } = await supabase
        .from("transactions")
        .select("*, asset:assets(*), reviewer:profiles!transactions_reviewed_by_fkey(*)")
        .eq("id", cleanId)
        .maybeSingle();

      if (singleTx) {
        setTxItems([singleTx as Transaction]);
      } else {
        // 3. Fallback: Query by asset_id
        const { data: assetTxs } = await supabase
          .from("transactions")
          .select("*, asset:assets(*), reviewer:profiles!transactions_reviewed_by_fkey(*)")
          .eq("asset_id", cleanId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (assetTxs && assetTxs.length > 0) {
          setTxItems(assetTxs as Transaction[]);
        }
      }
    } catch (err: any) {
      console.error("Error fetching loan details for QR page:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Initial fetch & Realtime Sync Subscription
  useEffect(() => {
    fetchLoanDetails(true);

    const channelId = `admin-loan-qr-realtime-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assets" },
        () => fetchLoanDetails(false)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions" },
        () => fetchLoanDetails(false)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLoanDetails]);

  // Handover confirmation handler
  async function handleConfirmHandover(asset: Asset, txItem: Transaction) {
    if (!asset) return;
    setProcessingAssetId(asset.id);

    try {
      const { error: handoverErr } = await supabase.rpc("scan_to_borrow", {
        p_scanned_qr: asset.code,
        p_tx_id: txItem.id,
        p_user_id: profile?.id || null,
      });

      if (handoverErr) {
        setToastConfig({
          visible: true,
          title: "Gagal Serah Terima",
          message: handoverErr.message || "Gagal memperbarui status unit HT.",
          icon: "❌",
          isDanger: true,
        });
        return;
      }

      if (Platform.OS !== "web") {
        try {
          SafeHaptics.notificationAsync();
        } catch {}
      }

      setToastConfig({
        visible: true,
        title: "Serah Terima Berhasil! 🎉",
        message: `Unit ${asset.name} (${asset.code}) berhasil dikonfirmasi diserahkan! Status unit aktif DIPINJAM.`,
        icon: "✅",
      });

      fetchLoanDetails(false);
    } catch (err: any) {
      setToastConfig({
        visible: true,
        title: "Gagal Update",
        message: err.message || "Gagal memperbarui status unit HT.",
        icon: "❌",
        isDanger: true,
      });
    } finally {
      setProcessingAssetId(null);
    }
  }

  // Return confirmation handler
  async function handleConfirmReturn(asset: Asset, txItem: Transaction) {
    if (!asset) return;
    setProcessingAssetId(asset.id);

    try {
      const { error: returnErr } = await supabase.rpc("process_asset_transaction", {
        p_asset_id: asset.id,
        p_action: "RETURN",
        p_condition: "baik",
        p_notes: `Admin Verifikasi Pengembalian QR Code (${txItem.borrower_name || "Petugas"})`,
      });

      if (returnErr) {
        setToastConfig({
          visible: true,
          title: "Gagal Pengembalian",
          message: returnErr.message || "Gagal memperbarui status pengembalian HT.",
          icon: "❌",
          isDanger: true,
        });
        return;
      }

      if (Platform.OS !== "web") {
        try {
          SafeHaptics.notificationAsync();
        } catch {}
      }

      setToastConfig({
        visible: true,
        title: "Pengembalian Berhasil! 📥",
        message: `Unit ${asset.name} (${asset.code}) berhasil dikembalikan. Status unit kembali TERSEDIA.`,
        icon: "✅",
      });

      fetchLoanDetails(false);
    } catch (err: any) {
      setToastConfig({
        visible: true,
        title: "Gagal Update",
        message: err.message || "Gagal memperbarui status pengembalian HT.",
        icon: "❌",
        isDanger: true,
      });
    } finally {
      setProcessingAssetId(null);
    }
  }

  // Share QR Code Details
  async function handleShareQR(asset: Asset) {
    try {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(asset.code)}`;
      await Share.share({
        message: `[ADMIN POLRESTA HT]\nStiker QR Unit: ${asset.name}\nKode Aset: ${asset.code}\nNomor Seri: ${asset.serial_number || "-"}\n\nLihat Gambar QR Code:\n${qrUrl}`,
        title: `Stiker QR Code ${asset.name}`,
      });
    } catch {}
  }

  // Admin Access Restriction Guard
  if (!isAdmin) {
    return (
      <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <View
          style={{
            backgroundColor: theme.cardBg,
            borderRadius: 24,
            borderWidth: 1,
            borderColor: theme.cardBorder,
            padding: 28,
            alignItems: "center",
            maxWidth: 400,
            width: "100%",
            shadowColor: theme.shadowColor,
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.15,
            shadowRadius: 20,
            elevation: 5,
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: isDark ? "rgba(245, 158, 11, 0.2)" : "#FEF3C7",
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <Ionicons name="shield-checkmark" size={32} color="#F59E0B" />
          </View>

          <Text style={{ fontSize: 19, fontWeight: "800", color: theme.textPrimary, textAlign: "center" }}>
            Khusus Panel Admin Logistik
          </Text>
          <Text style={{ fontSize: 13, color: theme.textSecondary, textAlign: "center", marginTop: 8, marginBottom: 24, lineHeight: 20 }}>
            Halaman pemantauan & pemindaian QR Code permohonan ini dikhususkan untuk verifikasi Admin Logistik TIK Polrestabes.
          </Text>

          <AnimatedPressable
            onPress={handleGoBack}
            style={{
              backgroundColor: theme.primary,
              paddingVertical: 12,
              paddingHorizontal: 24,
              borderRadius: 14,
              width: "100%",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 14 }}>
              Kembali
            </Text>
          </AnimatedPressable>
        </View>
      </LinearGradient>
    );
  }

  const mainTx = txItems[0];
  const isBatch = txItems.length > 1;
  const batchCode = mainTx?.batch_code || (mainTx ? `REF-${mainTx.id.slice(0, 8).toUpperCase()}` : "-");

  // Calculate card width for multi-column grid layout on tablet & web desktop
  const isWide = width >= 720;
  const cardWidth = isWide ? "48.5%" : "100%";

  return (
    <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1 }}>
      <View style={{ flex: 1, maxWidth: 960, width: "100%", alignSelf: "center" }}>
        
        {/* Top Navigation Header Bar */}
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: Platform.OS === "ios" ? 54 : 20,
            paddingBottom: 16,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottomWidth: 1,
            borderBottomColor: theme.cardBorder,
            backgroundColor: isDark ? "rgba(15, 23, 42, 0.6)" : "rgba(255, 255, 255, 0.8)",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
            <AnimatedPressable
              onPress={handleGoBack}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "#E2E8F0",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Ionicons name="arrow-back" size={20} color={theme.textPrimary} />
            </AnimatedPressable>

            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 19, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.3 }}>
                  Panel QR Code Admin
                </Text>
                <View style={{ backgroundColor: "rgba(245,158,11,0.2)", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
                  <Text style={{ fontSize: 10, fontWeight: "800", color: "#F59E0B" }}>ADMIN LOGISTIK</Text>
                </View>
              </View>
              <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textSecondary, marginTop: 1 }}>
                Ref: {batchCode} • Pemohon: {mainTx?.borrower_name || "Petugas"}
              </Text>
            </View>
          </View>

          {/* Realtime Status Indicator */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: isDark ? "rgba(34, 197, 94, 0.15)" : "#DCFCE7",
              borderColor: "rgba(34, 197, 94, 0.4)",
              borderWidth: 1,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 20,
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#22C55E" }} />
            <Text style={{ fontSize: 11, fontWeight: "800", color: "#166534" }}>
              REALTIME
            </Text>
          </View>
        </View>

        {/* Loading Spinner */}
        {loading ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={{ marginTop: 12, color: theme.textSecondary, fontSize: 13, fontWeight: "600" }}>
              Memuat Stiker QR Code Peminjaman...
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 24, gap: 20, paddingBottom: 50 }}
            style={{ flex: 1 }}
          >
            {/* Borrowing Request Summary Card */}
            {mainTx && (
              <View
                style={{
                  backgroundColor: theme.cardBg,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(56, 189, 248, 0.3)" : "#BAE6FD",
                  padding: 18,
                  shadowColor: theme.shadowColor,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.08,
                  shadowRadius: 12,
                  elevation: 2,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: "800", color: theme.textPrimary }}>
                    {isBatch ? `Peminjaman Batch (${txItems.length} Unit HT)` : "Peminjaman Tunggal Unit HT"}
                  </Text>
                  <View style={{ backgroundColor: theme.primary, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 }}>
                    <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "800" }}>
                      {batchCode}
                    </Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 4 }}>
                  <View>
                    <Text style={{ fontSize: 11, color: theme.textMuted }}>Nama Pemohon</Text>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: theme.textPrimary }}>
                      {mainTx.borrower_name || "Petugas"}
                    </Text>
                  </View>

                  <View>
                    <Text style={{ fontSize: 11, color: theme.textMuted }}>NRP / Pangkat</Text>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: theme.textPrimary }}>
                      {mainTx.borrower_nrp || "-"}
                    </Text>
                  </View>

                  <View>
                    <Text style={{ fontSize: 11, color: theme.textMuted }}>Kesatuan</Text>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: theme.textPrimary }}>
                      {mainTx.kesatuan || "-"}
                    </Text>
                  </View>

                  <View>
                    <Text style={{ fontSize: 11, color: theme.textMuted }}>Waktu Pengajuan</Text>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: theme.textSecondary }}>
                      {formatFullDateTimeId(mainTx.created_at)}
                    </Text>
                  </View>

                  {mainTx.reviewer && (
                    <View>
                      <Text style={{ fontSize: 11, color: theme.textMuted }}>Verifikator Admin</Text>
                      <Text style={{ fontSize: 12.5, fontWeight: "700", color: "#22C55E" }}>
                        {mainTx.reviewer.full_name}
                      </Text>
                    </View>
                  )}

                  {mainTx.reviewed_at && (
                    <View>
                      <Text style={{ fontSize: 11, color: theme.textMuted }}>Waktu Disetujui</Text>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: "#22C55E" }}>
                        {formatFullDateTimeId(mainTx.reviewed_at)}
                      </Text>
                    </View>
                  )}

                  {mainTx.due_date && (() => {
                    const rem = getRemainingTimeStatus(mainTx.due_date);
                    const isOver = rem?.isOverdue;
                    return (
                      <View style={{ width: "100%", marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6, backgroundColor: isOver ? "rgba(239, 68, 68, 0.12)" : rem?.urgentLevel === "warning" ? "rgba(245, 158, 11, 0.12)" : "rgba(14, 165, 233, 0.1)", borderColor: isOver ? "#ef4444" : rem?.urgentLevel === "warning" ? "#f59e0b" : "#0284c7", borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Ionicons name={isOver ? "alert-circle" : "alarm-outline"} size={14} color={isOver ? "#ef4444" : rem?.urgentLevel === "warning" ? "#d97706" : "#0284c7"} />
                          <Text style={{ fontSize: 11.5, fontWeight: "700", color: isOver ? "#ef4444" : rem?.urgentLevel === "warning" ? "#d97706" : "#0284c7" }}>
                            Batas: {formatFullDateTimeId(mainTx.due_date)}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 11, fontWeight: "800", color: isOver ? "#ef4444" : rem?.urgentLevel === "warning" ? "#d97706" : "#0284c7" }}>
                          Status: {rem?.text}
                        </Text>
                      </View>
                    );
                  })()}

                  {mainTx.document_url && (
                    <AnimatedPressable
                      onPress={() => setViewDocModal({ visible: true, url: mainTx.document_url!, name: mainTx.document_name || "Surat_Resmi" })}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 4,
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        backgroundColor: "rgba(16, 185, 129, 0.12)",
                        borderRadius: 8,
                        alignSelf: "flex-start",
                      }}
                    >
                      <Ionicons name="document-text" size={14} color="#10b981" />
                      <Text style={{ fontSize: 11.5, fontWeight: "700", color: "#10b981" }}>
                        Lihat Lampiran Surat Resmi
                      </Text>
                    </AnimatedPressable>
                  )}
                </View>
              </View>
            )}

            {/* Proportional Responsive Grid Container for HT QR Cards */}
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 16,
                justifyContent: "space-between",
              }}
            >
              {txItems.map((txItem, idx) => {
                const asset = txItem.asset;
                if (!asset) return null;
                const isBorrowed = (asset.status || "").toLowerCase() === "dipinjam";
                const isProcessing = processingAssetId === asset.id;

                return (
                  <View
                    key={`${txItem.id}-${idx}`}
                    style={{
                      width: cardWidth,
                      backgroundColor: theme.cardBg,
                      borderRadius: 22,
                      borderWidth: 1.5,
                      borderColor: isBorrowed ? "#22C55E" : theme.cardBorder,
                      padding: 20,
                      alignItems: "center",
                      shadowColor: theme.shadowColor,
                      shadowOffset: { width: 0, height: 6 },
                      shadowOpacity: 0.1,
                      shadowRadius: 16,
                      elevation: 3,
                    }}
                  >
                    {/* Card Header Info */}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%", marginBottom: 14 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                        <View
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            backgroundColor: isBorrowed ? "#22C55E" : theme.primary,
                            justifyContent: "center",
                            alignItems: "center",
                          }}
                        >
                          <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "800" }}>
                            {idx + 1}
                          </Text>
                        </View>

                        <View style={{ flex: 1 }}>
                          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "800", color: theme.textPrimary }}>
                            {asset.name}
                          </Text>
                          <Text style={{ fontSize: 11.5, color: theme.textSecondary, marginTop: 1 }}>
                            Kode: <Text style={{ fontWeight: "800", color: theme.primary }}>{asset.code}</Text> • SN: {asset.serial_number || "-"}
                          </Text>
                        </View>
                      </View>

                      <StatusBadge status={asset.status || "tersedia"} />
                    </View>

                    {/* QR Code Canvas Frame - Perfectly Proportioned */}
                    <View
                      style={{
                        backgroundColor: "#FFFFFF",
                        padding: 16,
                        borderRadius: 20,
                        borderWidth: 1.5,
                        borderColor: "#E2E8F0",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 16,
                        width: "100%",
                        maxWidth: 240,
                        shadowColor: "#000",
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.06,
                        shadowRadius: 10,
                        elevation: 2,
                      }}
                    >
                      <Image
                        source={{
                          uri: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
                            asset.code || ""
                          )}`,
                        }}
                        style={{ width: 190, height: 190, borderRadius: 8 }}
                        resizeMode="contain"
                      />
                      <Text style={{ fontSize: 11, fontWeight: "800", color: "#0F172A", marginTop: 10, letterSpacing: 0.5 }}>
                        STIKER QR: {asset.code}
                      </Text>
                    </View>

                    {/* Realtime Status Indicator Bar */}
                    <View
                      style={{
                        backgroundColor: isBorrowed
                          ? (isDark ? "rgba(34, 197, 94, 0.15)" : "#DCFCE7")
                          : (isDark ? "rgba(245, 158, 11, 0.15)" : "#FEF3C7"),
                        borderColor: isBorrowed ? "#22C55E" : "#F59E0B",
                        borderWidth: 1,
                        borderRadius: 12,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        width: "100%",
                        alignItems: "center",
                        marginBottom: 14,
                      }}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: "800", color: isBorrowed ? "#166534" : "#B45309" }}>
                        {isBorrowed ? "✓ DIPINJAM (Peminjaman Aktif)" : "📷 SIAP SCAN / SERAH TERIMA"}
                      </Text>
                    </View>

                    {/* Proportional Action Buttons Bar */}
                    <View style={{ flexDirection: "row", gap: 8, width: "100%" }}>
                      {!isBorrowed ? (
                        /* Konfirmasi Serah Terima Fisik (Set DIPINJAM) */
                        <AnimatedPressable
                          onPress={() => handleConfirmHandover(asset, txItem)}
                          disabled={isProcessing}
                          style={{
                            flex: 1,
                            backgroundColor: "#22C55E",
                            paddingVertical: 11,
                            borderRadius: 13,
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
                              <Ionicons name="checkmark-circle" size={17} color="#FFFFFF" />
                              <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 12.5 }}>
                                Set DIPINJAM
                              </Text>
                            </>
                          )}
                        </AnimatedPressable>
                      ) : (
                        /* Konfirmasi Pengembalian Fisik (Set TERSEDIA) */
                        <AnimatedPressable
                          onPress={() => handleConfirmReturn(asset, txItem)}
                          disabled={isProcessing}
                          style={{
                            flex: 1,
                            backgroundColor: isDark ? "rgba(2, 132, 199, 0.25)" : "#0284C7",
                            paddingVertical: 11,
                            borderRadius: 13,
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
                              <Ionicons name="arrow-undo-circle" size={17} color="#FFFFFF" />
                              <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 12.5 }}>
                                Set TERSEDIA
                              </Text>
                            </>
                          )}
                        </AnimatedPressable>
                      )}

                      {/* Share Button */}
                      <AnimatedPressable
                        onPress={() => handleShareQR(asset)}
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: 13,
                          backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "#F1F5F9",
                          borderWidth: 1,
                          borderColor: theme.cardBorder,
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <Ionicons name="share-social-outline" size={18} color={theme.textPrimary} />
                      </AnimatedPressable>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}

        {/* Global Toast Bottom Sheet Feedback */}
        {toastConfig.visible && (
          <AppBottomSheet
            visible={toastConfig.visible}
            onClose={() => setToastConfig((prev) => ({ ...prev, visible: false }))}
            title={toastConfig.title}
            message={toastConfig.message}
            icon={toastConfig.icon}
            isDanger={toastConfig.isDanger}
            confirmText="OK"
          />
        )}

        {/* Official Document Viewer Modal */}
        <DocumentViewerModal
          visible={viewDocModal.visible}
          onClose={() => setViewDocModal((prev) => ({ ...prev, visible: false }))}
          documentUrl={viewDocModal.url}
          documentName={viewDocModal.name}
          title="Surat Perintah / Resmi (Lampiran)"
        />
      </View>
    </LinearGradient>
  );
}
