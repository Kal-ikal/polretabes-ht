import { useAppTheme } from "@/context/ThemeContext";
import { ThemeColors } from "@/theme/colors";

export function useTheme(): ThemeColors {
  const { theme } = useAppTheme();
  return theme;
}

export { useAppTheme };
