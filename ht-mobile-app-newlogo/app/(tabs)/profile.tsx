import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal,
  Image,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { SafeHaptics } from "@/lib/safeHaptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useAppTheme } from "@/context/ThemeContext";
import { getFriendlyErrorMessage } from "@/lib/errorHandler";
import { Avatar } from "@/components/Avatar";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { AppBottomSheet } from "@/components/AppBottomSheet";
import { CredentialSlipModal, CredentialData } from "@/components/CredentialSlipModal";
import { ProfilePhotoModal } from "@/components/ProfilePhotoModal";
import type { Profile } from "@/types/database";

// Curated Police & Command Avatars
const PRESET_AVATARS = [
  { id: "police_male", label: "Polisi Pria", url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80" },
  { id: "police_female", label: "Polisi Wanita", url: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=200&auto=format&fit=crop&q=80" },
  { id: "commander", label: "Komandan", url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80" },
  { id: "tactical", label: "Operasional", url: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&auto=format&fit=crop&q=80" },
  { id: "intel", label: "Intelijen", url: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=200&auto=format&fit=crop&q=80" },
  { id: "tribrata", label: "Lambang Polri", url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80" },
];

export default function ProfileScreen() {
  const { profile, updateProfile, signOut, refreshProfile } = useAuth();
  const { theme, isDark, toggleColorScheme } = useAppTheme();

  const isAdmin = profile?.role === "admin";

  const [fullName, setFullName] = useState("");
  const [nrp, setNrp] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);

  // Admin User Management State
  const [usersList, setUsersList] = useState<Profile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [roleUpdatingUserId, setRoleUpdatingUserId] = useState<string | null>(null);

  // Create User Account Modal State
  const [createAccountModalVisible, setCreateAccountModalVisible] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [newNrp, setNewNrp] = useState("");
  const [newNickname, setNewNickname] = useState("");
  const [newPassword, setNewPassword] = useState("password123");
  const [newRole, setNewRole] = useState<"petugas" | "admin">("petugas");
  const [creatingUser, setCreatingUser] = useState(false);

  // Printable Credential Slip State
  const [credentialSlipVisible, setCredentialSlipVisible] = useState(false);
  const [credentialSlipData, setCredentialSlipData] = useState<CredentialData | null>(null);

  // In-App Self Change Password State
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState(false);
  const [newPasswordSelf, setNewPasswordSelf] = useState("");
  const [confirmPasswordSelf, setConfirmPasswordSelf] = useState("");
  const [showPasswordSelfToggle, setShowPasswordSelfToggle] = useState(false);
  const [updatingPasswordSelf, setUpdatingPasswordSelf] = useState(false);

  // Admin Reset User Password State
  const [resetTargetUser, setResetTargetUser] = useState<Profile | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState("password123");
  const [resettingUserPassword, setResettingUserPassword] = useState(false);

  // Full Photo Viewer Modal State
  const [photoViewerState, setPhotoViewerState] = useState<{
    visible: boolean;
    photoUrl?: string | null;
    name: string;
    nrp?: string | null;
    role?: string;
    isOwnProfile?: boolean;
  }>({
    visible: false,
    photoUrl: null,
    name: "",
    nrp: null,
    role: undefined,
    isOwnProfile: false,
  });

  // Toast / Feedback Modal
  const [toastConfig, setToastConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon: string;
    isDanger?: boolean;
  }>({ visible: false, title: "", message: "", icon: "✅" });

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setNrp(profile.nrp || "");
      setAvatarUrl(profile.avatar_url || null);
    }
  }, [profile]);

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingUsers(true);
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("full_name", { ascending: true });

    if (data) {
      setUsersList(data as Profile[]);
    }
    setLoadingUsers(false);
  }, [isAdmin]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Pick Image from Gallery
  const handlePickGalleryImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        setToastConfig({
          visible: true,
          title: "Izin Diperlukan",
          message: "Izin akses galeri diperlukan untuk memilih foto profil.",
          icon: "⚠️",
          isDanger: true,
        });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const uri = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
        setAvatarUrl(uri);
        setShowAvatarPicker(false);

        // Auto-save photo change
        await updateProfile(fullName.trim() || profile?.full_name || "Petugas", nrp.trim() || profile?.nrp, uri);
        try {
          SafeHaptics.notificationAsync();
        } catch {}
        setToastConfig({
          visible: true,
          title: "Foto Diperbarui",
          message: "Foto profil Anda berhasil diubah.",
          icon: "📸",
        });
      }
    } catch (err: any) {
      setToastConfig({
        visible: true,
        title: "Gagal Mengunggah",
        message: getFriendlyErrorMessage(err),
        icon: "❌",
        isDanger: true,
      });
    }
  };

  // Select Preset Avatar
  const handleSelectPresetAvatar = async (presetUrl: string) => {
    setAvatarUrl(presetUrl);
    setShowAvatarPicker(false);
    await updateProfile(fullName.trim() || profile?.full_name || "Petugas", nrp.trim() || profile?.nrp, presetUrl);
    try {
      SafeHaptics.notificationAsync();
    } catch {}
    setToastConfig({
      visible: true,
      title: "Avatar Dipasang",
      message: "Avatar profil berhasil diperbarui.",
      icon: "✅",
    });
  };

  // Remove Avatar
  const handleRemoveAvatar = async () => {
    setAvatarUrl(null);
    setShowAvatarPicker(false);
    await updateProfile(fullName.trim() || profile?.full_name || "Petugas", nrp.trim() || profile?.nrp, null);
    try {
      SafeHaptics.notificationAsync();
    } catch {}
    setToastConfig({
      visible: true,
      title: "Foto Dihapus",
      message: "Foto profil dihapus. Inisial nama Anda akan ditampilkan.",
      icon: "🗑️",
    });
  };

  // Save Profile Name & NRP
  const handleSaveProfile = async () => {
    if (!fullName.trim()) {
      setToastConfig({
        visible: true,
        title: "Nama Wajib Diisi",
        message: "Silakan masukkan nama lengkap Anda.",
        icon: "⚠️",
        isDanger: true,
      });
      return;
    }

    setSubmitting(true);
    const { error } = await updateProfile(fullName.trim(), nrp.trim() || null, avatarUrl);
    setSubmitting(false);

    if (error) {
      setToastConfig({
        visible: true,
        title: "Gagal Menyimpan",
        message: getFriendlyErrorMessage(error),
        icon: "❌",
        isDanger: true,
      });
    } else {
      try {
        SafeHaptics.notificationAsync();
      } catch {}
      setToastConfig({
        visible: true,
        title: "Profil Disimpan",
        message: "Perubahan profil Anda berhasil disimpan.",
        icon: "✅",
      });
    }
  };

  // Admin Action: Create New User Account & Generate Credential Slip
  const handleCreateUserAccount = async () => {
    if (!newFullName.trim() || !newNickname.trim() || !newPassword.trim()) {
      setToastConfig({
        visible: true,
        title: "Lengkapi Data",
        message: "Nama Lengkap, ID/Nickname, dan Kata Sandi wajib diisi.",
        icon: "⚠️",
        isDanger: true,
      });
      return;
    }

    setCreatingUser(true);
    const cleanEmail = newNickname.includes("@") ? newNickname.trim().toLowerCase() : `${newNickname.trim().toLowerCase()}@ht.id`;

    try {
      // 1. Call RPC admin_create_user_account
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("admin_create_user_account", {
        p_email: cleanEmail,
        p_password: newPassword.trim(),
        p_full_name: newFullName.trim(),
        p_nrp: newNrp.trim() || "-",
        p_role: newRole,
      });

      setCreatingUser(false);

      if (rpcErr) {
        // If RPC is not created yet in SQL editor, try direct upsert or friendly notice
        setToastConfig({
          visible: true,
          title: "Perhatian SQL",
          message: getFriendlyErrorMessage(rpcErr, "Pastikan script SQL 'supabase_setup_users_and_rpc.sql' sudah dijalankan di Supabase SQL Editor."),
          icon: "⚠️",
          isDanger: true,
        });
      } else {
        try {
          SafeHaptics.notificationAsync();
        } catch {}

        // Setup printable slip data
        setCredentialSlipData({
          fullName: newFullName.trim(),
          nrp: newNrp.trim(),
          email: cleanEmail,
          nickname: newNickname.trim().toLowerCase(),
          password: newPassword.trim(),
          role: newRole,
          createdAt: new Date().toISOString(),
        });

        // Reset form & close creation modal
        setNewFullName("");
        setNewNrp("");
        setNewNickname("");
        setNewPassword("password123");
        setCreateAccountModalVisible(false);

        // Open Printable Credential Slip Modal
        setCredentialSlipVisible(true);
        fetchUsers();
      }
    } catch (err: any) {
      setCreatingUser(false);
      setToastConfig({
        visible: true,
        title: "Kesalahan",
        message: err.message || "Gagal membuat akun.",
        icon: "❌",
        isDanger: true,
      });
    }
  };

  // Open Credential Slip for Existing User
  const handleOpenSlipForUser = (user: Profile) => {
    const nick = (user.email || "").split("@")[0] || user.full_name || "petugas";
    setCredentialSlipData({
      fullName: user.full_name || "Petugas",
      nrp: user.nrp || "-",
      email: user.email || `${nick}@ht.id`,
      nickname: nick,
      password: "password123",
      role: (user.role as "admin" | "petugas") || "petugas",
      createdAt: user.created_at,
    });
    setCredentialSlipVisible(true);
  };

  // Admin Action: Change User Role
  const handleChangeUserRole = async (targetUser: Profile, newRole: "admin" | "petugas") => {
    if (targetUser.id === profile?.id) {
      setToastConfig({
        visible: true,
        title: "Aksi Dibatasi",
        message: "Anda tidak dapat mengubah role akun Anda sendiri.",
        icon: "⚠️",
        isDanger: true,
      });
      return;
    }

    setRoleUpdatingUserId(targetUser.id);
    try {
      // 1. Try via RPC admin_update_user_role (bypasses RLS securely)
      const { error: rpcErr } = await supabase.rpc("admin_update_user_role", {
        p_user_id: targetUser.id,
        p_new_role: newRole,
      });

      let finalError = rpcErr;
      if (rpcErr) {
        // Fallback to direct table update
        const { error: directErr } = await supabase
          .from("profiles")
          .update({ role: newRole })
          .eq("id", targetUser.id);
        finalError = directErr;
      }

      setRoleUpdatingUserId(null);

      if (finalError) {
        setToastConfig({
          visible: true,
          title: "Gagal Mengubah Role",
          message: getFriendlyErrorMessage(finalError, "Pastikan script SQL 'supabase_setup_users_and_rpc.sql' sudah dijalankan di Supabase."),
          icon: "❌",
          isDanger: true,
        });
      } else {
        try {
          SafeHaptics.notificationAsync();
        } catch {}
        setToastConfig({
          visible: true,
          title: "Role Diperbarui",
          message: `Role ${targetUser.full_name || "Pengguna"} diubah menjadi ${newRole.toUpperCase()}.`,
          icon: "✅",
        });
        fetchUsers();
      }
    } catch (err: any) {
      setRoleUpdatingUserId(null);
      setToastConfig({
        visible: true,
        title: "Kesalahan",
        message: err.message || "Gagal memperbarui role pengguna.",
        icon: "❌",
        isDanger: true,
      });
    }
  };

  // Admin Action: Approve Pending User Account
  const handleApproveUser = async (targetUser: Profile) => {
    setRoleUpdatingUserId(targetUser.id);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ status: "ACTIVE" })
        .eq("id", targetUser.id);

      setRoleUpdatingUserId(null);

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
        setToastConfig({
          visible: true,
          title: "Akun Berhasil Disetujui",
          message: `Akun ${targetUser.full_name || "Petugas"} telah diaktifkan. Anggota sekarang dapat langsung masuk ke aplikasi.`,
          icon: "✅",
        });
        fetchUsers();
      }
    } catch (err: any) {
      setRoleUpdatingUserId(null);
      setToastConfig({
        visible: true,
        title: "Kesalahan",
        message: err.message || "Gagal mengaktifkan akun.",
        icon: "❌",
        isDanger: true,
      });
    }
  };

  // Self User Action: Change Own Password
  const handleSelfChangePassword = async () => {
    if (!newPasswordSelf.trim() || newPasswordSelf.trim().length < 6) {
      setToastConfig({
        visible: true,
        title: "Kata Sandi Terlalu Pendek",
        message: "Kata sandi baru minimal harus 6 karakter.",
        icon: "⚠️",
        isDanger: true,
      });
      return;
    }

    if (newPasswordSelf !== confirmPasswordSelf) {
      setToastConfig({
        visible: true,
        title: "Kata Sandi Tidak Cocok",
        message: "Konfirmasi kata sandi tidak cocok dengan kata sandi baru.",
        icon: "⚠️",
        isDanger: true,
      });
      return;
    }

    setUpdatingPasswordSelf(true);
    const { error } = await supabase.auth.updateUser({
      password: newPasswordSelf.trim(),
    });
    setUpdatingPasswordSelf(false);

    if (error) {
      setToastConfig({
        visible: true,
        title: "Gagal Mengubah Sandi",
        message: getFriendlyErrorMessage(error),
        icon: "❌",
        isDanger: true,
      });
    } else {
      setShowPasswordChangeModal(false);
      setNewPasswordSelf("");
      setConfirmPasswordSelf("");
      try {
        SafeHaptics.notificationAsync();
      } catch {}
      setToastConfig({
        visible: true,
        title: "Kata Sandi Diperbarui",
        message: "Kata sandi akun Anda berhasil diperbarui.",
        icon: "✅",
      });
    }
  };

  // Admin Action: Reset Officer Password & Trigger Credential Slip
  const handleAdminResetPassword = async () => {
    if (!resetTargetUser || resetNewPassword.trim().length < 6) {
      setToastConfig({
        visible: true,
        title: "Kata Sandi Tidak Valid",
        message: "Kata sandi baru minimal harus 6 karakter.",
        icon: "⚠️",
        isDanger: true,
      });
      return;
    }

    setResettingUserPassword(true);
    const { error } = await supabase.rpc("admin_reset_user_password", {
      p_user_id: resetTargetUser.id,
      p_new_password: resetNewPassword.trim(),
    });
    setResettingUserPassword(false);

    if (error) {
      setToastConfig({
        visible: true,
        title: "Gagal Reset Kata Sandi",
        message: getFriendlyErrorMessage(error, "Pastikan script 'supabase_reset_password_rpc.sql' sudah dijalankan di Supabase SQL Editor."),
        icon: "❌",
        isDanger: true,
      });
    } else {
      const target = resetTargetUser;
      const newPw = resetNewPassword.trim();
      setResetTargetUser(null);
      try {
        SafeHaptics.notificationAsync();
      } catch {}
      setToastConfig({
        visible: true,
        title: "Kata Sandi Direset",
        message: `Kata sandi akun ${target.full_name || "Petugas"} telah diatur ulang ke '${newPw}'. Slip kredensial otomatis disiapkan.`,
        icon: "🔑",
      });

      // Launch Credential Slip ready to print
      const nick = (target.email || "").split("@")[0] || target.full_name || "petugas";
      setCredentialSlipData({
        fullName: target.full_name || "Petugas",
        nrp: target.nrp || "-",
        email: target.email || `${nick}@ht.id`,
        nickname: nick,
        password: newPw,
        role: (target.role as "admin" | "petugas") || "petugas",
        createdAt: new Date().toISOString(),
      });
      setCredentialSlipVisible(true);
    }
  };

  return (
    <LinearGradient colors={theme.backgroundGradient} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 40,
          maxWidth: 840,
          width: "100%",
          alignSelf: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Profile Identity Card */}
        <View
          style={{
            backgroundColor: theme.cardBg,
            borderRadius: 24,
            borderWidth: 1,
            borderColor: theme.cardBorder,
            padding: 24,
            alignItems: "center",
            marginBottom: 20,
            shadowColor: theme.shadowColor,
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.1,
            shadowRadius: 16,
            elevation: 4,
          }}
        >
          {/* Avatar with Full Photo View & Edit Camera Badge */}
          <View style={{ position: "relative", marginBottom: 12 }}>
            <Avatar
              name={fullName || profile?.full_name || "Admin"}
              avatarUrl={avatarUrl}
              size={96}
              onPress={() =>
                setPhotoViewerState({
                  visible: true,
                  photoUrl: avatarUrl,
                  name: fullName || profile?.full_name || "Petugas HT",
                  nrp: profile?.nrp,
                  role: profile?.role,
                  isOwnProfile: true,
                })
              }
            />
            <AnimatedPressable
              onPress={() => setShowAvatarPicker(true)}
              style={{
                position: "absolute",
                bottom: 2,
                right: 2,
                backgroundColor: theme.primary,
                width: 32,
                height: 32,
                borderRadius: 16,
                justifyContent: "center",
                alignItems: "center",
                borderWidth: 2.5,
                borderColor: isDark ? "#0F172A" : "#FFFFFF",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.25,
                shadowRadius: 4,
                elevation: 4,
              }}
            >
              <Ionicons name="camera" size={16} color="#FFFFFF" />
            </AnimatedPressable>
          </View>

          <Text style={{ fontSize: 20, fontWeight: "800", color: theme.textPrimary, textAlign: "center" }}>
            {fullName || profile?.full_name || "Petugas HT"}
          </Text>

          <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 2, textAlign: "center" }}>
            {profile?.nrp ? `Pangkat / NRP: ${profile.nrp}` : "Anggota Kepolisian RI"}
          </Text>

          {/* Role Badge */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: isAdmin
                ? isDark ? "rgba(245, 158, 11, 0.2)" : "rgba(245, 158, 11, 0.12)"
                : isDark ? "rgba(2, 132, 199, 0.2)" : "rgba(2, 132, 199, 0.12)",
              borderColor: isAdmin ? "rgba(245, 158, 11, 0.4)" : "rgba(2, 132, 199, 0.3)",
              borderWidth: 1,
              paddingHorizontal: 12,
              paddingVertical: 4,
              borderRadius: 20,
              marginTop: 10,
            }}
          >
            <Ionicons
              name={isAdmin ? "shield-checkmark" : "person"}
              size={13}
              color={isAdmin ? "#F59E0B" : theme.primary}
            />
            <Text
              style={{
                fontSize: 11,
                fontWeight: "800",
                color: isAdmin ? "#F59E0B" : theme.primary,
                letterSpacing: 0.5,
              }}
            >
              {isAdmin ? "ADMIN POLRESTABES" : "PETUGAS POLRESTABES"}
            </Text>
          </View>
        </View>

        {/* Form Edit Data Profil */}
        <View
          style={{
            backgroundColor: theme.cardBg,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: theme.cardBorder,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "800", color: theme.textPrimary, marginBottom: 16 }}>
            Informasi Pribadi
          </Text>

          <View style={{ gap: 14 }}>
            <View>
              <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginBottom: 6 }}>
                Nama Lengkap
              </Text>
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                placeholder="Masukkan nama lengkap"
                placeholderTextColor={theme.inputPlaceholder}
                style={{
                  backgroundColor: theme.inputBackground,
                  borderWidth: 1,
                  borderColor: theme.inputBorder,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  color: theme.inputText,
                  fontSize: 14,
                }}
              />
            </View>

            <View>
              <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginBottom: 6 }}>
                Pangkat / NRP
              </Text>
              <TextInput
                value={nrp}
                onChangeText={setNrp}
                placeholder="Contoh: Bripka / 98012345"
                placeholderTextColor={theme.inputPlaceholder}
                style={{
                  backgroundColor: theme.inputBackground,
                  borderWidth: 1,
                  borderColor: theme.inputBorder,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  color: theme.inputText,
                  fontSize: 14,
                }}
              />
            </View>

            <AnimatedPressable
              onPress={handleSaveProfile}
              disabled={submitting}
              style={{
                backgroundColor: theme.primary,
                paddingVertical: 12,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                marginTop: 4,
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>
                  Simpan Perubahan
                </Text>
              )}
            </AnimatedPressable>

            {/* Change Password Trigger Button */}
            <AnimatedPressable
              onPress={() => setShowPasswordChangeModal(true)}
              style={{
                backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9",
                borderColor: theme.cardBorder,
                borderWidth: 1,
                paddingVertical: 11,
                borderRadius: 12,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Ionicons name="key-outline" size={15} color={theme.textPrimary} />
              <Text style={{ color: theme.textPrimary, fontWeight: "700", fontSize: 13 }}>
                Ganti Kata Sandi Akun
              </Text>
            </AnimatedPressable>
          </View>
        </View>

        {/* Section Khusus Admin: Kelola & Tambah Akun Petugas */}
        {isAdmin && (
          <View
            style={{
              backgroundColor: theme.cardBg,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: theme.cardBorder,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={{ fontSize: 16, fontWeight: "800", color: theme.textPrimary }}>
                  Kelola Akun Anggota
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                  Daftar akun & cetak slip kredensial (kertas gosok)
                </Text>
              </View>

              {/* Add User Button */}
              <AnimatedPressable
                onPress={() => setCreateAccountModalVisible(true)}
                style={{
                  backgroundColor: theme.primary,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Ionicons name="person-add" size={14} color="#FFFFFF" />
                <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 11.5 }}>
                  + Buat Akun
                </Text>
              </AnimatedPressable>
            </View>

            {loadingUsers ? (
              <ActivityIndicator color={theme.primary} style={{ marginVertical: 20 }} />
            ) : (
              <View style={{ gap: 10 }}>
                {usersList.map((user, idx) => {
                  const isUserAdmin = user.role === "admin";
                  const isCurrentSelf = user.id === profile?.id;
                  const isUpdating = roleUpdatingUserId === user.id;

                  return (
                    <View
                      key={`${user.id}-${idx}`}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC",
                        padding: 12,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: isUserAdmin ? "rgba(245, 158, 11, 0.3)" : theme.cardBorder,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                        <Avatar
                          name={user.full_name || "Petugas"}
                          avatarUrl={user.avatar_url}
                          size={40}
                          onPress={() =>
                            setPhotoViewerState({
                              visible: true,
                              photoUrl: user.avatar_url,
                              name: user.full_name || "Petugas HT",
                              nrp: user.nrp,
                              role: user.role,
                              isOwnProfile: user.id === profile?.id,
                            })
                          }
                        />
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={{ fontSize: 14, fontWeight: "700", color: theme.textPrimary }}>
                              {user.full_name || "Tanpa Nama"}
                            </Text>
                            {isCurrentSelf && (
                              <Text style={{ fontSize: 10, color: theme.primary, fontWeight: "800" }}>
                                (Anda)
                              </Text>
                            )}
                            {user.status === "PENDING" && (
                              <View
                                style={{
                                  backgroundColor: isDark ? "rgba(245, 158, 11, 0.2)" : "#FEF3C7",
                                  borderColor: isDark ? "#F59E0B" : "#FCD34D",
                                  borderWidth: 1,
                                  paddingHorizontal: 5,
                                  paddingVertical: 1,
                                  borderRadius: 4,
                                }}
                              >
                                <Text style={{ fontSize: 9, fontWeight: "800", color: isDark ? "#FBBF24" : "#B45309" }}>
                                  PENDING
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                            {user.nrp ? `NRP: ${user.nrp}` : user.email || "Petugas"}
                          </Text>
                        </View>
                      </View>

                      {/* Action Buttons: Approve (if pending), Reset Sandi, Print Slip & Role Toggle */}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {/* Approve Button for Pending Users */}
                        {user.status === "PENDING" && (
                          <AnimatedPressable
                            onPress={() => handleApproveUser(user)}
                            disabled={isUpdating}
                            style={{
                              backgroundColor: isDark ? "rgba(34, 197, 94, 0.2)" : "#DCFCE7",
                              borderColor: isDark ? "#22C55E" : "#86EFAC",
                              borderWidth: 1,
                              paddingHorizontal: 8,
                              paddingVertical: 6,
                              borderRadius: 8,
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 3,
                            }}
                          >
                            <Ionicons name="checkmark-circle" size={13} color={isDark ? "#4ADE80" : "#15803D"} />
                            <Text style={{ fontSize: 10.5, fontWeight: "800", color: isDark ? "#4ADE80" : "#15803D" }}>
                              Setujui
                            </Text>
                          </AnimatedPressable>
                        )}

                        {/* Admin Reset Password Button */}
                        <AnimatedPressable
                          onPress={() => {
                            setResetTargetUser(user);
                            setResetNewPassword("password123");
                          }}
                          style={{
                            backgroundColor: isDark ? "rgba(239, 68, 68, 0.15)" : "#FEE2E2",
                            borderColor: isDark ? "rgba(239, 68, 68, 0.3)" : "#FECACA",
                            borderWidth: 1,
                            paddingHorizontal: 8,
                            paddingVertical: 6,
                            borderRadius: 8,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          <Ionicons name="key-outline" size={13} color={isDark ? "#F87171" : "#DC2626"} />
                          <Text style={{ fontSize: 10.5, fontWeight: "700", color: isDark ? "#F87171" : "#DC2626" }}>
                            Reset
                          </Text>
                        </AnimatedPressable>

                        {/* Print Credential Slip Button */}
                        <AnimatedPressable
                          onPress={() => handleOpenSlipForUser(user)}
                          style={{
                            backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#E2E8F0",
                            paddingHorizontal: 8,
                            paddingVertical: 6,
                            borderRadius: 8,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          <Ionicons name="print-outline" size={13} color={theme.textPrimary} />
                          <Text style={{ fontSize: 10.5, fontWeight: "700", color: theme.textPrimary }}>
                            Slip
                          </Text>
                        </AnimatedPressable>

                        {/* Role Toggle Button */}
                        <AnimatedPressable
                          onPress={() => handleChangeUserRole(user, isUserAdmin ? "petugas" : "admin")}
                          disabled={isUpdating || isCurrentSelf}
                          style={{
                            backgroundColor: isUserAdmin
                              ? isDark ? "rgba(245, 158, 11, 0.2)" : "rgba(245, 158, 11, 0.12)"
                              : isDark ? "rgba(2, 132, 199, 0.2)" : "rgba(2, 132, 199, 0.12)",
                            borderColor: isUserAdmin ? "#F59E0B" : theme.primary,
                            borderWidth: 1,
                            paddingHorizontal: 8,
                            paddingVertical: 6,
                            borderRadius: 8,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 3,
                            opacity: isCurrentSelf ? 0.6 : 1,
                          }}
                        >
                          {isUpdating ? (
                            <ActivityIndicator size="small" color={isUserAdmin ? "#F59E0B" : theme.primary} />
                          ) : (
                            <>
                              <Ionicons
                                name={isUserAdmin ? "shield-checkmark" : "person"}
                                size={11}
                                color={isUserAdmin ? "#F59E0B" : theme.primary}
                              />
                              <Text
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: "800",
                                  color: isUserAdmin ? "#F59E0B" : theme.primary,
                                }}
                              >
                                {isUserAdmin ? "ADMIN" : "PETUGAS"}
                              </Text>
                            </>
                          )}
                        </AnimatedPressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Pengaturan Tampilan & Aplikasi */}
        <View
          style={{
            backgroundColor: theme.cardBg,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: theme.cardBorder,
            padding: 16,
            marginBottom: 24,
            gap: 12,
          }}
        >
          {/* Switch Tema */}
          <AnimatedPressable
            onPress={toggleColorScheme}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              paddingVertical: 8,
              paddingHorizontal: 4,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(2, 132, 199, 0.08)",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Ionicons name={isDark ? "moon" : "sunny"} size={18} color={theme.primary} />
              </View>
              <View>
                <Text style={{ fontSize: 14, fontWeight: "700", color: theme.textPrimary }}>
                  Mode Tampilan
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                  {isDark ? "Mode Gelap (Dark Mode)" : "Mode Terang (Light Mode)"}
                </Text>
              </View>
            </View>

            <View
              style={{
                backgroundColor: isDark ? "rgba(2, 132, 199, 0.2)" : "#E0F2FE",
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 8,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "700", color: theme.primary }}>
                Ubah
              </Text>
            </View>
          </AnimatedPressable>

          <View style={{ height: 1, backgroundColor: theme.cardBorder }} />

          {/* Versi Aplikasi */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              paddingVertical: 8,
              paddingHorizontal: 4,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(2, 132, 199, 0.08)",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Ionicons name="information-circle" size={18} color={theme.primary} />
              </View>
              <View>
                <Text style={{ fontSize: 14, fontWeight: "700", color: theme.textPrimary }}>
                  Versi Aplikasi
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                  Sistem HT Polrestabes v1.0.0
                </Text>
              </View>
            </View>

            <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textMuted }}>
              Terbaru
            </Text>
          </View>
        </View>

        {/* Tombol Logout */}
        <AnimatedPressable
          onPress={() => setLogoutModalVisible(true)}
          style={{
            backgroundColor: isDark ? "rgba(239, 68, 68, 0.15)" : "#FEE2E2",
            borderColor: isDark ? "rgba(239, 68, 68, 0.3)" : "#FECACA",
            borderWidth: 1,
            paddingVertical: 14,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 8,
          }}
        >
          <Ionicons name="log-out-outline" size={18} color="#EF4444" />
          <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 14 }}>
            Keluar dari Akun
          </Text>
        </AnimatedPressable>
      </ScrollView>

      {/* MODAL BUAT AKUN PETUGAS BARU */}
      <Modal
        visible={createAccountModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateAccountModalVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.7)",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: theme.cardBg,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 24,
              maxHeight: "85%",
            }}
          >
            {/* Header */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <View>
                <Text style={{ fontSize: 18, fontWeight: "800", color: theme.textPrimary }}>
                  Buat Akun Anggota Baru
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                  Otomatis buat slip kredensial untuk dicetak
                </Text>
              </View>
              <AnimatedPressable onPress={() => setCreateAccountModalVisible(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </AnimatedPressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Nama Lengkap */}
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary, marginBottom: 6 }}>
                  Nama Lengkap Anggota
                </Text>
                <TextInput
                  value={newFullName}
                  onChangeText={(val) => {
                    setNewFullName(val);
                    // Suggest nickname if nickname is empty
                    if (!newNickname && val.trim()) {
                      const firstWord = val.trim().split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
                      setNewNickname(firstWord);
                    }
                  }}
                  placeholder="Contoh: Bripka Budi Santoso"
                  placeholderTextColor={theme.inputPlaceholder}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    height: 44,
                    color: theme.inputText,
                    fontSize: 14,
                  }}
                />
              </View>

              {/* Pangkat / NRP */}
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary, marginBottom: 6 }}>
                  Pangkat / NRP
                </Text>
                <TextInput
                  value={newNrp}
                  onChangeText={setNewNrp}
                  placeholder="Contoh: Bripka / 78010234"
                  placeholderTextColor={theme.inputPlaceholder}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    height: 44,
                    color: theme.inputText,
                    fontSize: 14,
                  }}
                />
              </View>

              {/* Username / Nickname */}
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary, marginBottom: 6 }}>
                  ID / Nickname Login
                </Text>
                <TextInput
                  value={newNickname}
                  onChangeText={(v) => setNewNickname(v.toLowerCase().replace(/\s+/g, ""))}
                  placeholder="Contoh: budi (login via 'budi' atau 'budi@ht.id')"
                  placeholderTextColor={theme.inputPlaceholder}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    height: 44,
                    color: theme.inputText,
                    fontSize: 14,
                  }}
                />
              </View>

              {/* Password */}
              <View style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary }}>
                    Kata Sandi (Password)
                  </Text>
                  <AnimatedPressable
                    onPress={() => {
                      const randomPass = "polri" + Math.floor(100 + Math.random() * 900);
                      setNewPassword(randomPass);
                      SafeHaptics.selectionAsync();
                    }}
                    style={{ padding: 2 }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "700", color: theme.primary }}>
                      Acak Sandi
                    </Text>
                  </AnimatedPressable>
                </View>
                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Masukkan kata sandi..."
                  placeholderTextColor={theme.inputPlaceholder}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    height: 44,
                    color: theme.inputText,
                    fontSize: 14,
                  }}
                />
              </View>

              {/* Role Selection */}
              <View style={{ marginBottom: 20 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textPrimary, marginBottom: 8 }}>
                  Hak Akses (Role)
                </Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <AnimatedPressable
                    onPress={() => setNewRole("petugas")}
                    style={{
                      flex: 1,
                      backgroundColor: newRole === "petugas" ? (isDark ? "rgba(2, 132, 199, 0.25)" : "#E0F2FE") : theme.inputBackground,
                      borderColor: newRole === "petugas" ? theme.primary : theme.inputBorder,
                      borderWidth: 1.5,
                      borderRadius: 12,
                      padding: 12,
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Ionicons name="person" size={18} color={newRole === "petugas" ? theme.primary : theme.textSecondary} />
                    <Text style={{ fontSize: 12, fontWeight: "800", color: newRole === "petugas" ? theme.primary : theme.textSecondary }}>
                      Petugas
                    </Text>
                  </AnimatedPressable>

                  <AnimatedPressable
                    onPress={() => setNewRole("admin")}
                    style={{
                      flex: 1,
                      backgroundColor: newRole === "admin" ? (isDark ? "rgba(245, 158, 11, 0.25)" : "#FEF3C7") : theme.inputBackground,
                      borderColor: newRole === "admin" ? "#F59E0B" : theme.inputBorder,
                      borderWidth: 1.5,
                      borderRadius: 12,
                      padding: 12,
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Ionicons name="shield-checkmark" size={18} color={newRole === "admin" ? "#F59E0B" : theme.textSecondary} />
                    <Text style={{ fontSize: 12, fontWeight: "800", color: newRole === "admin" ? "#D97706" : theme.textSecondary }}>
                      Admin Logistik
                    </Text>
                  </AnimatedPressable>
                </View>
              </View>

              {/* Submit Button */}
              <AnimatedPressable
                onPress={handleCreateUserAccount}
                disabled={creatingUser}
                style={{
                  backgroundColor: theme.primary,
                  paddingVertical: 14,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  opacity: creatingUser ? 0.7 : 1,
                  marginBottom: 10,
                }}
              >
                {creatingUser ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Ionicons name="print" size={18} color="#FFFFFF" />
                    <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 15 }}>
                      Buat Akun & Terbitkan Slip
                    </Text>
                  </>
                )}
              </AnimatedPressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MODAL SLIP KREDENSIAL ANGGOTA (UKURAN KERTAS GOSOK / STRUK THERMAL) */}
      <CredentialSlipModal
        visible={credentialSlipVisible}
        onClose={() => setCredentialSlipVisible(false)}
        data={credentialSlipData}
      />

      {/* AVATAR PICKER MODAL */}
      <Modal
        visible={showAvatarPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAvatarPicker(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.65)",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: theme.cardBg,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 24,
              maxHeight: "80%",
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: theme.textPrimary }}>
                Pilih Foto Profil
              </Text>
              <AnimatedPressable onPress={() => setShowAvatarPicker(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </AnimatedPressable>
            </View>

            {/* Gallery Upload Option */}
            <AnimatedPressable
              onPress={handlePickGalleryImage}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                backgroundColor: isDark ? "rgba(2, 132, 199, 0.2)" : "#E0F2FE",
                borderColor: theme.primary,
                borderWidth: 1.5,
                borderRadius: 16,
                padding: 14,
                marginBottom: 20,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: theme.primary,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Ionicons name="images" size={20} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: theme.textPrimary }}>
                  Pilih dari Galeri HP
                </Text>
                <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                  Gunakan foto resmi Anda dari perangkat
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.primary} />
            </AnimatedPressable>

            {/* Preset Police Avatars Grid */}
            <Text style={{ fontSize: 13, fontWeight: "700", color: theme.textSecondary, marginBottom: 12 }}>
              Atau Pilih Avatar Korps:
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center", marginBottom: 20 }}>
              {PRESET_AVATARS.map((item) => (
                <AnimatedPressable
                  key={item.id}
                  onPress={() => handleSelectPresetAvatar(item.url)}
                  style={{
                    alignItems: "center",
                    gap: 6,
                    width: "28%",
                  }}
                >
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 32,
                      overflow: "hidden",
                      borderWidth: avatarUrl === item.url ? 3 : 1,
                      borderColor: avatarUrl === item.url ? theme.primary : theme.cardBorder,
                    }}
                  >
                    <Image source={{ uri: item.url }} style={{ width: "100%", height: "100%" }} />
                  </View>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textPrimary, textAlign: "center" }}>
                    {item.label}
                  </Text>
                </AnimatedPressable>
              ))}
            </View>

            {/* Preview Full Photo Action */}
            {avatarUrl && (
              <AnimatedPressable
                onPress={() => {
                  setShowAvatarPicker(false);
                  setPhotoViewerState({
                    visible: true,
                    photoUrl: avatarUrl,
                    name: fullName || profile?.full_name || "Petugas HT",
                    nrp: profile?.nrp,
                    role: profile?.role,
                    isOwnProfile: true,
                  });
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  paddingVertical: 12,
                  marginBottom: 12,
                  backgroundColor: isDark ? "rgba(2, 132, 199, 0.15)" : "#E0F2FE",
                  borderColor: isDark ? "rgba(56, 189, 248, 0.4)" : "#BAE6FD",
                  borderWidth: 1,
                  borderRadius: 14,
                }}
              >
                <Ionicons name="eye-outline" size={18} color={theme.primary} />
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.primary }}>
                  Lihat Foto Ukuran Penuh
                </Text>
              </AnimatedPressable>
            )}

            {/* Remove / Reset Avatar Option */}
            {avatarUrl && (
              <AnimatedPressable
                onPress={handleRemoveAvatar}
                style={{
                  alignItems: "center",
                  paddingVertical: 10,
                }}
              >
                <Text style={{ color: "#EF4444", fontSize: 13, fontWeight: "700" }}>
                  Gunakan Inisial Nama (Hapus Foto)
                </Text>
              </AnimatedPressable>
            )}
          </View>
        </View>
      </Modal>

      {/* CONFIRM LOGOUT MODAL */}
      <Modal
        visible={logoutModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLogoutModalVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.65)",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: theme.cardBg,
              borderRadius: 24,
              padding: 24,
              borderWidth: 1,
              borderColor: theme.cardBorder,
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                justifyContent: "center",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons name="log-out" size={28} color="#EF4444" />
            </View>

            <Text style={{ fontSize: 18, fontWeight: "800", color: theme.textPrimary, marginBottom: 6 }}>
              Konfirmasi Keluar
            </Text>
            <Text style={{ fontSize: 13, color: theme.textSecondary, textAlign: "center", marginBottom: 20 }}>
              Apakah Anda yakin ingin keluar dari aplikasi HT Polrestabes?
            </Text>

            <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
              <AnimatedPressable
                onPress={() => setLogoutModalVisible(false)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: theme.textSecondary, fontWeight: "700", fontSize: 14 }}>
                  Batal
                </Text>
              </AnimatedPressable>

              <AnimatedPressable
                onPress={async () => {
                  setLogoutModalVisible(false);
                  await signOut();
                }}
                style={{
                  flex: 1,
                  backgroundColor: "#EF4444",
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>
                  Keluar
                </Text>
              </AnimatedPressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 1. SELF CHANGE PASSWORD MODAL */}
      <Modal
        visible={showPasswordChangeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPasswordChangeModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.65)",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: theme.cardBg,
              borderRadius: 24,
              padding: 24,
              borderWidth: 1,
              borderColor: theme.cardBorder,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="key" size={20} color={theme.primary} />
                <Text style={{ fontSize: 18, fontWeight: "800", color: theme.textPrimary }}>
                  Ganti Kata Sandi
                </Text>
              </View>
              <AnimatedPressable onPress={() => setShowPasswordChangeModal(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </AnimatedPressable>
            </View>

            <View style={{ gap: 12, marginBottom: 20 }}>
              <View>
                <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginBottom: 6 }}>
                  Kata Sandi Baru
                </Text>
                <TextInput
                  value={newPasswordSelf}
                  onChangeText={setNewPasswordSelf}
                  placeholder="Minimal 6 karakter"
                  placeholderTextColor={theme.inputPlaceholder}
                  secureTextEntry={!showPasswordSelfToggle}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    color: theme.inputText,
                    fontSize: 14,
                  }}
                />
              </View>

              <View>
                <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginBottom: 6 }}>
                  Konfirmasi Kata Sandi Baru
                </Text>
                <TextInput
                  value={confirmPasswordSelf}
                  onChangeText={setConfirmPasswordSelf}
                  placeholder="Ketik ulang kata sandi baru"
                  placeholderTextColor={theme.inputPlaceholder}
                  secureTextEntry={!showPasswordSelfToggle}
                  style={{
                    backgroundColor: theme.inputBackground,
                    borderWidth: 1,
                    borderColor: theme.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    color: theme.inputText,
                    fontSize: 14,
                  }}
                />
              </View>

              <AnimatedPressable
                onPress={() => setShowPasswordSelfToggle(!showPasswordSelfToggle)}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }}
              >
                <Ionicons
                  name={showPasswordSelfToggle ? "checkbox" : "square-outline"}
                  size={18}
                  color={theme.primary}
                />
                <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                  Tampilkan Kata Sandi
                </Text>
              </AnimatedPressable>
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <AnimatedPressable
                onPress={() => setShowPasswordChangeModal(false)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: theme.textSecondary, fontWeight: "700", fontSize: 14 }}>
                  Batal
                </Text>
              </AnimatedPressable>

              <AnimatedPressable
                onPress={handleSelfChangePassword}
                disabled={updatingPasswordSelf}
                style={{
                  flex: 1.2,
                  backgroundColor: theme.primary,
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                }}
              >
                {updatingPasswordSelf ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>
                    Simpan Sandi
                  </Text>
                )}
              </AnimatedPressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 2. ADMIN RESET OFFICER PASSWORD MODAL */}
      <Modal
        visible={!!resetTargetUser}
        transparent
        animationType="slide"
        onRequestClose={() => setResetTargetUser(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.65)",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: theme.cardBg,
              borderRadius: 24,
              padding: 24,
              borderWidth: 1,
              borderColor: theme.cardBorder,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="key" size={20} color="#EF4444" />
                <Text style={{ fontSize: 17, fontWeight: "800", color: theme.textPrimary }}>
                  Reset Kata Sandi Anggota
                </Text>
              </View>
              <AnimatedPressable onPress={() => setResetTargetUser(null)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </AnimatedPressable>
            </View>

            <Text style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 14 }}>
              Atur ulang kata sandi untuk akun <Text style={{ fontWeight: "700", color: theme.textPrimary }}>{resetTargetUser?.full_name || "Petugas"}</Text>. Slip kredensial akan otomatis siap dicetak.
            </Text>

            <View style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: theme.textSecondary, marginBottom: 6 }}>
                Kata Sandi Baru
              </Text>
              <TextInput
                value={resetNewPassword}
                onChangeText={setResetNewPassword}
                placeholder="Minimal 6 karakter"
                placeholderTextColor={theme.inputPlaceholder}
                style={{
                  backgroundColor: theme.inputBackground,
                  borderWidth: 1,
                  borderColor: theme.inputBorder,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  color: theme.inputText,
                  fontSize: 14,
                }}
              />
              <AnimatedPressable
                onPress={() => setResetNewPassword("password123")}
                style={{ marginTop: 6, alignSelf: "flex-start" }}
              >
                <Text style={{ fontSize: 11.5, color: theme.primary, fontWeight: "700" }}>
                  ↺ Gunakan Default: password123
                </Text>
              </AnimatedPressable>
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <AnimatedPressable
                onPress={() => setResetTargetUser(null)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: theme.textSecondary, fontWeight: "700", fontSize: 14 }}>
                  Batal
                </Text>
              </AnimatedPressable>

              <AnimatedPressable
                onPress={handleAdminResetPassword}
                disabled={resettingUserPassword}
                style={{
                  flex: 1.3,
                  backgroundColor: "#EF4444",
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                }}
              >
                {resettingUserPassword ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>
                    Reset & Cetak Slip
                  </Text>
                )}
              </AnimatedPressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* FULL PROFILE PHOTO VIEWER MODAL */}
      <ProfilePhotoModal
        visible={photoViewerState.visible}
        onClose={() => setPhotoViewerState((prev) => ({ ...prev, visible: false }))}
        photoUrl={photoViewerState.photoUrl}
        name={photoViewerState.name}
        nrp={photoViewerState.nrp}
        role={photoViewerState.role}
        isOwnProfile={photoViewerState.isOwnProfile}
        onChangePhoto={() => setShowAvatarPicker(true)}
        onDeletePhoto={handleRemoveAvatar}
      />

      {/* FEEDBACK TOAST */}
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
