import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";
import { useColorScheme as useNWColorScheme } from "nativewind";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { darkTheme, lightTheme, ThemeColors } from "@/theme/colors";

const THEME_STORAGE_KEY = "@ht_app_theme_mode";

type ThemeMode = "dark" | "light";

interface ThemeContextType {
  colorScheme: ThemeMode;
  isDark: boolean;
  theme: ThemeColors;
  toggleColorScheme: () => void;
  setColorScheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  colorScheme: "dark",
  isDark: true,
  theme: darkTheme,
  toggleColorScheme: () => {},
  setColorScheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useRNColorScheme();
  const { setColorScheme: setNWColorScheme } = useNWColorScheme();
  const [colorScheme, setModeState] = useState<ThemeMode>(systemScheme === "light" ? "light" : "dark");

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY).then((saved) => {
      if (saved === "light" || saved === "dark") {
        setModeState(saved);
        try {
          setNWColorScheme(saved);
        } catch {}
      }
    });
  }, []);

  const setColorScheme = useCallback((mode: ThemeMode) => {
    setModeState(mode);
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch(() => {});
    try {
      setNWColorScheme(mode);
    } catch {}
  }, [setNWColorScheme]);

  const toggleColorScheme = useCallback(() => {
    setModeState((prev) => {
      const nextMode = prev === "dark" ? "light" : "dark";
      AsyncStorage.setItem(THEME_STORAGE_KEY, nextMode).catch(() => {});
      try {
        setNWColorScheme(nextMode);
      } catch {}
      return nextMode;
    });
  }, [setNWColorScheme]);

  const isDark = colorScheme === "dark";
  const theme = useMemo(() => (isDark ? darkTheme : lightTheme), [isDark]);

  const contextValue = useMemo(
    () => ({ colorScheme, isDark, theme, toggleColorScheme, setColorScheme }),
    [colorScheme, isDark, theme, toggleColorScheme, setColorScheme]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
