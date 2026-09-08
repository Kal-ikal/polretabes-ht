import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeHaptics } from "@/lib/safeHaptics";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useAppTheme } from "@/context/ThemeContext";
import { supabase } from "@/lib/supabase";
import { addHoursToNow, formatFullDateTimeId } from "@/lib/dateUtils";
import type { LoanDurationPreset } from "@/types/database";

const DEFAULT_PRESETS: LoanDurationPreset[] = [
  { id: "def-1", label: "12 Jam (Piket)", duration_hours: 12, is_active: true, sort_order: 1, created_at: "" },
  { id: "def-2", label: "1 Hari (24 Jam)", duration_hours: 24, is_active: true, sort_order: 2, created_at: "" },
  { id: "def-3", label: "3 Hari (Operasi)", duration_hours: 72, is_active: true, sort_order: 3, created_at: "" },
  { id: "def-4", label: "7 Hari (Kegiatan)", duration_hours: 168, is_active: true, sort_order: 4, created_at: "" },
];

export interface DueDatePickerProps {
  value: string | null; // ISO Date String
  onChange: (isoDateString: string | null) => void;
}

export function DueDatePicker({ value, onChange }: DueDatePickerProps) {
  const { theme, isDark } = useAppTheme();
  const [presets, setPresets] = useState<LoanDurationPreset[]>(DEFAULT_PRESETS);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("def-1");
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customDays, setCustomDays] = useState("1");
  const [customHours, setCustomHours] = useState("0");

  // Fetch preset durasi yang diatur oleh Admin dari database
  useEffect(() => {
    async function loadPresets() {
      try {
        const { data, error } = await supabase
          .from("loan_duration_presets")
          .select("*")
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (!error && data && data.length > 0) {
          setPresets(data as LoanDurationPreset[]);
          // Jika belum ada nilai value, default ke preset pertama
          if (!value) {
            const first = data[0];
            setSelectedPresetId(first.id);
            const calculated = addHoursToNow(first.duration_hours).toISOString();
            onChange(calculated);
          }
        } else {
          // Fallback default
          if (!value) {
            setSelectedPresetId("def-1");
            const calculated = addHoursToNow(12).toISOString();
            onChange(calculated);
          }
        }
      } catch {
        if (!value) {
          setSelectedPresetId("def-1");
          const calculated = addHoursToNow(12).toISOString();
          onChange(calculated);
        }
      }
    }
    loadPresets();
  }, []);

  const handleSelectPreset = (preset: LoanDurationPreset) => {
    try {
      SafeHaptics.selectionAsync();
    } catch {}
    setSelectedPresetId(preset.id);
    const newDueDate = addHoursToNow(preset.duration_hours).toISOString();
    onChange(newDueDate);
  };

  const handleOpenCustom = () => {
    try {
      SafeHaptics.impactAsync();
    } catch {}
    setShowCustomModal(true);
  };

  const handleApplyCustom = () => {
    const days = parseInt(customDays, 10) || 0;
    const hours = parseInt(customHours, 10) || 0;
    const totalHours = days * 24 + hours;

    if (totalHours <= 0) {
      return;
    }

    try {
      SafeHaptics.notificationAsync();
    } catch {}

    setSelectedPresetId("custom");
    const newDueDate = addHoursToNow(totalHours).toISOString();
    onChange(newDueDate);
    setShowCustomModal(false);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Ionicons name="time-outline" size={18} color={theme.primary} style={{ marginRight: 6 }} />
          <Text style={[styles.title, { color: theme.textPrimary }]}>Batas Waktu Pengembalian</Text>
        </View>
        <View style={styles.requiredBadge}>
          <Text style={styles.requiredText}>WAJIB</Text>
        </View>
      </View>

      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        Pilih durasi tugas kedinasan untuk menentukan batas waktu pengembalian HT.
      </Text>

      {/* Preset Chips Scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsScroll}
      >
        {presets.map((preset) => {
          const isSelected = selectedPresetId === preset.id;
          return (
            <AnimatedPressable
              key={preset.id}
              onPress={() => handleSelectPreset(preset)}
              style={[
                styles.chip,
                {
                  backgroundColor: isSelected ? theme.primary : theme.cardBackground,
                  borderColor: isSelected ? theme.primary : theme.cardBorder,
                },
              ]}
            >
              <Ionicons
                name={isSelected ? "checkmark-circle" : "time-outline"}
                size={14}
                color={isSelected ? "#ffffff" : theme.textSecondary}
                style={{ marginRight: 5 }}
              />
              <Text
                style={[
                  styles.chipText,
                  { color: isSelected ? "#ffffff" : theme.textPrimary },
                ]}
              >
                {preset.label}
              </Text>
            </AnimatedPressable>
          );
        })}

        {/* Custom Duration Button */}
        <AnimatedPressable
          onPress={handleOpenCustom}
          style={[
            styles.chip,
            {
              backgroundColor: selectedPresetId === "custom" ? theme.primary : theme.cardBackground,
              borderColor: selectedPresetId === "custom" ? theme.primary : theme.cardBorder,
            },
          ]}
        >
          <Ionicons
            name="calendar-outline"
            size={14}
            color={selectedPresetId === "custom" ? "#ffffff" : theme.textSecondary}
            style={{ marginRight: 5 }}
          />
          <Text
            style={[
              styles.chipText,
              { color: selectedPresetId === "custom" ? "#ffffff" : theme.textPrimary },
            ]}
          >
            Kustom Durasi...
          </Text>
        </AnimatedPressable>
      </ScrollView>

      {/* Calculated Deadline Banner */}
      {value ? (
        <View style={[styles.deadlineCard, { backgroundColor: isDark ? "rgba(14, 165, 233, 0.12)" : "rgba(14, 165, 233, 0.08)", borderColor: "rgba(14, 165, 233, 0.3)" }]}>
          <View style={styles.deadlineIconBox}>
            <Ionicons name="alarm" size={20} color="#0284c7" />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.deadlineTitle}>Jatuh Tempo Pengembalian</Text>
            <Text style={[styles.deadlineValue, { color: theme.textPrimary }]}>
              {formatFullDateTimeId(value)}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Custom Duration Modal */}
      <Modal
        visible={showCustomModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCustomModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="time" size={24} color={theme.primary} style={{ marginRight: 8 }} />
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>Atur Durasi Kustom</Text>
            </View>
            <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
              Tentukan berapa hari atau jam unit HT akan dipinjam untuk tugas ini.
            </Text>

            <View style={styles.customInputRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>Jumlah Hari</Text>
                <TextInput
                  value={customDays}
                  onChangeText={setCustomDays}
                  keyboardType="numeric"
                  style={[styles.numericInput, { backgroundColor: theme.inputBackground, color: theme.inputText, borderColor: theme.inputBorder }]}
                  placeholder="0"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>Jumlah Jam Tambahan</Text>
                <TextInput
                  value={customHours}
                  onChangeText={setCustomHours}
                  keyboardType="numeric"
                  style={[styles.numericInput, { backgroundColor: theme.inputBackground, color: theme.inputText, borderColor: theme.inputBorder }]}
                  placeholder="0"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
            </View>

            <View style={styles.modalActions}>
              <AnimatedPressable
                onPress={() => setShowCustomModal(false)}
                style={[styles.modalCancelBtn, { borderColor: theme.cardBorder }]}
              >
                <Text style={[styles.modalBtnText, { color: theme.textSecondary }]}>Batal</Text>
              </AnimatedPressable>

              <AnimatedPressable
                onPress={handleApplyCustom}
                style={[styles.modalApplyBtn, { backgroundColor: theme.primary }]}
              >
                <Text style={[styles.modalBtnText, { color: "#ffffff", fontWeight: "700" }]}>
                  Terapkan Batas Waktu
                </Text>
              </AnimatedPressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
  },
  requiredBadge: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  requiredText: {
    color: "#ef4444",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 12,
    marginBottom: 10,
  },
  chipsScroll: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  deadlineCard: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  deadlineIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(14, 165, 233, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  deadlineTitle: {
    fontSize: 11,
    color: "#0284c7",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  deadlineValue: {
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  modalSubtitle: {
    fontSize: 12,
    marginBottom: 16,
    lineHeight: 16,
  },
  customInputRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  numericInput: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  modalApplyBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modalBtnText: {
    fontSize: 13,
  },
});
