import { useSyncExternalStore } from "react";
import { authService } from "@/features/auth/service";
export function useAuth() {
  return useSyncExternalStore(authService.subscribe, authService.getSnapshot);
}
