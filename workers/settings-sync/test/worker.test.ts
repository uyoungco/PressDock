import assert from "node:assert/strict";
import test from "node:test";
import { CMS_CURRENT_USER_URL, createWorker, type Env } from "../src/index.ts";

const user = { userId: 6, nickname: "演示测试账号", role: ["admin"] };
const valid = () => Response.json({ code: "200", data: user });
const request = (authorization: string | null = "Bearer demo-test-token") =>
  new Request("https://test.example/api/v1/verify", {
    headers: authorization ? { Authorization: authorization } : {},
  });

function database(fail = false) {
  const queries: string[] = [];
  return {
    queries,
    env: {
      DB: {
        prepare(sql: string) {
          queries.push(sql);
          return {
            async first() {
              if (fail) throw new Error("internal SQL and demo-secret");
              return { connected: 1 };
            },
          };
        },
      } as unknown as D1Database,
    } satisfies Env,
  };
}

test("public health never calls CMS or D1", async () => {
  const db = database();
  const worker = createWorker({
    cmsFetch: async () => assert.fail("must not call CMS"),
  });
  const response = await worker.fetch(
    new Request("https://test.example/health"),
    db.env,
  );
  assert.equal(response.status, 200);
  const health = (await response.json()) as {
    stage: number;
    schemaVersion: number;
  };
  assert.equal(health.stage, 3);
  assert.equal(health.schemaVersion, 2);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(db.queries, []);
});

for (const authorization of [
  null,
  "Basic demo",
  "Bearer demo test",
  `Bearer ${"a".repeat(8193)}`,
]) {
  test(`invalid authorization is rejected before all outbound calls: ${authorization === null ? "missing" : authorization.slice(0, 20)}`, async () => {
    const db = database();
    const response = await createWorker({
      cmsFetch: async () => assert.fail("must not call CMS"),
    }).fetch(request(authorization), db.env);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "AUTH_REQUIRED",
    });
    assert.deepEqual(db.queries, []);
  });
}

test("CMS identity must be validated at the fixed URL before the read-only D1 query", async () => {
  const db = database();
  let cmsCalled = false;
  const worker = createWorker({
    cmsFetch: async (url, init) => {
      assert.equal(url, CMS_CURRENT_USER_URL);
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      assert.equal(
        new Headers(init.headers).get("Authorization"),
        "Bearer demo-test-token",
      );
      assert.deepEqual(db.queries, []);
      cmsCalled = true;
      return valid();
    },
  });
  const response = await worker.fetch(request(), db.env);
  assert.equal(cmsCalled, true);
  assert.equal(response.status, 200);
  assert.deepEqual(db.queries, ["SELECT 1 AS connected"]);
  assert.deepEqual(await response.json(), {
    ok: true,
    cms: { verified: true },
    database: { connected: true },
    environment: "development",
    stage: 1,
  });
});

for (const [status, code] of [
  [401, "AUTH_EXPIRED"],
  [403, "CMS_FORBIDDEN"],
  [503, "CMS_UNAVAILABLE"],
  [302, "CMS_UNAVAILABLE"],
] as const) {
  test(`CMS HTTP ${status} cannot grant D1 access`, async () => {
    const db = database();
    const response = await createWorker({
      cmsFetch: async () => new Response("demo-secret", { status }),
    }).fetch(request(), db.env);
    assert.equal(
      response.status,
      status === 401 || status === 403 ? status : 503,
    );
    assert.deepEqual(await response.json(), { ok: false, code });
    assert.deepEqual(db.queries, []);
  });
}

test("business expiry A0230 in HTTP 200 is rejected and does not leak the CMS body", async () => {
  const db = database();
  const response = await createWorker({
    cmsFetch: async () =>
      Response.json({ code: "A0230", msg: "demo-secret", data: user }),
  }).fetch(request(), db.env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, code: "AUTH_EXPIRED" });
  assert.deepEqual(db.queries, []);
});

for (const data of [
  null,
  {},
  { ...user, userId: 0 },
  { ...user, nickname: "" },
  { ...user, role: [] },
  { ...user, role: [1] },
]) {
  test(`malformed CMS identity fails closed: ${JSON.stringify(data)}`, async () => {
    const db = database();
    const response = await createWorker({
      cmsFetch: async () => Response.json({ code: 200, data }),
    }).fetch(request(), db.env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "CMS_INVALID_RESPONSE",
    });
    assert.deepEqual(db.queries, []);
  });
}

