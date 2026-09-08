import React from "react";
import {
  View,
  Text,
  Modal,
  Image,
  Dimensions,
  StyleSheet,
  StatusBar,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { SafeHaptics } from "@/lib/safeHaptics";
import { SafeAlert } from "@/lib/safeAlert";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useAppTheme } from "@/context/ThemeContext";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export interface DocumentViewerModalProps {
  visible: boolean;
  onClose: () => void;
  documentUrl?: string | null;
  documentName?: string | null;
  title?: string;
}

export function DocumentViewerModal({
  visible,
  onClose,
  documentUrl,
  documentName,
  title = "Surat Resmi / Surat Perintah",
}: DocumentViewerModalProps) {
  const { theme, isDark } = useAppTheme();

  if (!visible) return null;

  const isPdf =
    documentUrl?.toLowerCase().includes(".pdf") ||
    documentUrl?.startsWith("data:application/pdf") ||
    documentName?.toLowerCase().endsWith(".pdf");

  const isImage =
    documentUrl?.startsWith("data:image/") ||
    documentUrl?.match(/\.(jpeg|jpg|png|webp|gif)($|\?)/i) ||
    !isPdf;

  const handleClose = () => {
    try {
      SafeHaptics.impactAsync();
    } catch {}
    onClose();
  };

  const isRemoteUrl = documentUrl?.startsWith("http://") || documentUrl?.startsWith("https://");

  const handleOpenExternal = async () => {
    if (!documentUrl) return;
    try {
      if (Platform.OS === "web") {
        // window.open() also works for data: URIs on web (opens/renders the
        // PDF in a new tab), unlike Linking.openURL which only handles http(s).
        window.open(documentUrl, "_blank");
        return;
      }
      if (isRemoteUrl) {
        await Linking.openURL(documentUrl);
      } else {
        SafeAlert.alert(
          "Berkas Tersimpan Lokal",
          "Dokumen ini belum berhasil diunggah ke server dan hanya tersimpan sementara di perangkat ini, sehingga belum bisa dibuka sebagai berkas terpisah. Coba unggah ulang saat koneksi internet stabil."
        );
      }
    } catch (e) {
      console.warn("Could not open external url:", e);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />

        {/* TOP BAR */}
        <View style={styles.topBar}>
          <AnimatedPressable
            onPress={handleClose}
            style={styles.circleBtn}
            accessibilityLabel="Tutup Dokumen"
          >
            <Ionicons name="close" size={22} color="#ffffff" />
          </AnimatedPressable>

          <View style={{ flex: 1, marginHorizontal: 12 }}>
            <Text style={styles.topTitle} numberOfLines={1}>
              {title}
            </Text>
            {documentName ? (
              <Text style={styles.topSubtitle} numberOfLines={1}>
                {documentName}
              </Text>
            ) : null}
          </View>

          {documentUrl && (isRemoteUrl || Platform.OS === "web") ? (
            <AnimatedPressable
              onPress={handleOpenExternal}
              style={styles.circleBtn}
              accessibilityLabel="Buka di Browser"
            >
              <Ionicons name="open-outline" size={20} color="#ffffff" />
            </AnimatedPressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        {/* CONTENT */}
        <View style={styles.contentContainer}>
          {!documentUrl ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={64} color="#64748b" />
              <Text style={styles.emptyText}>Dokumen surat tidak ditemukan.</Text>
            </View>
          ) : isPdf ? (
            <View style={styles.pdfContainer}>
              <View style={styles.pdfIconCircle}>
                <Ionicons name="document-text" size={64} color="#ef4444" />
              </View>
              <Text style={styles.pdfTitle} numberOfLines={2}>
                {documentName || "Dokumen Surat Resmi (PDF)"}
              </Text>
              <Text style={styles.pdfDesc}>
                Berkas PDF telah terlampir pada sistem.
              </Text>
              <AnimatedPressable
                onPress={handleOpenExternal}
                style={styles.openPdfBtn}
              >
                <Ionicons name="open-outline" size={18} color="#ffffff" style={{ marginRight: 8 }} />
                <Text style={styles.openPdfBtnText}>Buka Dokumen PDF</Text>
              </AnimatedPressable>
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.imageScrollContent}
              maximumZoomScale={3}
              minimumZoomScale={1}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Image
                source={{ uri: documentUrl }}
                style={styles.fullImage}
                resizeMode="contain"
              />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.95)",
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 24) + 12 : 54,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.1)",
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
  topSubtitle: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },
  contentContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  imageScrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyText: {
    color: "#94a3b8",
    fontSize: 14,
    marginTop: 12,
    textAlign: "center",
  },
  pdfContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  pdfIconCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 2,
    borderColor: "rgba(239, 68, 68, 0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  pdfTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  pdfDesc: {
    color: "#94a3b8",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 24,
  },
  openPdfBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ef4444",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  openPdfBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
});
