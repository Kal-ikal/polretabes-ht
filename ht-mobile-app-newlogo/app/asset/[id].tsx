import { useEffect, useState } from "react";
import { View, Text, TextInput, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeHaptics } from "@/lib/safeHaptics";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/context/AuthContext";
import { getFriendlyErrorMessage } from "@/lib/errorHandler";
import { StatusBadge } from "@/components/StatusBadge";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppBottomSheet } from "@/components/AppBottomSheet";
import type { Asset, Transaction } from "@/types/database";

const KESATUAN_OPTIONS = [
  "Sat Lantas",
  "Sat Reskrim",
  "Sat Intelkam",
  "Sat Samapta",
  "Bag Ops",
  "SPKT",
  "Si Propam",
  "Polsek",
];

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { profile } = useAuth();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [pendingLoanInfo, setPendingLoanInfo] = useState<{ isPending: boolean; borrowerName?: string; kesatuan?: string } | null>(null);
  const [approvedAwaitingTx, setApprovedAwaitingTx] = useState<Transaction | null>(null);
  const [activeTx, setActiveTx] = useState<Transaction | null>(null);
  const [batchSiblingTxs, setBatchSiblingTxs] = useState<Transaction[]>([]);

  const [borrowerName, setBorrowerName] = useState(profile?.full_name || "");
  const [borrowerNrp, setBorrowerNrp] = useState(profile?.nrp || "");
  const [kesatuan, setKesatuan] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (profile) {
      if (profile.full_name && !borrowerName) setBorrowerName(profile.full_name);
      if (profile.nrp && !borrowerNrp) setBorrowerNrp(profile.nrp);
    }
  }, [profile]);

  const [modalConfig, setModalConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon: string;
    isDanger?: boolean;
    onConfirm: () => void;
  }>({
    visible: false,
    title: "",
    message: "",
    icon: "📋",
    onConfirm: () => {},
  });

  const loadAssetDetails = async () => {
    if (!id) return;
    try {
      // 1. Fetch asset details
      const { data: assetData } = await supabase
        .from("assets")
        .select("*")
        .eq("id", id)
        .single();

      if (assetData) {
        setAsset(assetData as Asset);
      }

      // 2. Fetch active or latest transaction for this asset
      const { data: latestTx } = await supabase
        .from("transactions")
        .select("*, asset:assets(*), reviewer:profiles!transactions_reviewed_by_fkey(*)")
        .eq("asset_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestTx) {
        setActiveTx(latestTx as Transaction);

        // If part of a batch, fetch all sibling transactions in the same batch
        if (latestTx.batch_id) {
          const { data: batchTxs } = await supabase
            .from("transactions")
            .select("*, asset:assets(*)")
            .eq("batch_id", latestTx.batch_id)
            .order("created_at", { ascending: true });

          if (batchTxs) {
            setBatchSiblingTxs(batchTxs as Transaction[]);
          }
        } else {
          setBatchSiblingTxs([]);
        }
      }

      // 3. Check if there's an active PENDING borrow request for this unit
      if (
        latestTx &&
        latestTx.action === "BORROW" &&
        latestTx.status === "PENDING" &&
        !latestTx.cancelled_at &&
        (assetData?.status || "").toLowerCase() === "tersedia"
      ) {
        setPendingLoanInfo({
          isPending: true,
          borrowerName: latestTx.borrower_name || "Petugas Lain",
          kesatuan: latestTx.kesatuan || "",
        });
      } else {
        setPendingLoanInfo({ isPending: false });
      }

      // 4. Check if there's an APPROVED borrow awaiting physical handover
      if (
        latestTx &&
        latestTx.action === "BORROW" &&
        latestTx.status === "APPROVED" &&
        !latestTx.cancelled_at &&
        (assetData?.status || "").toLowerCase() === "tersedia"
      ) {
        setApprovedAwaitingTx(latestTx as Transaction);
      } else {
        setApprovedAwaitingTx(null);
      }
    } catch (err) {
      console.error("Error loading asset details:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDirectHandover = async () => {
    if (!asset || !id) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("scan_to_borrow", {
        p_scanned_qr: asset.code,
        p_tx_id: approvedAwaitingTx?.id || null,
        p_user_id: profile?.id || null,
      });

      if (error) {
        setSubmitting(false);
        setModalConfig({
          visible: true,
          title: "Gagal Serah Terima",
          message: error.message || getFriendlyErrorMessage(error),
          icon: "❌",
          isDanger: true,
          onConfirm: () => {},
        });
        return;
      }

      setSubmitting(false);
      try {
        SafeHaptics.notificationAsync();
      } catch {}

      setModalConfig({
        visible: true,
        title: "Serah Terima Berhasil! 🎉",
        message: `Unit ${asset.name} (${asset.code}) resmi beralih ke status DIPINJAM untuk ${approvedAwaitingTx?.borrower_name || "peminjam"}.`,
        icon: "✅",
        onConfirm: () => {
          loadAssetDetails();
        },
      });
    } catch (err: any) {
      setSubmitting(false);
      setModalConfig({
        visible: true,
        title: "Gagal Serah Terima",
        message: err.message || getFriendlyErrorMessage(err),
        icon: "❌",
        isDanger: true,
        onConfirm: () => {},
      });
    }
  };

  const handleCancelApproved = async () => {
    if (!approvedAwaitingTx) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("cancel_transaction", {
        p_transaction_id: approvedAwaitingTx.id,
      });

      if (error) {
        setSubmitting(false);
        setModalConfig({
          visible: true,
          title: "Gagal Membatalkan",
          message: error.message || getFriendlyErrorMessage(error),
          icon: "❌",
          isDanger: true,
          onConfirm: () => {},
        });
        return;
      }

      setSubmitting(false);
      try {
        SafeHaptics.notificationAsync();
      } catch {}

      setModalConfig({
        visible: true,
        title: "Persetujuan Dibatalkan",
        message: `Persetujuan peminjaman telah dibatalkan. Unit ${asset?.name} kembali bersih berstatus TERSEDIA.`,
        icon: "ℹ️",
        onConfirm: () => {
          loadAssetDetails();
        },
      });
    } catch (err: any) {
      setSubmitting(false);
      setModalConfig({
        visible: true,
        title: "Gagal Membatalkan",
        message: err.message || getFriendlyErrorMessage(err),
        icon: "❌",
        isDanger: true,
        onConfirm: () => {},
      });
    }
  };

  useEffect(() => {
    loadAssetDetails();
  }, [id]);

  function triggerSubmit() {
    if (!asset || !id) return;
    if (!borrowerName.trim() || !borrowerNrp.trim() || !kesatuan.trim()) {
      setModalConfig({
        visible: true,
        title: "Lengkapi Data",
        message: "Nama Peminjam, Pangkat/NRP, dan Kesatuan wajib diisi.",
        icon: "⚠️",
        onConfirm: () => {},
      });
      return;
    }

    setModalConfig({
      visible: true,
      title: "Konfirmasi Peminjaman",
      message: `Proses pengajuan peminjaman unit ${asset.name} untuk ${borrowerName.trim()} (${kesatuan.trim()})?`,
      icon: "📻",
      onConfirm: executeSubmit,
    });
  }

  async function executeSubmit() {
    setSubmitting(true);

    try {
      const { data: latestAsset } = await supabase
        .from("assets")
        .select("status, name")
        .eq("id", id!)
        .single();

      if ((latestAsset?.status || "").toLowerCase() !== "tersedia") {
        setSubmitting(false);
        setModalConfig({
          visible: true,
          title: "Unit Tidak Tersedia",
          message: `Unit HT "${latestAsset?.name || "ini"}" saat ini berstatus ${latestAsset?.status?.toUpperCase()} dan tidak tersedia untuk dipinjam.`,
          icon: "⚠️",
          isDanger: true,
          onConfirm: () => router.replace("/(tabs)"),
        });
        return;
      }

      // Check the latest transaction on this asset
      const { data: latestExistingTx } = await supabase
        .from("transactions")
        .select("id, borrower_name, status, action, cancelled_at")
        .eq("asset_id", id!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (
        latestExistingTx &&
        latestExistingTx.action === "BORROW" &&
        latestExistingTx.status === "PENDING" &&
        !latestExistingTx.cancelled_at
      ) {
        setSubmitting(false);
        setModalConfig({
          visible: true,
          title: "Unit Sedang Diproses",
          message: `Unit HT ini sudah diajukan oleh ${latestExistingTx.borrower_name || "petugas lain"} dan sedang menunggu persetujuan admin. 1 unit hanya dapat dipinjam oleh 1 akun.`,
          icon: "⏳",
          isDanger: true,
          onConfirm: () => router.replace("/(tabs)"),
        });
        return;
      }

      // Check if there's already an APPROVED borrow waiting for physical handover scan
      if (
        latestExistingTx &&
        latestExistingTx.action === "BORROW" &&
        latestExistingTx.status === "APPROVED" &&
        !latestExistingTx.cancelled_at
      ) {
        setSubmitting(false);
        setModalConfig({
          visible: true,
          title: "Unit Sudah Disetujui",
          message: `Peminjaman unit HT ini sudah disetujui admin untuk ${latestExistingTx.borrower_name || "petugas"}. Silakan scan QR Code fisik unit HT untuk menyelesaikan serah terima.`,
          icon: "✅",
          onConfirm: () => router.replace("/(tabs)/scan"),
        });
        return;
      }

      const { error: rpcError } = await supabase.rpc("process_asset_transaction", {
        p_asset_id: id!,
        p_action: "BORROW",
        p_condition: "baik",
        p_notes: null,
        p_borrower_name: borrowerName.trim(),
        p_borrower_nrp: borrowerNrp.trim(),
        p_kesatuan: kesatuan.trim(),
      });

      if (rpcError) {
        console.warn("RPC process_asset_transaction returned error, executing direct fallback:", rpcError);

        const nowIso = new Date().toISOString();

        const { error: insertErr } = await supabase.from("transactions").insert({
          asset_id: id!,
          borrower_id: profile?.id || null,
          borrower_name: borrowerName.trim(),
          borrower_nrp: borrowerNrp.trim(),
          kesatuan: kesatuan.trim(),
          action: "BORROW",
          status: "PENDING",
          condition: "baik",
          notes: null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        if (insertErr) {
          setSubmitting(false);
          setModalConfig({
            visible: true,
            title: "Gagal Peminjaman",
            message: getFriendlyErrorMessage(insertErr, "Gagal memproses pengajuan peminjaman aset."),
            icon: "❌",
            isDanger: true,
            onConfirm: () => {},
          });
          return;
        }
      }

      setSubmitting(false);

      try {
        SafeHaptics.notificationAsync();
      } catch {}

      setModalConfig({
        visible: true,
        title: "Pengajuan Terkirim! ⏳",
        message: `Pengajuan peminjaman unit ${asset?.name} (${asset?.code}) untuk ${borrowerName.trim()} (${kesatuan.trim()}) berhasil dikirim. Menunggu persetujuan Admin sebelum unit siap di-scan untuk serah terima fisik.`,
        icon: "⏳",
        onConfirm: () => router.replace("/(tabs)"),
      });
    } catch (err: any) {
      setSubmitting(false);
      setModalConfig({
        visible: true,
        title: "Kesalahan Sistem",
        message: getFriendlyErrorMessage(err),
        icon: "❌",
        isDanger: true,
        onConfirm: () => {},
      });
    }
  }

  if (loading) {
    return (
      <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={theme.primary} size="large" />
      </LinearGradient>
    );
  }

  if (!asset) {
    return (
      <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <Text style={{ color: theme.textPrimary, fontSize: 16 }}>
          Aset tidak ditemukan.
        </Text>
      </LinearGradient>
    );
  }

  const isTersedia = (asset.status || "").toLowerCase() === "tersedia";
  const isPendingApproval = pendingLoanInfo?.isPending === true;
  const isAwaitingHandover = Boolean(approvedAwaitingTx && isTersedia);
  const isBorrowable = isTersedia && !isPendingApproval && !isAwaitingHandover;

  return (
    <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          {/* Asset Header Card */}
          <View
            style={{
              backgroundColor: theme.cardBackground,
              borderColor: theme.cardBorder,
              borderWidth: 1,
              borderRadius: 20,
              padding: 20,
              shadowColor: theme.shadowColor,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 12,
              elevation: 4,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={{ fontSize: 22, fontWeight: "800", color: theme.textPrimary }}
                >
                  {asset.name}
                </Text>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                  style={{ color: theme.textSecondary, marginTop: 4, fontSize: 14 }}
                >
                  Kode: {asset.code} • SN: {asset.serial_number}
                </Text>
              </View>

              <View
                style={{
                  backgroundColor: isPendingApproval
                    ? (theme.isDark ? "rgba(245, 158, 11, 0.2)" : "#FEF3C7")
                    : (theme.isDark ? "rgba(2, 132, 199, 0.2)" : "#E0F2FE"),
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "800",
                    color: isPendingApproval ? "#F59E0B" : theme.primary,
                  }}
                >
                  {asset.code}
                </Text>
              </View>
            </View>

            <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
              {isPendingApproval ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    backgroundColor: theme.isDark ? "rgba(245, 158, 11, 0.18)" : "#FEF3C7",
                    borderColor: theme.isDark ? "rgba(245, 158, 11, 0.4)" : "#FCD34D",
                    borderWidth: 1,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 12,
                  }}
                >
                  <Ionicons name="time" size={13} color="#F59E0B" />
                  <Text style={{ fontSize: 11.5, fontWeight: "800", color: "#F59E0B" }}>
                    MENUNGGU PERSETUJUAN
                  </Text>
                </View>
              ) : (
                <StatusBadge status={asset.status} />
              )}

              {activeTx?.batch_code && (
                <View
                  style={{
                    backgroundColor: theme.isDark ? "rgba(56, 189, 248, 0.18)" : "rgba(2, 132, 199, 0.1)",
                    borderColor: theme.primary,
                    borderWidth: 1,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 10,
                  }}
                >
                  <Text style={{ fontSize: 10.5, fontWeight: "800", color: theme.primary }}>
                    BATCH: {activeTx.batch_code}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* BATCH TRANSACTION SIBLINGS & DETAIL VIEW CARD (If part of batch loan) */}
          {batchSiblingTxs.length > 0 && (
            <View
              style={{
                backgroundColor: theme.cardBackground,
                borderColor: theme.cardBorder,
                borderWidth: 1,
                borderRadius: 20,
                padding: 18,
                gap: 12,
                shadowColor: theme.shadowColor,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.12,
                shadowRadius: 10,
                elevation: 3,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      backgroundColor: theme.isDark ? "rgba(2, 132, 199, 0.25)" : "rgba(2, 132, 199, 0.12)",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Ionicons name="albums-outline" size={18} color={theme.primary} />
                  </View>
                  <View>
                    <Text style={{ fontSize: 15, fontWeight: "800", color: theme.textPrimary }}>
                      Rincian Peminjaman Batch
                    </Text>
                    <Text style={{ fontSize: 11.5, color: theme.textSecondary }}>
                      {batchSiblingTxs.length} Unit HT • No. Ref: {activeTx?.batch_code}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Individual HT Units List in this Batch */}
              <View style={{ gap: 8 }}>
                {batchSiblingTxs.map((txItem, idx) => {
                  const isCurrent = txItem.asset_id === id;
                  return (
                    <View
                      key={`${txItem.id}-${idx}`}
                      style={{
                        backgroundColor: isCurrent
                          ? (theme.isDark ? "rgba(2, 132, 199, 0.2)" : "#E0F2FE")
                          : (theme.isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC"),
                        borderColor: isCurrent ? theme.primary : theme.cardBorder,
                        borderWidth: isCurrent ? 1.5 : 1,
                        borderRadius: 12,
                        padding: 10,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                        <View
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            backgroundColor: isCurrent ? theme.primary : (theme.isDark ? "rgba(255,255,255,0.15)" : "#CBD5E1"),
                            justifyContent: "center",
                            alignItems: "center",
                          }}
                        >
                          <Text style={{ color: isCurrent ? "#FFFFFF" : theme.textPrimary, fontSize: 10.5, fontWeight: "800" }}>
                            {idx + 1}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "800", color: theme.textPrimary }}>
                            {txItem.asset?.name || "Unit HT"} {isCurrent ? "(Unit Ini)" : ""}
                          </Text>
                          <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textSecondary }}>
                            QR: {txItem.asset?.code} • SN: {txItem.asset?.serial_number}
                          </Text>
                        </View>
                      </View>

                      <View style={{ alignItems: "flex-end" }}>
                        <StatusBadge status={txItem.asset?.status || "tersedia"} />
                        {txItem.condition && (
                          <Text style={{ fontSize: 10, color: theme.textMuted, marginTop: 2, fontStyle: "italic" }}>
                            Kondisi: {txItem.condition}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Borrower & Transaction Meta */}
              {activeTx && (
                <View
                  style={{
                    backgroundColor: theme.isDark ? "rgba(0, 0, 0, 0.2)" : "#F1F5F9",
                    borderRadius: 12,
                    padding: 10,
                    gap: 3,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "700", color: theme.textMuted, textTransform: "uppercase" }}>
                    Detail Peminjam
                  </Text>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: theme.textPrimary }}>
                    {activeTx.borrower_name} ({activeTx.borrower_nrp})
                  </Text>
                  <Text style={{ fontSize: 11.5, color: theme.textSecondary }}>
                    Kesatuan: {activeTx.kesatuan || "-"} • Status Transaksi: {activeTx.status}
                  </Text>
                  {activeTx.reviewer?.full_name && (
                    <Text style={{ fontSize: 11, color: theme.primary, marginTop: 2 }}>
                      Diverifikasi oleh: {activeTx.reviewer.full_name}
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Action / Form Section */}
          {isBorrowable ? (
            /* Active Loan Form */
            <View
              style={{
                backgroundColor: theme.cardBackground,
                borderColor: theme.cardBorder,
                borderWidth: 1,
                borderRadius: 20,
                padding: 20,
                shadowColor: theme.shadowColor,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 12,
                elevation: 4,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                  style={{ fontSize: 17, fontWeight: "800", color: theme.textPrimary }}
                >
                  Form Peminjaman Unit (Single)
                </Text>

                {profile && (
                  <AnimatedPressable
                    onPress={() => {
                      if (profile?.full_name) setBorrowerName(profile.full_name);
                      if (profile?.nrp) setBorrowerNrp(profile.nrp);
                      try {
                        SafeHaptics.notificationAsync();
                      } catch {}
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      backgroundColor: theme.isDark ? "rgba(2, 132, 199, 0.2)" : "rgba(2, 132, 199, 0.1)",
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: theme.primary,
                    }}
                  >
                    <Ionicons name="flash" size={13} color={theme.primary} />
                    <Text style={{ fontSize: 11.5, fontWeight: "700", color: theme.primary }}>
                      Data Saya
                    </Text>
                  </AnimatedPressable>
                )}
              </View>

              {/* Form Input: Nama */}
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontWeight: "700", marginBottom: 6, color: theme.textPrimary, fontSize: 12.5 }}>
                  Nama Lengkap Peminjam
                </Text>
                <TextInput
                  placeholder="Masukkan nama lengkap peminjam..."
                  placeholderTextColor={theme.inputPlaceholder}
                  value={borrowerName}
                  onChangeText={setBorrowerName}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    height: 44,
                    color: theme.inputText,
                    fontSize: 13.5,
                    outlineStyle: "none" as any,
                  }}
                />
              </View>

              {/* Form Input: NRP */}
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontWeight: "700", marginBottom: 6, color: theme.textPrimary, fontSize: 12.5 }}>
                  Pangkat / NRP
                </Text>
                <TextInput
                  placeholder="Contoh: Bripka / 78010234"
                  placeholderTextColor={theme.inputPlaceholder}
                  value={borrowerNrp}
                  onChangeText={setBorrowerNrp}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    height: 44,
                    color: theme.inputText,
                    fontSize: 13.5,
                    outlineStyle: "none" as any,
                  }}
                />
              </View>

              {/* Form Input: Kesatuan */}
              <View style={{ marginBottom: 10 }}>
                <Text style={{ fontWeight: "700", marginBottom: 6, color: theme.textPrimary, fontSize: 12.5 }}>
                  Kesatuan / Satuan Kerja
                </Text>
                <TextInput
                  placeholder="Contoh: Sat Reskrim / Sat Lantas"
                  placeholderTextColor={theme.inputPlaceholder}
                  value={kesatuan}
                  onChangeText={setKesatuan}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    height: 44,
                    color: theme.inputText,
                    fontSize: 13.5,
                    marginBottom: 8,
                    outlineStyle: "none" as any,
                  }}
                />

                {/* Preset Chips */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {KESATUAN_OPTIONS.map((opt) => {
                    const isSelected = kesatuan === opt;
                    return (
                      <AnimatedPressable
                        key={opt}
                        onPress={() => {
                          setKesatuan(opt);
                          SafeHaptics.selectionAsync();
                        }}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: 8,
                          backgroundColor: isSelected
                            ? theme.primary
                            : theme.isDark
                            ? "rgba(255, 255, 255, 0.08)"
                            : "rgba(2, 132, 199, 0.08)",
                          borderWidth: 1,
                          borderColor: isSelected
                            ? theme.primary
                            : theme.isDark
                            ? "rgba(255, 255, 255, 0.12)"
                            : "rgba(2, 132, 199, 0.15)",
                        }}
                      >
                        <Text style={{ fontSize: 11.5, fontWeight: "600", color: isSelected ? "#FFFFFF" : theme.textSecondary }}>
                          {opt}
                        </Text>
                      </AnimatedPressable>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Live Loan Summary Box */}
              <View
                style={{
                  backgroundColor: theme.isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.02)",
                  borderRadius: 14,
                  padding: 12,
                  marginTop: 10,
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                  gap: 4,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "700", color: theme.textSecondary, textTransform: "uppercase" }}>
                  Ringkasan Peminjaman
                </Text>
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.textPrimary }}>
                  {borrowerName.trim() || "Nama Belum Diisi"} • {kesatuan.trim() || "Satuan Kerja"}
                </Text>
                <Text style={{ fontSize: 11, color: theme.textMuted }}>
                  Unit {asset.name} ({asset.code}) akan diajukan ke admin logistik.
                </Text>
              </View>

              <AnimatedPressable
                onPress={triggerSubmit}
                disabled={submitting}
                style={{
                  backgroundColor: theme.primary,
                  borderRadius: 14,
                  padding: 15,
                  alignItems: "center",
                  marginTop: 14,
                  opacity: submitting ? 0.6 : 1,
                  shadowColor: theme.primary,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 4,
                }}
              >
                {submitting ? (
                  <ActivityIndicator color={theme.primaryTextOnButton} />
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="paper-plane" size={16} color={theme.primaryTextOnButton} />
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                      style={{ color: theme.primaryTextOnButton, fontWeight: "800", fontSize: 14.5 }}
                    >
                      Konfirmasi Peminjaman
                    </Text>
                  </View>
                )}
              </AnimatedPressable>
            </View>
          ) : isAwaitingHandover ? (
            /* Action Card when unit is APPROVED & awaiting physical handover */
            <View
              style={{
                backgroundColor: theme.isDark ? "rgba(2, 132, 199, 0.15)" : "#E0F2FE",
                borderColor: theme.isDark ? "rgba(2, 132, 199, 0.4)" : "#BAE6FD",
                borderWidth: 1.5,
                padding: 20,
                borderRadius: 20,
                alignItems: "center",
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: theme.isDark ? "rgba(2, 132, 199, 0.3)" : "#BAE6FD",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Ionicons name="checkmark-done-circle" size={30} color={theme.primary} />
              </View>

              <View style={{ alignItems: "center", gap: 2 }}>
                <Text style={{ fontSize: 17, fontWeight: "800", color: theme.textPrimary, textAlign: "center" }}>
                  Peminjaman Disetujui Admin
                </Text>
                <Text style={{ fontSize: 13, color: theme.textSecondary, textAlign: "center" }}>
                  Unit telah disetujui untuk peminjam di bawah dan siap diserahterimakan.
                </Text>
              </View>

              {/* Borrower Info Card */}
              <View
                style={{
                  width: "100%",
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.cardBorder,
                  borderWidth: 1,
                  borderRadius: 14,
                  padding: 12,
                  gap: 4,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "700", color: theme.textMuted, textTransform: "uppercase" }}>
                  Data Peminjam Terverifikasi
                </Text>
                <Text style={{ fontSize: 14, fontWeight: "800", color: theme.textPrimary }}>
                  {approvedAwaitingTx?.borrower_name || "Petugas"} ({approvedAwaitingTx?.borrower_nrp || "-"})
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                  Kesatuan: {approvedAwaitingTx?.kesatuan || "-"}
                </Text>
                {approvedAwaitingTx?.reviewer?.full_name && (
                  <Text style={{ fontSize: 11.5, color: theme.primary, marginTop: 2 }}>
                    Disetujui oleh: {approvedAwaitingTx.reviewer.full_name}
                  </Text>
                )}
              </View>

              {/* Action 1: Confirm Handover -> DIPINJAM */}
              <AnimatedPressable
                onPress={handleDirectHandover}
                disabled={submitting}
                style={{
                  width: "100%",
                  backgroundColor: theme.primary,
                  paddingVertical: 14,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  opacity: submitting ? 0.6 : 1,
                  shadowColor: theme.primary,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 4,
                }}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                    <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 14 }}>
                      Selesaikan Serah Terima (Ubah ke DIPINJAM)
                    </Text>
                  </>
                )}
              </AnimatedPressable>

              {/* Action 2: Cancel Approved Loan */}
              <AnimatedPressable
                onPress={handleCancelApproved}
                disabled={submitting}
                style={{
                  width: "100%",
                  backgroundColor: theme.isDark ? "rgba(239, 68, 68, 0.15)" : "#FEE2E2",
                  borderColor: theme.isDark ? "rgba(239, 68, 68, 0.3)" : "#FECACA",
                  borderWidth: 1,
                  paddingVertical: 11,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 6,
                }}
              >
                <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
                <Text style={{ color: theme.isDark ? "#F87171" : "#DC2626", fontWeight: "700", fontSize: 12.5 }}>
                  Batalkan Persetujuan Ini (Reset ke TERSEDIA)
                </Text>
              </AnimatedPressable>
            </View>
          ) : isPendingApproval ? (
            /* Warning Banner when unit is PENDING */
            <View
              style={{
                backgroundColor: theme.isDark ? "rgba(245, 158, 11, 0.15)" : "#FEF3C7",
                borderColor: theme.isDark ? "rgba(245, 158, 11, 0.35)" : "#FCD34D",
                borderWidth: 1,
                padding: 18,
                borderRadius: 18,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: theme.isDark ? "rgba(245, 158, 11, 0.25)" : "#FDE68A",
                  justifyContent: "center",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <Ionicons name="hourglass" size={24} color="#D97706" />
              </View>
              <Text style={{ fontSize: 16, fontWeight: "800", color: theme.isDark ? "#FBBF24" : "#B45309", textAlign: "center" }}>
                Unit Sedang Menunggu Verifikasi
              </Text>
              <Text style={{ fontSize: 13, color: theme.isDark ? "#FDE68A" : "#78350F", textAlign: "center", marginTop: 4, lineHeight: 18 }}>
                Unit HT ini telah diajukan peminjaman oleh <Text style={{ fontWeight: "700" }}>{pendingLoanInfo?.borrowerName}</Text> {pendingLoanInfo?.kesatuan ? `(${pendingLoanInfo.kesatuan})` : ""} dan sedang menunggu persetujuan admin.
              </Text>
              <Text style={{ fontSize: 11.5, color: theme.isDark ? "#FBBF24" : "#92400E", textAlign: "center", marginTop: 8, fontStyle: "italic" }}>
                1 unit hanya dapat dipinjam oleh 1 akun untuk mencegah duplikasi.
              </Text>
              <AnimatedPressable
                onPress={() => router.replace("/(tabs)/scan")}
                style={{
                  marginTop: 14,
                  backgroundColor: "#D97706",
                  paddingVertical: 9,
                  paddingHorizontal: 18,
                  borderRadius: 12,
                }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 12.5 }}>
                  Pilih Unit Lain yang Tersedia
                </Text>
              </AnimatedPressable>
            </View>
          ) : (
            /* Warning Banner when unit is DIPINJAM or RUSAK */
            <View
              style={{
                backgroundColor: theme.isDark ? "rgba(153,27,27,0.25)" : "#FEF2F2",
                borderColor: theme.isDark ? "rgba(248,113,113,0.3)" : "#FECACA",
                borderWidth: 1,
                padding: 18,
                borderRadius: 18,
                alignItems: "center",
              }}
            >
              <Ionicons name="close-circle" size={32} color={theme.isDark ? "#F87171" : "#DC2626"} style={{ marginBottom: 8 }} />
              <Text style={{ fontSize: 15, fontWeight: "700", color: theme.isDark ? "#F87171" : "#991B1B", textAlign: "center" }}>
                {(asset.status as string).toLowerCase() === "dipinjam"
                  ? "Unit HT ini sedang dipinjam oleh petugas lain."
                  : "Unit HT ini sedang berstatus rusak dan tidak dapat dipinjam."}
              </Text>
              <AnimatedPressable
                onPress={() => router.replace("/(tabs)/scan")}
                style={{
                  marginTop: 12,
                  backgroundColor: theme.primary,
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  borderRadius: 10,
                }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 12 }}>
                  Lihat Unit Tersedia
                </Text>
              </AnimatedPressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Confirmation & Alert Bottom Sheet */}
      <AppBottomSheet
        visible={modalConfig.visible}
        onClose={() => setModalConfig((prev) => ({ ...prev, visible: false }))}
        onConfirm={modalConfig.onConfirm}
        title={modalConfig.title}
        message={modalConfig.message}
        icon={modalConfig.icon}
        isDanger={modalConfig.isDanger}
      />
    </LinearGradient>
  );
}
