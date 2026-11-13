import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SettingsStore, type StoreEnv } from "../src/store.ts";
import { decryptSecret, encryptSecret, fingerprint } from "../src/crypto.ts";
import { createWorker } from "../src/index.ts";
import type { Config, Initialize, Operation, Change } from "../src/protocol.ts";

const config = (
  JSON.parse(
    readFileSync(
      new URL("../../../docs/settings-sync/fixtures-v2.json", import.meta.url),
      "utf8",
    ),
  ) as { base: { config: Config } }
).base.config;
const raw = (x: unknown) => new TextEncoder().encode(JSON.stringify(x));
const ring = () =>
  JSON.stringify({
    current: "v1",
    keys: {
      v1: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        "base64",
      ),
    },
  });
function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0001_settings.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      new URL("../migrations/0002_body_organization.sql", import.meta.url),
      "utf8",
    ),
  );
  let failAt = -1,
    loseResponse = false,
    queries = 0;
  class Statement {
    sql: string;
    args: SQLInputValue[] = [];
    constructor(sql: string) {
      this.sql = sql;
    }
    bind(...values: unknown[]) {
      this.args = values.map((v) =>
        v instanceof ArrayBuffer ? new Uint8Array(v) : v,
      ) as SQLInputValue[];
      return this;
    }
    async all() {
      queries++;
      return {
        success: true,
        results: db.prepare(this.sql).all(...this.args),
        meta: {},
      };
    }
  }
  const session = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (stmts: Statement[]) => {
      queries += stmts.length;
      db.exec("BEGIN");
      try {
        const results = stmts.map((s, i) => {
          if (i === failAt) throw new Error("injected storage failure");
          db.prepare(s.sql).run(...s.args);
          return { success: true, results: [], meta: {} };
        });
        db.exec("COMMIT");
        if (loseResponse) {
          loseResponse = false;
          throw new Error("committed response lost");
        }
        return results;
      } catch (e) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const env: StoreEnv = {
    DB: { withSession: () => session } as unknown as D1Database,
    SETTINGS_ENCRYPTION_KEYRING: ring(),
    SETTINGS_HMAC_KEYRING: ring(),
    SETTINGS_ENVIRONMENT: "test",
  };
  const store = () => new SettingsStore(env);
  const init: Initialize = {
    schemaVersion: 2,
    operationId: randomUUID(),
    deviceId: randomUUID(),
    sequence: 1,
    config: structuredClone(config),
    secrets: [{ providerId: "demo-provider", value: "DEMO-ONLY-initial" }],
  };
  return {
    db,
    env,
    store,
    init,
    fail: (i: number) => {
      failAt = i;
    },
    lose: () => {
      loseResponse = true;
    },
    queries: () => queries,
  };
}
const operation = (
  changes: Change[],
  deviceId: string = randomUUID(),
  sequence = 1,
): Operation => ({
  schemaVersion: 2,
  operationId: randomUUID(),
  deviceId,
  sequence,
  changes,
});
const set = (field: string, value: unknown): Change =>
  ({
    type: "set",
    target: { entity: "model", id: "demo-model" },
    field,
    value,
  }) as Change;

