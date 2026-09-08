import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { SafeHaptics } from "@/lib/safeHaptics";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useAppTheme } from "@/context/ThemeContext";
import { supabase } from "@/lib/supabase";
import { DocumentViewerModal } from "./DocumentViewerModal";

export interface OfficialDocumentData {
  url: string;
  name: string;
}

export interface OfficialLetterUploaderProps {
  value: OfficialDocumentData | null;
  onChange: (data: OfficialDocumentData | null) => void;
  isRequired?: boolean;
}

export function OfficialLetterUploader({
  value,
  onChange,
  isRequired = true,
}: OfficialLetterUploaderProps) {
  const { theme, isDark } = useAppTheme();
  const [uploading, setUploading] = useState(false);
  const [showViewer, setShowViewer] = useState(false);

  // Helper untuk upload ke Supabase Storage dengan fallback base64
  const processAndUploadFile = async (
    uri: string,
    fileName: string,
    mimeType: string,
    base64Data?: string | null
  ) => {
    setUploading(true);
    try {
      // 1. Coba upload ke Supabase Storage jika ada bucket
      let uploadedUrl: string | null = null;
      try {
        const fileExt = fileName.split(".").pop() || "jpg";
        const storagePath = `surat-resmi/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;

        if (Platform.OS === "web") {
          const response = await fetch(uri);
          const blob = await response.blob();
          const { data: storageData, error: storageErr } = await supabase.storage
            .from("official-documents")
            .upload(storagePath, blob, { contentType: mimeType, upsert: true });

          if (!storageErr && storageData) {
            const { data: publicUrlData } = supabase.storage
              .from("official-documents")
              .getPublicUrl(storagePath);
            uploadedUrl = publicUrlData.publicUrl;
          }
        }
      } catch (storageErr) {
        console.warn("Storage upload fallback to data URI:", storageErr);
      }

      // 2. Fallback: jika storage belum dibuat / gagal, gunakan Base64 Data URI
      if (!uploadedUrl) {
        if (base64Data) {
          uploadedUrl = `data:${mimeType};base64,${base64Data}`;
        } else {
          // Bila base64 belum ada, gunakan uri lokal
          uploadedUrl = uri;
        }
      }

      onChange({
        url: uploadedUrl,
        name: fileName,
      });

      try {
        SafeHaptics.notificationAsync();
      } catch {}
    } catch (err: any) {
      console.error("Error processing letter document:", err);
      Alert.alert("Gagal Memproses Surat", "Terjadi kesalahan saat memproses berkas surat.");
    } finally {
      setUploading(false);
    }
  };

  // 1. Ambil foto via kamera
  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Izin Kamera", "Izin akses kamera diperlukan untuk memotret surat resmi.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const fileName = asset.fileName || `surat_${Date.now()}.jpg`;
        await processAndUploadFile(
          asset.uri,
          fileName,
          asset.mimeType || "image/jpeg",
          asset.base64
        );
      }
    } catch (e: any) {
      Alert.alert("Kesalahan Kamera", e.message || "Gagal membuka kamera.");
    }
  };

  // 2. Pilih foto dari galeri
  const handlePickGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Izin Galeri", "Izin galeri diperlukan untuk memilih foto surat resmi.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const fileName = asset.fileName || `surat_${Date.now()}.jpg`;
        await processAndUploadFile(
          asset.uri,
          fileName,
          asset.mimeType || "image/jpeg",
          asset.base64
        );
      }
    } catch (e: any) {
      Alert.alert("Kesalahan Galeri", e.message || "Gagal memilih dari galeri.");
    }
  };

  // 3. Pilih Dokumen PDF / Berkas
  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const doc = result.assets[0];
        const fileName = doc.name || `dokumen_${Date.now()}.pdf`;
        await processAndUploadFile(
          doc.uri,
          fileName,
          doc.mimeType || "application/pdf",
          null
        );
      }
    } catch (e: any) {
      Alert.alert("Kesalahan Dokumen", e.message || "Gagal memilih dokumen.");
    }
  };

  const handleRemove = () => {
    try {
      SafeHaptics.impactAsync();
    } catch {}
    onChange(null);
  };

  const isPdf =
    value?.url.toLowerCase().includes(".pdf") ||
    value?.url.startsWith("data:application/pdf") ||
    value?.name.toLowerCase().endsWith(".pdf");

  return (
    <View style={styles.container}>
      {/* Header Label */}
      <View style={styles.headerRow}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Ionicons name="document-attach" size={18} color={theme.primary} style={{ marginRight: 6 }} />
          <Text style={[styles.title, { color: theme.textPrimary }]}>Surat Resmi / Perintah</Text>
        </View>
        {isRequired ? (
          <View style={styles.requiredBadge}>
            <Text style={styles.requiredText}>WAJIB</Text>
          </View>
        ) : (
          <Text style={[styles.optionalText, { color: theme.textSecondary }]}>Opsional</Text>
        )}
      </View>

      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        Lampirkan Surat Perintah (Sprint), Surat Tugas, atau Nota Dinas peminjaman HT.
      </Text>

      {uploading ? (
        <View style={[styles.loadingBox, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}>
          <ActivityIndicator size="small" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
            Memproses surat resmi...
          </Text>
        </View>
      ) : value ? (
        // Preview Card
        <View style={[styles.previewCard, { backgroundColor: theme.cardBackground, borderColor: theme.primary + "60" }]}>
          <AnimatedPressable
            onPress={() => setShowViewer(true)}
            style={styles.previewContent}
          >
            {isPdf ? (
              <View style={styles.pdfThumbnail}>
                <Ionicons name="document-text" size={28} color="#ef4444" />
              </View>
            ) : (
              <Image
                source={{ uri: value.url }}
                style={styles.imageThumbnail}
                resizeMode="cover"
              />
            )}

            <View style={styles.previewInfo}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons name="checkmark-circle" size={16} color="#10b981" style={{ marginRight: 4 }} />
                <Text style={[styles.fileStatus, { color: "#10b981" }]}>Terlampir</Text>
              </View>
              <Text style={[styles.fileName, { color: theme.textPrimary }]} numberOfLines={1}>
                {value.name || "Surat_Resmi.jpg"}
              </Text>
              <Text style={styles.tapToView}>Ketuk untuk melihat preview</Text>
            </View>
          </AnimatedPressable>

          <View style={styles.actionButtons}>
            <AnimatedPressable
              onPress={() => setShowViewer(true)}
              style={[styles.smallBtn, { backgroundColor: theme.primary + "18" }]}
              accessibilityLabel="Lihat Surat"
            >
              <Ionicons name="eye-outline" size={16} color={theme.primary} />
            </AnimatedPressable>

            <AnimatedPressable
              onPress={handleRemove}
              style={[styles.smallBtn, { backgroundColor: "rgba(239, 68, 68, 0.12)" }]}
              accessibilityLabel="Hapus Surat"
            >
              <Ionicons name="trash-outline" size={16} color="#ef4444" />
            </AnimatedPressable>
          </View>
        </View>
      ) : (
        // Upload Buttons Grid
        <View style={styles.buttonsGrid}>
          <AnimatedPressable
            onPress={handleTakePhoto}
            style={[styles.uploadBtn, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}
          >
            <View style={[styles.iconCircle, { backgroundColor: theme.primary + "15" }]}>
              <Ionicons name="camera" size={20} color={theme.primary} />
            </View>
            <Text style={[styles.btnLabel, { color: theme.textPrimary }]}>Foto Kamera</Text>
            <Text style={[styles.btnSub, { color: theme.textSecondary }]}>Ambil fisik surat</Text>
          </AnimatedPressable>

          <AnimatedPressable
            onPress={handlePickGallery}
            style={[styles.uploadBtn, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}
          >
            <View style={[styles.iconCircle, { backgroundColor: "#3b82f615" }]}>
              <Ionicons name="images" size={20} color="#3b82f6" />
            </View>
            <Text style={[styles.btnLabel, { color: theme.textPrimary }]}>Dari Galeri</Text>
            <Text style={[styles.btnSub, { color: theme.textSecondary }]}>Pilih foto surat</Text>
          </AnimatedPressable>

          <AnimatedPressable
            onPress={handlePickDocument}
            style={[styles.uploadBtn, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}
          >
            <View style={[styles.iconCircle, { backgroundColor: "#10b98115" }]}>
              <Ionicons name="document-text" size={20} color="#10b981" />
            </View>
            <Text style={[styles.btnLabel, { color: theme.textPrimary }]}>File Dokumen</Text>
            <Text style={[styles.btnSub, { color: theme.textSecondary }]}>Pilih file PDF</Text>
          </AnimatedPressable>
        </View>
      )}

      {/* Viewer Modal */}
      <DocumentViewerModal
        visible={showViewer}
        onClose={() => setShowViewer(false)}
        documentUrl={value?.url}
        documentName={value?.name}
        title="Surat Perintah / Resmi"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
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
  optionalText: {
    fontSize: 11,
  },
  subtitle: {
    fontSize: 12,
    marginBottom: 10,
    lineHeight: 16,
  },
  buttonsGrid: {
    flexDirection: "row",
    gap: 8,
  },
  uploadBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  btnLabel: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  btnSub: {
    fontSize: 10,
    textAlign: "center",
    marginTop: 2,
  },
  loadingBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  loadingText: {
    fontSize: 12,
    marginLeft: 8,
  },
  previewCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  previewContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  imageThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: "#1e293b",
  },
  pdfThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewInfo: {
    flex: 1,
    marginLeft: 10,
  },
  fileStatus: {
    fontSize: 11,
    fontWeight: "700",
  },
  fileName: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 1,
  },
  tapToView: {
    fontSize: 10,
    color: "#0ea5e9",
    marginTop: 2,
    fontWeight: "500",
  },
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 8,
  },
  smallBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
