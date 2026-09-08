import { useAppTheme } from "@/context/ThemeContext";
import { ThemeColors, darkTheme } from "@/theme/colors";

export function useTheme(): ThemeColors & { colors: ThemeColors; isDark: boolean; theme: ThemeColors } {
  const { theme = darkTheme, isDark = true } = useAppTheme() || {};
  const safeTheme = theme || darkTheme;
  return {
    ...safeTheme,
    colors: safeTheme,
    isDark: isDark ?? safeTheme.isDark ?? true,
    theme: safeTheme,
  };
}

export { useAppTheme };
