import { cmsIpc } from "@/services/tauri/cms";
import {
  invalidateClientRequests,
  isDesktop,
  onAuthenticationExpired,
  ServiceError,
} from "@/services/tauri/client";
import { editorBuffers } from "@/features/editor/buffer";
import { channelQueryMemory } from "@/features/channels/query-memory";
import { channelEditBuffers } from "@/features/channels/edit-buffer";
import {
  loginInputSchema,
  type AuthSession,
  type LoginInput,
} from "@/types/cms";

export type AuthSnapshot = {
  status:
    | "restoring"
    | "authenticating"
    | "authenticated"
    | "anonymous"
    | "unavailable";
  session: AuthSession | null;
  error: string | null;
};
let snapshot: AuthSnapshot = {
  status: "restoring",
  session: null,
  error: null,
};
let version = 0;
let restoreTask: Promise<void> | null = null;
const listeners = new Set<() => void>();
function update(value: AuthSnapshot) {
  snapshot = value;
  listeners.forEach((listener) => listener());
}
function begin() {
  invalidateClientRequests();
  return ++version;
}
function accept(session: AuthSession | null) {
  if (session) {
    editorBuffers.retainUser(session.user.userId);
    channelQueryMemory.retainUser(session.user.userId);
    channelEditBuffers.retainUser(session.user.userId);
  }
  update({
    status: session ? "authenticated" : "anonymous",
    session,
    error: null,
  });
}
onAuthenticationExpired(() => {
  if (snapshot.status !== "authenticated") return;
  begin();
  update({
    status: "anonymous",
    session: null,
    error: "登录已失效，请重新登录。未保存的编辑将在同账号登录后恢复。",
  });
});

export const authService = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => snapshot,
  restore(): Promise<void> {
    if (restoreTask) return restoreTask;
    if (!isDesktop()) {
      accept(null);
      return Promise.resolve();
    }
    const operation = begin();
    update({ status: "restoring", session: null, error: null });
    restoreTask = cmsIpc
      .restore()
      .then((session) => {
        if (operation === version) accept(session);
      })
      .catch((reason: unknown) => {
        if (operation === version)
          update({
            status: "unavailable",
            session: null,
            error: reason instanceof Error ? reason.message : "恢复会话失败",
          });
      })
      .finally(() => {
        restoreTask = null;
      });
    return restoreTask;
  },
  async login(input: LoginInput) {
    if (!isDesktop())
      throw new ServiceError("DESKTOP_REQUIRED", "请在 PressDock 桌面端登录");
    const request = loginInputSchema.parse(input);
    const operation = begin();
    update({ status: "authenticating", session: null, error: null });
    try {
      const session = await cmsIpc.login(request);
      if (operation !== version)
        throw new ServiceError("SESSION_CHANGED", "登录状态已变化，请重试");
      accept(session);
      return session;
    } catch (reason) {
      if (operation === version)
        update({
          status: "anonymous",
          session: null,
          error: reason instanceof Error ? reason.message : "登录失败",
        });
      throw reason;
    }
  },
  async logout() {
    begin();
    editorBuffers.clear();
    channelQueryMemory.clear();
    channelEditBuffers.clear();
    accept(null);
    return cmsIpc.logout();
  },
  useLoginForm() {
    begin();
    accept(null);
  },
};

export function safeReturnPath(value: string | null): string {
  const unsafe = (text: string) =>
    text.includes("\\") ||
    [...text].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    );
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    unsafe(value)
  )
    return "/dashboard";
  try {
    const url = new URL(value, "https://pressdock.invalid");
    if (url.origin !== "https://pressdock.invalid" || url.pathname === "/login")
      return "/dashboard";
    // 只允许已实现的工作区页面，路径按解码后再次校验。
    const path = decodeURIComponent(url.pathname);
    if (unsafe(path)) return "/dashboard";
    if (
      !/^\/(dashboard|articles|import|images|publish|settings|channels)$/.test(
        path,
      ) &&
      !/^\/editor\/[^/\\]+$/.test(path)
    )
      return "/dashboard";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}
