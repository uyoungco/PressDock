import { useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, LoaderCircle, Newspaper } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { authService, safeReturnPath } from "@/features/auth/service";
import { RestoreFailure, SessionLoading } from "@/features/auth/components";
import { loginInputSchema } from "@/types/cms";
import { isDesktop } from "@/services/tauri/client";

export default function Login() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [errors, setErrors] = useState<{
    username?: string;
    password?: string;
  }>({});
  const submitting = useRef(false);
  const desktop = isDesktop();
  if (auth.status === "restoring") return <SessionLoading />;
  if (auth.status === "unavailable") return <RestoreFailure />;
  if (auth.status === "authenticated")
    return <Navigate replace to={safeReturnPath(params.get("redirect"))} />;
  const busy = auth.status === "authenticating";
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || !desktop) return;
    const parsed = loginInputSchema.safeParse({ username, password });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setErrors({
        username: fields.username?.[0],
        password: fields.password?.[0],
      });
      return;
    }
    setErrors({});
    submitting.current = true;
    try {
      const session = await authService.login(parsed.data);
      if (!session.persistent)
        toast.warning("已登录，但无法安全保存会话。关闭应用后需要重新登录。");
    } catch {
      /* 认证服务将具体错误提供给表单。 */
    } finally {
      submitting.current = false;
      setPassword("");
    }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-5">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-foreground text-background">
            <Newspaper className="size-6" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            登录 PressDock
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            连接新闻后台，进入编辑工作空间。
          </p>
        </div>
        <Card className="shadow-none">
          <CardContent className="pt-6">
            {!desktop && (
              <p
                role="status"
                className="mb-5 rounded-md bg-muted p-3 text-sm leading-6"
              >
                当前为浏览器预览。请在 PressDock 桌面端登录，使用完整工作区。
              </p>
            )}
            <form
              onSubmit={(event) => void submit(event)}
              noValidate
              className="space-y-5"
            >
              <div className="space-y-2">
                <label htmlFor="login-username" className="text-sm font-medium">
                  用户名
                </label>
                <Input
                  id="login-username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={busy || !desktop}
                  aria-invalid={!!errors.username}
                  aria-describedby={
                    errors.username ? "username-error" : undefined
                  }
                />
                {errors.username && (
                  <p
                    id="username-error"
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {errors.username}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label htmlFor="login-password" className="text-sm font-medium">
                  密码
                </label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={visible ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy || !desktop}
                    className="pr-11"
                    aria-invalid={!!errors.password}
                    aria-describedby={
                      errors.password ? "password-error" : undefined
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-0 right-0"
                    onClick={() => setVisible(!visible)}
                    aria-label={visible ? "隐藏密码" : "显示密码"}
                    disabled={busy || !desktop}
                  >
                    {visible ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                </div>
                {errors.password && (
                  <p
                    id="password-error"
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {errors.password}
                  </p>
                )}
              </div>
              {auth.error && (
                <p role="alert" className="text-sm text-destructive">
                  {auth.error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={busy || !desktop}
              >
                {busy && <LoaderCircle className="size-4 animate-spin" />}
                {busy ? "正在登录…" : "登录"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          使用新闻管理后台账号 · 不保存密码
        </p>
      </div>
    </main>
  );
}
