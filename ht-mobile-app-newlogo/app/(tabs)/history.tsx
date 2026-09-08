import React, { useCallback, useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TextInput,
  Modal,
  ScrollView,
  Platform,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeHaptics } from "@/lib/safeHaptics";
import { SafeAlert } from "@/lib/safeAlert";
import { shareOrCopyText } from "@/lib/safeShare";
import Animated, { ZoomIn, ZoomOut } from "react-native-reanimated";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useAppTheme } from "@/context/ThemeContext";
import { useTheme } from "@/hooks/useTheme";
import { SkeletonCard } from "@/components/SkeletonCard";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { StatusBadge } from "@/components/StatusBadge";
import { LoanBatchQRModal } from "@/components/LoanBatchQRModal";
import { DocumentViewerModal } from "@/components/DocumentViewerModal";
import { formatFullDateTimeId, formatShortDateTimeId, getRemainingTimeStatus } from "@/lib/dateUtils";
import type { Transaction, TransactionStatus } from "@/types/database";

interface AssetStateLog {
  id: string;
  asset_id: string;
  from_state: string | null;
  to_state: string;
  triggered_by: string | null;
  reason: string | null;
  created_at: string;
  asset?: { name: string; code: string; serial_number?: string };
  triggerer?: { full_name: string };
}

type QuickFilterType = "ALL" | "BORROW" | "RETURN" | "PENDING" | "REJECTED";

interface GroupedTransaction {
  id: string;
  isBatch: boolean;
  batch_id?: string | null;
  batch_code?: string | null;
  items: Transaction[];
  mainTx: Transaction;
}

interface HistoryListItemProps {
  group: GroupedTransaction;
  isAdmin: boolean;
  onPress: () => void;
  onOpenQR: () => void;
}

