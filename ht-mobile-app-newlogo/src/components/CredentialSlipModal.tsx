import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  Share,
  Platform,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { safePrintAsync } from "@/lib/safePrint";
import { SafeHaptics } from "@/lib/safeHaptics";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { useAppTheme } from "@/context/ThemeContext";

export interface CredentialData {
  fullName: string;
  nrp: string;
  email: string;
  nickname: string;
  password?: string;
  role: "admin" | "petugas";
  createdAt?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  data: CredentialData | null;
}

export function CredentialSlipModal({ visible, onClose, data }: Props) {
  const { theme, isDark } = useAppTheme();
  const [showPassword, setShowPassword] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);

  if (!data) return null;

  const nickname = data.nickname || data.email.split("@")[0];
  const displayPassword = data.password || "password123";
  const roleLabel = data.role === "admin" ? "ADMINISTRATOR LOGISTIK" : "PETUGAS LOGISTIK HT";
  const dateStr = data.createdAt
    ? new Date(data.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
    : new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

  // 1. Share via WhatsApp / Native Share
  const handleShare = async () => {
    try {
      SafeHaptics.selectionAsync();
      const message = `*POLRESTA LOGISTIK TIK POLRI*
*SLIP KREDENSIAL AKSES APLIKASI HT*
══════════════════════════════
*Nama Petugas* : ${data.fullName}
*Pangkat / NRP* : ${data.nrp || "-"}
*Hak Akses*     : ${roleLabel}
──────────────────────────────
*ID / NICKNAME* : ${nickname}
*KATA SANDI*    : ${displayPassword}
*EMAIL LOGIN*   : ${data.email}
──────────────────────────────
*Tanggal Cetak* : ${dateStr}
_Catatan: Harap simpan kredensial ini dan jaga kerahasiaan kata sandi Anda._
══════════════════════════════`;

      await Share.share({
        title: `Slip Kredensial - ${data.fullName}`,
        message: message,
      });
    } catch (err) {
      console.error("Share error:", err);
    }
  };

  // 2. Direct Print / PDF Thermal Slip (58mm/80mm POS Thermal Slip)
  const handlePrint = async () => {
    try {
      setIsPrinting(true);
      SafeHaptics.selectionAsync();

      const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(nickname)}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Slip Kredensial - ${data.fullName}</title>
  <style>
    @page {
      size: 58mm auto;
      margin: 2mm;
    }
    body {
      font-family: 'Courier New', Courier, monospace, -apple-system, sans-serif;
      font-size: 11px;
      line-height: 1.35;
      color: #000000;
      background: #FFFFFF;
      margin: 0;
      padding: 6px;
      width: 54mm;
      box-sizing: border-box;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    .header-title {
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .header-sub {
      font-size: 9px;
      letter-spacing: 0.2px;
      margin-bottom: 6px;
    }
    .divider {
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    .double-divider {
      border-top: 2px solid #000;
      margin: 6px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 3px;
      font-size: 10px;
    }
    .credential-box {
      border: 1.5px solid #000;
      padding: 6px 4px;
      margin: 6px 0;
      background: #F8F8F8;
      text-align: center;
    }
    .cred-label {
      font-size: 9px;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 1px;
    }
    .cred-val {
      font-size: 14px;
      font-weight: 900;
      letter-spacing: 1px;
      font-family: monospace;
    }
    .qr-container {
      text-align: center;
      margin: 8px 0 4px 0;
    }
    .qr-img {
      width: 90px;
      height: 90px;
    }
    .footer-note {
      font-size: 8px;
      text-align: center;
      margin-top: 6px;
      line-height: 1.2;
    }
  </style>
</head>
<body>
  <div class="text-center">
    <div class="header-title">POLRESTA LOGISTIK TIK</div>
    <div class="header-sub">SLIP KREDENSIAL ANGGOTA</div>
  </div>

  <div class="double-divider"></div>

  <div class="row">
    <span class="bold">NAMA:</span>
    <span>${data.fullName}</span>
  </div>
  <div class="row">
    <span class="bold">PANGKAT/NRP:</span>
    <span>${data.nrp || "-"}</span>
  </div>
  <div class="row">
    <span class="bold">HAK AKSES:</span>
    <span class="bold">${data.role.toUpperCase()}</span>
  </div>
  <div class="row">
    <span class="bold">TANGGAL:</span>
    <span>${dateStr}</span>
  </div>

  <div class="divider"></div>

  <div class="credential-box">
    <div class="cred-label">ID / NICKNAME LOGIN</div>
    <div class="cred-val">${nickname}</div>
  </div>

  <div class="credential-box">
    <div class="cred-label">KATA SANDI (PASSWORD)</div>
    <div class="cred-val">${displayPassword}</div>
  </div>

  <div class="qr-container">
    <img class="qr-img" src="${qrApiUrl}" alt="QR Login" />
    <div style="font-size: 8px; margin-top: 2px;">QR Shortcut Login</div>
  </div>

  <div class="divider"></div>

  <div class="footer-note">
    RAHASIA & PRIBADI<br/>
    Simpan slip ini dengan aman.<br/>
    Jangan berikan kata sandi ke pihak lain.
  </div>

  <div class="double-divider"></div>
</body>
</html>
`;

      await safePrintAsync({
        html: htmlContent,
      });
    } catch (err) {
      console.error("Print error:", err);
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          justifyContent: "center",
          alignItems: "center",
          padding: 20,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 380,
            backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
            borderRadius: 24,
            borderWidth: 1,
            borderColor: isDark ? "#334155" : "#E2E8F0",
            overflow: "hidden",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.3,
            shadowRadius: 20,
            elevation: 10,
          }}
        >
          {/* Modal Header */}
          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 18,
              paddingBottom: 14,
              borderBottomWidth: 1,
              borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "#F1F5F9",
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="card" size={20} color={theme.primary} />
              <Text style={{ fontSize: 16, fontWeight: "800", color: theme.textPrimary }}>
                Slip Kredensial Anggota
              </Text>
            </View>
            <AnimatedPressable onPress={onClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </AnimatedPressable>
          </View>

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ padding: 20 }}>
            {/* Realistic Thermal / Scratch Slip Container */}
            <View
              style={{
                backgroundColor: isDark ? "#1E293B" : "#F8FAFC",
                borderWidth: 1.5,
                borderColor: isDark ? "#475569" : "#CBD5E1",
                borderRadius: 16,
                padding: 16,
                borderStyle: "dashed",
              }}
            >
              {/* Slip Header */}
              <View style={{ alignItems: "center", marginBottom: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: "900", letterSpacing: 0.8, color: theme.textPrimary }}>
                  POLRESTA LOGISTIK TIK POLRI
                </Text>
                <Text style={{ fontSize: 10.5, fontWeight: "700", color: theme.textSecondary, letterSpacing: 0.5, marginTop: 1 }}>
                  KARTU KREDENSIAL ANGGOTA
                </Text>
                <View
                  style={{
                    backgroundColor: data.role === "admin" ? "rgba(245, 158, 11, 0.15)" : "rgba(2, 132, 199, 0.15)",
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 6,
                    marginTop: 4,
                  }}
                >
                  <Text style={{ fontSize: 9.5, fontWeight: "800", color: data.role === "admin" ? "#D97706" : theme.primary }}>
                    {roleLabel}
                  </Text>
                </View>
              </View>

              {/* Dotted Divider */}
              <View style={{ height: 1, backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "#E2E8F0", marginVertical: 10 }} />

              {/* User Bio Details */}
              <View style={{ gap: 6, marginBottom: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11.5, color: theme.textSecondary }}>Nama Anggota</Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary }}>{data.fullName}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11.5, color: theme.textSecondary }}>Pangkat / NRP</Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary }}>{data.nrp || "-"}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11.5, color: theme.textSecondary }}>Tanggal Terbit</Text>
                  <Text style={{ fontSize: 11.5, color: theme.textSecondary }}>{dateStr}</Text>
                </View>
              </View>

              {/* Box 1: Nickname / Login ID */}
              <View
                style={{
                  backgroundColor: isDark ? "rgba(2, 132, 199, 0.12)" : "#E0F2FE",
                  borderColor: isDark ? "rgba(2, 132, 199, 0.3)" : "#BAE6FD",
                  borderWidth: 1,
                  borderRadius: 12,
                  padding: 10,
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <Text style={{ fontSize: 10, fontWeight: "700", color: theme.textSecondary, textTransform: "uppercase" }}>
                  ID / NICKNAME LOGIN
                </Text>
                <Text style={{ fontSize: 18, fontWeight: "900", color: theme.primary, letterSpacing: 1, marginTop: 2 }}>
                  {nickname}
                </Text>
              </View>

              {/* Box 2: Password (Scratch card style) */}
              <View
                style={{
                  backgroundColor: isDark ? "rgba(255, 255, 255, 0.05)" : "#F1F5F9",
                  borderColor: isDark ? "rgba(255, 255, 255, 0.12)" : "#CBD5E1",
                  borderWidth: 1,
                  borderRadius: 12,
                  padding: 10,
                  alignItems: "center",
                  position: "relative",
                }}
              >
                <Text style={{ fontSize: 10, fontWeight: "700", color: theme.textSecondary, textTransform: "uppercase" }}>
                  KATA SANDI (PASSWORD)
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
                  <Text style={{ fontSize: 16, fontWeight: "800", color: theme.textPrimary, letterSpacing: showPassword ? 0.5 : 3 }}>
                    {showPassword ? displayPassword : "••••••••••••"}
                  </Text>
                  <AnimatedPressable onPress={() => setShowPassword(!showPassword)} style={{ padding: 2 }}>
                    <Ionicons name={showPassword ? "eye-off" : "eye"} size={16} color={theme.textSecondary} />
                  </AnimatedPressable>
                </View>
              </View>

              {/* Footer Warning */}
              <Text style={{ fontSize: 9.5, color: theme.textMuted, textAlign: "center", marginTop: 10, fontStyle: "italic" }}>
                🔒 Rahasia: Simpan kartu ini & jangan berikan kata sandi kepada orang lain.
              </Text>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View
            style={{
              padding: 16,
              borderTopWidth: 1,
              borderTopColor: isDark ? "rgba(255,255,255,0.08)" : "#F1F5F9",
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", gap: 8 }}>
              {/* Print Thermal Slip Button */}
              <AnimatedPressable
                onPress={handlePrint}
                disabled={isPrinting}
                style={{
                  flex: 1,
                  backgroundColor: theme.primary,
                  paddingVertical: 12,
                  borderRadius: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  opacity: isPrinting ? 0.7 : 1,
                }}
              >
                <Ionicons name="print" size={16} color="#FFFFFF" />
                <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 13 }}>
                  {isPrinting ? "Mencetak..." : "Cetak Slip (Print)"}
                </Text>
              </AnimatedPressable>

              {/* Share WhatsApp Button */}
              <AnimatedPressable
                onPress={handleShare}
                style={{
                  flex: 1,
                  backgroundColor: isDark ? "rgba(34, 197, 94, 0.2)" : "#DCFCE7",
                  borderColor: "#22C55E",
                  borderWidth: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <Ionicons name="logo-whatsapp" size={16} color="#16A34A" />
                <Text style={{ color: isDark ? "#4ADE80" : "#15803D", fontWeight: "700", fontSize: 13 }}>
                  Bagikan
                </Text>
              </AnimatedPressable>
            </View>

            <AnimatedPressable
              onPress={onClose}
              style={{
                backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)",
                paddingVertical: 10,
                borderRadius: 12,
                alignItems: "center",
              }}
            >
              <Text style={{ color: theme.textSecondary, fontWeight: "600", fontSize: 13 }}>
                Tutup
              </Text>
            </AnimatedPressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
