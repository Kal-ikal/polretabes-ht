import "../global.css";
import { View, Platform } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider, useAppTheme } from "@/context/ThemeContext";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";

// Expo Router native error boundary contract
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <GlobalErrorBoundary>
      {/* If an uncaught router exception is triggered */}
      {(() => {
        throw error;
      })()}
    </GlobalErrorBoundary>
  );
}

function StackContent() {
  const { theme, isDark } = useAppTheme();

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right",
          headerStyle: {
            backgroundColor: theme.isDark ? "#0B132B" : "#0284C7",
          },
          headerTintColor: "#FFFFFF",
          headerTitleStyle: {
            fontWeight: "700",
            fontSize: 18,
          },
        }}
      >
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="asset/[id]"
          options={{
            headerShown: true,
            title: "Detail Aset",
            presentation: "modal",
            animation: "slide_from_bottom",
          }}
        />
        <Stack.Screen
          name="return/[id]"
          options={{
            headerShown: true,
            title: "Pengembalian",
            presentation: "modal",
            animation: "slide_from_bottom",
          }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GlobalErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#090D16" }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <AuthProvider>
              <View
                style={{
                  flex: 1,
                  width: "100%",
                  height: "100%",
                  backgroundColor: "#090D16",
                  alignItems: "center",
                }}
              >
                <View
                  style={{
                    flex: 1,
                    width: "100%",
                    maxWidth: Platform.OS === "web" ? 640 : "100%",
                    height: "100%",
                    backgroundColor: "transparent",
                    ...(Platform.OS === "web"
                      ? {
                          boxShadow: "0 0 40px rgba(0, 0, 0, 0.5)",
                          borderLeftWidth: 1,
                          borderRightWidth: 1,
                          borderColor: "rgba(255, 255, 255, 0.08)",
                        }
                      : {}),
                  }}
                >
                  <StackContent />
                </View>
              </View>
            </AuthProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </GlobalErrorBoundary>
  );
}