const HistoryListItem = ({ group, isAdmin, onPress, onOpenQR }: HistoryListItemProps) => {
  const { colors, isDark } = useTheme();
  const item = group.mainTx;
  const isBorrow = item.action === "BORROW";

  const getBadge = (status: string | null | undefined) => {
    const norm = (status || "").toUpperCase();
    switch (norm) {
      case "APPROVED":
        return {
          label: "Disetujui / Selesai",
          bg: isDark ? "rgba(34, 197, 94, 0.16)" : "#DCFCE7",
          text: isDark ? "#4ADE80" : "#15803D",
          border: isDark ? "rgba(74, 222, 128, 0.3)" : "#86EFAC",
          icon: "checkmark-circle",
        };
      case "REJECTED":
        return {
          label: "Ditolak",
          bg: isDark ? "rgba(239, 68, 68, 0.16)" : "#FEE2E2",
          text: isDark ? "#F87171" : "#B91C1C",
          border: isDark ? "rgba(248, 113, 113, 0.3)" : "#FCA5A5",
          icon: "close-circle",
        };
      case "PENDING":
      default:
        return {
          label: norm === "PENDING" ? "Menunggu Verifikasi" : (status || "Menunggu"),
          bg: isDark ? "rgba(245, 158, 11, 0.16)" : "#FEF3C7",
          text: isDark ? "#FBBF24" : "#D97706",
          border: isDark ? "rgba(245, 158, 11, 0.3)" : "#FCD34D",
          icon: "time",
        };
    }
  };

  const badge = getBadge(item.status);

  return (
    <AnimatedPressable
      onPress={onPress}
      style={{
        backgroundColor: colors.cardBackground,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: group.isBatch ? colors.primary : colors.cardBorder,
        marginBottom: 10,
        overflow: "hidden",
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: isDark ? 0.2 : 0.06,
        shadowRadius: 8,
        elevation: 2,
      }}
    >
      {/* Top Header Row */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              backgroundColor: group.isBatch
                ? (isDark ? "rgba(2, 132, 199, 0.3)" : "rgba(2, 132, 199, 0.15)")
                : isBorrow
                ? (isDark ? "rgba(2, 132, 199, 0.2)" : "rgba(2, 132, 199, 0.12)")
                : (isDark ? "rgba(34, 197, 94, 0.2)" : "rgba(34, 197, 94, 0.12)"),
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Ionicons
              name={group.isBatch ? "layers" : isBorrow ? "arrow-up" : "arrow-down"}
              size={16}
              color={isBorrow ? colors.primary : "#22C55E"}
            />
          </View>

          <View>
            <Text style={{ fontSize: 11, fontWeight: "800", color: isBorrow ? colors.primary : "#22C55E", textTransform: "uppercase" }}>
              {group.isBatch ? `Peminjaman Batch (${group.items.length} HT)` : isBorrow ? "Peminjaman HT" : "Pengembalian HT"}
            </Text>
            <Text style={{ fontSize: 10, color: colors.textMuted }}>
              {new Date(item.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB
            </Text>
          </View>
        </View>

        {/* Status Badge */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            backgroundColor: badge.bg,
            borderColor: badge.border,
            borderWidth: 1,
            paddingHorizontal: 8,
            paddingVertical: 3.5,
            borderRadius: 12,
          }}
        >
          <Ionicons name={badge.icon as any} size={11} color={badge.text} />
          <Text style={{ fontSize: 10.5, fontWeight: "800", color: badge.text }}>
            {badge.label}
          </Text>
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: colors.cardBorder, marginHorizontal: 16 }} />

      {/* Main Body Info */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 11 }}>
        {group.isBatch ? (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 15, fontWeight: "800", color: colors.textPrimary }}>
                {group.items.length} Unit Handy Talky
              </Text>
              <View style={{ backgroundColor: isDark ? "rgba(56, 189, 248, 0.18)" : "rgba(2, 132, 199, 0.1)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: colors.primary }}>
                  {group.batch_code}
                </Text>
              </View>
            </View>

            {/* List of HTs snippet */}
            <View style={{ gap: 3, marginTop: 2 }}>
              {group.items.slice(0, 3).map((it, idx) => (
                <Text key={`${it.id}-${idx}`} numberOfLines={1} style={{ fontSize: 11.5, color: colors.textSecondary }}>
                  • {it.asset?.name || "HT"} (Kode: {it.asset?.code || "-"} | SN: {it.asset?.serial_number || "-"})
                </Text>
              ))}
              {group.items.length > 3 && (
                <Text style={{ fontSize: 11, color: colors.primary, fontWeight: "700" }}>
                  + {group.items.length - 3} unit HT lainnya...
                </Text>
              )}
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "800", color: colors.textPrimary }}>
                {item.asset?.name || "Unit HT"}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 1 }}>
                SN: {item.asset?.serial_number || "-"} • Kode: {item.asset?.code || "-"}
              </Text>
            </View>

            <View style={{ backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "#F1F5F9", paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: 7 }}>
              <Text style={{ fontSize: 11, fontWeight: "800", color: colors.primary }}>
                {item.asset?.code || "HT"}
              </Text>
            </View>
          </View>
        )}

        {/* Borrower Info Box */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: isDark ? "rgba(255, 255, 255, 0.03)" : "#F8FAFC",
            borderRadius: 10,
            padding: 9,
            marginTop: 9,
            borderWidth: 1,
            borderColor: isDark ? "rgba(255, 255, 255, 0.06)" : "#E2E8F0",
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: "600" }}>
              Petugas Peminjam
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: "700", color: colors.textPrimary, marginTop: 1 }}>
              {item.borrower_name || "Anggota Petugas"}
            </Text>
          </View>

          <View style={{ width: 1, height: 22, backgroundColor: colors.cardBorder }} />

          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: "600" }}>
              Kesatuan / NRP
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: "700", color: colors.textPrimary, marginTop: 1 }}>
              {item.kesatuan || item.borrower_nrp || "-"}
            </Text>
          </View>
        </View>

        {/* Due Date & Document Badges */}
        {item.due_date && (() => {
          const rem = getRemainingTimeStatus(item.due_date);
          const isOver = rem?.isOverdue;
          return (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                marginTop: 8,
                backgroundColor: isOver
                  ? "rgba(239, 68, 68, 0.12)"
                  : rem?.urgentLevel === "warning"
                  ? "rgba(245, 158, 11, 0.12)"
                  : "rgba(14, 165, 233, 0.1)",
                borderColor: isOver ? "#ef4444" : rem?.urgentLevel === "warning" ? "#f59e0b" : "#0284c7",
                borderWidth: 1,
                paddingHorizontal: 8,
                paddingVertical: 3.5,
                borderRadius: 7,
                alignSelf: "flex-start",
              }}
            >
              <Ionicons
                name={isOver ? "alert-circle" : "alarm-outline"}
                size={12}
                color={isOver ? "#ef4444" : rem?.urgentLevel === "warning" ? "#d97706" : "#0284c7"}
              />
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "700",
                  color: isOver ? "#ef4444" : rem?.urgentLevel === "warning" ? "#d97706" : "#0284c7",
                }}
              >
                {rem?.text} (Batas: {formatShortDateTimeId(item.due_date)})
              </Text>
            </View>
          );
        })()}
        {item.document_url && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4, alignSelf: "flex-start" }}>
            <Ionicons name="document-text" size={12} color="#10b981" />
            <Text style={{ fontSize: 11, fontWeight: "600", color: "#10b981" }}>
              Surat Resmi Terlampir
            </Text>
          </View>
        )}
      </View>

      {/* Card Footer Bar */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: isDark ? "rgba(0, 0, 0, 0.15)" : "#F8FAFC",
          paddingHorizontal: 16,
          paddingVertical: 9,
          borderTopWidth: 1,
          borderTopColor: colors.cardBorder,
        }}
      >
        <Text style={{ fontSize: 11, color: colors.textMuted }}>
          Ref: {group.isBatch ? group.batch_code : `HT-${item.id.slice(0, 8).toUpperCase()}`}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {isAdmin && ((item.status as string) === "APPROVED" || (item.status as string) === "RETURN_APPROVED" || item.asset?.status === "dipinjam") && (
            <AnimatedPressable
              onPress={(e) => {
                e.stopPropagation();
                onOpenQR();
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
                📷 QR Code & Serah Terima
              </Text>
            </AnimatedPressable>
          )}

          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.primary }}>
              Lihat Rincian Bukti
            </Text>
            <Ionicons name="chevron-forward" size={12} color={colors.primary} />
          </View>
        </View>
      </View>
    </AnimatedPressable>
  );
};

