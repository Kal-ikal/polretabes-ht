/**
 * Friendly Error Handler for User-Facing Alerts
 * Converts technical system/database/network errors into polite and clear Indonesian messages.
 */

export function getFriendlyErrorMessage(
  error: any,
  fallback = "Terjadi kendala pada sistem. Silakan coba kembali beberapa saat lagi."
): string {
  if (!error) return fallback;

  let msg = "";
  if (typeof error === "string") {
    msg = error;
  } else if (error && typeof error === "object") {
    msg = error.message || error.error_description || error.details || "";
  }

  if (!msg || typeof msg !== "string" || msg.trim() === "" || msg === "{}" || msg === "[object Object]") {
    return fallback;
  }

  const lower = msg.toLowerCase();

  // 1. Authentication & Credentials
  if (
    lower.includes("invalid login credentials") ||
    lower.includes("invalid_credentials") ||
    lower.includes("invalid password") ||
    lower.includes("wrong password")
  ) {
    return "Nama Petugas / Email atau kata sandi tidak sesuai. Silakan periksa kembali.";
  }
  if (lower.includes("email not confirmed")) {
    return "Akun Anda belum dikonfirmasi. Silakan hubungi admin.";
  }
  if (lower.includes("user not found")) {
    return "Akun tidak ditemukan. Pastikan nama atau email Anda sudah terdaftar di sistem.";
  }
  if (lower.includes("too many requests") || lower.includes("rate limit") || lower.includes("security purposes")) {
    return "Terlalu banyak percobaan masuk. Harap tunggu beberapa saat sebelum mencoba lagi.";
  }

  // 2. Network & Connectivity
  if (
    lower.includes("network request failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("network error") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused")
  ) {
    return "Koneksi internet bermasalah. Pastikan perangkat Anda terhubung ke jaringan internet.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Waktu koneksi habis. Silakan periksa jaringan dan coba kembali.";
  }
  if (lower.includes("jwt") || lower.includes("session expired") || lower.includes("token expired")) {
    return "Sesi login Anda telah berakhir. Silakan masuk kembali.";
  }

  // 3. Database / SQL / Column Errors (Hide raw Postgres errors from normal users)
  if (
    lower.includes("column") ||
    lower.includes("relation") ||
    lower.includes("pgrst") ||
    lower.includes("syntax error") ||
    lower.includes("null value in column") ||
    lower.includes("violates") ||
    lower.includes("schema cache") ||
    lower.includes("permission denied") ||
    lower.includes("database error")
  ) {
    return "Terjadi kendala sinkronisasi database pada sistem. Silakan coba kembali atau hubungi pengelola.";
  }

  // 4. Known Friendly Business Rules (Preserve if already readable Indonesian)
  if (
    lower.includes("aset tidak ditemukan") ||
    lower.includes("transaksi tidak ditemukan") ||
    lower.includes("tidak dalam status") ||
    lower.includes("sudah berstatus") ||
    lower.includes("aset sudah tidak tersedia") ||
    lower.includes("aset tidak dapat dipinjam") ||
    lower.includes("sudah ada pengajuan") ||
    lower.includes("tidak dalam status dipinjam") ||
    lower.includes("wajib diisi") ||
    lower.includes("lengkapi data") ||
    lower.includes("akses ditolak")
  ) {
    return msg;
  }

  // Fallback if message is too technical or long
  if (msg.length > 90 || lower.includes("error") || lower.includes("exception")) {
    return fallback;
  }

  return msg;
}