test("initialize exactly once; permanent receipt precedes current-state validation", async () => {
  const d = database();
  const first = await d.store().write(raw(d.init), "initialize", 1);
  assert.deepEqual(await d.store().write(raw(d.init), "initialize", 2), first);
  assert.deepEqual(await d.store().write(raw(d.init), "initialize", 1), first);
  await assert.rejects(
    d
      .store()
      .write(
        raw({ ...d.init, operationId: randomUUID(), deviceId: randomUUID() }),
        "initialize",
        1,
      ),
    { code: "ALREADY_INITIALIZED" },
  );
  assert.equal((await d.store().bootstrap()).snapshot.revision, 1);
});
test("20 rounds: concurrent different fields merge, same field follows commits, late retries never overwrite", async () => {
  const d = database();
  await d.store().write(raw(d.init), "initialize", 1);
  for (let i = 0; i < 20; i++) {
    const a = operation([set("displayName", `demo-A-${i}`)]);
    const b = operation([set("maxOutputTokens", 4100 + i)]);
    await Promise.all([
      d.store().write(raw(a), "operation", 1),
      d.store().write(raw(b), "operation", 2),
    ]);
    const merged = await d.store().bootstrap();
    assert.equal(merged.snapshot.config.models[0].displayName, `demo-A-${i}`);
    assert.equal(merged.snapshot.config.models[0].maxOutputTokens, 4100 + i);
    const c = operation([set("displayName", `demo-C-${i}`)]);
    const old = await d.store().write(raw(c), "operation", 1);
    const e = operation([set("displayName", `demo-E-${i}`)]);
    await d.store().write(raw(e), "operation", 2);
    const before = await d.store().bootstrap();
    assert.deepEqual(await d.store().write(raw(c), "operation", 1), old);
    assert.deepEqual(await d.store().bootstrap(), before);
    assert.equal(before.snapshot.config.models[0].displayName, `demo-E-${i}`);
  }
});
test("response loss and concurrent identical requests return their original receipt", async () => {
  const d = database();
  await d.store().write(raw(d.init), "initialize", 1);
  const a = operation([set("displayName", "demo-lost")]);
  d.lose();
  const receipts = await Promise.all([
    d.store().write(raw(a), "operation", 1),
    d.store().write(raw(a), "operation", 1),
  ]);
  assert.deepEqual(receipts[0], receipts[1]);
  assert.equal((await d.store().bootstrap()).snapshot.revision, 2);
});
test("operation IDs bind original bytes and device sequence cannot run backwards", async () => {
  const d = database();
  await d.store().write(raw(d.init), "initialize", 1);
  const a = operation([set("displayName", "demo-seq")]);
  await d.store().write(raw(a), "operation", 1);
  await assert.rejects(
    d
      .store()
      .write(
        raw({ ...a, changes: [set("displayName", "demo-reused")] }),
        "operation",
        1,
      ),
    { code: "OPERATION_ID_REUSED" },
  );
  await assert.rejects(
    d
      .store()
      .write(new TextEncoder().encode(JSON.stringify(a) + " "), "operation", 1),
    { code: "OPERATION_ID_REUSED" },
  );
  await assert.rejects(
    d
      .store()
      .write(
        raw(operation([set("displayName", "demo-stale")], a.deviceId, 1)),
        "operation",
        1,
      ),
    { code: "SEQUENCE_STALE" },
  );
});
test("invalid references and mid-batch D1 failures leave snapshot, secrets and ledger untouched", async () => {
  const d = database();
  await d.store().write(raw(d.init), "initialize", 1);
  const before = await d.store().bootstrap();
  await assert.rejects(
    d
      .store()
      .write(
        raw(
          operation([
            { type: "delete", target: { entity: "model", id: "demo-model" } },
          ]),
        ),
        "operation",
        1,
      ),
    { code: "REFERENCE_NOT_FOUND" },
  );
  const a = operation([
    set("displayName", "demo-rollback"),
    {
      type: "setSecret",
      providerId: "demo-provider",
      value: "DEMO-ONLY-rollback",
    },
  ]);
  d.fail(3);
  await assert.rejects(d.store().write(raw(a), "operation", 1), {
    code: "WRITE_BUSY",
  });
  assert.deepEqual(await d.store().bootstrap(), before);
  assert.equal(
    d.db.prepare("SELECT count(*) AS n FROM settings_operations").get()?.n,
    1,
  );
  d.fail(-1);
  await d.store().write(raw(a), "operation", 1);
  assert.equal(
    (await d.store().bootstrap()).secrets[0].value,
    "DEMO-ONLY-rollback",
  );
});
test("encrypted secrets replace, clear and authenticate provider, environment and revision", async () => {
  const d = database();
  await d.store().write(raw(d.init), "initialize", 1);
  const value = "DEMO-ONLY-replacement-密钥";
  await d
    .store()
    .write(
      raw(
        operation([{ type: "setSecret", providerId: "demo-provider", value }]),
      ),
      "operation",
      1,
    );
  assert.equal((await d.store().bootstrap()).secrets[0].value, value);
  assert.equal(
    JSON.stringify(
      d.db
        .prepare(
          "SELECT *,hex(ciphertext) AS ciphertext_hex FROM settings_secrets",
        )
        .all(),
    ).includes(value),
    false,
  );
  const secret = await encryptSecret(d.env, "demo-provider", value, 3);
  assert.equal(await decryptSecret(d.env, secret), value);
  for (const altered of [
    { ...secret, providerId: "other" },
    { ...secret, secretRevision: 4 },
    { ...secret, ciphertext: Buffer.alloc(32).toString("base64") },
  ])
    await assert.rejects(decryptSecret(d.env, altered), {
      code: "SECRET_UNAVAILABLE",
    });
  await assert.rejects(
    decryptSecret({ ...d.env, SETTINGS_ENVIRONMENT: "other" }, secret),
    { code: "SECRET_UNAVAILABLE" },
  );
  const oldRing = JSON.parse(d.env.SETTINGS_ENCRYPTION_KEYRING) as {
    current: string;
    keys: Record<string, string>;
  };
  oldRing.current = "v2";
  oldRing.keys.v2 = JSON.parse(ring()).keys.v1;
  d.env.SETTINGS_ENCRYPTION_KEYRING = JSON.stringify(oldRing);
  assert.equal(await decryptSecret(d.env, secret), value);
  await d
    .store()
    .write(
      raw(operation([{ type: "clearSecret", providerId: "demo-provider" }])),
      "operation",
      1,
    );
  assert.equal((await d.store().bootstrap()).secrets[0].value, null);
  assert.equal(
    d.db.prepare("SELECT count(*) AS n FROM settings_secrets").get()?.n,
    0,
  );
});
test("HMAC rotation preserves old receipts without exposing request bodies", async () => {
  const d = database();
  const receipt = await d.store().write(raw(d.init), "initialize", 1);
  const old = JSON.parse(d.env.SETTINGS_HMAC_KEYRING) as {
    current: string;
    keys: Record<string, string>;
  };
  old.current = "v2";
  old.keys.v2 = JSON.parse(ring()).keys.v1;
  d.env.SETTINGS_HMAC_KEYRING = JSON.stringify(old);
  assert.deepEqual(
    await d.store().write(raw(d.init), "initialize", 1),
    receipt,
  );
  assert.notEqual(
    (await fingerprint(d.env, raw(d.init))).digest,
    (await fingerprint(d.env, raw(d.init), "v1")).digest,
  );
  assert.equal(
    JSON.stringify(
      d.db.prepare("SELECT * FROM settings_operations").all(),
    ).includes("DEMO-ONLY"),
    false,
  );
});
test("authenticated users share one namespace; unauthenticated requests cannot read secrets", async () => {
  const d = database();
  const worker = createWorker({
    cmsFetch: async (_url, init) =>
      new Response(
        JSON.stringify({
          data: {
            userId:
              init.headers &&
              (init.headers as Record<string, string>).Authorization.endsWith(
                "two",
              )
                ? 2
                : 1,
            nickname: "演示",
            role: ["Editor"],
          },
        }),
      ),
  });
  const call = (route: string, body?: unknown, token = "one") =>
    worker.fetch(
      new Request(`https://example.com/api/v1/settings/${route}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      d.env,
    );
  assert.equal((await call("initialize", d.init)).status, 200);
  assert.equal(
    (
      await call(
        "operations",
        operation([set("displayName", "demo-two")]),
        "two",
      )
    ).status,
    200,
  );
  const boot = await call("bootstrap");
  assert.equal(boot.status, 200);
  assert.equal(
    ((await boot.json()) as { snapshot: { config: Config } }).snapshot.config
      .models[0].displayName,
    "demo-two",
  );
  assert.equal(boot.headers.get("Cache-Control"), "no-store");
  const denied = await worker.fetch(
    new Request("https://example.com/api/v1/settings/bootstrap"),
    d.env,
  );
  assert.equal(denied.status, 401);
  assert.equal(
    JSON.stringify(await denied.json()).includes("DEMO-ONLY"),
    false,
  );
});
