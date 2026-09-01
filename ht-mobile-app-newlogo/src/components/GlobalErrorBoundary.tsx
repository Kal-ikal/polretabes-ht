import React, { Component, type ReactNode } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[GlobalErrorBoundary] Caught unexpected error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {/* Warning Icon Badge */}
            <View style={styles.iconCircle}>
              <Ionicons name="warning-outline" size={42} color="#EF4444" />
            </View>

            <Text style={styles.title}>Terjadi Kendala Sistem</Text>
            <Text style={styles.subtitle}>
              Aplikasi mengalami kendala sementara saat memuat data. Tenang, sesi dan data Anda tetap aman.
            </Text>

            {/* Error Message Box */}
            <View style={styles.errorBox}>
              <Text style={styles.errorHeader}>Detail Kendala:</Text>
              <Text style={styles.errorMessage} numberOfLines={4}>
                {this.state.error?.message || "Kesalahan tidak terduga pada antarmuka aplikasi."}
              </Text>
            </View>

            {/* Action Button */}
            <Pressable
              onPress={this.handleReset}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
            >
              <Ionicons name="refresh-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.retryButtonText}>Muat Ulang Aplikasi</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B132B",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1.5,
    borderColor: "rgba(239, 68, 68, 0.3)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: "#94A3B8",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
    maxWidth: 320,
  },
  errorBox: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.2)",
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  errorHeader: {
    fontSize: 12,
    fontWeight: "700",
    color: "#F87171",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  errorMessage: {
    fontSize: 13,
    color: "#E2E8F0",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0284C7",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    width: "100%",
    maxWidth: 380,
    shadowColor: "#0284C7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
