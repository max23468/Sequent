import { goto } from "$app/navigation";
import { isServerReachable } from "$lib/offline/manager";
import { setPracticePending } from "./practice-pending";

export async function navigatePractice(url: string, invalidate = true) {
  setPracticePending(true);
  try {
    if (!(await isServerReachable())) {
      window.location.assign(url);
      return;
    }
    await goto(url, { replaceState: true, invalidateAll: invalidate });
  } finally {
    setPracticePending(false);
  }
}