interface FsmLogListItemProps {
  item: AssetStateLog;
}

const FsmLogListItem = ({ item }: FsmLogListItemProps) => {
  const { colors } = useTheme();

  return (
    <View
      style={{
        backgroundColor: colors.cardBackground,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        padding: 14,
        marginBottom: 10,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <Text style={{ fontSize: 14, fontWeight: "800", color: colors.textPrimary }}>
          {item.asset?.name || "Unit HT"} ({item.asset?.code || "-"})
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ fontSize: 11, color: colors.textMuted, textTransform: "uppercase" }}>
            {item.from_state || "START"}
          </Text>
          <Ionicons name="arrow-forward" size={12} color={colors.primary} />
          <Text style={{ fontSize: 11, fontWeight: "800", color: colors.primary, textTransform: "uppercase" }}>
            {item.to_state}
          </Text>
        </View>
      </View>

      {item.reason && (
        <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }}>
          Alasan: {item.reason}
        </Text>
      )}
      <Text style={{ fontSize: 11, color: colors.textMuted }}>
        Waktu: {new Date(item.created_at).toLocaleString("id-ID")} WIB
      </Text>
    </View>
  );
};

export default function HistoryScreen() {
  const { profile } = useAuth();
  const { theme, isDark } = useAppTheme();
  const router = useRouter();
  const isAdmin = profile?.role === "admin";

  const [tabMode, setTabMode] = useState<"transactions" | "fsm_logs">("transactions");
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const [rawTransactions, setRawTransactions] = useState<Transaction[]>([]);
  const [fsmLogs, setFsmLogs] = useState<AssetStateLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTxGroup, setSelectedTxGroup] = useState<GroupedTransaction | null>(null);
  const [qrModalGroup, setQrModalGroup] = useState<GroupedTransaction | null>(null);
  const [viewDocModal, setViewDocModal] = useState<{ visible: boolean; url: string; name: string }>({
    visible: false,
    url: "",
    name: "",
  });

  const loadData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);

    try {
      // 1. Fetch transactions with asset & reviewer relations
      const { data: txData } = await supabase
        .from("transactions")
        .select("*, asset:assets(*), reviewer:profiles!transactions_reviewed_by_fkey(*)")
        .order("created_at", { ascending: false });

      if (txData) {
        const freshTxs = txData as Transaction[];
        setRawTransactions(freshTxs);

        // Realtime sync for active open modal group
        setSelectedTxGroup((prevGroup) => {
          if (!prevGroup) return null;
          const updatedItems = freshTxs.filter((tx) =>
            prevGroup.isBatch
              ? tx.batch_id === prevGroup.batch_id
              : tx.id === prevGroup.mainTx.id
          );
          if (updatedItems.length === 0) return prevGroup;
          return {
            ...prevGroup,
            items: updatedItems,
            mainTx: updatedItems[0],
          };
        });
      }

      // 2. Fetch FSM audit logs if admin
      if (isAdmin) {
        const { data: logData } = await supabase
          .from("asset_state_logs")
          .select("*, asset:assets(name, code, serial_number), triggerer:profiles!asset_state_logs_triggered_by_fkey(full_name)")
          .order("created_at", { ascending: false })
          .limit(60);

        setFsmLogs((logData as AssetStateLog[]) ?? []);
      }
    } catch (err) {
      console.error("Error loading history:", err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadData(true);

    const channelId = `history-events-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "asset_state_logs" },
        () => loadData(false)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData(false);
    }, [loadData])
  );

  async function onRefresh() {
    setRefreshing(true);
    await loadData(false);
    setRefreshing(false);
  }

  // Group raw transactions by batch_id if available
  const groupedTransactions = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    const singles: Transaction[] = [];

    for (const tx of rawTransactions) {
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

    // Add batch groups
    map.forEach((txList, batchId) => {
      if (txList.length > 0) {
        result.push({
          id: `batch-${batchId}`,
          isBatch: true,
          batch_id: batchId,
          batch_code: txList[0].batch_code || `BATCH-${batchId.slice(0, 6)}`,
          items: txList,
          mainTx: txList[0],
        });
      }
    });

    // Add single items
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

    // Sort by created_at desc
    result.sort((a, b) => new Date(b.mainTx.created_at).getTime() - new Date(a.mainTx.created_at).getTime());

    return result;
  }, [rawTransactions]);

  // Transaksi BORROW TERBARU untuk tiap aset yang SAAT INI berstatus
  // 'dipinjam'. Perlu karena scan_to_borrow mengubah status transaksi jadi
  // 'ACTIVE' setelah discan fisik (bukan tetap 'APPROVED'), dan satu unit
  // yang sudah dipinjam-kembalikan berkali-kali punya banyak baris BORROW
  // lama -- tanpa dedup ini, hitungan/filter "Dipinjam" bisa salah (baik
  // kelewatan unit yang sudah ACTIVE, maupun dobel-hitung riwayat lama).
  const activeBorrowTxByAssetId = useMemo(() => {
    const map = new Map<string, Transaction>();
    for (const tx of rawTransactions) {
      if (tx.action !== "BORROW" || (tx.asset?.status || "").toLowerCase() !== "dipinjam") continue;
      const existing = map.get(tx.asset_id);
      if (!existing || new Date(tx.created_at).getTime() > new Date(existing.created_at).getTime()) {
        map.set(tx.asset_id, tx);
      }
    }
    return map;
  }, [rawTransactions]);

  // Metrics calculation
  const metrics = useMemo(() => {
    const total = rawTransactions.length;
    const pending = rawTransactions.filter((i) => i.status === "PENDING").length;
    const borrowApproved = activeBorrowTxByAssetId.size;
    const returnApproved = rawTransactions.filter((i) => i.action === "RETURN" && i.status === "APPROVED").length;
    const rejected = rawTransactions.filter((i) => i.status === "REJECTED").length;

    return { total, pending, borrowApproved, returnApproved, rejected };
  }, [rawTransactions, activeBorrowTxByAssetId]);

  // Filtered Grouped Items
  const filteredGroups = useMemo(() => {
    return groupedTransactions.filter((group) => {
      const main = group.mainTx;
      let matchesFilter = true;

      if (quickFilter === "BORROW") matchesFilter = activeBorrowTxByAssetId.get(main.asset_id)?.id === main.id;
      else if (quickFilter === "RETURN") matchesFilter = main.action === "RETURN" && main.status === "APPROVED";
      else if (quickFilter === "PENDING") matchesFilter = main.status === "PENDING";
      else if (quickFilter === "REJECTED") matchesFilter = main.status === "REJECTED";

      if (!matchesFilter) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();

      // Check if batch code, borrower, or any HT item in the group matches search query
      if (group.batch_code?.toLowerCase().includes(q)) return true;
      if ((main.borrower_name || "").toLowerCase().includes(q)) return true;
      if ((main.borrower_nrp || "").toLowerCase().includes(q)) return true;
      if ((main.kesatuan || "").toLowerCase().includes(q)) return true;

      return group.items.some((item) =>
        (item.asset?.name || "").toLowerCase().includes(q) ||
        (item.asset?.code || "").toLowerCase().includes(q) ||
        (item.asset?.serial_number || "").toLowerCase().includes(q)
      );
    });
  }, [groupedTransactions, quickFilter, searchQuery, activeBorrowTxByAssetId]);

  // Share Receipt Generator
  const formatReceiptForSharing = (group: GroupedTransaction) => {
    const tx = group.mainTx;
    const statusText =
      tx.status === "APPROVED"
        ? "✅ DISETUJUI / SELESAI"
        : tx.status === "PENDING"
        ? "⏳ MENUNGGU VERIFIKASI"
        : "❌ DITOLAK";

    const actionText = tx.action === "BORROW" ? "Peminjaman Unit HT" : "Pengembalian Unit HT";
    const refCode = group.isBatch ? `#${group.batch_code}` : `#HT-${tx.id.slice(0, 8).toUpperCase()}`;
    const dateFormatted = new Date(tx.created_at).toLocaleString("id-ID", {
      dateStyle: "full",
      timeStyle: "short",
    });

    let details = `*BUKTI TRANSAKSI LOGISTIK HT*
*POLRESTA - SISTEM KOMUNIKASI*
----------------------------------------
*Status:* ${statusText}
*Aksi:* ${actionText} ${group.isBatch ? `(Batch ${group.items.length} HT)` : ""}`;

    if (group.isBatch) {
      details += `\n\n*Daftar Unit HT (${group.items.length} Unit):*`;
      group.items.forEach((it, idx) => {
        details += `\n${idx + 1}. ${it.asset?.name || "HT"} (Kode: ${it.asset?.code || "-"} | SN: ${it.asset?.serial_number || "-"})`;
      });
    } else {
      details += `\n\n*Detail Unit:*
• Unit HT: ${tx.asset?.name || "Handy Talky"}
• Kode Aset: ${tx.asset?.code || "-"}
• No. Seri: ${tx.asset?.serial_number || "-"}`;
    }

    details += `\n\n*Detail Peminjam:*
• Nama: ${tx.borrower_name || "-"}
• Pangkat / NRP: ${tx.borrower_nrp || "-"}
• Kesatuan: ${tx.kesatuan || "-"}`;

    if (tx.condition) {
      details += `\n• Kondisi Fisik: ${tx.condition === "rusak" ? "Rusak / Kendala" : "Baik"}`;
    }

    if (tx.reviewer?.full_name) {
      details += `\n• Diverifikasi Oleh: ${tx.reviewer.full_name}`;
    }

    if (tx.rejection_reason) {
      details += `\n• Alasan Tolak: "${tx.rejection_reason}"`;
    }

    if (tx.due_date) {
      details += `\n• Batas Pengembalian: ${new Date(tx.due_date).toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short" })} WIB`;
    }

    if (tx.document_name) {
      details += `\n• Dokumen Resmi: ${tx.document_name}`;
    }

    details += `\n\n*Waktu & Referensi:*
• Waktu: ${dateFormatted} WIB
• No. Ref: ${refCode}
----------------------------------------
_Dokumentasi Resmi Sistem Logistik HT Polrestabes_`;

    return details;
  };

  const handleShareReceipt = async (group: GroupedTransaction) => {
    try {
      SafeHaptics.impactAsync();
    } catch {}
    const receiptMessage = formatReceiptForSharing(group);

    const result = await shareOrCopyText({
      title: "Bukti Transaksi HT Polrestabes",
      message: receiptMessage,
    });

    if (result === "copied") {
      SafeAlert.alert("Disalin", "Bukti transaksi berhasil disalin ke clipboard.");
    } else if (result === "failed") {
      SafeAlert.alert("Gagal Membagikan", "Tidak dapat membagikan bukti transaksi di perangkat ini.");
    }
  };

  const getStatusBadgeConfig = (status?: string | null) => {
    const norm = (status || "").toUpperCase();
    switch (norm) {
      case "APPROVED":
        return {
          label: "Disetujui / Selesai",
          bg: isDark ? "rgba(34, 197, 94, 0.16)" : "#DCFCE7",
          text: isDark ? "#4ADE80" : "#15803D",
          border: isDark ? "rgba(74, 222, 128, 0.3)" : "#86EFAC",
          icon: "checkmark-circle",
        };
      case "REJECTED":
        return {
          label: "Ditolak",
          bg: isDark ? "rgba(239, 68, 68, 0.16)" : "#FEE2E2",
          text: isDark ? "#F87171" : "#B91C1C",
          border: isDark ? "rgba(248, 113, 113, 0.3)" : "#FCA5A5",
          icon: "close-circle",
        };
      case "PENDING":
      default:
        return {
          label: norm === "PENDING" ? "Menunggu Verifikasi" : (status || "Menunggu"),
          bg: isDark ? "rgba(245, 158, 11, 0.16)" : "#FEF3C7",
          text: isDark ? "#FBBF24" : "#D97706",
          border: isDark ? "rgba(245, 158, 11, 0.3)" : "#FCD34D",
          icon: "time",
        };
    }
  };

  return (
    <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1 }}>
      <View style={{ flex: 1, maxWidth: 640, width: "100%", alignSelf: "center" }}>
        
        {/* TOP HEADER & CONTROLS */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <View>
              <Text style={{ fontSize: 22, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.4 }}>
                {isAdmin ? "Audit & Riwayat" : "Riwayat Unit HT"}
              </Text>
              <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 2 }}>
                {isAdmin
                  ? "Log aktivitas transaksi & mutasi aset"
                  : "Catatan peminjaman & pengembalian Anda"}
              </Text>
            </View>

            {/* Admin Switcher Tab */}
            {isAdmin && (
              <View
                style={{
                  flexDirection: "row",
                  backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "#E2E8F0",
                  borderRadius: 12,
                  padding: 3,
                }}
              >
                <AnimatedPressable
                  onPress={() => setTabMode("transactions")}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 9,
                    backgroundColor: tabMode === "transactions" ? theme.primary : "transparent",
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "700", color: tabMode === "transactions" ? "#FFFFFF" : theme.textSecondary }}>
                    Transaksi
                  </Text>
                </AnimatedPressable>

                <AnimatedPressable
                  onPress={() => setTabMode("fsm_logs")}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 9,
                    backgroundColor: tabMode === "fsm_logs" ? "#F59E0B" : "transparent",
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "700", color: tabMode === "fsm_logs" ? "#FFFFFF" : theme.textSecondary }}>
                    FSM Log
                  </Text>
                </AnimatedPressable>
              </View>
            )}
          </View>

          {/* Color-Coded Segmented Filter Bar */}
          {tabMode === "transactions" && (
            <View style={{ gap: 8 }}>
              <View
                style={{
                  flexDirection: "row",
                  backgroundColor: isDark ? "rgba(30, 41, 59, 0.75)" : "#E2E8F0",
                  borderRadius: 14,
                  padding: 4,
                  gap: 4,
                }}
              >
                {[
                  { id: "ALL", label: "Semua", count: metrics.total, color: "#0284C7" },
                  { id: "BORROW", label: "Dipinjam", count: metrics.borrowApproved, color: isDark ? "#38BDF8" : "#0284C7" },
                  { id: "RETURN", label: "Kembali", count: metrics.returnApproved, color: isDark ? "#4ADE80" : "#16A34A" },
                  { id: "PENDING", label: "Menunggu", count: metrics.pending, color: isDark ? "#FBBF24" : "#D97706" },
                ].map((tab) => {
                  const isActive = quickFilter === tab.id;
                  return (
                    <AnimatedPressable
                      key={tab.id}
                      onPress={() => {
                        setQuickFilter(tab.id as QuickFilterType);
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
                          ? isDark ? tab.color : "#FFFFFF"
                          : "transparent",
                      }}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: isActive ? "800" : "700", color: isActive ? (isDark ? "#FFFFFF" : tab.color) : theme.textSecondary }}>
                        {tab.label}
                      </Text>
                      <View style={{ backgroundColor: isActive ? (isDark ? "rgba(255, 255, 255, 0.25)" : "rgba(2, 132, 199, 0.12)") : (isDark ? "rgba(255, 255, 255, 0.1)" : "#CBD5E1"), paddingHorizontal: 5, paddingVertical: 1, borderRadius: 8 }}>
                        <Text style={{ fontSize: 10, fontWeight: "800", color: isActive ? (isDark ? "#FFFFFF" : tab.color) : theme.textSecondary }}>
                          {tab.count}
                        </Text>
                      </View>
                    </AnimatedPressable>
                  );
                })}
              </View>

              {/* Search Bar */}
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
                  placeholder="Cari nama HT, kode, batch, atau peminjam..."
                  placeholderTextColor={theme.inputPlaceholder}
                  style={{ flex: 1, color: theme.inputText, fontSize: 13, fontWeight: "500" }}
                />
                {searchQuery.length > 0 && (
                  <AnimatedPressable onPress={() => setSearchQuery("")} style={{ padding: 4 }}>
                    <Ionicons name="close-circle" size={17} color={theme.textMuted} />
                  </AnimatedPressable>
                )}
              </View>
            </View>
          )}
        </View>

        {/* LIST CONTENT */}
        {loading ? (
          <View style={{ paddingHorizontal: 20, gap: 12 }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : tabMode === "transactions" ? (
          <FlatList
            data={filteredGroups}
            keyExtractor={(item) => item.id}
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={Platform.OS === "android"}
            updateCellsBatchingPeriod={30}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 50, flexGrow: 1 }}
            ListEmptyComponent={
              <View
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                  paddingVertical: 60,
                  backgroundColor: isDark ? "rgba(30, 41, 59, 0.4)" : "#FFFFFF",
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: isDark ? "rgba(2, 132, 199, 0.15)" : "rgba(2, 132, 199, 0.08)",
                    justifyContent: "center",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <Ionicons name="receipt-outline" size={28} color={theme.primary} />
                </View>
                <Text style={{ fontSize: 15, fontWeight: "800", color: theme.textPrimary, textAlign: "center" }}>
                  Tidak Ada Riwayat Ditemukan
                </Text>
                <Text style={{ fontSize: 12.5, color: theme.textSecondary, textAlign: "center", marginTop: 3, paddingHorizontal: 24, lineHeight: 18 }}>
                  {searchQuery || quickFilter !== "ALL"
                    ? "Coba sesuaikan filter atau kata kunci pencarian Anda."
                    : "Belum ada catatan transaksi unit HT pada sistem."}
                </Text>
              </View>
            }
            renderItem={({ item: group }) => (
              <HistoryListItem
                group={group}
                isAdmin={isAdmin}
                onPress={() => {
                  setSelectedTxGroup(group);
                  SafeHaptics.selectionAsync();
                }}
                onOpenQR={() => {
                  router.push(`/loan-qr/${group.batch_id || group.mainTx.id}`);
                }}
              />
            )}
          />
        ) : (
          /* FSM Logs for Admin */
          <FlatList
            data={fsmLogs}
            keyExtractor={(item) => item.id}
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={Platform.OS === "android"}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 50, flexGrow: 1 }}
            renderItem={({ item }) => <FsmLogListItem item={item} />}
          />
        )}

        {/* TRANSACTION DETAIL & DIGITAL RECEIPT MODAL */}
        <Modal
          visible={!!selectedTxGroup}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedTxGroup(null)}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 24 }}>
            {selectedTxGroup && (
              <Animated.View
                entering={ZoomIn.duration(220)}
                exiting={ZoomOut.duration(160)}
                style={{
                  width: "100%",
                  maxWidth: 420,
                  backgroundColor: theme.isDark ? "#0F172A" : "#FFFFFF",
                  borderRadius: 24,
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                  overflow: "hidden",
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 16 },
                  shadowOpacity: 0.4,
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
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: "rgba(255, 255, 255, 0.2)",
                      borderWidth: 1.5,
                      borderColor: "rgba(255, 255, 255, 0.4)",
                      justifyContent: "center",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <Ionicons name={selectedTxGroup.isBatch ? "layers" : "radio"} size={24} color="#FFFFFF" />
                  </View>

                  <Text style={{ fontSize: 17, fontWeight: "800", color: "#FFFFFF", textAlign: "center" }}>
                    {selectedTxGroup.isBatch
                      ? `Bukti Peminjaman Batch (${selectedTxGroup.items.length} HT)`
                      : "Bukti Transaksi Logistik HT"}
                  </Text>
                  <Text style={{ fontSize: 11.5, color: "rgba(255, 255, 255, 0.85)", marginTop: 2 }}>
                    Kepolisian Resor Kota • Sistem Komunikasi
                  </Text>

                  <View style={{ marginTop: 8, backgroundColor: "rgba(0, 0, 0, 0.25)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                    <Text style={{ color: "rgba(255, 255, 255, 0.9)", fontSize: 11, fontWeight: "700" }}>
                      {selectedTxGroup.isBatch
                        ? `NO. REF: ${selectedTxGroup.batch_code}`
                        : `ID: #${selectedTxGroup.mainTx.id.slice(0, 8).toUpperCase()}`}
                    </Text>
                  </View>
                </LinearGradient>

                {/* Body Content */}
                <ScrollView style={{ maxHeight: 380, paddingHorizontal: 20, paddingVertical: 14 }}>
                  {/* Status Row */}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.cardBorder }}>
                    <Text style={{ fontSize: 12, color: theme.textSecondary, fontWeight: "600" }}>
                      Status Verifikasi
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: getStatusBadgeConfig(selectedTxGroup.mainTx.status).bg, borderColor: getStatusBadgeConfig(selectedTxGroup.mainTx.status).border, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14 }}>
                      <Ionicons name={getStatusBadgeConfig(selectedTxGroup.mainTx.status).icon as any} size={13} color={getStatusBadgeConfig(selectedTxGroup.mainTx.status).text} />
                      <Text style={{ fontSize: 11.5, fontWeight: "800", color: getStatusBadgeConfig(selectedTxGroup.mainTx.status).text }}>
                        {getStatusBadgeConfig(selectedTxGroup.mainTx.status).label}
                      </Text>
                    </View>
                  </View>

                  {/* Items Breakdown */}
                  <View style={{ gap: 10, paddingVertical: 12 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary, textTransform: "uppercase" }}>
                      Rincian Unit HT ({selectedTxGroup.items.length} Unit)
                    </Text>

                    <View style={{ gap: 6 }}>
                      {selectedTxGroup.items.map((txItem, idx) => {
                        const isUnitBorrowed = (txItem.asset?.status || "").toLowerCase() === "dipinjam";
                        const canScan = selectedTxGroup.mainTx.status === "APPROVED" && !isUnitBorrowed;

                        return (
                          <AnimatedPressable
                            key={`${txItem.id}-${idx}`}
                            onPress={() => {
                              if (canScan) {
                                setSelectedTxGroup(null);
                                if (selectedTxGroup.isBatch) {
                                  router.push({
                                    pathname: "/(tabs)/scan",
                                    params: {
                                      target_batch_id: selectedTxGroup.mainTx.batch_id,
                                      batch_code: selectedTxGroup.batch_code || "",
                                    },
                                  });
                                } else {
                                  router.push({
                                    pathname: "/(tabs)/scan",
                                    params: {
                                      target_asset_id: txItem.asset_id,
                                      expected_code: txItem.asset?.code || "",
                                      expected_name: encodeURIComponent(txItem.asset?.name || ""),
                                    },
                                  });
                                }
                              }
                            }}
                            style={{
                              backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC",
                              borderWidth: 1,
                              borderColor: canScan ? "#22C55E" : theme.cardBorder,
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
                                  backgroundColor: canScan ? "#22C55E" : theme.primary,
                                  justifyContent: "center",
                                  alignItems: "center",
                                }}
                              >
                                <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "800" }}>{idx + 1}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "700", color: theme.textPrimary }}>
                                  {txItem.asset?.name || "Handy Talky"}
                                </Text>
                                <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textSecondary }}>
                                  QR: {txItem.asset?.code || "-"} • SN: {txItem.asset?.serial_number || "-"}
                                </Text>
                              </View>
                            </View>

                            {isUnitBorrowed ? (
                              <View style={{ backgroundColor: "rgba(34, 197, 94, 0.18)", borderColor: "#22C55E", borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                                <Text style={{ fontSize: 10, fontWeight: "800", color: "#22C55E" }}>✓ DIPINJAM</Text>
                              </View>
                            ) : canScan ? (
                              <View style={{ backgroundColor: "#22C55E", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 4 }}>
                                <Ionicons name="qr-code" size={13} color="#FFFFFF" />
                                <Text style={{ fontSize: 11, fontWeight: "800", color: "#FFFFFF" }}>Scan Unit Ini</Text>
                              </View>
                            ) : (
                              <StatusBadge status={txItem.asset?.status || "tersedia"} />
                            )}
                          </AnimatedPressable>
                        );
                      })}
                    </View>

                    {/* Borrower Meta */}
                    <View style={{ borderTopWidth: 1, borderTopColor: theme.cardBorder, paddingTop: 10, gap: 8, marginTop: 4 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ fontSize: 12.5, color: theme.textSecondary }}>Nama Petugas Peminjam</Text>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: theme.textPrimary }}>
                          {selectedTxGroup.mainTx.borrower_name || "-"}
                        </Text>
                      </View>

                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ fontSize: 12.5, color: theme.textSecondary }}>Pangkat / NRP</Text>
                        <Text style={{ fontSize: 12.5, fontWeight: "700", color: theme.textPrimary }}>
                          {selectedTxGroup.mainTx.borrower_nrp || "-"}
                        </Text>
                      </View>

                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ fontSize: 12.5, color: theme.textSecondary }}>Kesatuan / Bagian</Text>
                        <Text style={{ fontSize: 12.5, fontWeight: "700", color: theme.textPrimary }}>
                          {selectedTxGroup.mainTx.kesatuan || "-"}
                        </Text>
                      </View>

                      {selectedTxGroup.mainTx.reviewer && (
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ fontSize: 12.5, color: theme.textSecondary }}>Verifikator Admin</Text>
                          <Text style={{ fontSize: 12.5, fontWeight: "700", color: "#22C55E" }}>
                            {selectedTxGroup.mainTx.reviewer.full_name}
                          </Text>
                        </View>
                      )}

                      {selectedTxGroup.mainTx.reviewed_at && (
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ fontSize: 12.5, color: theme.textSecondary }}>Waktu Disetujui</Text>
                          <Text style={{ fontSize: 12, fontWeight: "600", color: "#22C55E" }}>
                            {formatFullDateTimeId(selectedTxGroup.mainTx.reviewed_at)}
                          </Text>
                        </View>
                      )}

                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ fontSize: 12.5, color: theme.textSecondary }}>Kondisi Fisik</Text>
                        <Text style={{ fontSize: 12.5, fontWeight: "700", color: selectedTxGroup.mainTx.condition === "rusak" ? "#EF4444" : "#22C55E" }}>
                          {selectedTxGroup.mainTx.condition === "rusak" ? "Rusak / Ada Kendala" : "Baik"}
                        </Text>
                      </View>

                      {selectedTxGroup.mainTx.notes && (
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <Text style={{ fontSize: 12.5, color: theme.textSecondary, marginRight: 8 }}>Catatan Dinas</Text>
                          <Text style={{ fontSize: 12, fontWeight: "600", color: theme.textPrimary, flex: 1, textAlign: "right" }}>
                            {selectedTxGroup.mainTx.notes}
                          </Text>
                        </View>
                      )}

                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ fontSize: 12.5, color: theme.textSecondary }}>Waktu Pengajuan</Text>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: theme.textMuted }}>
                          {formatFullDateTimeId(selectedTxGroup.mainTx.created_at)}
                        </Text>
                      </View>

                      {selectedTxGroup.mainTx.due_date && (() => {
                        const rem = getRemainingTimeStatus(selectedTxGroup.mainTx.due_date);
                        const isOver = rem?.isOverdue;
                        return (
                          <View style={{ gap: 4 }}>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                              <Text style={{ fontSize: 12.5, color: theme.textSecondary }}>Batas Waktu Pengembalian</Text>
                              <Text style={{ fontSize: 12, fontWeight: "700", color: "#0284c7" }}>
                                {formatFullDateTimeId(selectedTxGroup.mainTx.due_date)}
                              </Text>
                            </View>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 6,
                                alignSelf: "flex-end",
                                backgroundColor: isOver ? "rgba(239, 68, 68, 0.12)" : rem?.urgentLevel === "warning" ? "rgba(245, 158, 11, 0.12)" : "rgba(14, 165, 233, 0.1)",
                                borderColor: isOver ? "#ef4444" : rem?.urgentLevel === "warning" ? "#f59e0b" : "#0284c7",
                                borderWidth: 1,
                                paddingHorizontal: 8,
                                paddingVertical: 3,
                                borderRadius: 6,
                              }}
                            >
                              <Ionicons name={isOver ? "alert-circle" : "alarm-outline"} size={12} color={isOver ? "#ef4444" : rem?.urgentLevel === "warning" ? "#d97706" : "#0284c7"} />
                              <Text style={{ fontSize: 10.5, fontWeight: "700", color: isOver ? "#ef4444" : rem?.urgentLevel === "warning" ? "#d97706" : "#0284c7" }}>
                                Status: {rem?.text}
                              </Text>
                            </View>
                          </View>
                        );
                      })()}

                      {selectedTxGroup.mainTx.document_url && (
                        <AnimatedPressable
                          onPress={() => setViewDocModal({ visible: true, url: selectedTxGroup.mainTx.document_url!, name: selectedTxGroup.mainTx.document_name || "Surat_Resmi" })}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                            paddingVertical: 8,
                            paddingHorizontal: 10,
                            backgroundColor: "rgba(16, 185, 129, 0.12)",
                            borderRadius: 8,
                            marginTop: 4,
                          }}
                        >
                          <Ionicons name="document-text" size={16} color="#10b981" />
                          <Text style={{ fontSize: 12, fontWeight: "700", color: "#10b981", flex: 1 }}>
                            Lihat Surat Resmi Terlampir
                          </Text>
                          <Ionicons name="eye-outline" size={14} color="#10b981" />
                        </AnimatedPressable>
                      )}
                    </View>
                  </View>
                </ScrollView>

                {/* Footer Buttons */}
                <View
                  style={{
                    flexDirection: "row",
                    gap: 10,
                    padding: 16,
                    backgroundColor: isDark ? "rgba(0, 0, 0, 0.3)" : "#F8FAFC",
                    borderTopWidth: 1,
                    borderTopColor: theme.cardBorder,
                  }}
                >
                  <AnimatedPressable
                    onPress={() => handleShareReceipt(selectedTxGroup)}
                    style={{
                      flex: 1.2,
                      backgroundColor: theme.primary,
                      paddingVertical: 12,
                      borderRadius: 14,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <Ionicons name="share-social-outline" size={17} color="#FFFFFF" />
                    <Text style={{ fontSize: 13.5, fontWeight: "800", color: "#FFFFFF" }}>
                      Bagikan Bukti
                    </Text>
                  </AnimatedPressable>

                  <AnimatedPressable
                    onPress={() => setSelectedTxGroup(null)}
                    style={{
                      flex: 0.8,
                      backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "#E2E8F0",
                      paddingVertical: 12,
                      borderRadius: 14,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 13.5, fontWeight: "700", color: theme.textSecondary }}>
                      Tutup
                    </Text>
                  </AnimatedPressable>
                </View>
              </Animated.View>
            )}
          </View>
        </Modal>

        {/* QR Code & Serah Terima Modal */}
        <LoanBatchQRModal
          visible={!!qrModalGroup}
          group={qrModalGroup}
          onClose={() => setQrModalGroup(null)}
          onRefresh={() => loadData(false)}
        />

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
