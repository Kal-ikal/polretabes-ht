import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { getFriendlyErrorMessage } from "@/lib/errorHandler";
import type { Profile } from "@/types/database";

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateProfile: (full_name: string, nrp?: string | null, avatar_url?: string | null) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();
      if (data) {
        setProfile(data as Profile);
      }
    } catch (err) {
      console.error("fetchProfile error:", err);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      try {
        const { data } = await supabase.auth.getSession();
        const currentSession = data?.session ?? null;

        if (isMounted) {
          setSession(currentSession);
          if (currentSession?.user) {
            await fetchProfile(currentSession.user.id);
          }
        }
      } catch (err) {
        console.error("[AuthContext] getSession error:", err);
        if (isMounted) setSession(null);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    initAuth();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (isMounted) {
        setSession(newSession ?? null);
        if (newSession?.user) {
          await fetchProfile(newSession.user.id);
        } else {
          setProfile(null);
        }
      }
    });

    return () => {
      isMounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, [fetchProfile]);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      return;
    }

    const userId = session.user.id;
    fetchProfile(userId);

    // Subscribe to realtime profile changes for this user
    const profileChannelId = `user-profile-${userId}-${Date.now()}`;
    const channel = supabase
      .channel(profileChannelId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          if (payload.new) {
            setProfile(payload.new as Profile);
          } else {
            fetchProfile(userId);
          }
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch (err) {
        console.warn("[AuthContext] removeChannel error:", err);
      }
    };
  }, [session?.user?.id, fetchProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        return { error: getFriendlyErrorMessage(error) };
      }

      if (authData?.user) {
        const { data: userProf } = await supabase
          .from("profiles")
          .select("status, role")
          .eq("id", authData.user.id)
          .maybeSingle();

        if (userProf?.status === "PENDING" && userProf?.role !== "admin") {
          await supabase.auth.signOut();
          return {
            error: "Akun Anda berstatus PENDING (Menunggu Persetujuan Admin). Silakan hubungi Admin Logistik TIK untuk mengaktifkan akun Anda.",
          };
        }
      }

      return { error: null };
    } catch (err: any) {
      return { error: getFriendlyErrorMessage(err) };
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) {
      await fetchProfile(session.user.id);
    }
  }, [session?.user, fetchProfile]);

  const updateProfile = useCallback(async (full_name: string, nrp?: string | null, avatar_url?: string | null) => {
    if (!session?.user) return { error: "Sesi login tidak valid. Silakan login kembali." };

    const payload: Partial<Profile> = {
      id: session.user.id,
      full_name: full_name.trim(),
      nrp: nrp ? nrp.trim() : null,
    };

    if (avatar_url !== undefined) {
      payload.avatar_url = avatar_url;
    }

    // Optimistic UI update
    setProfile((prev) => (prev ? ({ ...prev, ...payload } as Profile) : null));

    const { error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" });

    if (error) {
      console.error("Supabase profile update error:", error);
      // Revert/sync with server
      await fetchProfile(session.user.id);
      return { error: getFriendlyErrorMessage(error) };
    }

    await fetchProfile(session.user.id);
    return { error: null };
  }, [session?.user, fetchProfile]);

  const contextValue = useMemo(
    () => ({ session, profile, loading, signIn, signOut, updateProfile, refreshProfile }),
    [session, profile, loading, signIn, signOut, updateProfile, refreshProfile]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam <AuthProvider>");
  return ctx;
}
