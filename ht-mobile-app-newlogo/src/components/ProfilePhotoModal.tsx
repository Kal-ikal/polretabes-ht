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
import { LinearGradient } from "expo-linear-gradient";
import { SafeHaptics } from "@/lib/safeHaptics";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useAppTheme } from "@/context/ThemeContext";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// Palettes for fallback initials
const PALETTES: [string, string][] = [
  ["#0284C7", "#38BDF8"],
  ["#0D9488", "#2DD4BF"],
  ["#4F46E5", "#818CF8"],
  ["#2563EB", "#60A5FA"],
  ["#059669", "#34D399"],
  ["#7C3AED", "#A78BFA"],
];

function getHashGradient(input: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % PALETTES.length;
  return PALETTES[index];
}

function getInitials(name: string): string {
  if (!name) return "PT";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].substring(0, 2).toUpperCase();
}

export interface ProfilePhotoModalProps {
  visible: boolean;
  onClose: () => void;
  photoUrl?: string | null;
  name: string;
  nrp?: string | null;
  role?: string;
  isOwnProfile?: boolean;
  onChangePhoto?: () => void;
  onDeletePhoto?: () => void;
}

export function ProfilePhotoModal({
  visible,
  onClose,
  photoUrl,
  name,
  nrp,
  role,
  isOwnProfile = false,
  onChangePhoto,
  onDeletePhoto,
}: ProfilePhotoModalProps) {
  const { theme, isDark } = useAppTheme();
  const initials = getInitials(name || "Petugas");
  const gradient = getHashGradient(name || "Petugas");
  const isAdmin = role?.toLowerCase() === "admin";

  const handleClose = () => {
    try {
      if (Platform.OS !== "web") {
        SafeHaptics.impactAsync();
      }
    } catch {}
    onClose();
  };

  const imageSize = Math.min(SCREEN_WIDTH - 48, 360);

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
          <View style={styles.topTitleContainer}>
            <Ionicons name="shield-checkmark" size={18} color="#38BDF8" style={{ marginRight: 6 }} />
            <Text style={styles.topTitle}>
              {isOwnProfile ? "Foto Profil Saya" : "Foto Profil Anggota"}
            </Text>
          </View>
          <AnimatedPressable onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </AnimatedPressable>
        </View>

        {/* CONTENT SCROLL */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* PHOTO CARD CONTAINER */}
          <View style={[styles.photoCard, { width: imageSize, height: imageSize }]}>
            {photoUrl ? (
              <Image
                source={{ uri: photoUrl }}
                style={styles.fullImage}
                resizeMode="cover"
              />
            ) : (
              <LinearGradient
                colors={gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.initialsGradient}
              >
                <Ionicons name="person" size={48} color="rgba(255, 255, 255, 0.4)" style={{ marginBottom: 8 }} />
                <Text style={styles.initialsText}>{initials}</Text>
                <Text style={styles.noPhotoSubtitle}>Inisial Standar</Text>
              </LinearGradient>
            )}

            {/* Police Badge Watermark Overlay */}
            <View style={styles.badgeOverlay}>
              <Text style={styles.badgeOverlayText}>POLRESTA</Text>
            </View>
          </View>

          {/* USER DETAILS CARD */}
          <View style={[styles.detailsCard, { width: imageSize }]}>
            <View style={styles.identityRow}>
              <Text style={styles.userName} numberOfLines={2}>
                {name || "Petugas HT"}
              </Text>

              {/* Role Badge */}
              <View
                style={[
                  styles.roleBadge,
                  {
                    backgroundColor: isAdmin
                      ? "rgba(245, 158, 11, 0.2)"
                      : "rgba(2, 132, 199, 0.2)",
                    borderColor: isAdmin ? "#F59E0B" : "#38BDF8",
                  },
                ]}
              >
                <Ionicons
                  name={isAdmin ? "star" : "shield"}
                  size={12}
                  color={isAdmin ? "#FBBF24" : "#38BDF8"}
                  style={{ marginRight: 4 }}
                />
                <Text
                  style={[
                    styles.roleBadgeText,
                    { color: isAdmin ? "#FBBF24" : "#38BDF8" },
                  ]}
                >
                  {isAdmin ? "ADMINISTRATOR" : "PETUGAS HT"}
                </Text>
              </View>
            </View>

            {/* NRP / Pangkat */}
            <View style={styles.nrpRow}>
              <Ionicons name="card-outline" size={15} color="#94A3B8" />
              <Text style={styles.nrpText}>
                {nrp ? `NRP / Pangkat: ${nrp}` : "Anggota Kepolisian RI"}
              </Text>
            </View>
          </View>

          {/* ACTION BUTTONS (FOR OWN PROFILE OR CLOSE) */}
          <View style={[styles.actionsContainer, { width: imageSize }]}>
            {isOwnProfile && onChangePhoto ? (
              <View style={styles.actionButtonsRow}>
                <AnimatedPressable
                  onPress={() => {
                    handleClose();
                    onChangePhoto();
                  }}
                  style={styles.changePhotoButton}
                >
                  <Ionicons name="camera" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.changePhotoText}>Ganti Foto</Text>
                </AnimatedPressable>

                {photoUrl && onDeletePhoto ? (
                  <AnimatedPressable
                    onPress={() => {
                      handleClose();
                      onDeletePhoto();
                    }}
                    style={styles.deletePhotoButton}
                  >
                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                  </AnimatedPressable>
                ) : null}
              </View>
            ) : null}

            <AnimatedPressable onPress={handleClose} style={styles.dismissButton}>
              <Text style={styles.dismissButtonText}>Tutup</Text>
            </AnimatedPressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 15, 29, 0.94)",
    justifyContent: "center",
    alignItems: "center",
  },
  topBar: {
    width: "100%",
    paddingTop: Platform.OS === "ios" ? 54 : 44,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 10,
  },
  topTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  topTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#F8FAFC",
    letterSpacing: 0.3,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 40,
    paddingTop: 10,
  },
  photoCard: {
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.2)",
    backgroundColor: "#1E293B",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 10,
    position: "relative",
  },
  fullImage: {
    width: "100%",
    height: "100%",
  },
  initialsGradient: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  initialsText: {
    color: "#FFFFFF",
    fontSize: 64,
    fontWeight: "900",
    letterSpacing: 2,
  },
  noPhotoSubtitle: {
    color: "rgba(255, 255, 255, 0.75)",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
  },
  badgeOverlay: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    borderColor: "rgba(255, 255, 255, 0.2)",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeOverlayText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#38BDF8",
    letterSpacing: 1,
  },
  detailsCard: {
    backgroundColor: "rgba(30, 41, 59, 0.85)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    padding: 16,
    marginTop: 18,
    alignItems: "center",
  },
  identityRow: {
    alignItems: "center",
    marginBottom: 6,
  },
  userName: {
    fontSize: 19,
    fontWeight: "800",
    color: "#F8FAFC",
    textAlign: "center",
    marginBottom: 6,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  nrpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  nrpText: {
    fontSize: 13,
    color: "#94A3B8",
    fontWeight: "600",
  },
  actionsContainer: {
    marginTop: 16,
    gap: 10,
  },
  actionButtonsRow: {
    flexDirection: "row",
    gap: 10,
  },
  changePhotoButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0284C7",
    paddingVertical: 13,
    borderRadius: 14,
  },
  changePhotoText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  deletePhotoButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  dismissButton: {
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  dismissButtonText: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "600",
  },
});
