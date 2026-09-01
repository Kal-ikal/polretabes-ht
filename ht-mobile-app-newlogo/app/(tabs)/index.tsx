import React, { useCallback, useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TextInput,
  Modal,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { SafeHaptics } from "@/lib/safeHaptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useAppTheme } from "@/context/ThemeContext";
import { getFriendlyErrorMessage } from "@/lib/errorHandler";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar } from "@/components/Avatar";
import { SkeletonCard } from "@/components/SkeletonCard";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppBottomSheet } from "@/components/AppBottomSheet";
import { ProfilePhotoModal } from "@/components/ProfilePhotoModal";
import { LoanBatchQRModal } from "@/components/LoanBatchQRModal";
import type { Transaction, Asset } from "@/types/database";

interface GroupedTxItem {
  id: string;
  isBatch: boolean;
  batch_id?: string | null;
  batch_code?: string | null;
  items: Transaction[];
  mainTx: Transaction;
}

function groupTransactionsByBatch(txList: Transaction[]): GroupedTxItem[] {
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

  const result: GroupedTxItem[] = [];

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

export default function HomeScreen() {
  const { profile, refreshProfile } = useAuth();
  const { theme, isDark } = useAppTheme();
  const router = useRouter();

  const isAdmin = profile?.role === "admin";

  // Common State
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Admin Specific State (Pending & Approved Approvals State for Admin)
  const [pendingApprovals, setPendingApprovals] = useState<Transaction[]>([]);
  const [approvedApprovals, setApprovedApprovals] = useState<Transaction[]>([]);
  const [adminSubTab, setAdminSubTab] = useState<"pending" | "approved">("pending");

  // Assets Summary State
  const [totalAssetsCount, setTotalAssetsCount] = useState(0);
  const [borrowedAssetsCount, setBorrowedAssetsCount] = useState(0);
  const [availableAssetsCount, setAvailableAssetsCount] = useState(0);
  const [damagedAssetsCount, setDamagedAssetsCount] = useState(0);

  // Admin Action Modals
  const [confirmApproveTx, setConfirmApproveTx] = useState<Transaction | null>(null);
  const [rejectModalTx, setRejectModalTx] = useState<Transaction | null>(null);
  const [qrModalGroup, setQrModalGroup] = useState<GroupedTxItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionProcessing, setActionProcessing] = useState(false);

  // Petugas Specific State
  const [activeLoans, setActiveLoans] = useState<Transaction[]>([]);
  const [myPendingLoans, setMyPendingLoans] = useState<Transaction[]>([]);
  const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
  const [viewTab, setViewTab] = useState<"active" | "pending" | "available">("active");

  // Toast / Feedback Modal
  const [toastConfig, setToastConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon: string;
    isDanger?: boolean;
  }>({ visible: false, title: "", message: "", icon: "✅" });

  // Photo viewer modal state
  const [photoModalVisible, setPhotoModalVisible] = useState(false);

  // Floating Action Animation for Petugas
  const fabScale = useSharedValue(1);
  useEffect(() => {
    if (!isAdmin) {
      fabScale.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.0, { duration: 1100, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    }
  }, [isAdmin]);

  const fabAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fabScale.value }],
  }));

  // Fetch Data Function
  const loadData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);

    if (isAdmin) {
      // 1. Fetch Pending & Approved Approvals for Admin
      const [pendingRes, approvedRes] = await Promise.all([
        supabase
          .from("transactions")
          .select("*, asset:assets(*), reviewer:profiles!transactions_reviewed_by_fkey(*)")
          .eq("status", "PENDING")
          .order("created_at", { ascending: false }),
        supabase
          .from("transactions")
          .select("*, asset:assets(*), reviewer:profiles!transactions_reviewed_by_fkey(*)")
          .eq("action", "BORROW")
          .eq("status", "APPROVED")
          .order("created_at", { ascending: false })
          .limit(40),
      ]);

      setPendingApprovals((pendingRes.data as Transaction[]) ?? []);
      setApprovedApprovals((approvedRes.data as Transaction[]) ?? []);

      // 2. Fetch Assets Summary & Pending Transactions
      const { data: allAssets } = await supabase.from("assets").select("id, status");
      const { data: pendingTxs } = await supabase
        .from("transactions")
        .select("asset_id")
        .eq("action", "BORROW")
        .eq("status", "PENDING");

      const pendingAssetIds = new Set((pendingTxs || []).map((t) => t.asset_id));

      if (allAssets) {
        setTotalAssetsCount(allAssets.length);
        setAvailableAssetsCount(allAssets.filter((a) => a.status === "tersedia" && !pendingAssetIds.has(a.id)).length);
        setBorrowedAssetsCount(allAssets.filter((a) => a.status === "dipinjam").length);
        setDamagedAssetsCount(allAssets.filter((a) => a.status === "rusak").length);
      }
    } else {
      // 1. Fetch catalog for Petugas
      const { data: catalog } = await supabase
        .from("assets")
        .select("*")
        .order("name", { ascending: true });

      const { data: pendingTxs } = await supabase
        .from("transactions")
        .select("asset_id")
        .eq("action", "BORROW")
        .eq("status", "PENDING");

      const pendingAssetIds = new Set((pendingTxs || []).map((t) => t.asset_id));

      if (catalog) {
        setAvailableAssets((catalog as Asset[]).filter((a) => a.status === "tersedia" && !pendingAssetIds.has(a.id)));
      }

      // 2. Fetch my pending borrow requests
      const { data: pendingData } = await supabase
        .from("transactions")
        .select("*, asset:assets(*)")
        .eq("action", "BORROW")
        .eq("status", "PENDING")
        .order("created_at", { ascending: false });

      setMyPendingLoans((pendingData as Transaction[]) ?? []);

      // 3. Fetch active borrowed loans
      const { data: borrowedAssets } = await supabase
        .from("assets")
        .select("id")
        .eq("status", "dipinjam");

      if (borrowedAssets && borrowedAssets.length > 0) {
        const assetIds = borrowedAssets.map((a) => a.id);
        const { data: transData } = await supabase
          .from("transactions")
          .select("*, asset:assets(*)")
          .in("asset_id", assetIds)
          .eq("action", "BORROW")
          .eq("status", "APPROVED")
          .order("created_at", { ascending: false });

        const uniqueMap = new Map<string, Transaction>();
        if (transData) {
          for (const item of transData as Transaction[]) {
            if (
              item.asset &&
              (item.asset.status || "").toLowerCase() === "dipinjam" &&
              !uniqueMap.has(item.asset_id)
            ) {
              uniqueMap.set(item.asset_id, item);
            }
          }
        }
        setActiveLoans(Array.from(uniqueMap.values()));
      } else {
        setActiveLoans([]);
      }
    }

    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    loadData(true);

    const channelId = `home-events-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions" },
        () => loadData(false)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assets" },
        () => loadData(false)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      refreshProfile();
      loadData(false);
    }, [loadData, refreshProfile])
  );

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([refreshProfile(), loadData(false)]);
    setRefreshing(false);
  }

  // Admin Action: Approve Transaction
  const handleApprove = async () => {
    if (!confirmApproveTx) return;
    setActionProcessing(true);

    try {
      let error: any = null;
      if (confirmApproveTx.batch_id) {
        let cleanBatchId = confirmApproveTx.batch_id;
        if (cleanBatchId.startsWith("batch-")) {
          cleanBatchId = cleanBatchId.replace("batch-", "");
        }

        const res = await supabase.rpc("approve_batch_transaction", {
          p_batch_id: cleanBatchId,
        });
        error = res.error;

        const { data: batchTxs } = await supabase
          .from("transactions")
          .select("asset_id, action, condition")
          .eq("batch_id", cleanBatchId);

        if (batchTxs && batchTxs.length > 0) {
          const isBorrow = confirmApproveTx.action === "BORROW";
          const assetIds = batchTxs.map((t) => t.asset_id);
          await supabase
            .from("transactions")
            .update({ status: "APPROVED", reviewed_at: new Date().toISOString() })
            .eq("batch_id", cleanBatchId);
          await supabase
            .from("assets")
            .update({ status: isBorrow ? "tersedia" : "tersedia", updated_at: new Date().toISOString() })
            .in("id", assetIds);
        }
      } else {
        const res = await supabase.rpc("approve_transaction", {
          p_transaction_id: confirmApproveTx.id,
        });
        error = res.error;

        const isBorrow = confirmApproveTx.action === "BORROW";
        const isDamaged = (confirmApproveTx.condition || "").toLowerCase() === "rusak";
        const targetStatus = isBorrow ? "tersedia" : isDamaged ? "rusak" : "tersedia";

        await supabase
          .from("transactions")
          .update({ status: "APPROVED", reviewed_at: new Date().toISOString() })
          .eq("id", confirmApproveTx.id);
        await supabase
          .from("assets")
          .update({ status: targetStatus, updated_at: new Date().toISOString() })
          .eq("id", confirmApproveTx.asset_id);
      }

      setActionProcessing(false);

      if (error) {
        setToastConfig({
          visible: true,
          title: "Gagal Menyetujui",
          message: getFriendlyErrorMessage(error),
          icon: "❌",
          isDanger: true,
        });
      } else {
        try {
          SafeHaptics.notificationAsync();
        } catch {}
        setConfirmApproveTx(null);
        setToastConfig({
          visible: true,
          title: confirmApproveTx.action === "RETURN" ? "Pengembalian Disetujui" : "Peminjaman Disetujui (Siap Scan)",
          message: confirmApproveTx.batch_id
            ? `Seluruh permohonan HT dalam batch ${confirmApproveTx.batch_code || ""} telah disetujui. Unit siap diambil & discan fisik.`
            : confirmApproveTx.action === "RETURN"
            ? `Pengembalian unit ${confirmApproveTx.asset?.name || "HT"} (${confirmApproveTx.asset?.code || ""}) berhasil disetujui. Unit kembali berstatus 'TERSEDIA'.`
            : `Permohonan untuk ${confirmApproveTx.borrower_name || "Petugas"} telah disetujui. Unit kini SIAP SCAN untuk serah terima fisik.`,
          icon: "✅",
        });
        loadData(false);
      }
    } catch (err: any) {
      setActionProcessing(false);
      setToastConfig({
        visible: true,
        title: "Kesalahan Sistem",
        message: getFriendlyErrorMessage(err),
        icon: "❌",
        isDanger: true,
      });
    }
  };

  // Admin Action: Reject Transaction
  const handleReject = async () => {
    if (!rejectModalTx) return;
    setActionProcessing(true);

    try {
      let error: any = null;
      if (rejectModalTx.batch_id) {
        const res = await supabase.rpc("reject_batch_transaction", {
          p_batch_id: rejectModalTx.batch_id,
          p_reason: rejectReason.trim() || "Ditolak oleh admin",
        });
        error = res.error;
      } else {
        const res = await supabase.rpc("reject_transaction", {
          p_transaction_id: rejectModalTx.id,
          p_reason: rejectReason.trim() || "Ditolak oleh admin",
        });
        error = res.error;
      }

      setActionProcessing(false);

      if (error) {
        setToastConfig({
          visible: true,
          title: "Gagal Menolak",
          message: getFriendlyErrorMessage(error),
          icon: "❌",
          isDanger: true,
        });
      } else {
        try {
          SafeHaptics.notificationAsync();
        } catch {}
        setRejectModalTx(null);
        setRejectReason("");
        setToastConfig({
          visible: true,
          title: "Permohonan Ditolak",
          message: rejectModalTx.batch_id
            ? "Seluruh permohonan HT dalam batch ini telah ditolak."
            : "Permohonan peminjaman telah berhasil ditolak.",
          icon: "⚠️",
        });
        loadData(false);
      }
    } catch (err: any) {
      setActionProcessing(false);
      setToastConfig({
        visible: true,
        title: "Kesalahan",
        message: err.message || "Gagal menolak permohonan.",
        icon: "❌",
        isDanger: true,
      });
    }
  };

  // Filtered available assets by search
  const filteredAvailableAssets = availableAssets.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.serial_number.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedPendingApprovals = useMemo(
    () => groupTransactionsByBatch(pendingApprovals),
    [pendingApprovals]
  );

  const groupedApprovedApprovals = useMemo(
    () => groupTransactionsByBatch(approvedApprovals.filter((t) => (t.asset?.status || "").toLowerCase() === "tersedia")),
    [approvedApprovals]
  );

  const groupedMyPendingLoans = useMemo(
    () => groupTransactionsByBatch(myPendingLoans),
    [myPendingLoans]
  );

  // =========================================================================
  // RENDER 1: PURE ADMIN DASHBOARD (APPROVALS & OVERVIEW ONLY)
  // =========================================================================
  if (isAdmin) {
    return (
      <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          {/* Admin Header Stats */}
          <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 }}>
            {/* Top Greeting Header */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Avatar
                  name={profile?.full_name || "Admin"}
                  avatarUrl={profile?.avatar_url}
                  size={48}
                  onPress={() => setPhotoModalVisible(true)}
                />
                <View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 18, fontWeight: "800", color: theme.textPrimary }}>
                      {profile?.full_name || "Admin HT"}
                    </Text>
                    <View style={{ backgroundColor: "rgba(245,158,11,0.2)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                      <Text style={{ fontSize: 10, fontWeight: "800", color: "#F59E0B" }}>ADMIN</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 1 }}>
                    Panel Verifikasi & Persetujuan Peminjaman
                  </Text>
                </View>
              </View>

              <AnimatedPressable
                onPress={() => router.push("/(tabs)/assets")}
                style={{
                  backgroundColor: isDark ? "rgba(2, 132, 199, 0.2)" : "rgba(2, 132, 199, 0.1)",
                  borderColor: theme.primary,
                  borderWidth: 1,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Ionicons name="cube-outline" size={16} color={theme.primary} />
                <Text style={{ color: theme.primary, fontWeight: "700", fontSize: 12 }}>
                  Master HT
                </Text>
              </AnimatedPressable>
            </View>

            {/* Quick Stat Tiles - Interactive with High Contrast */}
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              {/* Pending Approvals */}
              <AnimatedPressable
                style={{
                  flex: 1.2,
                  backgroundColor: pendingApprovals.length > 0
                    ? isDark ? "rgba(239, 68, 68, 0.2)" : "#FEF2F2"
                    : (isDark ? theme.cardBg : "#FFFFFF"),
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderColor: pendingApprovals.length > 0 ? (isDark ? "#EF4444" : "#FECACA") : theme.cardBorder,
                  padding: 12,
                  justifyContent: "center",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <Ionicons
                    name="time"
                    size={16}
                    color={pendingApprovals.length > 0 ? (isDark ? "#F87171" : "#DC2626") : (isDark ? "#94A3B8" : "#475569")}
                  />
                  <Text style={{ fontSize: 11, fontWeight: "700", color: pendingApprovals.length > 0 ? (isDark ? "#F87171" : "#DC2626") : theme.textSecondary }}>
                    Menunggu
                  </Text>
                </View>
                <Text style={{ fontSize: 18, fontWeight: "800", color: pendingApprovals.length > 0 ? (isDark ? "#F87171" : "#DC2626") : theme.textPrimary }}>
                  {groupedPendingApprovals.length} Permohonan ({pendingApprovals.length} HT)
                </Text>
              </AnimatedPressable>

              {/* Ready / Available */}
              <AnimatedPressable
                onPress={() => router.push("/(tabs)/assets")}
                style={{
                  flex: 1,
                  backgroundColor: isDark ? "rgba(34, 197, 94, 0.12)" : "#F0FDF4",
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderColor: isDark ? "rgba(34, 197, 94, 0.3)" : "#BBF7D0",
                  padding: 12,
                  justifyContent: "center",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <Ionicons name="checkmark-circle" size={16} color={isDark ? "#4ADE80" : "#16A34A"} />
                  <Text style={{ fontSize: 11, fontWeight: "700", color: isDark ? "#4ADE80" : "#15803D" }}>
                    Tersedia
                  </Text>
                </View>
                <Text style={{ fontSize: 20, fontWeight: "800", color: isDark ? "#4ADE80" : "#15803D" }}>
                  {availableAssetsCount} Unit
                </Text>
              </AnimatedPressable>

              {/* In Loan / Dipinjam */}
              <AnimatedPressable
                onPress={() => router.push("/(tabs)/assets")}
                style={{
                  flex: 1,
                  backgroundColor: isDark ? "rgba(2, 132, 199, 0.12)" : "#F0F9FF",
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderColor: isDark ? "rgba(2, 132, 199, 0.3)" : "#BAE6FD",
                  padding: 12,
                  justifyContent: "center",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <Ionicons name="radio" size={16} color={isDark ? "#38BDF8" : "#0284C7"} />
                  <Text style={{ fontSize: 11, fontWeight: "700", color: isDark ? "#38BDF8" : "#0369A1" }}>
                    Dipinjam
                  </Text>
                </View>
                <Text style={{ fontSize: 20, fontWeight: "800", color: isDark ? "#38BDF8" : "#0369A1" }}>
                  {borrowedAssetsCount} Unit
                </Text>
              </AnimatedPressable>
            </View>
          </View>

          {/* Admin Sub-Tab Filter Bar */}
          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20, marginBottom: 14 }}>
            <AnimatedPressable
              onPress={() => setAdminSubTab("pending")}
              style={{
                flex: 1,
                backgroundColor: adminSubTab === "pending"
                  ? (isDark ? "rgba(245, 158, 11, 0.2)" : "#FEF3C7")
                  : (isDark ? "rgba(255, 255, 255, 0.05)" : "#F1F5F9"),
                borderColor: adminSubTab === "pending" ? "#F59E0B" : theme.cardBorder,
                borderWidth: 1.5,
                paddingVertical: 10,
                borderRadius: 14,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Ionicons name="time-outline" size={16} color={adminSubTab === "pending" ? "#F59E0B" : theme.textSecondary} />
              <Text style={{ fontSize: 13, fontWeight: "800", color: adminSubTab === "pending" ? "#F59E0B" : theme.textSecondary }}>
                Menunggu ({groupedPendingApprovals.length})
              </Text>
            </AnimatedPressable>

            <AnimatedPressable
              onPress={() => setAdminSubTab("approved")}
              style={{
                flex: 1,
                backgroundColor: adminSubTab === "approved"
                  ? (isDark ? "rgba(34, 197, 94, 0.2)" : "#DCFCE7")
                  : (isDark ? "rgba(255, 255, 255, 0.05)" : "#F1F5F9"),
                borderColor: adminSubTab === "approved" ? "#22C55E" : theme.cardBorder,
                borderWidth: 1.5,
                paddingVertical: 10,
                borderRadius: 14,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Ionicons name="checkmark-circle-outline" size={16} color={adminSubTab === "approved" ? "#22C55E" : theme.textSecondary} />
              <Text style={{ fontSize: 13, fontWeight: "800", color: adminSubTab === "approved" ? "#22C55E" : theme.textSecondary }}>
                Disetujui / Siap Scan ({groupedApprovedApprovals.length})
              </Text>
            </AnimatedPressable>
          </View>

          {/* Approval List */}
          {loading ? (
            <View style={{ padding: 20 }}>
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : (
            <FlatList
              data={adminSubTab === "pending" ? groupedPendingApprovals : groupedApprovedApprovals}
              keyExtractor={(group) => group.id}
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
                      width: 80,
                      height: 80,
                      borderRadius: 40,
                      backgroundColor: isDark ? "rgba(34, 197, 94, 0.15)" : "rgba(34, 197, 94, 0.1)",
                      justifyContent: "center",
                      alignItems: "center",
                      marginBottom: 16,
                    }}
                  >
                    <Ionicons name={adminSubTab === "pending" ? "checkmark-done" : "qr-code"} size={40} color="#22C55E" />
                  </View>
                  <Text style={{ fontSize: 18, fontWeight: "800", color: theme.textPrimary }}>
                    {adminSubTab === "pending" ? "Semua Pengajuan Beres!" : "Belum Ada Peminjaman Disetujui"}
                  </Text>
                  <Text style={{ fontSize: 13, color: theme.textSecondary, textAlign: "center", marginTop: 4, paddingHorizontal: 30 }}>
                    {adminSubTab === "pending"
                      ? "Tidak ada permohonan peminjaman HT yang menunggu verifikasi saat ini."
                      : "Permohonan yang disetujui Admin akan muncul di sini untuk langsung di-scan fisiknya."}
                  </Text>
                </View>
              }
              renderItem={({ item: group }) => {
                const isApprovedTab = adminSubTab === "approved";
                return (
                  <View
                    style={{
                      backgroundColor: theme.cardBg,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: isApprovedTab ? "#22C55E" : theme.cardBorder,
                      padding: 18,
                      marginBottom: 14,
                      shadowColor: theme.shadowColor,
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.1,
                      shadowRadius: 12,
                      elevation: 3,
                    }}
                  >
                    {/* Header Row */}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                        <Avatar name={group.mainTx.borrower_name || "Petugas"} size={44} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 16, fontWeight: "800", color: theme.textPrimary }}>
                            {group.mainTx.borrower_name || "Petugas"}
                          </Text>
                          <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 1 }}>
                            NRP: {group.mainTx.borrower_nrp || "-"} • Kesatuan: {group.mainTx.kesatuan || "-"}
                          </Text>
                        </View>
                      </View>

                      {/* Action Type Badge */}
                      <View
                        style={{
                          backgroundColor: isApprovedTab
                            ? (isDark ? "rgba(34, 197, 94, 0.2)" : "#DCFCE7")
                            : (group.isBatch ? (isDark ? "rgba(56, 189, 248, 0.2)" : "#E0F2FE") : (isDark ? "rgba(245, 158, 11, 0.2)" : "#FEF3C7")),
                          borderColor: isApprovedTab
                            ? "#22C55E"
                            : (group.isBatch ? (isDark ? "rgba(56, 189, 248, 0.4)" : "#38BDF8") : (isDark ? "rgba(245, 158, 11, 0.4)" : "#FCD34D")),
                          borderWidth: 1,
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: 8,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 10,
                            fontWeight: "800",
                            color: isApprovedTab
                              ? "#22C55E"
                              : (group.isBatch ? (isDark ? "#38BDF8" : "#0284C7") : (isDark ? "#FBBF24" : "#B45309")),
                          }}
                        >
                          {isApprovedTab
                            ? "DISETUJUI (SIAP SCAN)"
                            : (group.isBatch ? `PEMINJAMAN BATCH (${group.items.length} HT)` : "PEMINJAMAN")}
                        </Text>
                      </View>
                    </View>

                    {/* Asset Info Card */}
                    <View
                      style={{
                        backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC",
                        borderRadius: 14,
                        padding: 12,
                        marginBottom: 14,
                        borderWidth: 1,
                        borderColor: theme.cardBorder,
                      }}
                    >
                      {group.isBatch ? (
                        <View style={{ gap: 4 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <Text style={{ fontSize: 14, fontWeight: "800", color: theme.textPrimary }}>
                              Permohonan Batch ({group.items.length} Unit HT)
                            </Text>
                            <Text style={{ fontSize: 11, fontWeight: "800", color: theme.primary }}>
                              {group.batch_code}
                            </Text>
                          </View>
                          <Text style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 4 }}>
                            Diajukan: {new Date(group.mainTx.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} WIB
                          </Text>
                          <View style={{ gap: 3, marginTop: 2 }}>
                            {group.items.map((it, idx) => {
                              const isBorrowed = (it.asset?.status || "").toLowerCase() === "dipinjam";
                              return (
                                <View key={`${it.id}-${idx}`} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                                  <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textPrimary, flex: 1 }}>
                                    • {it.asset?.name || "HT"} <Text style={{ color: theme.textMuted }}>({it.asset?.code || "-"})</Text>
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
                        </View>
                      ) : (
                        <View style={{ gap: 4 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <Text style={{ fontSize: 14, fontWeight: "800", color: theme.textPrimary }}>
                              {group.mainTx.asset?.name || "Unit HT"}
                            </Text>
                            <Text style={{ fontSize: 11, fontWeight: "800", color: theme.primary }}>
                              {group.mainTx.asset?.code}
                            </Text>
                          </View>
                          <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                            SN: {group.mainTx.asset?.serial_number || "-"} • Diajukan: {new Date(group.mainTx.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} WIB
                          </Text>
                        </View>
                      )}

                      {group.mainTx.notes && (
                        <Text style={{ fontSize: 12, color: theme.textPrimary, fontStyle: "italic", marginTop: 6 }}>
                          "{group.mainTx.notes}"
                        </Text>
                      )}
                    </View>

                    {/* Action Buttons */}
                    {isApprovedTab ? (
                      /* Dedicated Loan QR Page Trigger on Approved Batch */
                      <AnimatedPressable
                        onPress={() => router.push(`/loan-qr/${group.batch_id || group.mainTx.id}`)}
                        style={{
                          backgroundColor: "#22C55E",
                          paddingVertical: 12,
                          borderRadius: 14,
                          alignItems: "center",
                          flexDirection: "row",
                          justifyContent: "center",
                          gap: 8,
                          shadowColor: "#22C55E",
                          shadowOffset: { width: 0, height: 4 },
                          shadowOpacity: 0.25,
                          shadowRadius: 8,
                          elevation: 3,
                        }}
                      >
                        <Ionicons name="qr-code" size={19} color="#FFFFFF" />
                        <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 14 }}>
                          📷 QR Code & Serah Terima Fisik ({group.items.length} HT)
                        </Text>
                      </AnimatedPressable>
                    ) : (
                      /* Approve / Reject Buttons on Pending Batch */
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <AnimatedPressable
                          onPress={() => {
                            setRejectModalTx(group.mainTx);
                            setRejectReason("");
                          }}
                          style={{
                            flex: 1,
                            backgroundColor: isDark ? "rgba(239, 68, 68, 0.15)" : "rgba(239, 68, 68, 0.1)",
                            borderColor: "rgba(239, 68, 68, 0.3)",
                            borderWidth: 1,
                            paddingVertical: 11,
                            borderRadius: 12,
                            alignItems: "center",
                            flexDirection: "row",
                            justifyContent: "center",
                            gap: 6,
                          }}
                        >
                          <Ionicons name="close-circle-outline" size={18} color="#EF4444" />
                          <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 13 }}>
                            {group.isBatch ? "Tolak Batch" : "Tolak"}
                          </Text>
                        </AnimatedPressable>

                        <AnimatedPressable
                          onPress={() => setConfirmApproveTx(group.mainTx)}
                          style={{
                            flex: 1.4,
                            backgroundColor: "#22C55E",
                            paddingVertical: 11,
                            borderRadius: 12,
                            alignItems: "center",
                            flexDirection: "row",
                            justifyContent: "center",
                            gap: 6,
                            shadowColor: "#22C55E",
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.25,
                            shadowRadius: 8,
                            elevation: 3,
                          }}
                        >
                          <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                          <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 13 }}>
                            {group.isBatch ? `Setujui Batch (${group.items.length} HT)` : "Setujui Pinjam"}
                          </Text>
                        </AnimatedPressable>
                      </View>
                    )}
                  </View>
                );
              }}
            />
          )}
        </View>

        {/* MODAL 1: CONFIRM APPROVE */}
        <Modal
          visible={!!confirmApproveTx}
          transparent
          animationType="fade"
          onRequestClose={() => setConfirmApproveTx(null)}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 24 }}>
            <View style={{ backgroundColor: theme.cardBg, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.cardBorder }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(34, 197, 94, 0.15)", justifyContent: "center", alignItems: "center", marginBottom: 14 }}>
                <Ionicons name="checkmark-circle" size={32} color="#22C55E" />
              </View>

              <Text style={{ fontSize: 18, fontWeight: "800", color: theme.textPrimary, marginBottom: 4 }}>
                Konfirmasi Persetujuan
              </Text>
              <Text style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 20 }}>
                Setujui peminjaman unit "{confirmApproveTx?.asset?.name}" untuk anggota{" "}
                <Text style={{ fontWeight: "700", color: theme.textPrimary }}>{confirmApproveTx?.borrower_name}</Text>?
              </Text>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <AnimatedPressable
                  onPress={() => setConfirmApproveTx(null)}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.cardBorder, alignItems: "center" }}
                >
                  <Text style={{ color: theme.textSecondary, fontWeight: "700", fontSize: 14 }}>Batal</Text>
                </AnimatedPressable>

                <AnimatedPressable
                  onPress={handleApprove}
                  disabled={actionProcessing}
                  style={{ flex: 1, backgroundColor: "#22C55E", paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" }}
                >
                  {actionProcessing ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 14 }}>Setujui</Text>
                  )}
                </AnimatedPressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* MODAL 2: REJECT REASON */}
        <Modal
          visible={!!rejectModalTx}
          transparent
          animationType="fade"
          onRequestClose={() => setRejectModalTx(null)}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 24 }}>
            <View style={{ backgroundColor: theme.cardBg, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: theme.cardBorder }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: theme.textPrimary, marginBottom: 4 }}>
                Tolak Peminjaman
              </Text>
              <Text style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 16 }}>
                Masukkan alasan penolakan permohonan peminjaman unit HT ini:
              </Text>

              <TextInput
                value={rejectReason}
                onChangeText={setRejectReason}
                placeholder="Contoh: Unit sedang dicadangkan untuk giat operasi khusus"
                placeholderTextColor={theme.inputPlaceholder}
                multiline
                numberOfLines={3}
                style={{
                  backgroundColor: theme.inputBackground,
                  borderWidth: 1,
                  borderColor: theme.inputBorder,
                  borderRadius: 14,
                  padding: 12,
                  color: theme.inputText,
                  fontSize: 13,
                  marginBottom: 20,
                  textAlignVertical: "top",
                  height: 80,
                }}
              />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <AnimatedPressable
                  onPress={() => setRejectModalTx(null)}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.cardBorder, alignItems: "center" }}
                >
                  <Text style={{ color: theme.textSecondary, fontWeight: "700", fontSize: 14 }}>Batal</Text>
                </AnimatedPressable>

                <AnimatedPressable
                  onPress={handleReject}
                  disabled={actionProcessing}
                  style={{ flex: 1, backgroundColor: "#EF4444", paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" }}
                >
                  {actionProcessing ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 14 }}>Tolak Permohonan</Text>
                  )}
                </AnimatedPressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Full Profile Photo Modal for Admin */}
        <ProfilePhotoModal
          visible={photoModalVisible}
          onClose={() => setPhotoModalVisible(false)}
          photoUrl={profile?.avatar_url}
          name={profile?.full_name || "Admin HT"}
          nrp={profile?.nrp}
          role={profile?.role}
          isOwnProfile={true}
          onChangePhoto={() => {
            setPhotoModalVisible(false);
            router.push("/(tabs)/profile");
          }}
        />

        {/* Feedback Bottom Sheet */}
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

  // =========================================================================
  // RENDER 2: PETUGAS DASHBOARD (PEMINJAMAN & HT AKTIF SAYA)
  // =========================================================================
  return (
    <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {/* Officer Greeting Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Avatar
                name={profile?.full_name || "Petugas"}
                avatarUrl={profile?.avatar_url}
                size={48}
                onPress={() => setPhotoModalVisible(true)}
              />
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 18, fontWeight: "800", color: theme.textPrimary }}>
                    {profile?.full_name || "Petugas HT"}
                  </Text>
                  <View style={{ backgroundColor: isDark ? "rgba(2,132,199,0.2)" : "rgba(2,132,199,0.12)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ fontSize: 10, fontWeight: "800", color: theme.primary }}>PETUGAS</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 1 }}>
                  {profile?.nrp ? `NRP: ${profile.nrp}` : "Layanan Peminjaman HT Polrestabes"}
                </Text>
              </View>
            </View>

            <AnimatedPressable
              onPress={() => router.push("/(tabs)/scan")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: theme.primary,
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 12,
                gap: 6,
                shadowColor: theme.primary,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 4,
              }}
            >
              <Ionicons name="qr-code" size={16} color="#FFFFFF" />
              <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 12 }}>
                Scan QR
              </Text>
            </AnimatedPressable>
          </View>

          {/* Quick Action Shortcuts Ribbon (MyTelkomsel / myIM3 Style) with Active Color Switch */}
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
            <AnimatedPressable
              onPress={() => {
                setViewTab("active");
                SafeHaptics.selectionAsync();
              }}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                backgroundColor: viewTab === "active" ? theme.primary : (isDark ? "rgba(255, 255, 255, 0.08)" : "#FFFFFF"),
                borderWidth: 1,
                borderColor: viewTab === "active" ? theme.primary : theme.cardBorder,
                paddingVertical: 9,
                borderRadius: 12,
                shadowColor: theme.primary,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: viewTab === "active" ? 0.25 : 0,
                shadowRadius: 6,
                elevation: viewTab === "active" ? 2 : 0,
              }}
            >
              <Ionicons name="radio-outline" size={15} color={viewTab === "active" ? "#FFFFFF" : theme.primary} />
              <Text style={{ color: viewTab === "active" ? "#FFFFFF" : theme.textPrimary, fontWeight: "700", fontSize: 12 }}>
                HT Dipinjam
              </Text>
            </AnimatedPressable>

            <AnimatedPressable
              onPress={() => {
                setViewTab("available");
                SafeHaptics.selectionAsync();
              }}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                backgroundColor: viewTab === "available" ? theme.primary : (isDark ? "rgba(255, 255, 255, 0.08)" : "#FFFFFF"),
                borderWidth: 1,
                borderColor: viewTab === "available" ? theme.primary : theme.cardBorder,
                paddingVertical: 9,
                borderRadius: 12,
                shadowColor: theme.primary,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: viewTab === "available" ? 0.25 : 0,
                shadowRadius: 6,
                elevation: viewTab === "available" ? 2 : 0,
              }}
            >
              <Ionicons name="cube-outline" size={15} color={viewTab === "available" ? "#FFFFFF" : theme.primary} />
              <Text style={{ color: viewTab === "available" ? "#FFFFFF" : theme.textPrimary, fontWeight: "700", fontSize: 12 }}>
                Katalog HT
              </Text>
            </AnimatedPressable>

            <AnimatedPressable
              onPress={() => {
                router.push("/(tabs)/history");
                SafeHaptics.selectionAsync();
              }}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "#FFFFFF",
                borderWidth: 1,
                borderColor: theme.cardBorder,
                paddingVertical: 9,
                borderRadius: 12,
              }}
            >
              <Ionicons name="receipt-outline" size={15} color={theme.primary} />
              <Text style={{ color: theme.textPrimary, fontWeight: "700", fontSize: 12 }}>
                Riwayat
              </Text>
            </AnimatedPressable>
          </View>

          {/* Proportional Segmented Tab Selector */}
          <View
            style={{
              flexDirection: "row",
              backgroundColor: isDark ? "rgba(30, 41, 59, 0.75)" : "#E2E8F0",
              borderRadius: 14,
              padding: 4,
              gap: 4,
              marginBottom: viewTab === "available" ? 10 : 6,
            }}
          >
            {[
              { id: "active", label: "HT Dipinjam", count: activeLoans.length },
              { id: "pending", label: "Pending", count: myPendingLoans.length },
              { id: "available", label: "Tersedia", count: availableAssets.length },
            ].map((tab) => {
              const isActive = viewTab === tab.id;
              return (
                <AnimatedPressable
                  key={tab.id}
                  onPress={() => {
                    setViewTab(tab.id as any);
                    SafeHaptics.selectionAsync();
                  }}
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    paddingVertical: 9,
                    borderRadius: 10,
                    backgroundColor: isActive
                      ? isDark ? theme.primary : "#FFFFFF"
                      : "transparent",
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: isActive ? (isDark ? 0.3 : 0.08) : 0,
                    shadowRadius: 3,
                    elevation: isActive ? 2 : 0,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: isActive ? "800" : "600",
                      color: isActive
                        ? isDark ? "#FFFFFF" : theme.primary
                        : isDark ? "#94A3B8" : "#64748B",
                    }}
                  >
                    {tab.label}
                  </Text>
                  <View
                    style={{
                      backgroundColor: isActive
                        ? isDark ? "rgba(255, 255, 255, 0.2)" : "#EFF6FF"
                        : isDark ? "rgba(255, 255, 255, 0.1)" : "#CBD5E1",
                      paddingHorizontal: 6,
                      paddingVertical: 1,
                      borderRadius: 8,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 10.5,
                        fontWeight: "800",
                        color: isActive
                          ? isDark ? "#FFFFFF" : theme.primary
                          : isDark ? "#CBD5E1" : "#475569",
                      }}
                    >
                      {tab.count}
                    </Text>
                  </View>
                </AnimatedPressable>
              );
            })}
          </View>

          {/* Search bar when viewing available catalog */}
          {viewTab === "available" && (
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
                marginBottom: 6,
              }}
            >
              <Ionicons name="search-outline" size={17} color={theme.primary} style={{ marginRight: 8 }} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Cari kode atau nama HT..."
                placeholderTextColor={theme.inputPlaceholder}
                style={{ flex: 1, color: theme.inputText, fontSize: 13, fontWeight: "500" }}
              />
              {searchQuery.length > 0 && (
                <AnimatedPressable onPress={() => setSearchQuery("")} style={{ padding: 4 }}>
                  <Ionicons name="close-circle" size={17} color={theme.textMuted} />
                </AnimatedPressable>
              )}
            </View>
          )}
        </View>

        {/* Tab Content */}
        {loading ? (
          <View style={{ padding: 20 }}>
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : viewTab === "active" ? (
          <FlatList
            data={activeLoans}
            keyExtractor={(item) => item.id}
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={Platform.OS === "android"}
            updateCellsBatchingPeriod={30}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 }}
            ListEmptyComponent={
              <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 60 }}>
                <View style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(2,132,199,0.08)", justifyContent: "center", alignItems: "center", marginBottom: 14 }}>
                  <Ionicons name="radio-outline" size={36} color={theme.textMuted} />
                </View>
                <Text style={{ fontSize: 16, fontWeight: "700", color: theme.textPrimary }}>
                  Tidak Ada HT yang Sedang Dipinjam
                </Text>
                <Text style={{ fontSize: 13, color: theme.textSecondary, textAlign: "center", marginTop: 4 }}>
                  Gunakan tombol Scan QR untuk meminjam unit HT yang tersedia.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <View
                style={{
                  backgroundColor: theme.cardBg,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                  padding: 16,
                  marginBottom: 12,
                  shadowColor: theme.shadowColor,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.08,
                  shadowRadius: 10,
                  elevation: 2,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: theme.primary, backgroundColor: isDark ? "rgba(2,132,199,0.2)" : "rgba(2,132,199,0.1)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                        {item.asset?.code}
                      </Text>
                      <Text style={{ fontSize: 11, color: theme.textMuted }}>
                        SN: {item.asset?.serial_number}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: theme.textPrimary }}>
                      {item.asset?.name}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                      Peminjam: {item.borrower_name} ({item.kesatuan || "-"})
                    </Text>
                  </View>
                  <StatusBadge status="dipinjam" />
                </View>

                <AnimatedPressable
                  onPress={() => router.push("/(tabs)/scan")}
                  style={{
                    backgroundColor: isDark ? "rgba(34, 197, 94, 0.2)" : "rgba(34, 197, 94, 0.12)",
                    borderColor: "#22C55E",
                    borderWidth: 1,
                    paddingVertical: 10,
                    borderRadius: 12,
                    alignItems: "center",
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: 6,
                    marginTop: 4,
                  }}
                >
                  <Ionicons name="qr-code" size={17} color="#22C55E" />
                  <Text style={{ color: "#22C55E", fontWeight: "800", fontSize: 13 }}>
                    📷 Scan QR Pengembalian Fisik
                  </Text>
                </AnimatedPressable>
              </View>
            )}
          />
        ) : viewTab === "pending" ? (
          <FlatList
            data={groupedMyPendingLoans}
            keyExtractor={(group) => group.id}
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={Platform.OS === "android"}
            updateCellsBatchingPeriod={30}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 }}
            ListEmptyComponent={
              <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 60 }}>
                <Ionicons name="time-outline" size={48} color={theme.textMuted} style={{ marginBottom: 12 }} />
                <Text style={{ fontSize: 16, fontWeight: "700", color: theme.textPrimary }}>
                  Tidak Ada Permohonan Pending
                </Text>
                <Text style={{ fontSize: 13, color: theme.textSecondary, textAlign: "center", marginTop: 4 }}>
                  Semua pengajuan peminjaman Anda telah diproses oleh admin.
                </Text>
              </View>
            }
            renderItem={({ item: group }) => {
              const isApproved = group.mainTx.status === "APPROVED";
              return (
                <View
                  style={{
                    backgroundColor: theme.cardBg,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: isApproved ? "#22C55E" : theme.cardBorder,
                    padding: 16,
                    marginBottom: 12,
                    gap: 8,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={{ fontSize: 15, fontWeight: "800", color: theme.textPrimary }}>
                        {group.isBatch ? `Permohonan Batch (${group.items.length} Unit HT)` : (group.mainTx.asset?.name || "Unit HT")}
                      </Text>
                      <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                        Diajukan: {new Date(group.mainTx.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                      </Text>
                    </View>

                    <View
                      style={{
                        backgroundColor: isApproved
                          ? (isDark ? "rgba(34, 197, 94, 0.2)" : "#DCFCE7")
                          : (isDark ? "rgba(245, 158, 11, 0.2)" : "#FEF3C7"),
                        borderColor: isApproved ? "#22C55E" : "#F59E0B",
                        borderWidth: 1,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 8,
                      }}
                    >
                      <Text style={{ fontSize: 10, fontWeight: "800", color: isApproved ? "#22C55E" : "#B45309" }}>
                        {isApproved ? "DISETUJUI (SIAP SCAN)" : "MENUNGGU VERIFIKASI"}
                      </Text>
                    </View>
                  </View>

                  {/* List preview */}
                  {group.isBatch && (
                    <View style={{ backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "#F8FAFC", borderRadius: 10, padding: 10, gap: 3 }}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: theme.primary }}>
                        Ref: {group.batch_code} • Daftar Unit Paket:
                      </Text>
                      {group.items.map((it, idx) => (
                        <Text key={`${it.id}-${idx}`} style={{ fontSize: 11.5, color: theme.textSecondary }}>
                          • {it.asset?.name} ({it.asset?.code})
                        </Text>
                      ))}
                    </View>
                  )}

                  {/* Scan Fisik Button if Approved */}
                  {isApproved && (
                    <AnimatedPressable
                      onPress={() => {
                        if (group.isBatch) {
                          router.push({
                            pathname: "/(tabs)/scan",
                            params: {
                              target_batch_id: group.mainTx.batch_id || group.id,
                              batch_code: group.batch_code || "",
                            },
                          });
                        } else {
                          router.push({
                            pathname: "/(tabs)/scan",
                            params: {
                              target_asset_id: group.mainTx.asset_id,
                              expected_code: group.mainTx.asset?.code || "",
                              expected_name: encodeURIComponent(group.mainTx.asset?.name || ""),
                            },
                          });
                        }
                      }}
                      style={{
                        backgroundColor: "#22C55E",
                        paddingVertical: 11,
                        borderRadius: 12,
                        alignItems: "center",
                        flexDirection: "row",
                        justifyContent: "center",
                        gap: 6,
                        marginTop: 4,
                      }}
                    >
                      <Ionicons name="qr-code" size={18} color="#FFFFFF" />
                      <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 13.5 }}>
                        📷 Scan Fisik Barang ({group.items.length} HT)
                      </Text>
                    </AnimatedPressable>
                  )}
                </View>
              );
            }}
          />
        ) : (
          <FlatList
            data={filteredAvailableAssets}
            keyExtractor={(item) => item.id}
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={Platform.OS === "android"}
            updateCellsBatchingPeriod={30}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 }}
            ListEmptyComponent={
              <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 60 }}>
                <Ionicons name="cube-outline" size={48} color={theme.textMuted} style={{ marginBottom: 12 }} />
                <Text style={{ fontSize: 16, fontWeight: "700", color: theme.textPrimary }}>
                  Tidak Ada HT Siap Pakai
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <View
                style={{
                  backgroundColor: theme.cardBg,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                  padding: 16,
                  marginBottom: 12,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View style={{ flex: 1, marginRight: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: "#22C55E", backgroundColor: isDark ? "rgba(34,197,94,0.2)" : "rgba(34,197,94,0.1)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                      {item.code}
                    </Text>
                    <Text style={{ fontSize: 11, color: theme.textMuted }}>
                      SN: {item.serial_number}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 15, fontWeight: "800", color: theme.textPrimary }}>
                    {item.name}
                  </Text>
                </View>

                <AnimatedPressable
                  onPress={() => router.push(`/asset/${item.id}`)}
                  style={{
                    backgroundColor: theme.primary,
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                    borderRadius: 12,
                  }}
                >
                  <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 12 }}>
                    Ajukan Pinjam
                  </Text>
                </AnimatedPressable>
              </View>
            )}
          />
        )}
        {/* Loan Batch QR Code & Handover Modal */}
        <LoanBatchQRModal
          visible={!!qrModalGroup}
          group={qrModalGroup}
          onClose={() => setQrModalGroup(null)}
          onRefresh={() => loadData(false)}
        />

        {/* Full Profile Photo Modal for Petugas */}
        <ProfilePhotoModal
          visible={photoModalVisible}
          onClose={() => setPhotoModalVisible(false)}
          photoUrl={profile?.avatar_url}
          name={profile?.full_name || "Petugas HT"}
          nrp={profile?.nrp}
          role={profile?.role}
          isOwnProfile={true}
          onChangePhoto={() => {
            setPhotoModalVisible(false);
            router.push("/(tabs)/profile");
          }}
        />
      </View>
    </LinearGradient>
  );
}
