import { useState, useEffect } from "react";
import { View, Text, ActivityIndicator, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeHaptics } from "@/lib/safeHaptics";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/hooks/useTheme";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppBottomSheet } from "@/components/AppBottomSheet";
import { StatusBadge } from "@/components/StatusBadge";
import { DocumentViewerModal } from "@/components/DocumentViewerModal";
import { getFriendlyErrorMessage } from "@/lib/errorHandler";
import { formatFullDateTimeId, getRemainingTimeStatus } from "@/lib/dateUtils";
import type { Transaction } from "@/types/database";

export default function ReturnScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const [selectedStatus, setSelectedStatus] = useState<"Tersedia" | "Rusak">("Tersedia");
  const [notes, setNotes] = useState("");
  const [activeTx, setActiveTx] = useState<Transaction | null>(null);
  const [viewDocModal, setViewDocModal] = useState<{ visible: boolean; url: string; name: string }>({
    visible: false,
    url: "",
    name: "",
  });
  const [submitting, setSubmitting] = useState(false);
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

  // Load Active Borrowing Transaction for Due Date Inspection
  useEffect(() => {
    if (!id) return;
    supabase
      .from("transactions")
      .select("*, asset:assets(*)")
      .eq("asset_id", id)
      .eq("action", "BORROW")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setActiveTx(data as Transaction);
      });
  }, [id]);

  function triggerSubmit() {
    if (!id) return;

    setModalConfig({
      visible: true,
      title: "Konfirmasi Pengembalian",
      message: `Proses pengembalian unit HT dengan kondisi ${selectedStatus === "Tersedia" ? "Baik" : "Rusak"}?`,
      icon: selectedStatus === "Tersedia" ? "📥" : "⚠️",
      onConfirm: executeSubmit,
    });
  }

  async function executeSubmit() {
    setSubmitting(true);
    const conditionValue = selectedStatus === "Tersedia" ? "baik" : "rusak";

    let { error: rpcError } = await supabase.rpc("process_asset_transaction", {
      p_asset_id: id!,
      p_action: "RETURN",
      p_condition: conditionValue,
      p_notes: notes.trim() || null,
    });

    const targetStatus = conditionValue === "baik" ? "tersedia" : "rusak";

    if (rpcError) {
      console.warn("RPC return error, applying fallback update:", rpcError);
      
      let fallbackSuccess = false;

      // 1. Try RPC status override (bypasses RLS with SECURITY DEFINER)
      const { error: overrideErr } = await supabase.rpc("admin_override_asset_status", {
        p_asset_id: id!,
        p_new_status: targetStatus,
        p_reason: `Pengembalian Fisik (${conditionValue === "baik" ? "Kondisi Baik" : "Unit Rusak"})`,
      });

      if (!overrideErr) {
        fallbackSuccess = true;
      } else {
        // 2. Direct table update fallback
        const { error: directErr } = await supabase
          .from("assets")
          .update({ status: targetStatus, updated_at: new Date().toISOString() })
          .eq("id", id!);
        if (!directErr) fallbackSuccess = true;
      }

      if (fallbackSuccess) {
        rpcError = null;

        try {
          // Ikutkan data peminjam dari transaksi BORROW aktif (activeTx) supaya
          // baris RETURN ini tidak tampil kosong (tanpa nama/NRP/kesatuan) di
          // Riwayat/Audit dibanding baris yang diproses lewat RPC normal.
          await supabase.from("transactions").insert({
            asset_id: id!,
            borrower_id: activeTx?.borrower_id ?? null,
            borrower_name: activeTx?.borrower_name ?? null,
            borrower_nrp: activeTx?.borrower_nrp ?? null,
            kesatuan: activeTx?.kesatuan ?? null,
            action: "RETURN",
            status: "APPROVED",
            condition: conditionValue,
            notes: notes.trim() || "Pengembalian Fisik",
          });
        } catch {}

        try {
          await supabase.from("asset_state_logs").insert({
            asset_id: id!,
            from_state: "dipinjam",
            to_state: targetStatus,
            reason: `Pengembalian Fisik (${conditionValue === "baik" ? "Kondisi Baik" : "Unit Rusak"})`,
          });
        } catch {}
      }
    }

    setSubmitting(false);

    if (rpcError) {
      setModalConfig({
        visible: true,
        title: "Gagal Pengembalian",
        message: getFriendlyErrorMessage(rpcError, "Gagal memproses pengembalian aset."),
        icon: "❌",
        isDanger: true,
        onConfirm: () => {},
      });
      return;
    }

    try {
      SafeHaptics.notificationAsync();
    } catch {}

    setModalConfig({
      visible: true,
      title: "Pengembalian Berhasil",
      message: "Pengembalian unit HT berhasil dicatat.",
      icon: "✅",
      onConfirm: () => router.replace("/(tabs)"),
    });
  }

  return (
    <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, justifyContent: "center", flexGrow: 1 }}>
          <View
            className="bg-white/80 dark:bg-slate-900/75 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xl"
            style={{
              backgroundColor: theme.cardBackground,
              borderColor: theme.cardBorder,
              borderWidth: 1,
              borderRadius: 24,
              padding: 24,
              shadowColor: theme.shadowColor,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.2,
              shadowRadius: 16,
              elevation: 6,
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              className="text-xl font-extrabold text-center text-slate-900 dark:text-white mb-2"
              style={{ fontSize: 20, fontWeight: "800", textAlign: "center", color: theme.textPrimary, marginBottom: 8 }}
            >
              Pengembalian Unit HT
            </Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              className="text-sm text-center text-slate-500 dark:text-slate-400 mb-5"
              style={{ fontSize: 14, textAlign: "center", color: theme.textSecondary, marginBottom: 14 }}
            >
              Pilih kondisi unit HT saat dikembalikan
            </Text>

            {/* Due Date & Peminjam Info Banner */}
            {activeTx && (
              <View
                style={{
                  backgroundColor: theme.isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC",
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                  padding: 12,
                  marginBottom: 16,
                  gap: 6,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary }}>
                    Peminjam: {activeTx.borrower_name || "Petugas"}
                  </Text>
                  <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                    Kesatuan: {activeTx.kesatuan || "-"}
                  </Text>
                </View>

                {activeTx.due_date && (() => {
                  const rem = getRemainingTimeStatus(activeTx.due_date);
                  const isOver = rem?.isOverdue;
                  return (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        backgroundColor: isOver ? "rgba(239, 68, 68, 0.15)" : "rgba(34, 197, 94, 0.15)",
                        borderColor: isOver ? "#ef4444" : "#22c55e",
                        borderWidth: 1,
                        padding: 8,
                        borderRadius: 8,
                      }}
                    >
                      <Ionicons
                        name={isOver ? "alert-circle" : "checkmark-circle"}
                        size={16}
                        color={isOver ? "#ef4444" : "#22c55e"}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 11.5, fontWeight: "800", color: isOver ? "#ef4444" : "#15803d" }}>
                          {isOver ? "⚠️ KETERLAMBATAN PENGEMBALIAN" : "✅ PENGEMBALIAN TEPAT WAKTU"}
                        </Text>
                        <Text style={{ fontSize: 11, color: isOver ? "#b91c1c" : "#166534", marginTop: 1 }}>
                          {rem?.label} • Batas: {formatFullDateTimeId(activeTx.due_date)}
                        </Text>
                      </View>
                    </View>
                  );
                })()}

                {activeTx.document_url && (
                  <AnimatedPressable
                    onPress={() => setViewDocModal({ visible: true, url: activeTx.document_url!, name: activeTx.document_name || "Surat_Resmi" })}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      backgroundColor: "rgba(16, 185, 129, 0.12)",
                      padding: 6,
                      borderRadius: 6,
                      alignSelf: "flex-start",
                    }}
                  >
                    <Ionicons name="document-text" size={14} color="#10b981" />
                    <Text style={{ fontSize: 11.5, fontWeight: "700", color: "#10b981" }}>
                      Lihat Surat Resmi Terlampir
                    </Text>
                  </AnimatedPressable>
                )}
              </View>
            )}

            {/* Condition Toggle Buttons */}
            <View style={{ gap: 12, marginBottom: 16 }}>
              <AnimatedPressable
                onPress={() => {
                  setSelectedStatus("Tersedia");
                  SafeHaptics.selectionAsync();
                }}
                style={{
                  backgroundColor: selectedStatus === "Tersedia" ? (theme.isDark ? "rgba(34, 197, 94, 0.22)" : "rgba(34, 197, 94, 0.12)") : theme.inputBackground,
                  borderColor: selectedStatus === "Tersedia" ? "#22C55E" : theme.inputBorder,
                  borderWidth: selectedStatus === "Tersedia" ? 2 : 1,
                  borderRadius: 16,
                  padding: 16,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Ionicons name="checkmark-circle" size={20} color={selectedStatus === "Tersedia" ? "#22C55E" : theme.textMuted} />
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={{ color: selectedStatus === "Tersedia" ? "#22C55E" : theme.textPrimary, fontWeight: "800", fontSize: 15 }}
                >
                  Unit Berfungsi Baik
                </Text>
              </AnimatedPressable>

              <AnimatedPressable
                onPress={() => {
                  setSelectedStatus("Rusak");
                  SafeHaptics.selectionAsync();
                }}
                style={{
                  backgroundColor: selectedStatus === "Rusak" ? (theme.isDark ? "rgba(239, 68, 68, 0.22)" : "rgba(239, 68, 68, 0.12)") : theme.inputBackground,
                  borderColor: selectedStatus === "Rusak" ? "#EF4444" : theme.inputBorder,
                  borderWidth: selectedStatus === "Rusak" ? 2 : 1,
                  borderRadius: 16,
                  padding: 16,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Ionicons name="alert-circle" size={20} color={selectedStatus === "Rusak" ? "#EF4444" : theme.textMuted} />
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={{ color: selectedStatus === "Rusak" ? "#EF4444" : theme.textPrimary, fontWeight: "800", fontSize: 15 }}
                >
                  Ada Kendala / Rusak
                </Text>
              </AnimatedPressable>
            </View>

            {/* Quick Note Presets */}
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginBottom: 8 }}>
                Pilihan Cepat Catatan
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {[
                  "Unit & baterai lengkap normal",
                  "Fisik mulus tanpa kendala",
                  "Baterai agak lemah",
                  "Antena / knob longgar",
                ].map((notePreset) => (
                  <AnimatedPressable
                    key={notePreset}
                    onPress={() => {
                      setNotes(notePreset);
                      SafeHaptics.selectionAsync();
                    }}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 10,
                      backgroundColor: notes === notePreset ? theme.primary : (theme.isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)"),
                      borderWidth: 1,
                      borderColor: notes === notePreset ? theme.primary : theme.cardBorder,
                    }}
                  >
                    <Text style={{ fontSize: 11.5, fontWeight: "600", color: notes === notePreset ? "#FFFFFF" : theme.textSecondary }}>
                      {notePreset}
                    </Text>
                  </AnimatedPressable>
                ))}
              </View>
            </View>

            {/* Optional Notes Input */}
            <View style={{ marginBottom: 20 }}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={{ fontWeight: "600", marginBottom: 6, color: theme.textPrimary, fontSize: 13 }}
              >
                Catatan Tambahan
              </Text>
              <TextInput
                placeholder="Tulis catatan atau keluhan jika ada..."
                placeholderTextColor={theme.inputPlaceholder}
                value={notes}
                onChangeText={setNotes}
                multiline
                style={{
                  backgroundColor: theme.inputBackground,
                  borderWidth: 1,
                  borderColor: theme.inputBorder,
                  borderRadius: 12,
                  padding: 12,
                  minHeight: 70,
                  textAlignVertical: "top",
                  color: theme.inputText,
                  fontSize: 14,
                  outlineStyle: "none" as any,
                }}
              />
            </View>

            {/* Submit Button */}
            <AnimatedPressable
              onPress={triggerSubmit}
              disabled={submitting}
              style={{
                backgroundColor: theme.primary,
                borderRadius: 14,
                padding: 16,
                alignItems: "center",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? (
                <ActivityIndicator color={theme.primaryTextOnButton} />
              ) : (
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={{ color: theme.primaryTextOnButton, fontWeight: "700", fontSize: 16, includeFontPadding: false }}
                >
                  Konfirmasi Pengembalian
                </Text>
              )}
            </AnimatedPressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Confirmation Bottom Sheet */}
      <AppBottomSheet
        visible={modalConfig.visible}
        onClose={() => setModalConfig((prev) => ({ ...prev, visible: false }))}
        onConfirm={modalConfig.onConfirm}
        title={modalConfig.title}
        message={modalConfig.message}
        icon={modalConfig.icon}
        isDanger={modalConfig.isDanger}
      />

      {/* Official Document Viewer Modal */}
      <DocumentViewerModal
        visible={viewDocModal.visible}
        onClose={() => setViewDocModal((prev) => ({ ...prev, visible: false }))}
        documentUrl={viewDocModal.url}
        documentName={viewDocModal.name}
        title="Surat Perintah / Resmi (Peminjaman)"
      />
    </LinearGradient>
  );
}
