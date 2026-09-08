/**
 * Cross-platform Share Wrapper.
 * react-native-web's Share.share() only works when navigator.share exists,
 * which most desktop browsers lack — it then rejects and, since call sites
 * typically swallow the error, the "Bagikan" button silently does nothing
 * on web. This copies to the clipboard on web instead (with native Share
 * as a fallback if the Clipboard API isn't available), and uses the native
 * Share sheet on iOS/Android as before.
 */
import { Platform, Share } from "react-native";

export type ShareOrCopyResult = "shared" | "copied" | "failed";

export async function shareOrCopyText(content: { title?: string; message: string }): Promise<ShareOrCopyResult> {
  if (Platform.OS === "web") {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(content.message);
        return "copied";
      }
    } catch {
      // fall through to Share.share below
    }
  }

  try {
    await Share.share({ title: content.title, message: content.message });
    return "shared";
  } catch {
    return "failed";
  }
}
