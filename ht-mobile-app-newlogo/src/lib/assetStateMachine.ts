import type { AssetStatus } from "@/types/database";

/**
 * Mirror dari FSM guard di database (supabase/schema.sql -> change_asset_status).
 * Dipakai HANYA untuk validasi cepat di UI (misal: nonaktifkan tombol "Pinjam"
 * kalau status sudah "dipinjam"). Validasi SEBENARNYA tetap di database lewat
 * RPC `request_borrow` / `request_return`, supaya tidak bisa dibypass.
 */
const ALLOWED_TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  tersedia: ["dipinjam", "rusak"],
  dipinjam: ["tersedia", "rusak"],
  rusak: ["tersedia"],
  pending: [],
};

export function canTransition(from: AssetStatus, to: AssetStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canBorrow(status: AssetStatus): boolean {
  return status === "tersedia";
}

export function statusLabel(status: AssetStatus | string): string {
  switch ((status || "").toLowerCase()) {
    case "tersedia":
      return "Tersedia";
    case "dipinjam":
      return "Dipinjam";
    case "rusak":
      return "Rusak";
    case "pending":
    case "pending_approval":
      return "Sedang Pending";
    default:
      return status || "Tersedia";
  }
}

export function statusColor(status: AssetStatus | string): string {
  switch ((status || "").toLowerCase()) {
    case "tersedia":
      return "#16a34a"; // green-600
    case "dipinjam":
      return "#ea580c"; // orange-600
    case "rusak":
      return "#dc2626"; // red-600
    case "pending":
    case "pending_approval":
      return "#d97706"; // amber-600
    default:
      return "#16a34a";
  }
}
