import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import type { Database } from "@/types/database";

const DEFAULT_SUPABASE_URL = "https://dwyqwbmnouiyhcpsyivn.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_bqd7TpKukFffe7SfO5M90g_lJnCcZjL";

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn(
    "[Supabase] EXPO_PUBLIC_SUPABASE_URL atau EXPO_PUBLIC_SUPABASE_ANON_KEY tidak ditemukan di environment. Menggunakan konfigurasi fallback default."
  );
}

// Web: use localStorage directly for maximum compatibility
// Native: use AsyncStorage
const webStorage = Platform.OS === "web" && typeof window !== "undefined" && window.localStorage
  ? {
      getItem: (key: string) => {
        const value = window.localStorage.getItem(key);
        return Promise.resolve(value);
      },
      setItem: (key: string, value: string) => {
        window.localStorage.setItem(key, value);
        return Promise.resolve();
      },
      removeItem: (key: string) => {
        window.localStorage.removeItem(key);
        return Promise.resolve();
      },
    }
  : null;

const storage = webStorage || AsyncStorage;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
  },
});

