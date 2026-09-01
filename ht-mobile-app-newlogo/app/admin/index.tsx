import { useCallback, useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Modal,
  Image,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useAppTheme } from "@/context/ThemeContext";
import { Avatar } from "@/components/Avatar";
import { StatusBadge } from "@/components/StatusBadge";
import { SkeletonCard } from "@/components/SkeletonCard";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppBottomSheet } from "@/components/AppBottomSheet";
import { ProfilePhotoModal } from "@/components/ProfilePhotoModal";
import { LoanBatchQRModal } from "@/components/LoanBatchQRModal";
import { getFriendlyErrorMessage } from "@/lib/errorHandler";
import type { Asset, Transaction, Profile, AssetStatus } from "@/types/database";

interface GroupedTransaction {
  id: string;
  isBatch: boolean;
  batch_id?: string | null;
  batch_code?: string | null;
  items: Transaction[];
  mainTx: Transaction;
}

function groupTransactionsByBatch(txList: Transaction[]): GroupedTransaction[] {
  const map = new Map<string, Transaction[]>();
  const singles: Transaction[] = [];

  for (const tx of txList) {
    if (tx.batch_id) {
      if (!map.has(tx.batch_id)) {
        map.set(tx.batch_id, []);
      }
      map.get(tx.batch_id)!.push(tx);
    } else {
      singles.push(tx);
    }
  }

  const result: GroupedTransaction[] = [];

  map.forEach((items, batchId) => {
    if (items.length > 0) {
      result.push({
        id: `batch-${batchId}`,
        isBatch: true,
        batch_id: batchId,
        batch_code: items[0].batch_code || `BATCH-${batchId.slice(0, 6)}`,
        items,
        mainTx: items[0],
      });
    }
  });

  for (const tx of singles) {
    result.push({
      id: tx.id,
      isBatch: false,
      batch_id: null,
      batch_code: null,
      items: [tx],
      mainTx: tx,
    });
  }

  result.sort((a, b) => new Date(b.mainTx.created_at).getTime() - new Date(a.mainTx.created_at).getTime());
  return result;
}

