import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  FlatList,
  ScrollView,
  Platform,
  Modal,
  TextInput,
} from "react-native";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeHaptics } from "@/lib/safeHaptics";
import { SafeAlert } from "@/lib/safeAlert";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { StatusBadge } from "@/components/StatusBadge";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppBottomSheet } from "@/components/AppBottomSheet";
import { DueDatePicker } from "@/components/DueDatePicker";
import { OfficialLetterUploader, type OfficialDocumentData } from "@/components/OfficialLetterUploader";
import { formatFullDateTimeId } from "@/lib/dateUtils";
import { getFriendlyErrorMessage } from "@/lib/errorHandler";
import type { Asset, AssetStatus } from "@/types/database";

// Conditional imports for native-only modules
let CameraView: any = null;
let useCameraPermissions: any = null;
let useIsFocused: any = () => true; // fallback for web

if (Platform.OS !== "web") {
  try {
    const cameraModule = require("expo-camera");
    CameraView = cameraModule.CameraView;
    useCameraPermissions = cameraModule.useCameraPermissions;
  } catch {}
  try {
    const navModule = require("@react-navigation/native");
    useIsFocused = navModule.useIsFocused;
  } catch {}
}

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

interface ListItemProps {
  item: Asset;
  isBatchMode: boolean;
  isSelectedInBatch: boolean;
  onPress: () => void;
}

const ListItem = ({ item, isBatchMode, isSelectedInBatch, onPress }: ListItemProps) => {
  const { colors, isDark } = useTheme();
  const statusNorm = (item.status || "").toLowerCase();
  const isAvailable = statusNorm === "tersedia";

  return (
    <AnimatedPressable
      onPress={onPress}
      style={{
        backgroundColor: isSelectedInBatch
          ? (isDark ? "rgba(2, 132, 199, 0.22)" : "#E0F2FE")
          : colors.cardBackground,
        borderColor: isSelectedInBatch
          ? colors.primary
          : colors.cardBorder,
        borderWidth: isSelectedInBatch ? 2 : 1,
        borderRadius: 18,
        padding: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 2,
      }}
    >
      {/* Multi-select Checkbox in Batch Mode */}
      {isBatchMode && (
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: isSelectedInBatch ? colors.primary : colors.textMuted,
            backgroundColor: isSelectedInBatch ? colors.primary : "transparent",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {isSelectedInBatch && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
        </View>
      )}

      {/* Icon */}
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 14,
          backgroundColor: isAvailable
            ? (isDark ? "rgba(34, 197, 94, 0.2)" : "#DCFCE7")
            : (isDark ? "rgba(239, 68, 68, 0.2)" : "#FEE2E2"),
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Ionicons
          name="radio"
          size={20}
          color={isAvailable ? "#22C55E" : "#EF4444"}
        />
      </View>

      {/* Details */}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: colors.textPrimary, fontWeight: "700", fontSize: 15 }}>
          {item.name}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12 }}>
          Kode: {item.code} • SN: {item.serial_number}
        </Text>
        <View style={{ marginTop: 2 }}>
          <StatusBadge status={item.status} />
        </View>
      </View>

      {/* Action Pill */}
      <View
        style={{
          backgroundColor: isSelectedInBatch
            ? colors.primary
            : isAvailable
            ? (isDark ? "rgba(2, 132, 199, 0.2)" : "rgba(2, 132, 199, 0.1)")
            : "transparent",
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 10,
        }}
      >
        <Text
          style={{
            color: isSelectedInBatch ? "#FFFFFF" : isAvailable ? colors.primary : colors.textMuted,
            fontWeight: "700",
            fontSize: 11.5,
          }}
        >
          {isSelectedInBatch ? "Terpilih" : isAvailable ? (isBatchMode ? "+ Pilih" : "Pilih") : "Tidak Siap"}
        </Text>
      </View>
    </AnimatedPressable>
  );
};

