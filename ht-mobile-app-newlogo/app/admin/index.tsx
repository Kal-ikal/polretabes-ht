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
  Share,
} from "react-native";
import { SafeAlert } from "@/lib/safeAlert";
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
import { DocumentViewerModal } from "@/components/DocumentViewerModal";
import { formatFullDateTimeId, formatShortDateTimeId, getRemainingTimeStatus } from "@/lib/dateUtils";
import { getFriendlyErrorMessage } from "@/lib/errorHandler";
import type { Asset, Transaction, Profile, AssetStatus, LoanDurationPreset } from "@/types/database";

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
    if (items.length > 1) {
      result.push({
        id: `batch-${batchId}`,
        isBatch: true,
        batch_id: batchId,
        batch_code: items[0].batch_code || `BATCH-${batchId.slice(0, 6)}`,
        items,
        mainTx: items[0],
      });
    } else if (items.length === 1) {
      singles.push(items[0]);
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

  const [activeTab, setActiveTab] = useState<"approval" | "history" | "assets" | "users" | "presets">("approval");

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

  // Tab: History & Audit Log State
  const [historyList, setHistoryList] = useState<Transaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"ALL" | "BORROWED" | "RETURNED" | "PENDING" | "REJECTED">("ALL");
  const [selectedHistoryModalGroup, setSelectedHistoryModalGroup] = useState<GroupedTransaction | null>(null);

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

  // Official Letter Viewer Modal
  const [viewDocModal, setViewDocModal] = useState<{
    visible: boolean;
    url: string;
    name: string;
  }>({ visible: false, url: "", name: "" });

  // Tab 4: Duration Presets State
  const [presetsList, setPresetsList] = useState<LoanDurationPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const [editingPreset, setEditingPreset] = useState<LoanDurationPreset | null>(null);
  const [presetLabel, setPresetLabel] = useState("");
  const [presetHours, setPresetHours] = useState("");
  const [presetSubmitting, setPresetSubmitting] = useState(false);

  // 1. Fetch Pending & Approved Approvals
  const fetchApprovals = useCallback(async () => {
    setLoadingApprovals(true);
    const [resPending, resApproved] = await Promise.all([
      supabase
        .from("transactions")
        .select("*, asset:assets(*), reviewer:profiles!transactions_reviewed_by_fkey(*)")
        .eq("action", "BORROW")
        .eq("status", "PENDING")
        .order("created_at", { ascending: false }),
      supabase
        .from("transactions")
        .select("*, asset:assets(*), reviewer:profiles!transactions_reviewed_by_fkey(*)")
        .eq("action", "BORROW")
        .eq("status", "APPROVED")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    setPendingApprovals((resPending.data as Transaction[]) ?? []);
    setApprovedApprovals((resApproved.data as Transaction[]) ?? []);
    setLoadingApprovals(false);
  }, []);

  // 1.1 Fetch Audit & Transaction History
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, asset:assets(*), reviewer:profiles!transactions_reviewed_by_fkey(*)")
        .order("created_at", { ascending: false })
        .limit(300);

      if (!error && data) {
        setHistoryList(data as Transaction[]);
      }
    } catch (err) {
      console.error("fetchHistory error:", err);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // 2. Fetch Master Assets
  const fetchAssets = useCallback(async () => {
    setLoadingAssets(true);
    const { data: rawAssets } = await supabase
      .from("assets")
      .select("*")
      .order("name", { ascending: true });

    const { data: reservedRows } = await supabase.rpc("get_reserved_asset_ids");

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

  // 4. Fetch Duration Presets
  const fetchPresets = useCallback(async () => {
    setLoadingPresets(true);
    try {
      const { data, error } = await supabase
        .from("loan_duration_presets")
        .select("*")
        .order("sort_order", { ascending: true });

      if (!error && data) {
        setPresetsList(data as LoanDurationPreset[]);
      }
    } catch (err) {
      console.error("fetchPresets error:", err);
    } finally {
      setLoadingPresets(false);
    }
  }, []);

  useEffect(() => {
    if (profile?.role === "admin") {
      fetchApprovals();
      fetchHistory();
      fetchAssets();
      fetchUsers();
      fetchPresets();

      // Subscribe to Realtime Updates
      const txChannelId = `admin-tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const txChannel = supabase
        .channel(txChannelId)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "transactions" },
          () => {
            fetchApprovals();
            fetchHistory();
            fetchUsers();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "assets" },
          () => {
            fetchApprovals();
            fetchHistory();
            fetchAssets();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "loan_duration_presets" },
          () => {
            fetchPresets();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(txChannel);
      };
    }
  }, [profile, fetchApprovals, fetchHistory, fetchAssets, fetchUsers, fetchPresets]);

  // Preset Handlers
  function openPresetForm(preset?: LoanDurationPreset) {
    if (preset) {
      setEditingPreset(preset);
      setPresetLabel(preset.label);
      setPresetHours(String(preset.duration_hours));
    } else {
      setEditingPreset(null);
      setPresetLabel("");
      setPresetHours("");
    }
    setPresetModalVisible(true);
  }

  async function handleSavePreset() {
    const hours = parseInt(presetHours.trim(), 10);
    if (!presetLabel.trim() || isNaN(hours) || hours <= 0) {
      setToastConfig({
        visible: true,
        title: "Lengkapi Data",
        message: "Label preset dan durasi (jam) harus diisi dengan angka valid (> 0).",
        icon: "⚠️",
        isDanger: true,
      });
      return;
    }

    setPresetSubmitting(true);
    try {
      if (editingPreset) {
        const { error } = await supabase
          .from("loan_duration_presets")
          .update({
            label: presetLabel.trim(),
            duration_hours: hours,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingPreset.id);

        if (error) throw error;
      } else {
        const nextOrder = presetsList.length > 0 ? Math.max(...presetsList.map((p) => p.sort_order)) + 1 : 1;
        const { error } = await supabase
          .from("loan_duration_presets")
          .insert({
            label: presetLabel.trim(),
            duration_hours: hours,
            is_active: true,
            sort_order: nextOrder,
          });

        if (error) throw error;
      }

      setPresetModalVisible(false);
      setToastConfig({
        visible: true,
        title: "Berhasil Disimpan",
        message: `Preset durasi "${presetLabel.trim()}" (${hours} Jam) berhasil disimpan.`,
        icon: "✅",
      });
      fetchPresets();
    } catch (err: any) {
      setToastConfig({
        visible: true,
        title: "Gagal Menyimpan",
        message: getFriendlyErrorMessage(err, "Gagal menyimpan preset durasi."),
        icon: "❌",
        isDanger: true,
      });
    } finally {
      setPresetSubmitting(false);
    }
  }

  async function handleTogglePresetActive(preset: LoanDurationPreset) {
    try {
      const { error } = await supabase
        .from("loan_duration_presets")
        .update({ is_active: !preset.is_active, updated_at: new Date().toISOString() })
        .eq("id", preset.id);

      if (error) throw error;
      fetchPresets();
    } catch (err: any) {
      SafeAlert.alert("Gagal", err.message || "Gagal mengubah status aktif preset.");
    }
  }

  async function handleDeletePreset(preset: LoanDurationPreset) {
    const doDelete = async () => {
      try {
        const { error } = await supabase
          .from("loan_duration_presets")
          .delete()
          .eq("id", preset.id);

        if (error) throw error;
        setToastConfig({
          visible: true,
          title: "Preset Dihapus",
          message: `Preset "${preset.label}" berhasil dihapus.`,
          icon: "🗑️",
        });
        fetchPresets();
      } catch (err: any) {
        SafeAlert.alert("Gagal Menghapus", err.message || "Gagal menghapus preset.");
      }
    };

    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(`Apakah Anda yakin ingin menghapus preset "${preset.label}"?`)) {
        await doDelete();
      }
      return;
    }

    SafeAlert.alert(
      "Hapus Preset Durasi",
      `Apakah Anda yakin ingin menghapus preset "${preset.label}"?`,
      [
        { text: "Batal", style: "cancel" },
        { text: "Hapus", style: "destructive", onPress: doDelete },
      ]
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

  // Grouped history transactions with filters & search
  const groupedHistoryTransactions = useMemo(() => {
    let filtered = historyList;

    if (historyFilter === "BORROWED") {
      filtered = filtered.filter(
        (tx) => tx.action === "BORROW" && (tx.asset?.status || "").toLowerCase() === "dipinjam"
      );
    } else if (historyFilter === "RETURNED") {
      filtered = filtered.filter(
        (tx) => tx.action === "RETURN" || (tx.status === "APPROVED" && (tx.asset?.status || "").toLowerCase() === "tersedia")
      );
    } else if (historyFilter === "PENDING") {
      filtered = filtered.filter((tx) => tx.status === "PENDING");
    } else if (historyFilter === "REJECTED") {
      filtered = filtered.filter((tx) => tx.status === "REJECTED");
    }

    if (historySearch.trim()) {
      const q = historySearch.toLowerCase().trim();
      filtered = filtered.filter((tx) => {
        const borrower = (tx.borrower_name || "").toLowerCase();
        const nrp = (tx.borrower_nrp || "").toLowerCase();
        const kesatuan = (tx.kesatuan || "").toLowerCase();
        const batch = (tx.batch_code || "").toLowerCase();
        const assetName = (tx.asset?.name || "").toLowerCase();
        const assetCode = (tx.asset?.code || "").toLowerCase();
        const sn = (tx.asset?.serial_number || "").toLowerCase();
        const notes = (tx.notes || "").toLowerCase();
        return (
          borrower.includes(q) ||
          nrp.includes(q) ||
          kesatuan.includes(q) ||
          batch.includes(q) ||
          assetName.includes(q) ||
          assetCode.includes(q) ||
          sn.includes(q) ||
          notes.includes(q)
        );
      });
    }

    return groupTransactionsByBatch(filtered);
  }, [historyList, historyFilter, historySearch]);

  // KPI calculations for audit
  const auditKPIs = useMemo(() => {
    const total = historyList.length;
    let borrowedCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;

    const now = new Date().getTime();
    for (const tx of historyList) {
      if (tx.status === "PENDING") pendingCount++;
      if (tx.action === "BORROW" && (tx.asset?.status || "").toLowerCase() === "dipinjam") {
        borrowedCount++;
        if (tx.due_date && new Date(tx.due_date).getTime() < now) {
          overdueCount++;
        }
      }
    }

    return { total, borrowedCount, pendingCount, overdueCount };
  }, [historyList]);

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
        SafeAlert.alert("Gagal Menyetujui", error.message || getFriendlyErrorMessage(error));
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
      SafeAlert.alert("Kesalahan Sistem", err.message || "Gagal menyetujui permohonan.");
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

  // --- Handlers: Share / Copy Audit Slip ---
  async function handleShareAuditSlip(group: GroupedTransaction) {
    const tx = group.mainTx;
    const isBorrow = tx.action === "BORROW";
    const refCode = group.isBatch ? group.batch_code : `HT-${tx.id.slice(0, 8).toUpperCase()}`;
    const statusText =
      tx.status === "APPROVED"
        ? "DISETUJUI / SELESAI"
        : tx.status === "REJECTED"
        ? "DITOLAK"
        : "MENUNGGU VERIFIKASI";

    let text = `*LEMBAR AUDIT LOGISTIK HT POLRESTA*\n----------------------------------------\n`;
    text += `*Status:* ${statusText}\n`;
    text += `*Jenis Transaksi:* ${isBorrow ? "Peminjaman HT" : "Pengembalian HT"} ${group.isBatch ? `(Batch ${group.items.length} Unit)` : ""}\n`;
    text += `*No. Referensi:* ${refCode}\n`;
    text += `*Waktu Pengajuan:* ${formatFullDateTimeId(tx.created_at)}\n`;
    if (tx.due_date) {
      text += `*Batas Pengembalian:* ${formatFullDateTimeId(tx.due_date)}\n`;
    }
    if (tx.reviewed_at) {
      text += `*Waktu Disetujui:* ${formatFullDateTimeId(tx.reviewed_at)}\n`;
      text += `*Verifikator Admin:* ${tx.reviewer?.full_name || "-"}\n`;
    }
    text += `\n*Data Petugas Peminjam:*\n`;
    text += `• Nama: ${tx.borrower_name || "-"}\n`;
    text += `• Pangkat/NRP: ${tx.borrower_nrp || "-"}\n`;
    text += `• Kesatuan: ${tx.kesatuan || "-"}\n`;

    if (group.isBatch) {
      text += `\n*Daftar Unit HT (${group.items.length} Unit):*\n`;
      group.items.forEach((it, idx) => {
        text += `${idx + 1}. ${it.asset?.name || "HT"} (Kode: ${it.asset?.code || "-"} | SN: ${it.asset?.serial_number || "-"})\n`;
      });
    } else {
      text += `\n*Unit HT:* ${tx.asset?.name || "HT"} (Kode: ${tx.asset?.code || "-"} | SN: ${tx.asset?.serial_number || "-"})\n`;
    }
    if (tx.condition) {
      text += `• Kondisi Fisik: ${tx.condition.toUpperCase()}\n`;
    }
    if (tx.notes) {
      text += `• Keperluan: "${tx.notes}"\n`;
    }
    text += `----------------------------------------\nDokumentasi Resmi Sistem Logistik HT Polresta`;

    try {
      if (Platform.OS === "web") {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          setToastConfig({
            visible: true,
            title: "Data Disalin",
            message: "Rincian data audit transaksi berhasil disalin ke clipboard.",
            icon: "📋",
          });
          return;
        }
      }
      await Share.share({
        title: `Audit Transaksi HT - ${refCode}`,
        message: text,
      });
    } catch (e) {
      console.log("Share error:", e);
    }
  }

  return (
    <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1 }}>
      <View style={{ flex: 1, maxWidth: 1080, width: "100%", alignSelf: "center" }}>
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
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/(tabs)");
            }
          }}
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
          <Text style={{ color: theme.primary, fontWeight: "600", fontSize: 11 }}>Sistem Manajemen Aset HT & Audit</Text>
        </View>

        <View style={{ width: 70 }} />
      </View>

      {/* 5 Tabs Segmented Switcher Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            flexDirection: "row",
            gap: 8,
            alignItems: "center",
            paddingVertical: 2,
          }}
        >
          {/* TAB 1: PERSETUJUAN */}
          <AnimatedPressable
            onPress={() => setActiveTab("approval")}
            scaleTo={0.97}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 9,
              paddingHorizontal: 13,
              borderRadius: 14,
              backgroundColor: activeTab === "approval" ? theme.primary : theme.cardBackground,
              borderColor: activeTab === "approval" ? theme.primary : theme.cardBorder,
              borderWidth: 1,
            }}
          >
            <Ionicons
              name="checkbox-outline"
              size={15}
              color={activeTab === "approval" ? theme.primaryTextOnButton : theme.textSecondary}
            />
            <Text
              style={{
                color: activeTab === "approval" ? theme.primaryTextOnButton : theme.textPrimary,
                fontWeight: "700",
                fontSize: 12.5,
              }}
            >
              Persetujuan ({pendingApprovals.length})
            </Text>
          </AnimatedPressable>

          {/* TAB 2: RIWAYAT & AUDIT */}
          <AnimatedPressable
            onPress={() => setActiveTab("history")}
            scaleTo={0.97}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 9,
              paddingHorizontal: 13,
              borderRadius: 14,
              backgroundColor: activeTab === "history" ? theme.primary : theme.cardBackground,
              borderColor: activeTab === "history" ? theme.primary : theme.cardBorder,
              borderWidth: 1,
            }}
          >
            <Ionicons
              name="receipt-outline"
              size={15}
              color={activeTab === "history" ? theme.primaryTextOnButton : theme.textSecondary}
            />
            <Text
              style={{
                color: activeTab === "history" ? theme.primaryTextOnButton : theme.textPrimary,
                fontWeight: "700",
                fontSize: 12.5,
              }}
            >
              Riwayat & Audit ({historyList.length})
            </Text>
          </AnimatedPressable>

          {/* TAB 3: DATA ASET */}
          <AnimatedPressable
            onPress={() => setActiveTab("assets")}
            scaleTo={0.97}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 9,
              paddingHorizontal: 13,
              borderRadius: 14,
              backgroundColor: activeTab === "assets" ? theme.primary : theme.cardBackground,
              borderColor: activeTab === "assets" ? theme.primary : theme.cardBorder,
              borderWidth: 1,
            }}
          >
            <Ionicons
              name="radio-outline"
              size={15}
              color={activeTab === "assets" ? theme.primaryTextOnButton : theme.textSecondary}
            />
            <Text
              style={{
                color: activeTab === "assets" ? theme.primaryTextOnButton : theme.textPrimary,
                fontWeight: "700",
                fontSize: 12.5,
              }}
            >
              Data Aset ({assetsList.length})
            </Text>
          </AnimatedPressable>

          {/* TAB 4: USER */}
          <AnimatedPressable
            onPress={() => setActiveTab("users")}
            scaleTo={0.97}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 9,
              paddingHorizontal: 13,
              borderRadius: 14,
              backgroundColor: activeTab === "users" ? theme.primary : theme.cardBackground,
              borderColor: activeTab === "users" ? theme.primary : theme.cardBorder,
              borderWidth: 1,
            }}
          >
            <Ionicons
              name="people-outline"
              size={15}
              color={activeTab === "users" ? theme.primaryTextOnButton : theme.textSecondary}
            />
            <Text
              style={{
                color: activeTab === "users" ? theme.primaryTextOnButton : theme.textPrimary,
                fontWeight: "700",
                fontSize: 12.5,
              }}
            >
              User ({usersList.length})
            </Text>
          </AnimatedPressable>

          {/* TAB 5: PRESETS */}
          <AnimatedPressable
            onPress={() => setActiveTab("presets")}
            scaleTo={0.97}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 9,
              paddingHorizontal: 13,
              borderRadius: 14,
              backgroundColor: activeTab === "presets" ? theme.primary : theme.cardBackground,
              borderColor: activeTab === "presets" ? theme.primary : theme.cardBorder,
              borderWidth: 1,
            }}
          >
            <Ionicons
              name="timer-outline"
              size={15}
              color={activeTab === "presets" ? theme.primaryTextOnButton : theme.textSecondary}
            />
            <Text
              style={{
                color: activeTab === "presets" ? theme.primaryTextOnButton : theme.textPrimary,
                fontWeight: "700",
                fontSize: 12.5,
              }}
            >
              Durasi ({presetsList.length})
            </Text>
          </AnimatedPressable>
        </ScrollView>
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

                        {/* Waktu Pengajuan Lengkap */}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                          <Ionicons name="calendar-outline" size={13} color={theme.textMuted} />
                          <Text style={{ fontSize: 11.5, color: theme.textSecondary }}>
                            Diajukan: {formatFullDateTimeId(group.mainTx.created_at)}
                          </Text>
                        </View>

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
                                    • {it.asset?.name || "HT"} (Kode: {it.asset?.code || "-"} | SN: {it.asset?.serial_number || "-"})
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
                          <View style={{ marginTop: 2, gap: 2 }}>
                            <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                              SN: {group.mainTx.asset?.serial_number ?? "-"} • Kode: {group.mainTx.asset?.code ?? "-"}
                            </Text>
                            {group.mainTx.condition && (
                              <Text style={{ fontSize: 11.5, color: theme.textSecondary }}>
                                Kondisi Fisik:{" "}
                                <Text style={{ fontWeight: "700", color: group.mainTx.condition.toLowerCase() === "rusak" ? "#EF4444" : "#22C55E" }}>
                                  {group.mainTx.condition.toUpperCase()}
                                </Text>
                              </Text>
                            )}
                          </View>
                        )}

                        {/* Catatan / Keperluan Dinas */}
                        {group.mainTx.notes && (
                          <Text style={{ fontSize: 12, color: theme.textPrimary, fontStyle: "italic", marginTop: 4 }}>
                            Keperluan: "{group.mainTx.notes}"
                          </Text>
                        )}

                        {/* Due Date & Remaining Time Status Badge */}
                        {group.mainTx.due_date && (() => {
                          const rem = getRemainingTimeStatus(group.mainTx.due_date);
                          const isOverdue = rem?.isOverdue;
                          const isWarning = rem?.urgentLevel === "warning";
                          const badgeBg = isOverdue
                            ? (theme.isDark ? "rgba(239, 68, 68, 0.2)" : "#FEE2E2")
                            : isWarning
                            ? (theme.isDark ? "rgba(245, 158, 11, 0.2)" : "#FEF3C7")
                            : (theme.isDark ? "rgba(14, 165, 233, 0.15)" : "#E0F2FE");
                          const badgeBorder = isOverdue ? "#EF4444" : isWarning ? "#F59E0B" : "#0284c7";
                          const textColor = isOverdue ? "#EF4444" : isWarning ? "#D97706" : "#0284c7";

                          return (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, backgroundColor: badgeBg, borderColor: badgeBorder, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 }}>
                              <Ionicons name={isOverdue ? "alert-circle" : "alarm-outline"} size={16} color={textColor} />
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 11.5, fontWeight: "800", color: textColor }}>
                                  Jatuh Tempo: {formatFullDateTimeId(group.mainTx.due_date)}
                                </Text>
                                {rem && (
                                  <Text style={{ fontSize: 10.5, fontWeight: "700", color: textColor, marginTop: 1 }}>
                                    {isOverdue ? `⚠️ TERLAMBAT: ${rem.label}` : `⏱️ Sisa Waktu: ${rem.label}`}
                                  </Text>
                                )}
                              </View>
                            </View>
                          );
                        })()}

                        {/* Reviewed Info if Approved */}
                        {isApprovedTab && group.mainTx.reviewed_at && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, backgroundColor: isDark ? "rgba(34, 197, 94, 0.12)" : "#DCFCE7", borderColor: "#22C55E", borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                            <Ionicons name="shield-checkmark" size={15} color="#15803D" />
                            <Text style={{ fontSize: 11.5, fontWeight: "700", color: isDark ? "#4ADE80" : "#15803D" }}>
                              Disetujui: {formatFullDateTimeId(group.mainTx.reviewed_at)} {group.mainTx.reviewer?.full_name ? `• Oleh: ${group.mainTx.reviewer.full_name}` : ""}
                            </Text>
                          </View>
                        )}

                        {/* Official Letter Preview */}
                        {group.mainTx.document_url && (
                          <AnimatedPressable
                            onPress={() => setViewDocModal({ visible: true, url: group.mainTx.document_url!, name: group.mainTx.document_name || "Surat_Resmi" })}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                              marginTop: 6,
                              backgroundColor: "rgba(16, 185, 129, 0.12)",
                              borderColor: "rgba(16, 185, 129, 0.3)",
                              borderWidth: 1,
                              paddingHorizontal: 10,
                              paddingVertical: 7,
                              borderRadius: 8,
                            }}
                          >
                            <Ionicons name="document-text" size={16} color="#10b981" />
                            <Text style={{ fontSize: 12, fontWeight: "700", color: "#10b981", flex: 1 }} numberOfLines={1}>
                              Surat Resmi: {group.mainTx.document_name || "Lihat Dokumen"}
                            </Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                              <Text style={{ fontSize: 11, fontWeight: "700", color: "#10b981" }}>Tinjau</Text>
                              <Ionicons name="eye-outline" size={14} color="#10b981" />
                            </View>
                          </AnimatedPressable>
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

        {/* TAB 2: RIWAYAT & AUDIT TRANSAKSI */}
        {activeTab === "history" && (
          <View style={{ flex: 1, gap: 14 }}>
            {/* Header & Subtitle */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "800", color: theme.textPrimary }}>
                  Riwayat & Rekonsiliasi Audit HT
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                  Log pencatatan transaksi lengkap, timestamp detail, serta kontrol kepatuhan peminjaman.
                </Text>
              </View>

              <AnimatedPressable
                onPress={fetchHistory}
                style={{
                  backgroundColor: theme.isDark ? "rgba(255, 255, 255, 0.08)" : "#F1F5F9",
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Ionicons name="refresh" size={15} color={theme.textPrimary} />
                <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary }}>
                  Segarkan
                </Text>
              </AnimatedPressable>
            </View>

            {/* 4 KPI Summary Cards */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {/* Card 1: Total */}
              <View
                style={{
                  flex: 1,
                  minWidth: 140,
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.cardBorder,
                  borderWidth: 1,
                  borderRadius: 14,
                  padding: 12,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: theme.textSecondary }}>TOTAL TRANSAKSI</Text>
                  <Ionicons name="receipt-outline" size={16} color={theme.primary} />
                </View>
                <Text style={{ fontSize: 20, fontWeight: "800", color: theme.textPrimary }}>
                  {auditKPIs.total}
                </Text>
                <Text style={{ fontSize: 10.5, color: theme.textMuted }}>Data audit tercatat</Text>
              </View>

              {/* Card 2: Dipinjam */}
              <View
                style={{
                  flex: 1,
                  minWidth: 140,
                  backgroundColor: theme.isDark ? "rgba(2, 132, 199, 0.12)" : "#F0F9FF",
                  borderColor: theme.primary,
                  borderWidth: 1,
                  borderRadius: 14,
                  padding: 12,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: theme.primary }}>DIPINJAM AKTIF</Text>
                  <Ionicons name="radio-outline" size={16} color={theme.primary} />
                </View>
                <Text style={{ fontSize: 20, fontWeight: "800", color: theme.primary }}>
                  {auditKPIs.borrowedCount}
                </Text>
                <Text style={{ fontSize: 10.5, color: theme.primary }}>Sedang digunakan</Text>
              </View>

              {/* Card 3: Menunggu */}
              <View
                style={{
                  flex: 1,
                  minWidth: 140,
                  backgroundColor: theme.isDark ? "rgba(245, 158, 11, 0.12)" : "#FFFBEB",
                  borderColor: "#F59E0B",
                  borderWidth: 1,
                  borderRadius: 14,
                  padding: 12,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#D97706" }}>MENUNGGU</Text>
                  <Ionicons name="time-outline" size={16} color="#F59E0B" />
                </View>
                <Text style={{ fontSize: 20, fontWeight: "800", color: "#D97706" }}>
                  {auditKPIs.pendingCount}
                </Text>
                <Text style={{ fontSize: 10.5, color: "#D97706" }}>Perlu persetujuan</Text>
              </View>

              {/* Card 4: Overdue */}
              <View
                style={{
                  flex: 1,
                  minWidth: 140,
                  backgroundColor: theme.isDark ? "rgba(239, 68, 68, 0.12)" : "#FEF2F2",
                  borderColor: "#EF4444",
                  borderWidth: 1,
                  borderRadius: 14,
                  padding: 12,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#EF4444" }}>TERLAMBAT</Text>
                  <Ionicons name="alert-circle-outline" size={16} color="#EF4444" />
                </View>
                <Text style={{ fontSize: 20, fontWeight: "800", color: "#EF4444" }}>
                  {auditKPIs.overdueCount}
                </Text>
                <Text style={{ fontSize: 10.5, color: "#EF4444" }}>Melebihi batas tempo</Text>
              </View>
            </View>

            {/* Filter Pills & Search Input Row */}
            <View style={{ gap: 10 }}>
              {/* Search Bar */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: theme.inputBackground,
                  borderColor: theme.inputBorder,
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  height: 42,
                }}
              >
                <Ionicons name="search-outline" size={17} color={theme.primary} style={{ marginRight: 8 }} />
                <TextInput
                  value={historySearch}
                  onChangeText={setHistorySearch}
                  placeholder="Cari nama peminjam, NRP, kesatuan, kode HT, SN, atau batch..."
                  placeholderTextColor={theme.inputPlaceholder}
                  style={{ flex: 1, color: theme.inputText, fontSize: 13, fontWeight: "500" }}
                />
                {historySearch.length > 0 && (
                  <AnimatedPressable onPress={() => setHistorySearch("")} style={{ padding: 4 }}>
                    <Ionicons name="close-circle" size={17} color={theme.textMuted} />
                  </AnimatedPressable>
                )}
              </View>

              {/* Filter Pills */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: "row", gap: 8 }}>
                {[
                  { key: "ALL", label: "Semua Status" },
                  { key: "BORROWED", label: "Sedang Dipinjam" },
                  { key: "RETURNED", label: "Selesai (Kembali)" },
                  { key: "PENDING", label: "Menunggu" },
                  { key: "REJECTED", label: "Ditolak" },
                ].map((flt) => {
                  const isActive = historyFilter === flt.key;
                  return (
                    <AnimatedPressable
                      key={flt.key}
                      onPress={() => setHistoryFilter(flt.key as any)}
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 12,
                        borderRadius: 20,
                        backgroundColor: isActive
                          ? (theme.isDark ? "rgba(2, 132, 199, 0.25)" : "#E0F2FE")
                          : (theme.isDark ? "rgba(255, 255, 255, 0.05)" : "#F1F5F9"),
                        borderColor: isActive ? theme.primary : theme.cardBorder,
                        borderWidth: 1,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: isActive ? "800" : "600",
                          color: isActive ? theme.primary : theme.textSecondary,
                        }}
                      >
                        {flt.label}
                      </Text>
                    </AnimatedPressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Content List */}
            {loadingHistory ? (
              <View style={{ gap: 8 }}>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </View>
            ) : groupedHistoryTransactions.length === 0 ? (
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
                <Text style={{ fontSize: 36, marginBottom: 10 }}>📋</Text>
                <Text style={{ color: theme.textPrimary, fontWeight: "700", fontSize: 16, textAlign: "center" }}>
                  Tidak Ada Catatan Transaksi Ditemukan
                </Text>
                <Text style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4, fontSize: 13 }}>
                  {historySearch || historyFilter !== "ALL"
                    ? "Coba sesuaikan kata kunci pencarian atau ganti filter status."
                    : "Belum ada transaksi peminjaman atau pengembalian tercatat."}
                </Text>
              </View>
            ) : (
              <FlatList
                data={groupedHistoryTransactions}
                keyExtractor={(item) => item.id}
                removeClippedSubviews={true}
                maxToRenderPerBatch={6}
                initialNumToRender={6}
                windowSize={5}
                refreshControl={<RefreshControl refreshing={false} onRefresh={fetchHistory} tintColor={theme.primary} />}
                contentContainerStyle={{ paddingBottom: 60, gap: 12 }}
                renderItem={({ item: group }) => {
                  const tx = group.mainTx;
                  const isBorrow = tx.action === "BORROW";
                  const isApproved = tx.status === "APPROVED";
                  const isRejected = tx.status === "REJECTED";
                  const isPending = tx.status === "PENDING";
                  const rem = tx.due_date ? getRemainingTimeStatus(tx.due_date) : null;
                  const isBorrowedNow = isBorrow && (tx.asset?.status || "").toLowerCase() === "dipinjam";

                  return (
                    <AnimatedPressable
                      onPress={() => setSelectedHistoryModalGroup(group)}
                      style={{
                        backgroundColor: theme.cardBackground,
                        borderColor: isBorrowedNow ? theme.primary : theme.cardBorder,
                        borderWidth: 1,
                        borderRadius: 18,
                        padding: 16,
                        gap: 10,
                        shadowColor: theme.shadowColor,
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.08,
                        shadowRadius: 6,
                        elevation: 2,
                      }}
                    >
                      {/* Top Header Row */}
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                          <View
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 10,
                              backgroundColor: group.isBatch
                                ? (theme.isDark ? "rgba(2, 132, 199, 0.3)" : "#E0F2FE")
                                : isBorrow
                                ? (theme.isDark ? "rgba(2, 132, 199, 0.2)" : "#E0F2FE")
                                : (theme.isDark ? "rgba(34, 197, 94, 0.2)" : "#DCFCE7"),
                              justifyContent: "center",
                              alignItems: "center",
                            }}
                          >
                            <Ionicons
                              name={group.isBatch ? "layers" : isBorrow ? "arrow-up" : "arrow-down"}
                              size={16}
                              color={isBorrow ? theme.primary : "#22C55E"}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: "800", color: theme.textPrimary }}>
                              {group.isBatch ? `Peminjaman Batch (${group.items.length} Unit HT)` : (tx.asset?.name || "Unit HT")}
                            </Text>
                            <Text style={{ fontSize: 11, color: theme.primary, fontWeight: "700" }}>
                              {group.isBatch ? `REF: #${group.batch_code}` : `KODE: ${tx.asset?.code || "-"}`}
                            </Text>
                          </View>
                        </View>

                        {/* Status Badge */}
                        <View
                          style={{
                            paddingHorizontal: 9,
                            paddingVertical: 3.5,
                            borderRadius: 12,
                            backgroundColor: isApproved
                              ? (theme.isDark ? "rgba(34, 197, 94, 0.2)" : "#DCFCE7")
                              : isRejected
                              ? (theme.isDark ? "rgba(239, 68, 68, 0.2)" : "#FEE2E2")
                              : (theme.isDark ? "rgba(245, 158, 11, 0.2)" : "#FEF3C7"),
                            borderColor: isApproved ? "#22C55E" : isRejected ? "#EF4444" : "#F59E0B",
                            borderWidth: 1,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10.5,
                              fontWeight: "800",
                              color: isApproved ? "#22C55E" : isRejected ? "#EF4444" : "#D97706",
                            }}
                          >
                            {isApproved ? "DISETUJUI" : isRejected ? "DITOLAK" : "MENUNGGU"}
                          </Text>
                        </View>
                      </View>

                      {/* Divider */}
                      <View style={{ height: 1, backgroundColor: theme.cardBorder }} />

                      {/* Detail Data Grid */}
                      <View style={{ gap: 6 }}>
                        {/* Waktu Pengajuan */}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Ionicons name="calendar-outline" size={14} color={theme.textMuted} />
                          <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                            <Text style={{ fontWeight: "700", color: theme.textPrimary }}>Waktu Pengajuan: </Text>
                            {formatFullDateTimeId(tx.created_at)}
                          </Text>
                        </View>

                        {/* Peminjam Info */}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Ionicons name="person-outline" size={14} color={theme.textMuted} />
                          <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                            <Text style={{ fontWeight: "700", color: theme.textPrimary }}>Peminjam: </Text>
                            {tx.borrower_name || "-"} (NRP: {tx.borrower_nrp || "-"} • {tx.kesatuan || "-"})
                          </Text>
                        </View>

                        {/* Batch Breakdown or Single Info */}
                        {group.isBatch ? (
                          <View style={{ marginTop: 2, padding: 8, borderRadius: 10, backgroundColor: theme.isDark ? "rgba(255,255,255,0.03)" : "#F8FAFC", gap: 3 }}>
                            <Text style={{ fontSize: 11, fontWeight: "700", color: theme.primary, textTransform: "uppercase" }}>
                              Daftar Unit Dalam Batch ({group.items.length} HT):
                            </Text>
                            {group.items.slice(0, 4).map((it, idx) => (
                              <Text key={`${it.id}-${idx}`} numberOfLines={1} style={{ fontSize: 11.5, color: theme.textSecondary }}>
                                • {it.asset?.name || "HT"} ({it.asset?.code || "-"} | SN: {it.asset?.serial_number || "-"})
                              </Text>
                            ))}
                            {group.items.length > 4 && (
                              <Text style={{ fontSize: 11, color: theme.primary, fontWeight: "700" }}>
                                + {group.items.length - 4} unit HT lainnya...
                              </Text>
                            )}
                          </View>
                        ) : (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Ionicons name="hardware-chip-outline" size={14} color={theme.textMuted} />
                            <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                              <Text style={{ fontWeight: "700", color: theme.textPrimary }}>Perangkat: </Text>
                              SN: {tx.asset?.serial_number || "-"} • Kondisi: {tx.condition ? tx.condition.toUpperCase() : "BAIK"}
                            </Text>
                          </View>
                        )}

                        {/* Batas Waktu Pengembalian & Sisa Waktu */}
                        {tx.due_date && (() => {
                          const isOverdue = rem?.isOverdue;
                          const isWarning = rem?.urgentLevel === "warning";
                          const badgeBg = isOverdue
                            ? (theme.isDark ? "rgba(239, 68, 68, 0.15)" : "#FEE2E2")
                            : isWarning
                            ? (theme.isDark ? "rgba(245, 158, 11, 0.15)" : "#FEF3C7")
                            : (theme.isDark ? "rgba(14, 165, 233, 0.12)" : "#E0F2FE");
                          const badgeBorder = isOverdue ? "#EF4444" : isWarning ? "#F59E0B" : "#0284c7";
                          const textColor = isOverdue ? "#EF4444" : isWarning ? "#D97706" : "#0284c7";

                          return (
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 6,
                                marginTop: 4,
                                backgroundColor: badgeBg,
                                borderColor: badgeBorder,
                                borderWidth: 1,
                                paddingHorizontal: 9,
                                paddingVertical: 5,
                                borderRadius: 8,
                              }}
                            >
                              <Ionicons name={isOverdue ? "alert-circle" : "alarm-outline"} size={15} color={textColor} />
                              <Text style={{ fontSize: 11.5, fontWeight: "700", color: textColor, flex: 1 }}>
                                Batas: {formatFullDateTimeId(tx.due_date)} {rem ? `(${rem.label})` : ""}
                              </Text>
                              <Text style={{ fontSize: 10, fontWeight: "800", color: textColor, textTransform: "uppercase" }}>
                                {isOverdue ? "TERLAMBAT" : isWarning ? "MENDEKATI BATAS" : "AMAN"}
                              </Text>
                            </View>
                          );
                        })()}

                        {/* Reviewer / Verifikator Info */}
                        {tx.reviewed_at && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                            <Ionicons name="shield-checkmark-outline" size={14} color="#22C55E" />
                            <Text style={{ fontSize: 11.5, color: theme.textSecondary }}>
                              Disetujui: {formatFullDateTimeId(tx.reviewed_at)} {tx.reviewer?.full_name ? `oleh ${tx.reviewer.full_name}` : ""}
                            </Text>
                          </View>
                        )}

                        {/* Surat Resmi Button Preview */}
                        {tx.document_url && (
                          <AnimatedPressable
                            onPress={(e) => {
                              e.stopPropagation();
                              setViewDocModal({
                                visible: true,
                                url: tx.document_url!,
                                name: tx.document_name || "Surat_Resmi",
                              });
                            }}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                              marginTop: 4,
                              paddingVertical: 6,
                              paddingHorizontal: 10,
                              backgroundColor: "rgba(16, 185, 129, 0.12)",
                              borderColor: "rgba(16, 185, 129, 0.3)",
                              borderWidth: 1,
                              borderRadius: 8,
                              alignSelf: "flex-start",
                            }}
                          >
                            <Ionicons name="document-text" size={14} color="#10b981" />
                            <Text style={{ fontSize: 11.5, fontWeight: "700", color: "#10b981" }}>
                              Surat Resmi Terlampir: {tx.document_name || "Tinjau"}
                            </Text>
                          </AnimatedPressable>
                        )}
                      </View>

                      {/* Card Action Bar */}
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.cardBorder }}>
                        <Text style={{ fontSize: 11, color: theme.textMuted }}>
                          {tx.action === "BORROW" ? "Peminjaman" : "Pengembalian"}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          {isApproved && (
                            <AnimatedPressable
                              onPress={(e) => {
                                e.stopPropagation();
                                router.push(`/loan-qr/${group.batch_id || tx.id}`);
                              }}
                              style={{
                                backgroundColor: "#22C55E",
                                paddingHorizontal: 10,
                                paddingVertical: 5,
                                borderRadius: 8,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <Ionicons name="qr-code" size={13} color="#FFFFFF" />
                              <Text style={{ fontSize: 11, fontWeight: "800", color: "#FFFFFF" }}>
                                📷 QR Serah Terima
                              </Text>
                            </AnimatedPressable>
                          )}

                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Text style={{ fontSize: 11.5, fontWeight: "700", color: theme.primary }}>
                              Detail & Slip Bukti
                            </Text>
                            <Ionicons name="chevron-forward" size={13} color={theme.primary} />
                          </View>
                        </View>
                      </View>
                    </AnimatedPressable>
                  );
                }}
              />
            )}
          </View>
        )}

        {/* TAB 3: DATA ASET (MASTER CRUD) */}
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
        {/* TAB 4: DURATION PRESETS MANAGEMENT (Admin Custom) */}
        {activeTab === "presets" && (
          <View style={{ gap: 14 }}>
            {/* Header & Add Button */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "800", color: theme.textPrimary }}>
                  Preset Durasi Peminjaman
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                  Opsi durasi yang dapat dipilih anggota saat mengajukan peminjaman HT.
                </Text>
              </View>

              <AnimatedPressable
                onPress={() => openPresetForm()}
                style={{
                  backgroundColor: theme.primary,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Ionicons name="add" size={18} color={theme.primaryTextOnButton} />
                <Text style={{ color: theme.primaryTextOnButton, fontWeight: "700", fontSize: 12.5 }}>
                  Tambah
                </Text>
              </AnimatedPressable>
            </View>

            {loadingPresets ? (
              <View style={{ gap: 8 }}>
                <SkeletonCard />
                <SkeletonCard />
              </View>
            ) : presetsList.length === 0 ? (
              <View
                style={{
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.cardBorder,
                  borderWidth: 1,
                  borderRadius: 20,
                  padding: 32,
                  alignItems: "center",
                  marginTop: 12,
                }}
              >
                <Text style={{ fontSize: 36, marginBottom: 10 }}>⏱️</Text>
                <Text style={{ color: theme.textPrimary, fontWeight: "700", fontSize: 15, textAlign: "center" }}>
                  Belum Ada Preset Durasi
                </Text>
                <Text style={{ color: theme.textSecondary, textAlign: "center", fontSize: 12.5, marginTop: 4 }}>
                  Tambahkan pilihan durasi peminjaman standar untuk memudahkan anggota.
                </Text>
                <AnimatedPressable
                  onPress={() => openPresetForm()}
                  style={{
                    marginTop: 14,
                    backgroundColor: theme.primary,
                    paddingHorizontal: 16,
                    paddingVertical: 9,
                    borderRadius: 12,
                  }}
                >
                  <Text style={{ color: theme.primaryTextOnButton, fontWeight: "700", fontSize: 13 }}>
                    + Tambah Preset Pertama
                  </Text>
                </AnimatedPressable>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {presetsList.map((preset) => (
                  <View
                    key={preset.id}
                    style={{
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.cardBorder,
                      borderWidth: 1,
                      borderRadius: 16,
                      padding: 14,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      shadowColor: theme.shadowColor,
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.08,
                      shadowRadius: 6,
                      elevation: 2,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          backgroundColor: preset.is_active ? "rgba(14, 165, 233, 0.15)" : "rgba(148, 163, 184, 0.15)",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name="time"
                          size={20}
                          color={preset.is_active ? theme.primary : "#94a3b8"}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ fontSize: 14, fontWeight: "700", color: theme.textPrimary }}>
                            {preset.label}
                          </Text>
                          <View
                            style={{
                              backgroundColor: preset.is_active ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 6,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 10,
                                fontWeight: "800",
                                color: preset.is_active ? "#10b981" : "#ef4444",
                              }}
                            >
                              {preset.is_active ? "AKTIF" : "NONAKTIF"}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                          Durasi: {preset.duration_hours} Jam {preset.duration_hours >= 24 ? `(${Math.floor(preset.duration_hours / 24)} Hari)` : ""}
                        </Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      {/* Toggle Active Button */}
                      <AnimatedPressable
                        onPress={() => handleTogglePresetActive(preset)}
                        style={{
                          padding: 8,
                          borderRadius: 8,
                          backgroundColor: preset.is_active ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.1)",
                        }}
                        accessibilityLabel="Ubah Status Aktif"
                      >
                        <Ionicons
                          name={preset.is_active ? "pause-outline" : "play-outline"}
                          size={16}
                          color={preset.is_active ? "#ef4444" : "#10b981"}
                        />
                      </AnimatedPressable>

                      {/* Edit Button */}
                      <AnimatedPressable
                        onPress={() => openPresetForm(preset)}
                        style={{
                          padding: 8,
                          borderRadius: 8,
                          backgroundColor: theme.primary + "15",
                        }}
                        accessibilityLabel="Edit Preset"
                      >
                        <Ionicons name="pencil-outline" size={16} color={theme.primary} />
                      </AnimatedPressable>

                      {/* Delete Button */}
                      <AnimatedPressable
                        onPress={() => handleDeletePreset(preset)}
                        style={{
                          padding: 8,
                          borderRadius: 8,
                          backgroundColor: "rgba(239, 68, 68, 0.12)",
                        }}
                        accessibilityLabel="Hapus Preset"
                      >
                        <Ionicons name="trash-outline" size={16} color="#ef4444" />
                      </AnimatedPressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
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

                  {selectedBatchModalGroup.mainTx.due_date && (
                    <View style={{ marginTop: 6, padding: 8, borderRadius: 8, backgroundColor: "rgba(14, 165, 233, 0.1)" }}>
                      <Text style={{ fontSize: 11.5, fontWeight: "700", color: "#0284c7" }}>
                        ⏱️ Batas Waktu Pengembalian: {formatFullDateTimeId(selectedBatchModalGroup.mainTx.due_date)}
                      </Text>
                    </View>
                  )}

                  {selectedBatchModalGroup.mainTx.document_url && (
                    <AnimatedPressable
                      onPress={() => setViewDocModal({ visible: true, url: selectedBatchModalGroup.mainTx.document_url!, name: selectedBatchModalGroup.mainTx.document_name || "Surat_Resmi_Batch" })}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 6,
                        padding: 8,
                        borderRadius: 8,
                        backgroundColor: "rgba(16, 185, 129, 0.15)",
                        borderWidth: 1,
                        borderColor: "rgba(16, 185, 129, 0.3)",
                      }}
                    >
                      <Ionicons name="document-text" size={16} color="#10b981" />
                      <Text style={{ fontSize: 12, fontWeight: "700", color: "#10b981", flex: 1 }}>
                        Surat Resmi: {selectedBatchModalGroup.mainTx.document_name || "Lihat Dokumen"}
                      </Text>
                      <Ionicons name="eye-outline" size={14} color="#10b981" />
                    </AnimatedPressable>
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

      {/* Official Document Viewer Modal */}
      <DocumentViewerModal
        visible={viewDocModal.visible}
        onClose={() => setViewDocModal((prev) => ({ ...prev, visible: false }))}
        documentUrl={viewDocModal.url}
        documentName={viewDocModal.name}
        title="Surat Perintah / Resmi (Lampiran)"
      />

      {/* Form Add / Edit Loan Duration Preset Modal */}
      {presetModalVisible && (
        <Modal visible={presetModalVisible} transparent animationType="fade">
          <View style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.65)", justifyContent: "center", padding: 20 }}>
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
                {editingPreset ? "Edit Preset Durasi" : "Tambah Preset Durasi Baru"}
              </Text>
              <Text style={{ color: theme.textSecondary, fontSize: 12.5, textAlign: "center" }}>
                Atur durasi standar tugas peminjaman unit HT.
              </Text>

              <View>
                <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>
                  Label Preset (Contoh: "12 Jam (Piket)"):
                </Text>
                <TextInput
                  value={presetLabel}
                  onChangeText={setPresetLabel}
                  placeholder="Contoh: 3 Hari (Operasi Lilin)"
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
                  Durasi Dalam Jam:
                </Text>
                <TextInput
                  value={presetHours}
                  onChangeText={setPresetHours}
                  keyboardType="numeric"
                  placeholder="Contoh: 72"
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

              <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                <AnimatedPressable
                  onPress={() => setPresetModalVisible(false)}
                  style={{
                    flex: 1,
                    backgroundColor: theme.isDark ? "rgba(255, 255, 255, 0.08)" : "#F1F5F9",
                    paddingVertical: 13,
                    borderRadius: 12,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: theme.textSecondary, fontWeight: "700", fontSize: 13.5 }}>Batal</Text>
                </AnimatedPressable>

                <AnimatedPressable
                  onPress={handleSavePreset}
                  disabled={presetSubmitting}
                  style={{
                    flex: 1,
                    backgroundColor: theme.primary,
                    paddingVertical: 13,
                    borderRadius: 12,
                    alignItems: "center",
                  }}
                >
                  {presetSubmitting ? (
                    <ActivityIndicator color={theme.primaryTextOnButton} />
                  ) : (
                    <Text style={{ color: theme.primaryTextOnButton, fontWeight: "700", fontSize: 13.5 }}>
                      Simpan Preset
                    </Text>
                  )}
                </AnimatedPressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* MODAL: Digital Audit Slip / Receipt for History Group */}
      {selectedHistoryModalGroup && (
        <Modal
          visible={!!selectedHistoryModalGroup}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedHistoryModalGroup(null)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.65)",
              justifyContent: "center",
              alignItems: "center",
              paddingHorizontal: 20,
              paddingVertical: 24,
            }}
          >
            <View
              style={{
                width: "100%",
                maxWidth: 480,
                backgroundColor: theme.cardBackground,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: theme.cardBorder,
                overflow: "hidden",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 16 },
                shadowOpacity: 0.35,
                shadowRadius: 28,
                elevation: 20,
              }}
            >
              {/* Header Banner */}
              <LinearGradient
                colors={isDark ? ["#0284C7", "#1E3A8A"] : ["#0284C7", "#0369A1"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, alignItems: "center" }}
              >
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 23,
                    backgroundColor: "rgba(255, 255, 255, 0.2)",
                    borderWidth: 1.5,
                    borderColor: "rgba(255, 255, 255, 0.4)",
                    justifyContent: "center",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <Ionicons
                    name={selectedHistoryModalGroup.isBatch ? "layers" : "radio"}
                    size={22}
                    color="#FFFFFF"
                  />
                </View>

                <Text style={{ fontSize: 16.5, fontWeight: "800", color: "#FFFFFF", textAlign: "center" }}>
                  {selectedHistoryModalGroup.isBatch
                    ? `Bukti Audit Peminjaman Batch (${selectedHistoryModalGroup.items.length} HT)`
                    : "Lembar Bukti & Audit Transaksi HT"}
                </Text>
                <Text style={{ fontSize: 11.5, color: "rgba(255, 255, 255, 0.85)", marginTop: 2 }}>
                  Kepolisian Resor Kota • Rekonsiliasi Logistik
                </Text>

                <View style={{ marginTop: 8, backgroundColor: "rgba(0, 0, 0, 0.25)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 }}>
                  <Text style={{ color: "rgba(255, 255, 255, 0.95)", fontSize: 11, fontWeight: "800" }}>
                    {selectedHistoryModalGroup.isBatch
                      ? `REF: #${selectedHistoryModalGroup.batch_code}`
                      : `ID: #${selectedHistoryModalGroup.mainTx.id.slice(0, 8).toUpperCase()}`}
                  </Text>
                </View>
              </LinearGradient>

              {/* Body Content */}
              <ScrollView style={{ maxHeight: 420, paddingHorizontal: 20, paddingVertical: 14 }}>
                {/* Status & Action */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.cardBorder }}>
                  <Text style={{ fontSize: 12, color: theme.textSecondary, fontWeight: "600" }}>
                    Status & Jenis Transaksi
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View
                      style={{
                        backgroundColor: selectedHistoryModalGroup.mainTx.action === "BORROW" ? "rgba(2, 132, 199, 0.15)" : "rgba(34, 197, 94, 0.15)",
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 8,
                      }}
                    >
                      <Text style={{ fontSize: 10.5, fontWeight: "800", color: selectedHistoryModalGroup.mainTx.action === "BORROW" ? theme.primary : "#22C55E" }}>
                        {selectedHistoryModalGroup.mainTx.action === "BORROW" ? "PEMINJAMAN" : "PENGEMBALIAN"}
                      </Text>
                    </View>

                    <View
                      style={{
                        backgroundColor: selectedHistoryModalGroup.mainTx.status === "APPROVED"
                          ? "rgba(34, 197, 94, 0.15)"
                          : selectedHistoryModalGroup.mainTx.status === "REJECTED"
                          ? "rgba(239, 68, 68, 0.15)"
                          : "rgba(245, 158, 11, 0.15)",
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 8,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 10.5,
                          fontWeight: "800",
                          color: selectedHistoryModalGroup.mainTx.status === "APPROVED"
                            ? "#22C55E"
                            : selectedHistoryModalGroup.mainTx.status === "REJECTED"
                            ? "#EF4444"
                            : "#D97706",
                        }}
                      >
                        {selectedHistoryModalGroup.mainTx.status}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Audit Timestamp Timeline Box */}
                <View
                  style={{
                    backgroundColor: isDark ? "rgba(255, 255, 255, 0.03)" : "#F8FAFC",
                    borderRadius: 14,
                    padding: 12,
                    marginVertical: 12,
                    borderWidth: 1,
                    borderColor: theme.cardBorder,
                    gap: 8,
                  }}
                >
                  <Text style={{ fontSize: 11.5, fontWeight: "800", color: theme.primary, textTransform: "uppercase" }}>
                    Kronologi & Catatan Waktu (Timestamp Audit):
                  </Text>

                  {/* Waktu Pengajuan */}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 12, color: theme.textSecondary }}>Waktu Pengajuan:</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary }}>
                      {formatFullDateTimeId(selectedHistoryModalGroup.mainTx.created_at)}
                    </Text>
                  </View>

                  {/* Batas Waktu Pengembalian */}
                  {selectedHistoryModalGroup.mainTx.due_date && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 12, color: theme.textSecondary }}>Batas Pengembalian:</Text>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: "#0284c7" }}>
                        {formatFullDateTimeId(selectedHistoryModalGroup.mainTx.due_date)}
                      </Text>
                    </View>
                  )}

                  {/* Status Sisa Waktu */}
                  {selectedHistoryModalGroup.mainTx.due_date && (() => {
                    const rem = getRemainingTimeStatus(selectedHistoryModalGroup.mainTx.due_date);
                    if (!rem) return null;
                    return (
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ fontSize: 12, color: theme.textSecondary }}>Kepatuhan Waktu:</Text>
                        <Text style={{ fontSize: 11.5, fontWeight: "800", color: rem.isOverdue ? "#EF4444" : rem.urgentLevel === "warning" ? "#D97706" : "#22C55E" }}>
                          {rem.isOverdue ? `⚠️ Terlambat: ${rem.label}` : `⏱️ Sisa: ${rem.label}`}
                        </Text>
                      </View>
                    );
                  })()}

                  {/* Waktu Persetujuan & Verifikator */}
                  {selectedHistoryModalGroup.mainTx.reviewed_at && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 12, color: theme.textSecondary }}>Waktu Disetujui:</Text>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: "#22C55E" }}>
                        {formatFullDateTimeId(selectedHistoryModalGroup.mainTx.reviewed_at)}
                      </Text>
                    </View>
                  )}

                  {selectedHistoryModalGroup.mainTx.reviewer && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 12, color: theme.textSecondary }}>Verifikator Admin:</Text>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: "#22C55E" }}>
                        {selectedHistoryModalGroup.mainTx.reviewer.full_name}
                      </Text>
                    </View>
                  )}

                  {selectedHistoryModalGroup.mainTx.rejection_reason && (
                    <View style={{ marginTop: 2, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.cardBorder }}>
                      <Text style={{ fontSize: 11, color: "#EF4444", fontWeight: "700" }}>
                        Alasan Penolakan: "{selectedHistoryModalGroup.mainTx.rejection_reason}"
                      </Text>
                    </View>
                  )}
                </View>

                {/* Borrower Details */}
                <View style={{ gap: 6, marginBottom: 12 }}>
                  <Text style={{ fontSize: 11.5, fontWeight: "800", color: theme.textPrimary, textTransform: "uppercase" }}>
                    Identitas Petugas Peminjam:
                  </Text>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 12, color: theme.textSecondary }}>Nama Petugas:</Text>
                    <Text style={{ fontSize: 12.5, fontWeight: "700", color: theme.textPrimary }}>
                      {selectedHistoryModalGroup.mainTx.borrower_name || "-"}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 12, color: theme.textSecondary }}>Pangkat / NRP:</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary }}>
                      {selectedHistoryModalGroup.mainTx.borrower_nrp || "-"}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 12, color: theme.textSecondary }}>Kesatuan / Bagian:</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary }}>
                      {selectedHistoryModalGroup.mainTx.kesatuan || "-"}
                    </Text>
                  </View>
                  {selectedHistoryModalGroup.mainTx.notes && (
                    <View style={{ marginTop: 2 }}>
                      <Text style={{ fontSize: 11, color: theme.textMuted }}>Keperluan / Tugas:</Text>
                      <Text style={{ fontSize: 12, fontStyle: "italic", color: theme.textPrimary, marginTop: 1 }}>
                        "{selectedHistoryModalGroup.mainTx.notes}"
                      </Text>
                    </View>
                  )}
                </View>

                {/* Surat Perintah Resmi */}
                {selectedHistoryModalGroup.mainTx.document_url && (
                  <AnimatedPressable
                    onPress={() =>
                      setViewDocModal({
                        visible: true,
                        url: selectedHistoryModalGroup.mainTx.document_url!,
                        name: selectedHistoryModalGroup.mainTx.document_name || "Surat_Resmi",
                      })
                    }
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      padding: 10,
                      backgroundColor: "rgba(16, 185, 129, 0.12)",
                      borderColor: "rgba(16, 185, 129, 0.3)",
                      borderWidth: 1,
                      borderRadius: 12,
                      marginBottom: 12,
                    }}
                  >
                    <Ionicons name="document-text" size={18} color="#10b981" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: "#10b981" }}>
                        Surat Perintah / Dokumen Kedinasan
                      </Text>
                      <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                        {selectedHistoryModalGroup.mainTx.document_name || "Lampiran resmi tersedia"}
                      </Text>
                    </View>
                    <Ionicons name="eye-outline" size={16} color="#10b981" />
                  </AnimatedPressable>
                )}

                {/* Items Breakdown */}
                <View style={{ gap: 6, marginBottom: 16 }}>
                  <Text style={{ fontSize: 11.5, fontWeight: "800", color: theme.textPrimary, textTransform: "uppercase" }}>
                    Daftar Unit Handy Talky ({selectedHistoryModalGroup.items.length} Unit):
                  </Text>
                  {selectedHistoryModalGroup.items.map((it, idx) => (
                    <View
                      key={`${it.id}-${idx}`}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "#F8FAFC",
                        padding: 10,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: theme.cardBorder,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12.5, fontWeight: "700", color: theme.textPrimary }}>
                          {idx + 1}. {it.asset?.name || "Unit HT"}
                        </Text>
                        <Text style={{ fontSize: 11, color: theme.textSecondary, marginTop: 1 }}>
                          Kode: {it.asset?.code || "-"} • SN: {it.asset?.serial_number || "-"}
                        </Text>
                      </View>
                      <StatusBadge status={it.asset?.status || "tersedia"} />
                    </View>
                  ))}
                </View>
              </ScrollView>

              {/* Action Buttons */}
              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                  padding: 16,
                  backgroundColor: isDark ? "rgba(0, 0, 0, 0.25)" : "#F8FAFC",
                  borderTopWidth: 1,
                  borderTopColor: theme.cardBorder,
                }}
              >
                <AnimatedPressable
                  onPress={() => handleShareAuditSlip(selectedHistoryModalGroup)}
                  style={{
                    flex: 1.2,
                    backgroundColor: theme.primary,
                    paddingVertical: 12,
                    borderRadius: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <Ionicons name="share-social-outline" size={16} color={theme.primaryTextOnButton} />
                  <Text style={{ fontSize: 13, fontWeight: "800", color: theme.primaryTextOnButton }}>
                    Bagikan / Salin
                  </Text>
                </AnimatedPressable>

                {selectedHistoryModalGroup.mainTx.status === "APPROVED" && (
                  <AnimatedPressable
                    onPress={() => {
                      const grp = selectedHistoryModalGroup;
                      setSelectedHistoryModalGroup(null);
                      router.push(`/loan-qr/${grp.batch_id || grp.mainTx.id}`);
                    }}
                    style={{
                      flex: 1,
                      backgroundColor: "#22C55E",
                      paddingVertical: 12,
                      borderRadius: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <Ionicons name="qr-code" size={16} color="#FFFFFF" />
                    <Text style={{ fontSize: 13, fontWeight: "800", color: "#FFFFFF" }}>
                      QR Serah Terima
                    </Text>
                  </AnimatedPressable>
                )}

                <AnimatedPressable
                  onPress={() => setSelectedHistoryModalGroup(null)}
                  style={{
                    flex: 0.8,
                    backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "#E2E8F0",
                    paddingVertical: 12,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: "700", color: theme.textSecondary }}>
                    Tutup
                  </Text>
                </AnimatedPressable>
              </View>
            </View>
          </View>
        </Modal>
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
          onConfirm={() => setToastConfig((prev) => ({ ...prev, visible: false }))}
        />
      )}
      </View>
    </LinearGradient>
  );
}