export default function AdminPanelScreen() {
  const { profile } = useAuth();
  const { theme, isDark } = useAppTheme();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"approval" | "assets" | "users">("approval");

  // Tab 1: Approval State
  const [pendingApprovals, setPendingApprovals] = useState<Transaction[]>([]);
  const [approvedApprovals, setApprovedApprovals] = useState<Transaction[]>([]);
  const [approvalSubTab, setApprovalSubTab] = useState<"pending" | "approved">("pending");
  const [loadingApprovals, setLoadingApprovals] = useState(true);
  const [selectedBatchModalGroup, setSelectedBatchModalGroup] = useState<GroupedTransaction | null>(null);
  const [loanQrGroup, setLoanQrGroup] = useState<GroupedTransaction | null>(null);
  const [selectedApproveGroup, setSelectedApproveGroup] = useState<GroupedTransaction | null>(null);
  const [selectedRejectGroup, setSelectedRejectGroup] = useState<GroupedTransaction | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [processingTxId, setProcessingTxId] = useState<string | null>(null);

  // Tab 2: Assets Master State
  const [assetsList, setAssetsList] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [assetModalVisible, setAssetModalVisible] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [assetCode, setAssetCode] = useState("");
  const [assetName, setAssetName] = useState("");
  const [assetSN, setAssetSN] = useState("");
  const [assetSubmitting, setAssetSubmitting] = useState(false);
  const [qrModalAsset, setQrModalAsset] = useState<Asset | null>(null);

  // Override status modal state
  const [overrideAsset, setOverrideAsset] = useState<Asset | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<AssetStatus>("tersedia");
  const [overrideReason, setOverrideReason] = useState("");

  // Tab 3: Users State
  const [usersList, setUsersList] = useState<(Profile & { txCount?: number })[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  // Full Photo Viewer Modal State
  const [photoViewerState, setPhotoViewerState] = useState<{
    visible: boolean;
    photoUrl?: string | null;
    name: string;
    nrp?: string | null;
    role?: string;
  }>({
    visible: false,
    photoUrl: null,
    name: "",
    nrp: null,
    role: undefined,
  });

  // Status feedback toast bottom sheet
  const [toastConfig, setToastConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon: string;
    isDanger?: boolean;
  }>({ visible: false, title: "", message: "", icon: "✅" });

  // 1. Fetch Pending & Approved Approvals
  const fetchApprovals = useCallback(async () => {
    setLoadingApprovals(true);
    const [resPending, resApproved] = await Promise.all([
      supabase
        .from("transactions")
        .select("*, asset:assets(*)")
        .eq("action", "BORROW")
        .eq("status", "PENDING")
        .order("created_at", { ascending: false }),
      supabase
        .from("transactions")
        .select("*, asset:assets(*)")
        .eq("action", "BORROW")
        .eq("status", "APPROVED")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    setPendingApprovals((resPending.data as Transaction[]) ?? []);
    setApprovedApprovals((resApproved.data as Transaction[]) ?? []);
    setLoadingApprovals(false);
  }, []);

  // 2. Fetch Master Assets
  const fetchAssets = useCallback(async () => {
    setLoadingAssets(true);
    const { data: rawAssets } = await supabase
      .from("assets")
      .select("*")
      .order("name", { ascending: true });

    const { data: pendingTxs } = await supabase
      .from("transactions")
      .select("asset_id")
      .eq("action", "BORROW")
      .eq("status", "PENDING");

    if (rawAssets) {
      const pendingAssetIds = new Set((pendingTxs || []).map((t) => t.asset_id));
      const updatedList = (rawAssets as Asset[]).map((asset) => {
        if (pendingAssetIds.has(asset.id) && (asset.status || "").toLowerCase() === "tersedia") {
          return { ...asset, status: "pending" as AssetStatus };
        }
        return asset;
      });

      setAssetsList(updatedList);
    }
    setLoadingAssets(false);
  }, []);

  // 3. Fetch Users & Transaction Counts
  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("*")
      .order("full_name", { ascending: true });

    if (profilesData) {
      const usersWithCounts = await Promise.all(
        (profilesData as Profile[]).map(async (u) => {
          const { count } = await supabase
            .from("transactions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", u.id);
          return { ...u, txCount: count ?? 0 };
        })
      );
      setUsersList(usersWithCounts);
    }
    setLoadingUsers(false);
  }, []);

  useEffect(() => {
    if (profile?.role === "admin") {
      fetchApprovals();
      fetchAssets();
      fetchUsers();

      // Subscribe to Realtime Updates
      const txChannelId = `admin-tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const txChannel = supabase
        .channel(txChannelId)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "transactions" },
          () => {
            fetchApprovals();
            fetchUsers();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "assets" },
          () => {
            fetchApprovals();
            fetchAssets();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(txChannel);
      };
    }
  }, [profile, fetchApprovals, fetchAssets, fetchUsers]);

  // Admin Access Gate
  if (profile?.role !== "admin") {
    return (
      <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <View
          style={{
            backgroundColor: theme.cardBackground,
            borderColor: theme.cardBorder,
            borderWidth: 1,
            borderRadius: 24,
            padding: 28,
            alignItems: "center",
            width: "100%",
          }}
        >
          <Text style={{ fontSize: 44, marginBottom: 12 }}>🛡️</Text>
          <Text style={{ color: theme.textPrimary, fontWeight: "800", fontSize: 20, textAlign: "center" }}>
            Akses Ditolak
          </Text>
          <Text style={{ color: theme.textSecondary, textAlign: "center", marginTop: 6, marginBottom: 20, fontSize: 14 }}>
            Halaman ini khusus untuk Admin Sistem. Peran Anda saat ini adalah Petugas.
          </Text>
          <AnimatedPressable
            onPress={() => router.replace("/(tabs)")}
            style={{
              backgroundColor: theme.primary,
              paddingVertical: 14,
              paddingHorizontal: 24,
              borderRadius: 14,
              width: "100%",
              alignItems: "center",
            }}
          >
            <Text style={{ color: theme.primaryTextOnButton, fontWeight: "700", fontSize: 16 }}>
              Kembali ke Aplikasi Mobile
            </Text>
          </AnimatedPressable>
        </View>
      </LinearGradient>
    );
  }

  const groupedPendingApprovals = useMemo(
    () => groupTransactionsByBatch(pendingApprovals),
    [pendingApprovals]
  );

  const groupedApprovedApprovals = useMemo(
    () => groupTransactionsByBatch(approvedApprovals.filter((t) => (t.asset?.status || "").toLowerCase() === "tersedia")),
    [approvedApprovals]
  );

  // --- Handlers: Approve & Reject ---
  async function handleApproveGroup(group: GroupedTransaction) {
    setProcessingTxId(group.id);
    setSelectedApproveGroup(null);
    setSelectedBatchModalGroup(null);

    try {
      let error: any = null;
      if (group.isBatch && group.batch_id) {
        let cleanBatchId = group.batch_id;
        if (cleanBatchId.startsWith("batch-")) {
          cleanBatchId = cleanBatchId.replace("batch-", "");
        }

        const res = await supabase.rpc("approve_batch_transaction", {
          p_batch_id: cleanBatchId,
        });
        error = res.error;
      } else {
        const res = await supabase.rpc("approve_borrow_request", {
          p_tx_id: group.mainTx.id,
          p_admin_id: profile?.id || null,
        });
        error = res.error;
      }

      if (error) {
        Alert.alert("Gagal Menyetujui", error.message || getFriendlyErrorMessage(error));
        setToastConfig({
          visible: true,
          title: "Gagal Menyetujui",
          message: error.message || getFriendlyErrorMessage(error, "Gagal memproses persetujuan."),
          icon: "❌",
          isDanger: true,
        });
      } else {
        setToastConfig({
          visible: true,
          title: "Permohonan Disetujui (APPROVED)",
          message: group.isBatch
            ? `Seluruh permohonan (${group.items.length} HT) dalam batch ${group.batch_code || ""} berhasil disetujui (APPROVED). Status permohonan disetujui, siap di-scan serah terima fisik di mobile.`
            : `Pengajuan peminjaman unit ${group.mainTx.asset?.name || "HT"} berhasil disetujui (APPROVED). Siap di-scan serah terima fisik di mobile.`,
          icon: "✅",
        });
        fetchApprovals();
        fetchAssets();
      }
    } catch (err: any) {
      Alert.alert("Kesalahan Sistem", err.message || "Gagal menyetujui permohonan.");
    } finally {
      setProcessingTxId(null);
    }
  }

  async function handleRejectGroup() {
    if (!selectedRejectGroup) return;
    setProcessingTxId(selectedRejectGroup.id);

    let error: any = null;
    if (selectedRejectGroup.isBatch && selectedRejectGroup.batch_id) {
      const res = await supabase.rpc("reject_batch_transaction", {
        p_batch_id: selectedRejectGroup.batch_id,
        p_reason: rejectReason.trim() || "Ditolak oleh admin",
      });
      error = res.error;
    } else {
      const res = await supabase.rpc("reject_transaction", {
        p_transaction_id: selectedRejectGroup.mainTx.id,
        p_reason: rejectReason.trim() || "Ditolak oleh admin",
      });
      error = res.error;
    }

    setProcessingTxId(null);
    setSelectedRejectGroup(null);
    setSelectedBatchModalGroup(null);
    setRejectReason("");

    if (error) {
      setToastConfig({
        visible: true,
        title: "Gagal Menolak",
        message: getFriendlyErrorMessage(error, "Gagal menolak pengajuan."),
        icon: "❌",
        isDanger: true,
      });
    } else {
      setToastConfig({
        visible: true,
        title: "Pengajuan Ditolak",
        message: selectedRejectGroup.isBatch
          ? `Seluruh permohonan HT (${selectedRejectGroup.items.length} unit) dalam batch berhasil ditolak.`
          : "Pengajuan peminjaman telah ditolak.",
        icon: "🚫",
      });
      fetchApprovals();
    }
  }

  // --- Handlers: Master Asset Upsert ---
  function openAssetForm(asset?: Asset) {
    if (asset) {
      setEditingAsset(asset);
      setAssetCode(asset.code);
      setAssetName(asset.name);
      setAssetSN(asset.serial_number);
    } else {
      setEditingAsset(null);
      setAssetCode(`HT-${Math.floor(1000 + Math.random() * 9000)}`);
      setAssetName("");
      setAssetSN("");
    }
    setAssetModalVisible(true);
  }

  async function handleSaveAsset() {
    if (!assetCode.trim() || !assetName.trim() || !assetSN.trim()) {
      setToastConfig({
        visible: true,
        title: "Data Belum Lengkap",
        message: "Mohon isi Kode, Nama Aset, dan Serial Number.",
        icon: "⚠️",
        isDanger: true,
      });
      return;
    }

    setAssetSubmitting(true);
    const { error } = await supabase.rpc("admin_upsert_asset", {
      p_id: editingAsset ? editingAsset.id : null,
      p_code: assetCode.trim(),
      p_name: assetName.trim(),
      p_serial_number: assetSN.trim(),
    });

    setAssetSubmitting(false);

    if (error) {
      setToastConfig({
        visible: true,
        title: "Gagal Menyimpan",
        message: getFriendlyErrorMessage(error, "Gagal menyimpan data aset."),
        icon: "❌",
        isDanger: true,
      });
    } else {
      setAssetModalVisible(false);
      setToastConfig({
        visible: true,
        title: editingAsset ? "Aset Diperbarui" : "Aset Ditambahkan",
        message: `Data unit ${assetName} berhasil disimpan.`,
        icon: "✅",
      });
      fetchAssets();
    }
  }

  // --- Handlers: Manual Status Override ---
  async function handleOverrideStatus() {
    if (!overrideAsset) return;
    let { error } = await supabase.rpc("admin_override_asset_status", {
      p_asset_id: overrideAsset.id,
      p_new_status: overrideStatus,
      p_reason: overrideReason.trim() || "Override manual oleh admin",
    });

    if (error) {
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

    setOverrideAsset(null);
    setOverrideReason("");

    if (error) {
      setToastConfig({
        visible: true,
        title: "Gagal Override Status",
        message: getFriendlyErrorMessage(error, "Gagal menguji perubahan status."),
        icon: "❌",
        isDanger: true,
      });
    } else {
      setToastConfig({
        visible: true,
        title: "Status Diubah",
        message: `Status unit berhasil diubah menjadi ${overrideStatus}.`,
        icon: "✅",
      });
      fetchAssets();
    }
  }

  return (
    <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1 }}>
      <View style={{ flex: 1, maxWidth: 800, width: "100%", alignSelf: "center" }}>
      {/* Header Bar */}
      <View
        style={{
          paddingTop: Platform.OS === "ios" ? 50 : 20,
          paddingHorizontal: 16,
          paddingBottom: 12,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottomWidth: 1,
          borderBottomColor: theme.cardBorder,
          backgroundColor: theme.cardBackground,
        }}
      >
        <AnimatedPressable
          onPress={() => router.back()}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: 12,
            backgroundColor: theme.isDark ? "rgba(255, 255, 255, 0.08)" : "#F1F5F9",
          }}
        >
          <Ionicons name="arrow-back" size={20} color={theme.textPrimary} />
          <Text style={{ color: theme.textPrimary, fontWeight: "700", fontSize: 13 }}>Kembali</Text>
        </AnimatedPressable>

        <View style={{ alignItems: "center" }}>
          <Text style={{ color: theme.textPrimary, fontWeight: "800", fontSize: 17 }}>Admin Panel</Text>
          <Text style={{ color: theme.primary, fontWeight: "600", fontSize: 11 }}>Sistem Manajemen Aset HT</Text>
        </View>

        <View style={{ width: 70 }} />
      </View>

      {/* 3 Tabs Segmented Switcher Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <View
          style={{
            flexDirection: "row",
            backgroundColor: theme.cardBackground,
            borderColor: theme.cardBorder,
            borderWidth: 1,
            borderRadius: 16,
            padding: 4,
            height: 48,
            alignItems: "center",
          }}
        >
          <AnimatedPressable
            onPress={() => setActiveTab("approval")}
            scaleTo={0.98}
            style={{
              flex: 1,
              height: "100%",
              justifyContent: "center",
              alignItems: "center",
              borderRadius: 12,
              backgroundColor: activeTab === "approval" ? theme.primary : "transparent",
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={{
                color: activeTab === "approval" ? theme.primaryTextOnButton : theme.textSecondary,
                fontWeight: "700",
                fontSize: 12,
                includeFontPadding: false,
              }}
            >
              Persetujuan ({pendingApprovals.length})
            </Text>
          </AnimatedPressable>

          <AnimatedPressable
            onPress={() => setActiveTab("assets")}
            scaleTo={0.98}
            style={{
              flex: 1,
              height: "100%",
              justifyContent: "center",
              alignItems: "center",
              borderRadius: 12,
              backgroundColor: activeTab === "assets" ? theme.primary : "transparent",
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={{
                color: activeTab === "assets" ? theme.primaryTextOnButton : theme.textSecondary,
                fontWeight: "700",
                fontSize: 12,
                includeFontPadding: false,
              }}
            >
              Data Aset ({assetsList.length})
            </Text>
          </AnimatedPressable>

          <AnimatedPressable
            onPress={() => setActiveTab("users")}
            scaleTo={0.98}
            style={{
              flex: 1,
              height: "100%",
              justifyContent: "center",
              alignItems: "center",
              borderRadius: 12,
              backgroundColor: activeTab === "users" ? theme.primary : "transparent",
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={{
                color: activeTab === "users" ? theme.primaryTextOnButton : theme.textSecondary,
                fontWeight: "700",
                fontSize: 12,
                includeFontPadding: false,
              }}
            >
              User ({usersList.length})
            </Text>
          </AnimatedPressable>
        </View>
      </View>

      {/* Main Tab Content */}
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
        {/* TAB 1: PERSATUAN / APPROVAL WORKFLOW */}
        {activeTab === "approval" && (
          <View style={{ flex: 1 }}>
            {/* SUB-TAB SELECTOR */}
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
              <AnimatedPressable
                onPress={() => setApprovalSubTab("pending")}
                style={{
                  flex: 1,
                  backgroundColor: approvalSubTab === "pending"
                    ? (theme.isDark ? "rgba(245, 158, 11, 0.2)" : "#FEF3C7")
                    : (theme.isDark ? "rgba(255, 255, 255, 0.05)" : "#F1F5F9"),
                  borderColor: approvalSubTab === "pending" ? "#F59E0B" : theme.cardBorder,
                  borderWidth: 1.5,
                  paddingVertical: 10,
                  borderRadius: 14,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <Ionicons name="time-outline" size={16} color={approvalSubTab === "pending" ? "#F59E0B" : theme.textSecondary} />
                <Text style={{ fontSize: 13, fontWeight: "800", color: approvalSubTab === "pending" ? "#F59E0B" : theme.textSecondary }}>
                  Menunggu ({groupedPendingApprovals.length})
                </Text>
              </AnimatedPressable>

              <AnimatedPressable
                onPress={() => setApprovalSubTab("approved")}
                style={{
                  flex: 1,
                  backgroundColor: approvalSubTab === "approved"
                    ? (theme.isDark ? "rgba(34, 197, 94, 0.2)" : "#DCFCE7")
                    : (theme.isDark ? "rgba(255, 255, 255, 0.05)" : "#F1F5F9"),
                  borderColor: approvalSubTab === "approved" ? "#22C55E" : theme.cardBorder,
                  borderWidth: 1.5,
                  paddingVertical: 10,
                  borderRadius: 14,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <Ionicons name="checkmark-circle-outline" size={16} color={approvalSubTab === "approved" ? "#22C55E" : theme.textSecondary} />
                <Text style={{ fontSize: 13, fontWeight: "800", color: approvalSubTab === "approved" ? "#22C55E" : theme.textSecondary }}>
                  Sudah Disetujui ({groupedApprovedApprovals.length})
                </Text>
              </AnimatedPressable>
            </View>

            {loadingApprovals ? (
              <View style={{ gap: 8 }}>
                <SkeletonCard />
                <SkeletonCard />
              </View>
            ) : (
              <FlatList
                data={approvalSubTab === "pending" ? groupedPendingApprovals : groupedApprovedApprovals}
                keyExtractor={(group) => group.id}
                removeClippedSubviews={true}
                maxToRenderPerBatch={5}
                initialNumToRender={5}
                windowSize={3}
                refreshControl={<RefreshControl refreshing={false} onRefresh={fetchApprovals} tintColor={theme.primary} />}
                contentContainerStyle={{ paddingBottom: 32, gap: 12 }}
                ListEmptyComponent={
                  <View
                    style={{
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.cardBorder,
                      borderWidth: 1,
                      borderRadius: 20,
                      padding: 32,
                      alignItems: "center",
                      marginTop: 8,
                    }}
                  >
                    <Text style={{ fontSize: 36, marginBottom: 12 }}>
                      {approvalSubTab === "pending" ? "✨" : "📱"}
                    </Text>
                    <Text style={{ color: theme.textPrimary, fontWeight: "700", fontSize: 16, textAlign: "center" }}>
                      {approvalSubTab === "pending"
                        ? "Semua Pengajuan Selesai"
                        : "Belum Ada Peminjaman Disetujui"}
                    </Text>
                    <Text style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4, fontSize: 13 }}>
                      {approvalSubTab === "pending"
                        ? "Tidak ada pengajuan peminjaman yang menunggu persetujuan saat ini."
                        : "Pengajuan yang disetujui akan muncul di sini dan siap di-scan fisiknya."}
                    </Text>
                  </View>
                }
                renderItem={({ item: group }) => {
                  const isApprovedTab = approvalSubTab === "approved";
                  return (
                    <View
                      style={{
                        backgroundColor: theme.cardBackground,
                        borderColor: isApprovedTab ? "#22C55E" : theme.cardBorder,
                        borderWidth: 1,
                        borderRadius: 20,
                        padding: 16,
                        shadowColor: theme.shadowColor,
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.1,
                        shadowRadius: 8,
                        elevation: 3,
                        gap: 12,
                      }}
                    >
                      {/* Card Top Row */}
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Ionicons
                            name={group.isBatch ? "layers-outline" : "radio-outline"}
                            size={20}
                            color={isApprovedTab ? "#22C55E" : theme.primary}
                          />
                          <Text style={{ color: theme.textPrimary, fontWeight: "800", fontSize: 15 }}>
                            {group.isBatch ? `Permohonan Batch (${group.items.length} HT)` : (group.mainTx.asset?.name ?? "Unit HT")}
                          </Text>
                        </View>
                        <View
                          style={{
                            backgroundColor: isApprovedTab
                              ? "rgba(34, 197, 94, 0.18)"
                              : (group.isBatch ? "rgba(2, 132, 199, 0.18)" : "rgba(245, 158, 11, 0.18)"),
                            borderColor: isApprovedTab
                              ? "#22C55E"
                              : (group.isBatch ? "rgba(56, 189, 248, 0.4)" : "rgba(245, 158, 11, 0.4)"),
                            borderWidth: 1,
                            paddingHorizontal: 9,
                            paddingVertical: 3,
                            borderRadius: 999,
                          }}
                        >
                          <Text
                            style={{
                              color: isApprovedTab ? "#22C55E" : (group.isBatch ? theme.primary : "#F59E0B"),
                              fontWeight: "800",
                              fontSize: 10.5,
                            }}
                          >
                            {isApprovedTab ? "DISETUJUI (SIAP SCAN)" : (group.isBatch ? group.batch_code : "MENUNGGU")}
                          </Text>
                        </View>
                      </View>

                      {/* Borrower Details */}
                      <View
                        style={{
                          backgroundColor: theme.isDark ? "rgba(15, 23, 42, 0.6)" : "#F8FAFC",
                          borderRadius: 14,
                          padding: 12,
                          gap: 4,
                        }}
                      >
                        <Text style={{ color: theme.textPrimary, fontSize: 13, fontWeight: "700" }}>
                          Pemohon: {group.mainTx.borrower_name ?? "Petugas"}
                        </Text>
                        <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                          NRP: {group.mainTx.borrower_nrp ?? "-"} • Kesatuan: {group.mainTx.kesatuan ?? "-"}
                        </Text>

                        {/* Preview list if batch */}
                        {group.isBatch ? (
                          <View style={{ marginTop: 6, gap: 3 }}>
                            <Text style={{ fontSize: 11, fontWeight: "700", color: theme.primary, textTransform: "uppercase" }}>
                              Daftar Unit Dalam Paket ({group.items.length} Unit):
                            </Text>
                            {group.items.map((it: Transaction, idx: number) => {
                              const isBorrowed = (it.asset?.status || "").toLowerCase() === "dipinjam";
                              return (
                                <View key={`${it.id}-${idx}`} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                                  <Text numberOfLines={1} style={{ fontSize: 11.5, color: theme.textSecondary, flex: 1 }}>
                                    • {it.asset?.name || "HT"} (Kode: {it.asset?.code || "-"})
                                  </Text>
                                  {isApprovedTab && (
                                    <Text style={{ fontSize: 10, fontWeight: "800", color: isBorrowed ? "#22C55E" : "#F59E0B" }}>
                                      {isBorrowed ? "✓ DIPINJAM" : "📷 SIAP SCAN"}
                                    </Text>
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        ) : (
                          <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 2 }}>
                            SN: {group.mainTx.asset?.serial_number ?? "-"} • Kode: {group.mainTx.asset?.code ?? "-"}
                          </Text>
                        )}
                      </View>

                      {/* Action Bar */}
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        <AnimatedPressable
                          onPress={() => setSelectedBatchModalGroup(group)}
                          style={{
                            flex: 1,
                            backgroundColor: theme.isDark ? "rgba(56, 189, 248, 0.15)" : "rgba(2, 132, 199, 0.1)",
                            borderColor: theme.primary,
                            borderWidth: 1,
                            paddingVertical: 10,
                            paddingHorizontal: 12,
                            borderRadius: 12,
                            alignItems: "center",
                            justifyContent: "center",
                            flexDirection: "row",
                            gap: 6,
                          }}
                        >
                          <Ionicons name="eye-outline" size={16} color={theme.primary} />
                          <Text style={{ color: theme.primary, fontWeight: "800", fontSize: 12.5 }}>
                            Detail & Status Scan ({group.items.length} HT)
                          </Text>
                        </AnimatedPressable>

                        {isApprovedTab ? (
                          <AnimatedPressable
                            onPress={() => router.push(`/loan-qr/${group.batch_id || group.mainTx.id}`)}
                            style={{
                              flex: 1.2,
                              backgroundColor: "#22C55E",
                              paddingVertical: 10,
                              paddingHorizontal: 12,
                              borderRadius: 12,
                              alignItems: "center",
                              justifyContent: "center",
                              flexDirection: "row",
                              gap: 6,
                            }}
                          >
                            <Ionicons name="qr-code" size={16} color="#FFFFFF" />
                            <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 12.5 }}>
                              📷 QR Code & Serah Terima
                            </Text>
                          </AnimatedPressable>
                        ) : (
                          <>
                            <AnimatedPressable
                              onPress={() => {
                                setSelectedRejectGroup(group);
                                setRejectReason("");
                              }}
                              disabled={processingTxId === group.id}
                              style={{
                                flex: 1,
                                backgroundColor: "#EF4444",
                                paddingVertical: 11,
                                borderRadius: 12,
                                alignItems: "center",
                                justifyContent: "center",
                                flexDirection: "row",
                                gap: 4,
                              }}
                            >
                              <Ionicons name="close-circle" size={16} color="#FFFFFF" />
                              <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 13 }}>
                                Tolak
                              </Text>
                            </AnimatedPressable>

                            <AnimatedPressable
                              onPress={() => setSelectedApproveGroup(group)}
                              disabled={processingTxId === group.id}
                              style={{
                                flex: 1.4,
                                backgroundColor: "#22C55E",
                                paddingVertical: 11,
                                borderRadius: 12,
                                alignItems: "center",
                                justifyContent: "center",
                                flexDirection: "row",
                                gap: 4,
                              }}
                            >
                              {processingTxId === group.id ? (
                                <ActivityIndicator color="#FFFFFF" size="small" />
                              ) : (
                                <>
                                  <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" />
                                  <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 13 }}>
                                    {group.isBatch ? `Setujui (${group.items.length})` : "Setujui"}
                                  </Text>
                                </>
                              )}
                            </AnimatedPressable>
                          </>
                        )}
                      </View>
                    </View>
                  );
                }}
              />
            )}
          </View>
        )}

        {/* TAB 2: DATA ASET (MASTER CRUD) */}
        {activeTab === "assets" && (
          loadingAssets ? (
            <View style={{ gap: 8 }}>
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <FlatList
                data={assetsList}
                keyExtractor={(item) => item.id}
                removeClippedSubviews={true}
                maxToRenderPerBatch={5}
                initialNumToRender={5}
                windowSize={3}
                refreshControl={<RefreshControl refreshing={false} onRefresh={fetchAssets} tintColor={theme.primary} />}
                contentContainerStyle={{ paddingBottom: 90, gap: 10 }}
                renderItem={({ item }) => (
                  <View
                    style={{
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.cardBorder,
                      borderWidth: 1,
                      borderRadius: 18,
                      padding: 14,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      shadowColor: theme.shadowColor,
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.1,
                      shadowRadius: 6,
                      elevation: 2,
                    }}
                  >
                    {/* Item Details */}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: theme.textPrimary, fontWeight: "800", fontSize: 15 }}>
                        {item.name}
                      </Text>
                      <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                        Kode: {item.code} • SN: {item.serial_number}
                      </Text>
                      <View style={{ marginTop: 4 }}>
                        <StatusBadge status={item.status} />
                      </View>
                    </View>

                    {/* QR Code Action Button */}
                    <AnimatedPressable
                      onPress={() => setQrModalAsset(item)}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        backgroundColor: theme.isDark ? "rgba(56, 189, 248, 0.18)" : "rgba(2, 132, 199, 0.12)",
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      <Ionicons name="qr-code-outline" size={18} color={theme.primary} />
                    </AnimatedPressable>

                    {/* Edit Asset Button */}
                    <AnimatedPressable
                      onPress={() => openAssetForm(item)}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        backgroundColor: theme.isDark ? "rgba(255, 255, 255, 0.08)" : "#F1F5F9",
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      <Ionicons name="create-outline" size={18} color={theme.textPrimary} />
                    </AnimatedPressable>

                    {/* Override Status Button */}
                    <AnimatedPressable
                      onPress={() => {
                        setOverrideAsset(item);
                        setOverrideStatus(item.status);
                        setOverrideReason("");
                      }}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        backgroundColor: theme.isDark ? "rgba(245, 158, 11, 0.18)" : "#FEF3C7",
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      <Ionicons name="options-outline" size={18} color="#D97706" />
                    </AnimatedPressable>
                  </View>
                )}
              />

              {/* Floating Add Asset Button (+ FAB) */}
              <AnimatedPressable
                onPress={() => openAssetForm()}
                style={{
                  position: "absolute",
                  bottom: 24,
                  right: 16,
                  backgroundColor: theme.primary,
                  paddingVertical: 14,
                  paddingHorizontal: 20,
                  borderRadius: 999,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.25,
                  shadowRadius: 10,
                  elevation: 6,
                }}
              >
                <Ionicons name="add" size={22} color={theme.primaryTextOnButton} />
                <Text style={{ color: theme.primaryTextOnButton, fontWeight: "800", fontSize: 14 }}>
                  Tambah Aset
                </Text>
              </AnimatedPressable>
            </View>
          )
        )}

        {/* TAB 3: USER MONITORING */}
        {activeTab === "users" && (
          loadingUsers ? (
            <View style={{ gap: 8 }}>
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : (
            <FlatList
              data={usersList}
              keyExtractor={(item) => item.id}
              removeClippedSubviews={true}
              maxToRenderPerBatch={5}
              initialNumToRender={5}
              windowSize={3}
              refreshControl={<RefreshControl refreshing={false} onRefresh={fetchUsers} tintColor={theme.primary} />}
              contentContainerStyle={{ paddingBottom: 32, gap: 10 }}
              renderItem={({ item }) => (
                <View
                  style={{
                    backgroundColor: theme.cardBackground,
                    borderColor: theme.cardBorder,
                    borderWidth: 1,
                    borderRadius: 18,
                    padding: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    shadowColor: theme.shadowColor,
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.1,
                    shadowRadius: 6,
                    elevation: 2,
                  }}
                >
                  <Avatar
                    name={item.full_name}
                    avatarUrl={item.avatar_url}
                    size={44}
                    onPress={() =>
                      setPhotoViewerState({
                        visible: true,
                        photoUrl: item.avatar_url,
                        name: item.full_name,
                        nrp: item.nrp,
                        role: item.role,
                      })
                    }
                  />

                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ color: theme.textPrimary, fontWeight: "800", fontSize: 15 }}>
                        {item.full_name}
                      </Text>
                      <View
                        style={{
                          backgroundColor: item.role === "admin" ? "rgba(16, 185, 129, 0.18)" : "rgba(2, 132, 199, 0.12)",
                          borderColor: item.role === "admin" ? "#34D399" : theme.primary,
                          borderWidth: 1,
                          paddingHorizontal: 6,
                          height: 18,
                          borderRadius: 999,
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <Text style={{ color: item.role === "admin" ? "#059669" : theme.primary, fontWeight: "700", fontSize: 10 }}>
                          {item.role.toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                      NRP: {item.nrp ?? "Tidak terdaftar"}
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                      Aktivitas: {item.txCount ?? 0} Transaksi Peminjaman/Pengembalian
                    </Text>
                  </View>

                  {/* Toggle Role Button (Admin <-> Petugas) */}
                  <AnimatedPressable
                    onPress={async () => {
                      const newRole = item.role === "admin" ? "petugas" : "admin";
                      const { error } = await supabase.rpc("admin_update_user_role", {
                        p_target_user_id: item.id,
                        p_new_role: newRole,
                      });

                      if (error) {
                        setToastConfig({
                          visible: true,
                          title: "Gagal Mengubah Role",
                          message: getFriendlyErrorMessage(error, "Gagal mengubah role user."),
                          icon: "❌",
                          isDanger: true,
                        });
                      } else {
                        setToastConfig({
                          visible: true,
                          title: "Role Diperbarui",
                          message: `Role ${item.full_name} diubah menjadi ${newRole.toUpperCase()}.`,
                          icon: "✅",
                        });
                        fetchUsers();
                      }
                    }}
                    style={{
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderRadius: 10,
                      backgroundColor: item.role === "admin" ? "rgba(239, 68, 68, 0.15)" : "rgba(16, 185, 129, 0.15)",
                      borderColor: item.role === "admin" ? "rgba(248, 113, 113, 0.3)" : "rgba(52, 211, 153, 0.3)",
                      borderWidth: 1,
                    }}
                  >
                    <Text
                      style={{
                        color: item.role === "admin" ? "#F87171" : "#10B981",
                        fontSize: 11,
                        fontWeight: "700",
                        includeFontPadding: false,
                      }}
                    >
                      {item.role === "admin" ? "Jadikan Petugas" : "Jadikan Admin"}
                    </Text>
                  </AnimatedPressable>
                </View>
              )}
            />
          )
        )}
      </View>

      {/* MODAL 1: Confirm Approve Bottom Sheet */}
      {selectedApproveGroup && (
        <AppBottomSheet
          visible={!!selectedApproveGroup}
          onClose={() => setSelectedApproveGroup(null)}
          title={selectedApproveGroup.isBatch ? "Konfirmasi Persetujuan Batch" : "Konfirmasi Persetujuan"}
          message={
            selectedApproveGroup.isBatch
              ? `Apakah Anda yakin ingin menyetujui SELURUH permohonan peminjaman batch (${selectedApproveGroup.items.length} unit HT) untuk ${selectedApproveGroup.mainTx.borrower_name}?`
              : `Apakah Anda yakin ingin menyetujui peminjaman unit ${selectedApproveGroup.mainTx.asset?.name} untuk ${selectedApproveGroup.mainTx.borrower_name}?`
          }
          icon="✅"
          confirmText={selectedApproveGroup.isBatch ? `Setujui Batch (${selectedApproveGroup.items.length} HT)` : "Ya, Setujui"}
          cancelText="Batal"
          onConfirm={() => handleApproveGroup(selectedApproveGroup)}
        />
      )}

      {/* MODAL 2: Reject Reason Input Modal */}
      {selectedRejectGroup && (
        <Modal visible={!!selectedRejectGroup} transparent animationType="fade">
          <View style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.6)", justifyContent: "center", padding: 20 }}>
            <View
              style={{
                backgroundColor: theme.cardBackground,
                borderColor: theme.cardBorder,
                borderWidth: 1,
                borderRadius: 24,
                padding: 24,
                gap: 14,
              }}
            >
              <Text style={{ color: theme.textPrimary, fontWeight: "800", fontSize: 18, textAlign: "center" }}>
                {selectedRejectGroup.isBatch ? "Tolak Permohonan Batch" : "Tolak Pengajuan Peminjaman"}
              </Text>
              <Text style={{ color: theme.textSecondary, fontSize: 13, textAlign: "center" }}>
                {selectedRejectGroup.isBatch
                  ? `Paket: #${selectedRejectGroup.batch_code} (${selectedRejectGroup.items.length} Unit HT) • Pemohon: ${selectedRejectGroup.mainTx.borrower_name}`
                  : `Unit: ${selectedRejectGroup.mainTx.asset?.name} • Peminjam: ${selectedRejectGroup.mainTx.borrower_name}`}
              </Text>

              <View style={{ marginTop: 6 }}>
                <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>
                  Alasan Penolakan (Opsional):
                </Text>
                <TextInput
                  placeholder="Contoh: Unit sedang dijadwalkan pemeliharaan berkala"
                  placeholderTextColor={theme.inputPlaceholder}
                  value={rejectReason}
                  onChangeText={setRejectReason}
                  multiline
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 14,
                    padding: 12,
                    color: theme.inputText,
                    fontSize: 14,
                    minHeight: 70,
                    textAlignVertical: "top",
                  }}
                />
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                <AnimatedPressable
                  onPress={() => setSelectedRejectGroup(null)}
                  style={{
                    flex: 1,
                    backgroundColor: theme.isDark ? "rgba(255, 255, 255, 0.08)" : "#F1F5F9",
                    paddingVertical: 14,
                    borderRadius: 12,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: theme.textSecondary, fontWeight: "700", fontSize: 14 }}>Batal</Text>
                </AnimatedPressable>

                <AnimatedPressable
                  onPress={handleRejectGroup}
                  disabled={!!processingTxId}
                  style={{
                    flex: 1,
                    backgroundColor: "#EF4444",
                    paddingVertical: 14,
                    borderRadius: 12,
                    alignItems: "center",
                  }}
                >
                  {processingTxId === selectedRejectGroup.id ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>Konfirmasi Tolak</Text>
                  )}
                </AnimatedPressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* MODAL 3: BATCH DETAILS POPUP MODAL */}
      {selectedBatchModalGroup && (
        <Modal
          visible={!!selectedBatchModalGroup}
          transparent
          animationType="slide"
          onRequestClose={() => setSelectedBatchModalGroup(null)}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" }}>
            <View
              style={{
                backgroundColor: theme.cardBackground,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                padding: 22,
                maxHeight: "85%",
                borderColor: theme.cardBorder,
                borderTopWidth: 1,
              }}
            >
              {/* Header */}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <View>
                  <Text style={{ fontSize: 18, fontWeight: "800", color: theme.textPrimary }}>
                    Detail Peminjaman Batch ({selectedBatchModalGroup.items.length} HT)
                  </Text>
                  <Text style={{ fontSize: 11.5, color: theme.primary, fontWeight: "700", marginTop: 2 }}>
                    REF: #{selectedBatchModalGroup.batch_code}
                  </Text>
                </View>

                <AnimatedPressable
                  onPress={() => setSelectedBatchModalGroup(null)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F1F5F9",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Ionicons name="close" size={20} color={theme.textPrimary} />
                </AnimatedPressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
                {/* Borrower Information Card */}
                <View
                  style={{
                    backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC",
                    borderRadius: 16,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: theme.cardBorder,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Avatar name={selectedBatchModalGroup.mainTx.borrower_name || "Petugas"} size={42} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: "800", color: theme.textPrimary }}>
                        {selectedBatchModalGroup.mainTx.borrower_name || "Petugas"}
                      </Text>
                      <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 1 }}>
                        NRP: {selectedBatchModalGroup.mainTx.borrower_nrp || "-"} • Kesatuan: {selectedBatchModalGroup.mainTx.kesatuan || "-"}
                      </Text>
                    </View>
                  </View>

                  {selectedBatchModalGroup.mainTx.notes && (
                    <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.cardBorder }}>
                      <Text style={{ fontSize: 10.5, fontWeight: "700", color: theme.textMuted, textTransform: "uppercase" }}>
                        Keperluan / Catatan Giat:
                      </Text>
                      <Text style={{ fontSize: 12.5, color: theme.textPrimary, fontStyle: "italic", marginTop: 2 }}>
                        "{selectedBatchModalGroup.mainTx.notes}"
                      </Text>
                    </View>
                  )}
                </View>

                {/* Units List */}
                <View style={{ gap: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary, textTransform: "uppercase" }}>
                    Daftar Unit HT Dalam Paket ({selectedBatchModalGroup.items.length} Unit):
                  </Text>

                  <View style={{ gap: 8 }}>
                    {selectedBatchModalGroup.items.map((it, idx) => (
                      <View
                        key={`${it.id}-${idx}`}
                        style={{
                          backgroundColor: isDark ? "rgba(15, 23, 42, 0.6)" : "#FFFFFF",
                          borderRadius: 12,
                          padding: 10,
                          borderWidth: 1,
                          borderColor: theme.cardBorder,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                          <View
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 12,
                              backgroundColor: theme.primary,
                              justifyContent: "center",
                              alignItems: "center",
                            }}
                          >
                            <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "800" }}>
                              {idx + 1}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: "700", color: theme.textPrimary }}>
                              {it.asset?.name || "Unit HT"}
                            </Text>
                            <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textSecondary }}>
                              Kode: {it.asset?.code || "-"} • SN: {it.asset?.serial_number || "-"}
                            </Text>
                          </View>
                        </View>

                        <StatusBadge status={it.asset?.status || "tersedia"} />
                      </View>
                    ))}
                  </View>
                </View>
              </ScrollView>

              {/* Action Buttons in Modal */}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.cardBorder }}>
                <AnimatedPressable
                  onPress={() => {
                    setSelectedRejectGroup(selectedBatchModalGroup);
                    setRejectReason("");
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: "#EF4444",
                    paddingVertical: 12,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 13.5 }}>
                    Tolak Batch
                  </Text>
                </AnimatedPressable>

                <AnimatedPressable
                  onPress={() => handleApproveGroup(selectedBatchModalGroup)}
                  disabled={!!processingTxId}
                  style={{
                    flex: 1.6,
                    backgroundColor: "#22C55E",
                    paddingVertical: 12,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {processingTxId === selectedBatchModalGroup.id ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 13.5 }}>
                      Setujui Batch ({selectedBatchModalGroup.items.length} HT)
                    </Text>
                  )}
                </AnimatedPressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* MODAL 3: Form Add / Edit Master Asset */}
      {assetModalVisible && (
        <Modal visible={assetModalVisible} transparent animationType="slide">
          <View style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.6)", justifyContent: "flex-end" }}>
            <View
              style={{
                backgroundColor: theme.cardBackground,
                borderColor: theme.cardBorder,
                borderWidth: 1,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                padding: 24,
                gap: 14,
              }}
            >
              <Text style={{ color: theme.textPrimary, fontWeight: "800", fontSize: 18, textAlign: "center" }}>
                {editingAsset ? "Edit Data Master Aset" : "Tambah Unit Aset HT Baru"}
              </Text>

              <View>
                <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>
                  Kode QR Payload Aset:
                </Text>
                <TextInput
                  value={assetCode}
                  onChangeText={setAssetCode}
                  placeholder="Contoh: HT-001"
                  placeholderTextColor={theme.inputPlaceholder}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    padding: 12,
                    color: theme.inputText,
                    fontSize: 14,
                  }}
                />
              </View>

              <View>
                <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>
                  Nama Unit Aset:
                </Text>
                <TextInput
                  value={assetName}
                  onChangeText={setAssetName}
                  placeholder="Contoh: Motorola XiR P8668i - Unit 01"
                  placeholderTextColor={theme.inputPlaceholder}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    padding: 12,
                    color: theme.inputText,
                    fontSize: 14,
                  }}
                />
              </View>

              <View>
                <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>
                  Serial Number (SN):
                </Text>
                <TextInput
                  value={assetSN}
                  onChangeText={setAssetSN}
                  placeholder="Contoh: SN-88392019"
                  placeholderTextColor={theme.inputPlaceholder}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    padding: 12,
                    color: theme.inputText,
                    fontSize: 14,
                  }}
                />
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                <AnimatedPressable
                  onPress={() => setAssetModalVisible(false)}
                  style={{
                    flex: 1,
                    backgroundColor: theme.isDark ? "rgba(255, 255, 255, 0.08)" : "#F1F5F9",
                    paddingVertical: 14,
                    borderRadius: 12,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: theme.textSecondary, fontWeight: "700", fontSize: 14 }}>Batal</Text>
                </AnimatedPressable>

                <AnimatedPressable
                  onPress={handleSaveAsset}
                  disabled={assetSubmitting}
                  style={{
                    flex: 1,
                    backgroundColor: theme.primary,
                    paddingVertical: 14,
                    borderRadius: 12,
                    alignItems: "center",
                  }}
                >
                  {assetSubmitting ? (
                    <ActivityIndicator color={theme.primaryTextOnButton} />
                  ) : (
                    <Text style={{ color: theme.primaryTextOnButton, fontWeight: "700", fontSize: 14 }}>
                      Simpan Aset
                    </Text>
                  )}
                </AnimatedPressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* MODAL 4: QR Code Preview Modal */}
      {qrModalAsset && (
        <Modal visible={!!qrModalAsset} transparent animationType="fade">
          <View style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.75)", justifyContent: "center", padding: 24 }}>
            <View
              style={{
                backgroundColor: theme.cardBackground,
                borderColor: theme.cardBorder,
                borderWidth: 1,
                borderRadius: 24,
                padding: 24,
                alignItems: "center",
                gap: 14,
              }}
            >
              <Text style={{ color: theme.textPrimary, fontWeight: "800", fontSize: 18, textAlign: "center" }}>
                Stiker QR Code Unit
              </Text>
              <Text style={{ color: theme.textSecondary, fontSize: 13, textAlign: "center" }}>
                {qrModalAsset.name} ({qrModalAsset.code})
              </Text>

              <View
                style={{
                  backgroundColor: "#FFFFFF",
                  padding: 16,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "#CBD5E1",
                }}
              >
                <Image
                  source={{
                    uri: qrModalAsset.qr_code_url || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${qrModalAsset.code}`,
                  }}
                  style={{ width: 180, height: 180 }}
                />
              </View>

              <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: "center" }}>
                Pindai stiker ini menggunakan kamera Scanner di aplikasi Mobile
              </Text>

              <AnimatedPressable
                onPress={() => setQrModalAsset(null)}
                style={{
                  backgroundColor: theme.primary,
                  paddingVertical: 12,
                  paddingHorizontal: 24,
                  borderRadius: 12,
                  width: "100%",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: theme.primaryTextOnButton, fontWeight: "700", fontSize: 14 }}>
                  Tutup QR Code
                </Text>
              </AnimatedPressable>
            </View>
          </View>
        </Modal>
      )}

      {/* MODAL 5: Status Override Modal */}
      {overrideAsset && (
        <Modal visible={!!overrideAsset} transparent animationType="fade">
          <View style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.6)", justifyContent: "center", padding: 20 }}>
            <View
              style={{
                backgroundColor: theme.cardBackground,
                borderColor: theme.cardBorder,
                borderWidth: 1,
                borderRadius: 24,
                padding: 24,
                gap: 14,
              }}
            >
              <Text style={{ color: theme.textPrimary, fontWeight: "800", fontSize: 18, textAlign: "center" }}>
                Override Status Manual Admin
              </Text>
              <Text style={{ color: theme.textSecondary, fontSize: 13, textAlign: "center" }}>
                Unit: {overrideAsset.name} ({overrideAsset.code})
              </Text>

              {/* Status Picker Buttons */}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                {(["tersedia", "dipinjam", "rusak"] as AssetStatus[]).map((s) => (
                  <AnimatedPressable
                    key={s}
                    onPress={() => setOverrideStatus(s)}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 10,
                      borderWidth: 1.5,
                      borderColor: overrideStatus === s ? theme.primary : theme.cardBorder,
                      backgroundColor: overrideStatus === s ? theme.primary : "transparent",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: overrideStatus === s ? theme.primaryTextOnButton : theme.textSecondary,
                        fontWeight: "700",
                        fontSize: 12,
                      }}
                    >
                      {s.toUpperCase()}
                    </Text>
                  </AnimatedPressable>
                ))}
              </View>

              <View>
                <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>
                  Alasan Perubahan Status:
                </Text>
                <TextInput
                  placeholder="Contoh: Unit Selesai Perbaikan Rutin"
                  placeholderTextColor={theme.inputPlaceholder}
                  value={overrideReason}
                  onChangeText={setOverrideReason}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    padding: 12,
                    color: theme.inputText,
                    fontSize: 14,
                  }}
                />
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                <AnimatedPressable
                  onPress={() => setOverrideAsset(null)}
                  style={{
                    flex: 1,
                    backgroundColor: theme.isDark ? "rgba(255, 255, 255, 0.08)" : "#F1F5F9",
                    paddingVertical: 14,
                    borderRadius: 12,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: theme.textSecondary, fontWeight: "700", fontSize: 14 }}>Batal</Text>
                </AnimatedPressable>

                <AnimatedPressable
                  onPress={handleOverrideStatus}
                  style={{
                    flex: 1,
                    backgroundColor: theme.primary,
                    paddingVertical: 14,
                    borderRadius: 12,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: theme.primaryTextOnButton, fontWeight: "700", fontSize: 14 }}>
                    Simpan Override
                  </Text>
                </AnimatedPressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Loan Batch QR Code & Handover Modal */}
      <LoanBatchQRModal
        visible={!!loanQrGroup}
        group={loanQrGroup}
        onClose={() => setLoanQrGroup(null)}
        onRefresh={() => fetchApprovals()}
      />

      {/* Full Photo Viewer Modal for Personnel Inspection */}
      <ProfilePhotoModal
        visible={photoViewerState.visible}
        onClose={() => setPhotoViewerState((prev) => ({ ...prev, visible: false }))}
        photoUrl={photoViewerState.photoUrl}
        name={photoViewerState.name}
        nrp={photoViewerState.nrp}
        role={photoViewerState.role}
        isOwnProfile={false}
      />

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
          onConfirm={() => setToastConfig((prev) => ({ ...prev, visible: false }))}
        />
      )}
      </View>
    </LinearGradient>
  );
}
