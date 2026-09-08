/**
 * dateUtils.ts
 * Utilitas format tanggal, kalkulasi sisa waktu jatuh tempo, dan status keterlambatan (overdue).
 */

const BULAN_ID = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

const HARI_ID = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];

/**
 * Format tanggal lengkap Indonesia: e.g. "Senin, 7 Sep 2026, 15:30 WIB"
 */
export function formatFullDateTimeId(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "-";
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return "-";

  const hari = HARI_ID[d.getDay()];
  const tgl = d.getDate();
  const bln = BULAN_ID[d.getMonth()];
  const thn = d.getFullYear();
  const jam = String(d.getHours()).padStart(2, "0");
  const mnt = String(d.getMinutes()).padStart(2, "0");

  return `${hari}, ${tgl} ${bln} ${thn}, ${jam}:${mnt} WIB`;
}

/**
 * Format ringkas tanggal: e.g. "7 Sep 2026, 15:30"
 */
export function formatShortDateTimeId(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "-";
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return "-";

  const tgl = d.getDate();
  const bln = BULAN_ID[d.getMonth()];
  const thn = d.getFullYear();
  const jam = String(d.getHours()).padStart(2, "0");
  const mnt = String(d.getMinutes()).padStart(2, "0");

  return `${tgl} ${bln} ${thn}, ${jam}:${mnt}`;
}

export interface RemainingTimeStatus {
  isOverdue: boolean;
  label: string;
  text: string;
  urgentLevel: "safe" | "warning" | "danger";
  hoursDiff: number;
}

/**
 * Hitung sisa waktu atau keterlambatan terhadap due_date
 */
export function getRemainingTimeStatus(
  dueDateInput: string | Date | null | undefined
): RemainingTimeStatus | null {
  if (!dueDateInput) return null;
  const due = typeof dueDateInput === "string" ? new Date(dueDateInput) : dueDateInput;
  if (isNaN(due.getTime())) return null;

  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffSec = Math.floor(Math.abs(diffMs) / 1000);
  const diffMinutes = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  const isOverdue = diffMs < 0;

  let label = "";
  if (diffDays > 0) {
    const remHours = diffHours % 24;
    label = remHours > 0 ? `${diffDays} hari ${remHours} jam` : `${diffDays} hari`;
  } else if (diffHours > 0) {
    const remMins = diffMinutes % 60;
    label = remMins > 0 ? `${diffHours} jam ${remMins} mnt` : `${diffHours} jam`;
  } else if (diffMinutes > 0) {
    label = `${diffMinutes} menit`;
  } else {
    label = "Kurang dari 1 menit";
  }

  if (isOverdue) {
    return {
      isOverdue: true,
      label: `Terlambat ${label}`,
      text: `⚠️ Terlambat ${label}`,
      urgentLevel: "danger",
      hoursDiff: -diffHours,
    };
  }

  // Waktu masih aman atau mendekati batas
  const urgentLevel: "safe" | "warning" | "danger" =
    diffHours < 2 ? "warning" : "safe";

  return {
    isOverdue: false,
    label: `Sisa ${label}`,
    text: `⏱️ Sisa ${label}`,
    urgentLevel,
    hoursDiff: diffHours,
  };
}

/**
 * Menghitung Date baru dengan menambahkan N jam dari waktu saat ini
 */
export function addHoursToNow(hours: number): Date {
  const d = new Date();
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d;
}
