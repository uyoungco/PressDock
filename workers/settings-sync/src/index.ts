import { readBody } from "./http.ts";
import { ServiceError, serviceError } from "./service-error.ts";
import { SettingsStore, type StoreEnv } from "./store.ts";

export const CMS_CURRENT_USER_URL =
  "https://newsadmin.nccontrol.com.cn/api/Account/CurrentUser";

export interface Env {
  DB: D1Database;
  SETTINGS_ENCRYPTION_KEYRING?: string;
  SETTINGS_HMAC_KEYRING?: string;
  SETTINGS_ENVIRONMENT?: string;
}

type CmsFetch = (url: string, init: RequestInit) => Promise<Response>;
type Dependencies = { cmsFetch?: CmsFetch; timeoutMs?: number };

class VerificationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  constructor(status: number, code: string, retryable = false) {
    super(code);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

async function readCmsJson(response: Response): Promise<unknown> {
  if (!response.body) throw new VerificationError(503, "CMS_INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new VerificationError(503, "CMS_INVALID_RESPONSE");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    throw new VerificationError(503, "CMS_INVALID_RESPONSE");
  } finally {
    reader.releaseLock();
  }
}

async function verifyCmsAttempt(
  authorization: string,
  cmsFetch: CmsFetch,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await cmsFetch(CMS_CURRENT_USER_URL, {
      method: "GET",
      headers: { Authorization: authorization, Accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => {});
    }
    if (response.status === 401)
      throw new VerificationError(401, "AUTH_EXPIRED");
    if (response.status === 403)
      throw new VerificationError(403, "CMS_FORBIDDEN");
    if (response.status < 200 || response.status >= 300)
      throw new VerificationError(
        503,
        "CMS_UNAVAILABLE",
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
      );

    const payload = await readCmsJson(response);
    if (!record(payload))
      throw new VerificationError(503, "CMS_INVALID_RESPONSE");
    const code = payload.code === undefined ? undefined : String(payload.code);
    if (code === "A0230") throw new VerificationError(401, "AUTH_EXPIRED");
    if (code !== undefined && code !== "200")
      throw new VerificationError(503, "CMS_UNAVAILABLE");

    const user = payload.data;
    if (
      !record(user) ||
      typeof user.userId !== "number" ||
      !Number.isSafeInteger(user.userId) ||
      user.userId <= 0 ||
      typeof user.nickname !== "string" ||
      !user.nickname.trim() ||
      !Array.isArray(user.role) ||
      user.role.length === 0 ||
      !user.role.every((role) => typeof role === "string" && role.trim())
    ) {
      throw new VerificationError(503, "CMS_INVALID_RESPONSE");
    }
    return user.userId;
  } catch (error) {
    if (controller.signal.aborted)
      throw new VerificationError(503, "CMS_TIMEOUT", true);
    if (error instanceof VerificationError) throw error;
    throw new VerificationError(503, "CMS_UNAVAILABLE", true);
  } finally {
    clearTimeout(timer);
  }
}

async function verifyCms(
  authorization: string | null,
  cmsFetch: CmsFetch,
  timeoutMs: number,
) {
  if (
    !authorization ||
    authorization.length > 8192 ||
    !/^Bearer [A-Za-z0-9._~+/=-]+$/i.test(authorization)
  ) {
    throw new VerificationError(401, "AUTH_REQUIRED");
  }
  // 只重试固定 CMS 地址的只读鉴权，不重放配置写入，也不复用旧鉴权结果。
  // 默认最多 2 × 8 秒，为客户端 25 秒请求预算保留传输及 D1 时间。
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await verifyCmsAttempt(authorization, cmsFetch, timeoutMs);
    } catch (error) {
      if (
        !(error instanceof VerificationError) ||
        !error.retryable ||
        attempt >= 1
      )
        throw error;
    }
  }
}

export function createWorker(dependencies: Dependencies = {}) {
  const cmsFetch = dependencies.cmsFetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = dependencies.timeoutMs ?? 8000;

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const settingsRoute = new URL(request.url).pathname.startsWith(
        "/api/v1/settings/",
      );
      let operationId: string | null = null;
      try {
        const url = new URL(request.url);
        if (settingsRoute) {
          if (url.search) throw new ServiceError("QUERY_NOT_ALLOWED", 400);
          const route = url.pathname.slice("/api/v1/settings/".length);
          if (
            !["bootstrap", "initialize", "operations", "check"].includes(route)
          )
            throw new ServiceError("NOT_FOUND", 404);
          const method = route === "bootstrap" ? "GET" : "POST";
          if (request.method !== method)
            return json(
              {
                schemaVersion: 1,
                error: {
                  code: "METHOD_NOT_ALLOWED",
                  retryable: false,
                  operationId: null,
                },
              },
              405,
              { Allow: method },
            );
          const userId = await verifyCms(
            request.headers.get("Authorization"),
            cmsFetch,
            timeoutMs,
          );
          if (
            !env.SETTINGS_ENCRYPTION_KEYRING ||
            !env.SETTINGS_HMAC_KEYRING ||
            !env.SETTINGS_ENVIRONMENT
          )
            throw new ServiceError("SECRET_UNAVAILABLE", 503, true);
          const store = new SettingsStore(env as StoreEnv);
          if (route === "bootstrap") return json(await store.bootstrap());
          const raw = await readBody(request);
          if (route === "check") return json(await store.check(raw));
          return json(
            await store.write(
              raw,
              route === "initialize" ? "initialize" : "operation",
              userId,
              (id) => {
                operationId = id;
              },
            ),
          );
        }
        if (url.search)
          return json({ ok: false, code: "QUERY_NOT_ALLOWED" }, 400);
        if (!["/health", "/api/v1/verify"].includes(url.pathname))
          return json({ ok: false, code: "NOT_FOUND" }, 404);
        if (request.method !== "GET")
          return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, {
            Allow: "GET",
          });
        if (url.pathname === "/health")
          return json({
            ok: true,
            service:
              env.SETTINGS_ENVIRONMENT === "production"
                ? "pressdock-settings"
                : "pressdock-settings-dev",
            environment: env.SETTINGS_ENVIRONMENT ?? "development",
            stage: 3,
          });

        await verifyCms(
          request.headers.get("Authorization"),
          cmsFetch,
          timeoutMs,
        );
        try {
          const row = await env.DB.prepare("SELECT 1 AS connected").first<{
            connected: number;
          }>();
          if (row?.connected !== 1) throw new Error("connection check failed");
        } catch {
          throw new VerificationError(503, "D1_UNAVAILABLE");
        }
        return json({
          ok: true,
          cms: { verified: true },
          database: { connected: true },
          environment: env.SETTINGS_ENVIRONMENT ?? "development",
          stage: 1,
        });
      } catch (error) {
        if (settingsRoute) {
          const problem =
            error instanceof VerificationError
              ? new ServiceError(error.code, error.status, error.status >= 500)
              : serviceError(error);
          return json(
            {
              schemaVersion: 1,
              error: {
                code: problem.code,
                retryable: problem.retryable,
                operationId,
              },
            },
            problem.status,
          );
        }
        return error instanceof VerificationError
          ? json({ ok: false, code: error.code }, error.status)
          : json({ ok: false, code: "INTERNAL_ERROR" }, 500);
      }
    },
  };
}

export default createWorker();