export default function ScanScreen() {
  // Read target parameters passed from 'Siap Scan' / 'Scan Fisik' cards or direct link
  const params = useLocalSearchParams<{
    target_asset_id?: string;
    target_batch_id?: string;
    expected_code?: string;
    expected_name?: string;
    batch_code?: string;
    txId?: string;
    id?: string;
    tx_id?: string;
  }>();

  const [targetAssetId, setTargetAssetId] = useState<string | null>(params.target_asset_id || null);
  const [targetBatchId, setTargetBatchId] = useState<string | null>(params.target_batch_id || null);
  const [expectedCode, setExpectedCode] = useState<string>(params.expected_code || "");
  const [expectedName, setExpectedName] = useState<string>(params.expected_name ? decodeURIComponent(params.expected_name) : "");
  const [batchCode, setBatchCode] = useState<string>(params.batch_code || "");

  // On web, camera permissions are not needed
  const cameraPerms = useCameraPermissions ? useCameraPermissions() : [{ granted: true }, () => {}];
  const [permission, requestPermission] = cameraPerms;
  const [scanned, setScanned] = useState(false);
  // Web manual code input state
  const [webManualCode, setWebManualCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [assetsList, setAssetsList] = useState<Asset[]>([]);
  const [filterCategory, setFilterCategory] = useState<"semua" | "tersedia" | "dipinjam" | "rusak">("semua");

  // Camera Controls State
  const [isCameraExpanded, setIsCameraExpanded] = useState(false);
  const [zoomFactor, setZoomFactor] = useState(0); // 0 = 1x, 0.3 = 2x, 0.6 = 3x
  const [enableTorch, setEnableTorch] = useState(false);

  // Batch Peminjaman State (Up to 50 HTs)
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchSelectedAssets, setBatchSelectedAssets] = useState<Asset[]>([]);
  const [batchModalVisible, setBatchModalVisible] = useState(false);
  const [borrowerName, setBorrowerName] = useState("");
  const [borrowerNrp, setBorrowerNrp] = useState("");
  const [kesatuan, setKesatuan] = useState("");
  const [batchNotes, setBatchNotes] = useState("");
  const [batchDueDate, setBatchDueDate] = useState<string | null>(null);
  const [batchOfficialDoc, setBatchOfficialDoc] = useState<OfficialDocumentData | null>(null);
  const [submittingBatch, setSubmittingBatch] = useState(false);

  // Feedback Bottom Sheet Toast
  const [toastConfig, setToastConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon: string;
    isDanger?: boolean;
  }>({ visible: false, title: "", message: "", icon: "✅" });

  const theme = useTheme();
  const isDark = theme.isDark;
  const router = useRouter();
  const isFocused = useIsFocused();
  const isProcessingRef = useRef(false);
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    if (params.target_asset_id) {
      setTargetAssetId(params.target_asset_id);
      setExpectedCode(params.expected_code || "");
      setExpectedName(params.expected_name ? decodeURIComponent(params.expected_name) : "");
    }
    if (params.target_batch_id) {
      setTargetBatchId(params.target_batch_id);
      setBatchCode(params.batch_code || "");
    }
  }, [params.target_asset_id, params.target_batch_id, params.expected_code, params.expected_name, params.batch_code]);

  useEffect(() => {
    if (profile) {
      if (profile.full_name && !borrowerName) setBorrowerName(profile.full_name);
      if (profile.nrp && !borrowerNrp) setBorrowerNrp(profile.nrp);
    }
  }, [profile]);

  // Load live asset catalog
  const fetchAssetsCatalog = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchAssetsCatalog();

    const channelId = `scan-assets-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assets" },
        () => fetchAssetsCatalog()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions" },
        () => fetchAssetsCatalog()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAssetsCatalog]);

  useFocusEffect(
    useCallback(() => {
      fetchAssetsCatalog();
      setScanned(false);
      setLoading(false);
      setErrorMsg(null);
      isProcessingRef.current = false;
    }, [fetchAssetsCatalog])
  );

  // Toggle selection in batch mode
  const toggleSelectBatchAsset = (asset: Asset) => {
    if ((asset.status || "").toLowerCase() !== "tersedia") {
      setToastConfig({
        visible: true,
        title: "Unit Tidak Tersedia",
        message: `Unit ${asset.name} (${asset.code}) berstatus ${asset.status.toUpperCase()} dan tidak dapat dipinjam.`,
        icon: "⚠️",
        isDanger: true,
      });
      return;
    }

    setBatchSelectedAssets((prev) => {
      const exists = prev.some((item) => item.id === asset.id);
      if (exists) {
        try {
        SafeHaptics.selectionAsync();
        } catch {}
        return prev.filter((item) => item.id !== asset.id);
      } else {
        if (prev.length >= 50) {
          setToastConfig({
            visible: true,
            title: "Batas Maksimal 50 HT",
            message: "Batas peminjaman sekaligus adalah 50 unit HT.",
            icon: "⚠️",
            isDanger: true,
          });
          return prev;
        }
        try {
          SafeHaptics.notificationAsync();
        } catch {}
        return [...prev, asset];
      }
    });
  };

  async function handleBarcodeScanned(payload: any) {
    if (isProcessingRef.current || scanned || loading) return;

    let scannedData = "";
    if (typeof payload === "string") {
      scannedData = payload.trim();
    } else if (payload && typeof payload.data === "string") {
      scannedData = payload.data.trim();
    }

    if (!scannedData) return;

    // Try parsing JSON string format if applicable
    if (scannedData.startsWith("{") && scannedData.endsWith("}")) {
      try {
        const parsed = JSON.parse(scannedData);
        if (parsed.code) scannedData = String(parsed.code).trim();
      } catch {}
    }

    isProcessingRef.current = true;
    setScanned(true);
    setLoading(true);
    setErrorMsg(null);

    // ====================================================================
    // MODE 1: Serah Terima / Ambil Barang (Jika ADA ID Transaksi)
    // ====================================================================
    const currentTxId = params.txId || params.id || params.tx_id;
    if (currentTxId) {
      try {
        const { error } = await supabase.rpc("scan_to_borrow", {
          p_tx_id: currentTxId,
          p_scanned_qr: scannedData,
          p_user_id: profile?.id || null,
        });

        setLoading(false);

        if (error) {
          SafeAlert.alert("Gagal", error.message || getFriendlyErrorMessage(error));
          setTimeout(() => {
            setScanned(false);
            isProcessingRef.current = false;
          }, 2000);
          return;
        }

        if (Platform.OS !== "web") {
          try {
            await SafeHaptics.notificationAsync();
          } catch {}
        }

        SafeAlert.alert("Sukses", "Aset berhasil diserahterimakan", [
          {
            text: "OK",
            onPress: () => router.replace("/history"),
          },
        ]);
        router.replace("/history");
      } catch (err: any) {
        setLoading(false);
        SafeAlert.alert("Gagal", err.message || "Gagal memproses serah terima.");
        setTimeout(() => {
          setScanned(false);
          isProcessingRef.current = false;
        }, 2000);
      }
      return;
    }

    // ====================================================================
    // MODE 2: Pengajuan Baru (Jika TIDAK ADA ID Transaksi)
    // ====================================================================
    try {
      // 1. Try exact code match
      let { data: asset } = await supabase
        .from("assets")
        .select("*")
        .eq("code", scannedData)
        .maybeSingle();

      // 2. Fallback: try case-insensitive code match
      if (!asset) {
        const { data: assetIlike } = await supabase
          .from("assets")
          .select("*")
          .ilike("code", scannedData)
          .maybeSingle();
        asset = assetIlike;
      }

      // 3. Fallback: try UUID match
      if (!asset) {
        const { data: assetById } = await supabase
          .from("assets")
          .select("*")
          .eq("id", scannedData)
          .maybeSingle();
        asset = assetById;
      }

      setLoading(false);

      if (!asset) {
        setErrorMsg(`QR Code "${scannedData}" tidak ditemukan di database aset.`);
        setTimeout(() => {
          setScanned(false);
          isProcessingRef.current = false;
        }, 2000);
        return;
      }

      // Strict checks for target params if present
      if (targetAssetId && asset.id !== targetAssetId) {
        setToastConfig({
          visible: true,
          title: "QR Code Salah / Beda Unit HT! ❌",
          message: `Unit yang Anda scan adalah "${asset.name}" (${asset.code}). Unit yang disetujui admin untuk Anda ambil adalah "${expectedName || 'unit permohonan'}" (${expectedCode || ''}). Harap scan fisik unit HT yang sesuai!`,
          icon: "⚠️",
          isDanger: true,
        });
        setTimeout(() => {
          setScanned(false);
          isProcessingRef.current = false;
        }, 3500);
        return;
      }

      if (targetBatchId) {
        const { data: inBatch } = await supabase
          .from("transactions")
          .select("id")
          .eq("batch_id", targetBatchId)
          .eq("asset_id", asset.id)
          .eq("status", "APPROVED")
          .maybeSingle();

        if (!inBatch) {
          setToastConfig({
            visible: true,
            title: "Unit Bukan Bagian Paket! ❌",
            message: `Unit "${asset.name}" (${asset.code}) bukan bagian dari paket peminjaman batch ${batchCode || ''} yang telah disetujui.`,
            icon: "⚠️",
            isDanger: true,
          });
          setTimeout(() => {
            setScanned(false);
            isProcessingRef.current = false;
          }, 3500);
          return;
        }
      }

      if (Platform.OS !== "web") {
        try {
          await SafeHaptics.notificationAsync();
        } catch {}
      }

      const isAssetDipinjam = (asset.status || "").toLowerCase() === "dipinjam";
      const isAssetRusak = (asset.status || "").toLowerCase() === "rusak";

      // Case 1: Asset is currently DIPINJAM -> Route to Return Screen
      if (isAssetDipinjam) {
        router.push(`/return/${asset.id}`);
        setTimeout(() => {
          setScanned(false);
          isProcessingRef.current = false;
        }, 1500);
        return;
      }

      // Case 2: Asset is RUSAK -> Alert maintenance
      if (isAssetRusak) {
        setToastConfig({
          visible: true,
          title: "Unit Rusak / Maintenance ⚠️",
          message: `Unit ${asset.name} (${asset.code}) saat ini berstatus RUSAK dan tidak dapat dipinjam.`,
          icon: "❌",
          isDanger: true,
        });
        setTimeout(() => {
          setScanned(false);
          isProcessingRef.current = false;
        }, 2200);
        return;
      }

      // Case 3: Batch Mode vs Single Borrow Request Form
      if (isBatchMode) {
        toggleSelectBatchAsset(asset as Asset);
        setErrorMsg(`Dipilih: ${asset.name} (${batchSelectedAssets.length + 1}/50)`);
      } else {
        router.push(`/asset/${asset.id}`);
      }

      setTimeout(() => {
        setScanned(false);
        isProcessingRef.current = false;
      }, 1500);
    } catch (err: any) {
      setLoading(false);
      setErrorMsg(getFriendlyErrorMessage(err, "Gagal memindai QR code."));
      setTimeout(() => {
        setScanned(false);
        isProcessingRef.current = false;
      }, 2000);
    }
  }

  // Handle Batch Loan Submit
  async function executeBatchSubmit() {
    if (batchSelectedAssets.length === 0) return;

    if (batchSelectedAssets.length < 2) {
      SafeAlert.alert("Gagal", "Peminjaman Batch minimal 2 unit. Untuk 1 unit, gunakan peminjaman reguler.");
      return;
    }

    if (!borrowerName.trim() || !borrowerNrp.trim() || !kesatuan.trim()) {
      setToastConfig({
        visible: true,
        title: "Lengkapi Data",
        message: "Nama Lengkap, Pangkat/NRP, dan Kesatuan wajib diisi.",
        icon: "⚠️",
        isDanger: true,
      });
      return;
    }

    if (!batchDueDate) {
      setToastConfig({
        visible: true,
        title: "Tentukan Batas Waktu",
        message: "Batas waktu pengembalian HT untuk batch ini wajib ditentukan.",
        icon: "⏱️",
        isDanger: true,
      });
      return;
    }

    if (!batchOfficialDoc) {
      setToastConfig({
        visible: true,
        title: "Surat Resmi Wajib",
        message: "Surat resmi (Sprint / Surat Perintah / Nota Dinas) wajib dilampirkan sebelum mengajukan peminjaman batch.",
        icon: "📄",
        isDanger: true,
      });
      return;
    }

    setSubmittingBatch(true);

    try {
      const assetIds = batchSelectedAssets.map((a) => a.id);

      // Call process_batch_asset_transaction RPC
      const { data, error } = await supabase.rpc("process_batch_asset_transaction", {
        p_asset_ids: assetIds,
        p_action: "BORROW",
        p_borrower_name: borrowerName.trim(),
        p_borrower_nrp: borrowerNrp.trim(),
        p_kesatuan: kesatuan.trim(),
        p_notes: batchNotes.trim() || null,
        p_due_date: batchDueDate,
        p_document_url: batchOfficialDoc?.url || null,
        p_document_name: batchOfficialDoc?.name || null,
      });

      setSubmittingBatch(false);

      if (error) {
        setToastConfig({
          visible: true,
          title: "Gagal Peminjaman Batch",
          message: getFriendlyErrorMessage(error, "Gagal memproses permohonan peminjaman batch."),
          icon: "❌",
          isDanger: true,
        });
        return;
      }

      try {
        await SafeHaptics.notificationAsync();
      } catch {}

      setBatchModalVisible(false);
      setBatchSelectedAssets([]);
      setIsBatchMode(false);

      setToastConfig({
        visible: true,
        title: "Pengajuan Batch Terkirim!",
        message: `Pengajuan peminjaman untuk ${assetIds.length} unit HT berhasil terkirim. Menunggu verifikasi admin.`,
        icon: "⏳",
      });

      fetchAssetsCatalog();
    } catch (err: any) {
      setSubmittingBatch(false);
      setToastConfig({
        visible: true,
        title: "Kesalahan Sistem",
        message: getFriendlyErrorMessage(err),
        icon: "❌",
        isDanger: true,
      });
    }
  }



  if (!permission && Platform.OS !== "web") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.isDark ? "#090d16" : "#f8fafc" }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (permission && !permission.granted && Platform.OS !== "web") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: theme.isDark ? "#090d16" : "#f8fafc" }}>
        <View
          style={{
            backgroundColor: theme.cardBackground,
            borderColor: theme.cardBorder,
            borderWidth: 1,
            borderRadius: 16,
            padding: 24,
            alignItems: "center",
            width: "100%",
          }}
        >
          <Text style={{ textAlign: "center", marginBottom: 20, color: theme.textPrimary, fontSize: 15, lineHeight: 22 }}>
            Aplikasi butuh akses kamera untuk memindai QR Code unit HT.
          </Text>
          <AnimatedPressable
            onPress={requestPermission}
            style={{
              backgroundColor: theme.primary,
              paddingVertical: 14,
              paddingHorizontal: 24,
              borderRadius: 12,
              width: "100%",
              alignItems: "center",
            }}
          >
            <Text style={{ color: theme.primaryTextOnButton, fontWeight: "700", fontSize: 16 }}>
              Izinkan Kamera
            </Text>
          </AnimatedPressable>
        </View>
      </View>
    );
  }

  // Counts
  const totalCount = assetsList.length;
  const tersediaCount = assetsList.filter((a) => (a.status || "").toLowerCase() === "tersedia").length;
  const dipinjamCount = assetsList.filter((a) => (a.status || "").toLowerCase() === "dipinjam").length;
  const rusakCount = assetsList.filter((a) => (a.status || "").toLowerCase() === "rusak").length;

  const filteredAssets = assetsList.filter((a) => {
    if (filterCategory === "tersedia") return (a.status || "").toLowerCase() === "tersedia";
    if (filterCategory === "dipinjam") return (a.status || "").toLowerCase() === "dipinjam";
    if (filterCategory === "rusak") return (a.status || "").toLowerCase() === "rusak";
    return true;
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.isDark ? "#090D16" : "#F8FAFC" }}>
      <View style={{ flex: 1, maxWidth: 640, width: "100%", alignSelf: "center" }}>
        
        {/* Active Target Banner (After Admin Approval) */}
        {(targetAssetId || targetBatchId) && (
          <View
            style={{
              backgroundColor: isDark ? "rgba(34, 197, 94, 0.15)" : "#DCFCE7",
              borderColor: "#22C55E",
              borderWidth: 1.5,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 14,
              marginHorizontal: 16,
              marginTop: 12,
              marginBottom: 8,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <Ionicons name="shield-checkmark" size={22} color="#22C55E" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: "#16A34A", textTransform: "uppercase" }}>
                  Target Serah Terima Fisik (Disetujui)
                </Text>
                <Text style={{ fontSize: 13.5, fontWeight: "800", color: isDark ? "#86EFAC" : "#15803D" }}>
                  {targetBatchId ? `Paket Batch ${batchCode}` : `${expectedName || 'Unit HT'} (${expectedCode})`}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => {
                setTargetAssetId(null);
                setTargetBatchId(null);
                setExpectedCode("");
                setExpectedName("");
                setBatchCode("");
              }}
              style={{ padding: 4 }}
            >
              <Ionicons name="close-circle" size={20} color={isDark ? "#86EFAC" : "#16A34A"} />
            </Pressable>
          </View>
        )}

        {/* Dynamic Camera Scanner Container / Web Manual Input */}
        <View
          style={{
            height: Platform.OS === "web" ? "auto" : (isCameraExpanded ? 400 : 220),
            minHeight: Platform.OS === "web" ? 140 : undefined,
            position: "relative",
            overflow: "hidden",
            backgroundColor: Platform.OS === "web" ? (isDark ? "#0F172A" : "#E0F2FE") : "#000000",
          }}
        >
          {Platform.OS === "web" ? (
            /* Web Fallback: Manual Code Input */
            <View
              style={{
                flex: 1,
                padding: 20,
                justifyContent: "center",
                alignItems: "center",
                gap: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Ionicons name="globe-outline" size={20} color={theme.primary} />
                <Text style={{ color: theme.textPrimary, fontWeight: "800", fontSize: 15 }}>
                  Masukkan Kode HT / Scan QR Web
                </Text>
              </View>
              <Text style={{ color: theme.textSecondary, fontSize: 12, textAlign: "center" }}>
                Kamera tidak tersedia di browser. Ketik kode unit HT atau pilih dari katalog di bawah.
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  width: "100%",
                  maxWidth: 440,
                  gap: 8,
                }}
              >
                <View
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: theme.inputBackground || (isDark ? "#1E293B" : "#FFFFFF"),
                    borderWidth: 1.5,
                    borderColor: theme.inputBorder || (isDark ? "#334155" : "#CBD5E1"),
                    borderRadius: 14,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                  }}
                >
                  <Ionicons name="search-outline" size={18} color={theme.textMuted} style={{ marginRight: 8 }} />
                  <TextInput
                    placeholder="Kode HT (cth: HT-001)"
                    placeholderTextColor={theme.textMuted}
                    value={webManualCode}
                    onChangeText={setWebManualCode}
                    onSubmitEditing={() => {
                      if (webManualCode.trim()) {
                        handleBarcodeScanned(webManualCode.trim());
                        setWebManualCode("");
                      }
                    }}
                    style={{
                      flex: 1,
                      color: theme.textPrimary,
                      fontSize: 15,
                      outlineStyle: "none",
                    } as any}
                  />
                </View>
                <AnimatedPressable
                  onPress={() => {
                    if (webManualCode.trim()) {
                      handleBarcodeScanned(webManualCode.trim());
                      setWebManualCode("");
                    }
                  }}
                  style={{
                    backgroundColor: theme.primary,
                    paddingHorizontal: 18,
                    borderRadius: 14,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
                </AnimatedPressable>
              </View>

              {(loading || errorMsg) && (
                <View
                  style={{
                    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(2, 132, 199, 0.08)",
                    borderRadius: 10,
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    maxWidth: 440,
                    width: "100%",
                  }}
                >
                  <Text style={{ color: theme.textPrimary, fontSize: 12, fontWeight: "600", textAlign: "center" }}>
                    {loading ? "Memeriksa kode..." : errorMsg}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            /* Native: Camera View */
            <>
              {isFocused && CameraView ? (
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  zoom={zoomFactor}
                  enableTorch={enableTorch}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={handleBarcodeScanned}
                />
              ) : (
                <View style={{ flex: 1, backgroundColor: "#000000" }} />
              )}
            </>
          )}

          {/* Camera Action Controls — native only */}
          {Platform.OS !== "web" && (
            <>
              <View
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  zIndex: 10,
                }}
              >
                {/* Batch Borrowing Toggle Button (Up to 50 HTs) */}
                <AnimatedPressable
                  onPress={() => {
                    setIsBatchMode((prev) => !prev);
                    try {
                      SafeHaptics.impactAsync();
                    } catch {}
                  }}
                  style={{
                    height: 32,
                    paddingHorizontal: 10,
                    borderRadius: 16,
                    backgroundColor: isBatchMode ? theme.primary : "rgba(15, 23, 42, 0.75)",
                    borderColor: isBatchMode ? theme.primary : "rgba(255, 255, 255, 0.25)",
                    borderWidth: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Ionicons name={isBatchMode ? "checkbox" : "albums-outline"} size={14} color="#FFFFFF" />
                  <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 11.5 }}>
                    {isBatchMode ? `Batch (${batchSelectedAssets.length}/50)` : "Mode Multi-HT"}
                  </Text>
                </AnimatedPressable>

                {/* Zoom Button */}
                <AnimatedPressable
                  onPress={() => setZoomFactor((prev) => (prev === 0 ? 0.3 : prev === 0.3 ? 0.6 : 0))}
                  style={{
                    height: 32,
                    paddingHorizontal: 10,
                    borderRadius: 16,
                    backgroundColor: "rgba(15, 23, 42, 0.75)",
                    borderColor: "rgba(255, 255, 255, 0.25)",
                    borderWidth: 1,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 12 }}>
                    {zoomFactor === 0 ? "1x" : zoomFactor === 0.3 ? "2x" : "3x"}
                  </Text>
                </AnimatedPressable>

                {/* Torch Toggle */}
                <AnimatedPressable
                  onPress={() => setEnableTorch((prev) => !prev)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: enableTorch ? "#FACC15" : "rgba(15, 23, 42, 0.75)",
                    borderColor: "rgba(255, 255, 255, 0.25)",
                    borderWidth: 1,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Ionicons
                    name={enableTorch ? "flash" : "flash-outline"}
                    size={16}
                    color={enableTorch ? "#0F172A" : "#FFFFFF"}
                  />
                </AnimatedPressable>

                {/* Expand / Compact Toggle */}
                <AnimatedPressable
                  onPress={() => setIsCameraExpanded((prev) => !prev)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: "rgba(15, 23, 42, 0.75)",
                    borderColor: "rgba(255, 255, 255, 0.25)",
                    borderWidth: 1,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Ionicons
                    name={isCameraExpanded ? "contract-outline" : "expand-outline"}
                    size={16}
                    color="#FFFFFF"
                  />
                </AnimatedPressable>
              </View>

              {/* Scanner Reticle */}
              <View style={{ position: "absolute", inset: 0, justifyContent: "center", alignItems: "center" }}>
                <View
                  style={{
                    width: isCameraExpanded ? 200 : 140,
                    height: isCameraExpanded ? 200 : 140,
                    borderWidth: 2,
                    borderColor: isBatchMode ? "#38BDF8" : theme.primary,
                    borderRadius: 20,
                    backgroundColor: "rgba(0, 0, 0, 0.12)",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Ionicons
                    name={isBatchMode ? "albums" : "qr-code-outline"}
                    size={isCameraExpanded ? 50 : 36}
                    color="rgba(255, 255, 255, 0.8)"
                  />
                </View>
              </View>

              {/* Toast Status Bar */}
              <View
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: 12,
                  right: 12,
                  backgroundColor: isBatchMode ? "rgba(2, 132, 199, 0.9)" : "rgba(15, 23, 42, 0.85)",
                  borderRadius: 12,
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 11.5, fontWeight: "600" }}>
                  {loading
                    ? "Memeriksa QR Code..."
                    : errorMsg ??
                      (isBatchMode
                        ? `Mode Batch Aktif: Pindai QR Code atau centang unit (${batchSelectedAssets.length}/50)`
                        : "Arahkan kamera ke stiker QR Code atau pilih unit di bawah")}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Catalog & Asset Selection Grid */}
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }}>
          {/* Summary & Mode Info */}
          <View
            style={{
              backgroundColor: theme.cardBackground,
              borderColor: isBatchMode ? theme.primary : theme.cardBorder,
              borderWidth: 1,
              borderRadius: 16,
              padding: 12,
              marginBottom: 10,
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: isBatchMode
                    ? (theme.isDark ? "rgba(2, 132, 199, 0.3)" : "rgba(2, 132, 199, 0.15)")
                    : (theme.isDark ? "rgba(56, 189, 248, 0.18)" : "rgba(2, 132, 199, 0.12)"),
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Ionicons
                  name={isBatchMode ? "layers" : "radio-outline"}
                  size={18}
                  color={theme.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.textPrimary, fontWeight: "800", fontSize: 13.5 }}>
                  {isBatchMode ? "Peminjaman Multi-Unit HT (Max 50)" : "Katalog Unit HT"}
                </Text>
                <Text style={{ color: theme.textSecondary, fontSize: 11.5 }}>
                  {isBatchMode
                    ? `${batchSelectedAssets.length} unit terpilih • ${tersediaCount} siap dipinjam`
                    : `${tersediaCount} dari ${totalCount} unit siap digunakan`}
                </Text>
              </View>
            </View>

            <AnimatedPressable
              onPress={() => setIsBatchMode((prev) => !prev)}
              style={{
                backgroundColor: isBatchMode ? theme.primary : (theme.isDark ? "rgba(255, 255, 255, 0.08)" : "#F1F5F9"),
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 10,
              }}
            >
              <Text
                style={{
                  fontSize: 11.5,
                  fontWeight: "700",
                  color: isBatchMode ? theme.primaryTextOnButton : theme.primary,
                }}
              >
                {isBatchMode ? "Mode Satuan" : "+ Mode Multi-HT"}
              </Text>
            </AnimatedPressable>
          </View>

          {/* Proportional Segmented Category Filter Bar */}
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
              { id: "semua", label: "Semua", count: totalCount, color: "#0284C7" },
              { id: "tersedia", label: "Tersedia", count: tersediaCount, color: isDark ? "#4ADE80" : "#16A34A" },
              { id: "dipinjam", label: "Dipinjam", count: dipinjamCount, color: isDark ? "#FB923C" : "#EA580C" },
              { id: "rusak", label: "Rusak", count: rusakCount, color: isDark ? "#F87171" : "#DC2626" },
            ].map((tab) => {
              const isActive = filterCategory === tab.id;
              return (
                <AnimatedPressable
                  key={tab.id}
                  onPress={() => {
                    setFilterCategory(tab.id as any);
                  SafeHaptics.selectionAsync();
                  }}
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 3.5,
                    paddingVertical: 7,
                    borderRadius: 10,
                    backgroundColor: isActive
                      ? isDark ? tab.color : "#FFFFFF"
                      : "transparent",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: isActive ? "800" : "700",
                      color: isActive
                        ? isDark ? "#FFFFFF" : tab.color
                        : (isDark ? "#94A3B8" : "#475569"),
                    }}
                  >
                    {tab.label}
                  </Text>
                  <View
                    style={{
                      backgroundColor: isActive
                        ? (isDark ? "rgba(255, 255, 255, 0.25)" : "rgba(2, 132, 199, 0.12)")
                        : (isDark ? "rgba(255, 255, 255, 0.1)" : "#CBD5E1"),
                      paddingHorizontal: 4.5,
                      paddingVertical: 1,
                      borderRadius: 7,
                    }}
                  >
                    <Text style={{ fontSize: 9.5, fontWeight: "800", color: isActive ? (isDark ? "#FFFFFF" : tab.color) : theme.textSecondary }}>
                      {tab.count}
                    </Text>
                  </View>
                </AnimatedPressable>
              );
            })}
          </View>

          {/* Asset List */}
          <FlatList
            data={filteredAssets}
            keyExtractor={(item) => item.id}
            removeClippedSubviews={true}
            maxToRenderPerBatch={8}
            initialNumToRender={8}
            windowSize={4}
            contentContainerStyle={{ paddingBottom: batchSelectedAssets.length > 0 ? 100 : 32, gap: 10 }}
            renderItem={({ item }) => (
              <ListItem
                item={item}
                isBatchMode={isBatchMode}
                isSelectedInBatch={batchSelectedAssets.some((b) => b.id === item.id)}
                onPress={() => {
                  if (isBatchMode) {
                    toggleSelectBatchAsset(item);
                  } else {
                    handleBarcodeScanned({ data: item.code });
                  }
                }}
              />
            )}
          />
        </View>
      </View>

      {/* Floating Bottom Bar when 1 or more items are selected in Batch Mode */}
      {batchSelectedAssets.length > 0 && (
        <View
          style={{
            position: "absolute",
            bottom: 20,
            left: 16,
            right: 16,
            maxWidth: 640,
            alignSelf: "center",
            backgroundColor: theme.cardBackground,
            borderColor: theme.primary,
            borderWidth: 1.5,
            borderRadius: 20,
            padding: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            shadowColor: theme.primary,
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.25,
            shadowRadius: 12,
            elevation: 8,
          }}
        >
          <View style={{ gap: 2, flex: 1, marginRight: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View
                style={{
                  backgroundColor: batchSelectedAssets.length > 1 ? theme.primary : "#10B981",
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 10,
                }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 12 }}>
                  {batchSelectedAssets.length} HT
                </Text>
              </View>
              <Text style={{ fontSize: 13, fontWeight: "800", color: theme.textPrimary }}>
                {batchSelectedAssets.length > 1 ? "Peminjaman Batch" : "Peminjaman Tunggal"}
              </Text>
            </View>
            <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textSecondary }}>
              {batchSelectedAssets.length > 1
                ? `${batchSelectedAssets.length} unit terpilih untuk dipinjam sekaligus`
                : `${batchSelectedAssets[0]?.name || "1 unit"} siap diajukan`}
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {/* Tombol Batal Pilihan */}
            <AnimatedPressable
              onPress={() => {
                setBatchSelectedAssets([]);
                setIsBatchMode(false);
              }}
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#F1F5F9",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Ionicons name="close" size={18} color={theme.textSecondary} />
            </AnimatedPressable>

            {/* Tombol Aksi: Satuan vs Batch */}
            <AnimatedPressable
              onPress={() => {
                if (batchSelectedAssets.length === 1) {
                  const targetId = batchSelectedAssets[0].id;
                  setBatchSelectedAssets([]);
                  setIsBatchMode(false);
                  router.push(`/asset/${targetId}`);
                } else if (batchSelectedAssets.length > 1) {
                  setBatchModalVisible(true);
                }
              }}
              style={{
                backgroundColor: theme.primary,
                paddingVertical: 11,
                paddingHorizontal: 14,
                borderRadius: 14,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Ionicons name="paper-plane-outline" size={16} color={theme.primaryTextOnButton} />
              <Text style={{ color: theme.primaryTextOnButton, fontWeight: "800", fontSize: 13 }}>
                {batchSelectedAssets.length > 1
                  ? `Pinjam Batch (${batchSelectedAssets.length})`
                  : "Pinjam Unit (1)"}
              </Text>
            </AnimatedPressable>
          </View>
        </View>
      )}

      {/* BATCH BORROW CHECKOUT MODAL */}
      <Modal
        visible={batchModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setBatchModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" }}>
          <View
            style={{
              backgroundColor: theme.cardBackground,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 22,
              maxHeight: "90%",
              borderColor: theme.cardBorder,
              borderTopWidth: 1,
            }}
          >
            {/* Modal Header */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <View>
                <Text style={{ fontSize: 19, fontWeight: "800", color: theme.textPrimary }}>
                  Form Peminjaman Batch ({batchSelectedAssets.length} HT)
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                  Satu Peminjam untuk {batchSelectedAssets.length} QR Code HT Berbeda
                </Text>
              </View>

              <AnimatedPressable
                onPress={() => setBatchModalVisible(false)}
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
              {/* Selected HT Units Breakdown List */}
              <View style={{ gap: 8 }}>
                <Text style={{ fontSize: 12.5, fontWeight: "700", color: theme.textPrimary, textTransform: "uppercase" }}>
                  Daftar Unit HT Terpilih ({batchSelectedAssets.length} Unit)
                </Text>

                <View
                  style={{
                    maxHeight: 180,
                    backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC",
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: theme.cardBorder,
                    padding: 10,
                  }}
                >
                  <ScrollView nestedScrollEnabled contentContainerStyle={{ gap: 6 }}>
                    {batchSelectedAssets.map((item, index) => (
                      <View
                        key={`${item.id}-${index}`}
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          backgroundColor: theme.cardBackground,
                          padding: 8,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: theme.cardBorder,
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                          <View
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 11,
                              backgroundColor: theme.primary,
                              justifyContent: "center",
                              alignItems: "center",
                            }}
                          >
                            <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "800" }}>
                              {index + 1}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "700", color: theme.textPrimary }}>
                              {item.name}
                            </Text>
                            <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textSecondary }}>
                              Kode: {item.code} • SN: {item.serial_number}
                            </Text>
                          </View>
                        </View>

                        <AnimatedPressable
                          onPress={() => toggleSelectBatchAsset(item)}
                          style={{ padding: 4 }}
                        >
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </AnimatedPressable>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              </View>

              {/* Form Input: Nama Peminjam */}
              <View style={{ gap: 4 }}>
                <Text style={{ fontWeight: "700", color: theme.textPrimary, fontSize: 12.5 }}>
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
                  }}
                />
              </View>

              {/* Form Input: Pangkat / NRP */}
              <View style={{ gap: 4 }}>
                <Text style={{ fontWeight: "700", color: theme.textPrimary, fontSize: 12.5 }}>
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
                  }}
                />
              </View>

              {/* Form Input: Kesatuan */}
              <View style={{ gap: 4 }}>
                <Text style={{ fontWeight: "700", color: theme.textPrimary, fontSize: 12.5 }}>
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
                    marginBottom: 6,
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
                            : (theme.isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(2, 132, 199, 0.08)"),
                          borderWidth: 1,
                          borderColor: isSelected ? theme.primary : theme.cardBorder,
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

              {/* Input Catatan Opsional */}
              <View style={{ gap: 4 }}>
                <Text style={{ fontWeight: "700", color: theme.textPrimary, fontSize: 12.5 }}>
                  Catatan Keperluan / Kegiatan (Opsional)
                </Text>
                <TextInput
                  placeholder="Contoh: Pengamanan Operasi Lilin 2026..."
                  placeholderTextColor={theme.inputPlaceholder}
                  value={batchNotes}
                  onChangeText={setBatchNotes}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    height: 44,
                    color: theme.inputText,
                    fontSize: 13,
                  }}
                />
              </View>

              {/* Batas Waktu Pengembalian Batch */}
              <DueDatePicker value={batchDueDate} onChange={setBatchDueDate} />

              {/* Surat Resmi Batch (Wajib) */}
              <OfficialLetterUploader
                value={batchOfficialDoc}
                onChange={setBatchOfficialDoc}
                isRequired={true}
              />

              {/* Action Submit Button */}
              <AnimatedPressable
                onPress={executeBatchSubmit}
                disabled={submittingBatch}
                style={{
                  backgroundColor: theme.primary,
                  borderRadius: 14,
                  padding: 15,
                  alignItems: "center",
                  marginTop: 10,
                  marginBottom: 20,
                  opacity: submittingBatch ? 0.6 : 1,
                }}
              >
                {submittingBatch ? (
                  <ActivityIndicator color={theme.primaryTextOnButton} />
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="paper-plane" size={16} color={theme.primaryTextOnButton} />
                    <Text style={{ color: theme.primaryTextOnButton, fontWeight: "800", fontSize: 15 }}>
                      Kirim Pengajuan Batch ({batchSelectedAssets.length} HT)
                    </Text>
                  </View>
                )}
              </AnimatedPressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Feedback Toast Bottom Sheet */}
      <AppBottomSheet
        visible={toastConfig.visible}
        onClose={() => setToastConfig((prev) => ({ ...prev, visible: false }))}
        title={toastConfig.title}
        message={toastConfig.message}
        icon={toastConfig.icon}
        isDanger={toastConfig.isDanger}
      />
    </View>
  );
}
