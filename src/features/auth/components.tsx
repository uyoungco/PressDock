import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { authService } from "./service";

export function SessionBoundary() {
  useEffect(() => {
    void authService.restore();
  }, []);
  return <Outlet />;
}
export function SessionLoading() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center p-6"
      role="status"
    >
      正在验证登录状态…
    </div>
  );
}
export function RestoreFailure() {
  const auth = useAuth();
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md space-y-4 rounded-xl border bg-card p-7">
        <h1 className="text-xl font-semibold">暂时无法恢复登录</h1>
        <p role="alert" className="text-sm text-muted-foreground">
          {auth.error}
        </p>
        <div className="flex gap-3">
          <Button onClick={() => void authService.restore()}>重试</Button>
          <Button variant="outline" onClick={() => authService.useLoginForm()}>
            重新登录
          </Button>
        </div>
      </div>
    </div>
  );
}
export function RequireSession({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "restoring") return <SessionLoading />;
  if (auth.status === "unavailable") return <RestoreFailure />;
  if (auth.status !== "authenticated") {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate replace to={`/login?${new URLSearchParams({ redirect })}`} />
    );
  }
  return children;
}
