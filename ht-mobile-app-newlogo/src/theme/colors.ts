export type ThemeColors = {
  isDark: boolean;
  backgroundGradient: [string, string, string];
  cardBackground: string;
  cardBg: string;
  cardBorder: string;
  primary: string;
  primaryTextOnButton: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  inputBackground: string;
  inputBorder: string;
  inputText: string;
  inputPlaceholder: string;
  status: {
    tersedia: {
      bg: string;
      text: string;
      border: string;
    };
    dipinjam: {
      bg: string;
      text: string;
      border: string;
    };
    rusak: {
      bg: string;
      text: string;
      border: string;
    };
    pending: {
      bg: string;
      text: string;
      border: string;
    };
  };
  shadowColor: string;
};

export const darkTheme: ThemeColors = {
  isDark: true,
  backgroundGradient: ["#0B132B", "#1C2541", "#1E3A8A"],
  cardBackground: "rgba(30, 41, 59, 0.78)",
  cardBg: "rgba(30, 41, 59, 0.78)",
  cardBorder: "rgba(255, 255, 255, 0.12)",
  primary: "#38BDF8",
  primaryTextOnButton: "#0F172A",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  inputBackground: "rgba(15, 23, 42, 0.65)",
  inputBorder: "rgba(255, 255, 255, 0.15)",
  inputText: "#F8FAFC",
  inputPlaceholder: "#64748B",
  status: {
    tersedia: {
      bg: "rgba(34, 197, 94, 0.18)",
      text: "#4ADE80",
      border: "rgba(74, 222, 128, 0.35)",
    },
    dipinjam: {
      bg: "rgba(249, 115, 22, 0.18)",
      text: "#FB923C",
      border: "rgba(251, 146, 60, 0.35)",
    },
    rusak: {
      bg: "rgba(239, 68, 68, 0.18)",
      text: "#F87171",
      border: "rgba(248, 113, 113, 0.35)",
    },
    pending: {
      bg: "rgba(245, 158, 11, 0.18)",
      text: "#FBBF24",
      border: "rgba(251, 191, 36, 0.35)",
    },
  },
  shadowColor: "#000000",
};

export const lightTheme: ThemeColors = {
  isDark: false,
  backgroundGradient: ["#F8FAFC", "#E0F2FE", "#E2E8F0"],
  cardBackground: "rgba(255, 255, 255, 0.92)",
  cardBg: "rgba(255, 255, 255, 0.92)",
  cardBorder: "rgba(226, 232, 240, 0.9)",
  primary: "#0284C7",
  primaryTextOnButton: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  textMuted: "#94A3B8",
  inputBackground: "#FFFFFF",
  inputBorder: "#CBD5E1",
  inputText: "#0F172A",
  inputPlaceholder: "#94A3B8",
  status: {
    tersedia: {
      bg: "#DCFCE7",
      text: "#15803D",
      border: "#86EFAC",
    },
    dipinjam: {
      bg: "#FFEDD5",
      text: "#C2410C",
      border: "#FDBA74",
    },
    rusak: {
      bg: "#FEE2E2",
      text: "#B91C1C",
      border: "#FCA5A5",
    },
    pending: {
      bg: "#FEF3C7",
      text: "#B45309",
      border: "#FCD34D",
    },
  },
  shadowColor: "#64748B",
};
