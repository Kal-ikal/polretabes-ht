/**
 * Safe Print Wrapper for Web Compatibility
 * On web, uses window.print() instead of expo-print.
 * On native, uses expo-print as before.
 */
import { Platform } from "react-native";

export async function safePrintAsync(options: { html: string }) {
  if (Platform.OS === "web") {
    // On web, open a new window with the HTML content and trigger print
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(options.html);
      printWindow.document.close();
      printWindow.focus();
      // Wait for images to load before printing
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);
    }
    return;
  }

  // On native, use expo-print
  const Print = require("expo-print");
  await Print.printAsync(options);
}