test("CMS network failures cannot grant access or leak exception details", async () => {
  const db = database();
  const response = await createWorker({
    cmsFetch: async () => {
      throw new Error("demo-secret");
    },
  }).fetch(request(), db.env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "CMS_UNAVAILABLE",
  });
  assert.deepEqual(db.queries, []);
});

test("CMS timeout cancels the request and never runs a database query", async () => {
  const db = database();
  let attempts = 0;
  const response = await createWorker({
    timeoutMs: 5,
    cmsFetch: async (_url, init) => {
      attempts += 1;
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => reject(new Error("demo-secret")),
          { once: true },
        );
      });
    },
  }).fetch(request(), db.env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, code: "CMS_TIMEOUT" });
  assert.deepEqual(db.queries, []);
  assert.equal(attempts, 2);
});

for (const transient of ["timeout", "network", 408, 429, 503] as const) {
  test(`transient CMS ${transient} is retried before the single database read`, async () => {
    const db = database();
    let attempts = 0;
    const response = await createWorker({
      timeoutMs: 5,
      cmsFetch: async (url, init) => {
        attempts += 1;
        assert.equal(url, CMS_CURRENT_USER_URL);
        assert.equal(init.redirect, "manual");
        assert.equal(
          new Headers(init.headers).get("Authorization"),
          "Bearer demo-test-token",
        );
        assert.deepEqual(db.queries, []);
        if (attempts > 1) return valid();
        if (transient === "network") throw new Error("demo-secret");
        if (transient === "timeout") {
          return new Promise<Response>((_resolve, reject) => {
            init.signal!.addEventListener(
              "abort",
              () => reject(new Error("demo-secret")),
              { once: true },
            );
          });
        }
        return new Response("demo-secret", { status: transient });
      },
    }).fetch(request(), db.env);
    assert.equal(response.status, 200);
    assert.equal(attempts, 2);
    assert.deepEqual(db.queries, ["SELECT 1 AS connected"]);
  });
}

for (const response of [
  () => new Response("demo-secret", { status: 401 }),
  () => new Response("demo-secret", { status: 403 }),
  () => new Response("demo-secret", { status: 302 }),
  () => Response.json({ code: "A0230", data: user }),
  () => Response.json({ code: "200", data: { ...user, userId: 0 } }),
  () => new Response("demo-secret <html>invalid</html>"),
]) {
  test("untrusted or rejected identity never retries or falls back to D1", async () => {
    const db = database();
    let attempts = 0;
    const result = await createWorker({
      cmsFetch: async () => {
        attempts += 1;
        return response();
      },
    }).fetch(request(), db.env);
    assert.notEqual(result.status, 200);
    assert.equal(attempts, 1);
    assert.deepEqual(db.queries, []);
    assert.equal((await result.text()).includes("demo-secret"), false);
  });
}

for (const body of ["demo-secret <html>error</html>", "x".repeat(65537)]) {
  test(`untrusted CMS response is rejected (length ${body.length})`, async () => {
    const db = database();
    const response = await createWorker({
      cmsFetch: async () => new Response(body),
    }).fetch(request(), db.env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "CMS_INVALID_RESPONSE",
    });
    assert.deepEqual(db.queries, []);
  });
}

test("D1 errors are sanitized and never reported as success", async () => {
  const db = database(true);
  const response = await createWorker({ cmsFetch: async () => valid() }).fetch(
    request(),
    db.env,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "D1_UNAVAILABLE",
  });
});

test("query credentials, writes, and unknown routes are not accepted", async () => {
  const db = database();
  const worker = createWorker({
    cmsFetch: async () => assert.fail("must not call CMS"),
  });
  for (const [input, expected] of [
    [new Request("https://test.example/api/v1/verify?token=demo-secret"), 400],
    [
      new Request("https://test.example/api/v1/verify", { method: "POST" }),
      405,
    ],
    [new Request("https://test.example/arbitrary-sql"), 404],
  ] as const) {
    const response = await worker.fetch(input, db.env);
    assert.equal(response.status, expected);
    assert.equal((await response.text()).includes("demo-secret"), false);
  }
  assert.deepEqual(db.queries, []);
});
