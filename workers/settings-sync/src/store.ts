import {
  encryptSecret,
  decryptSecret,
  fingerprint,
  sameDigest,
  type EncryptedSecret,
  type SecretEnv,
} from "./crypto.ts";
import {
  entityKey,
  parseWriteEnvelope,
  validateDocument,
  validateOperation,
  validateSnapshot,
  type Bootstrap,
  type Config,
  type Initialize,
  type Json,
  type Operation,
  type Receipt,
  type Snapshot,
} from "./protocol.ts";
import { ServiceError } from "./service-error.ts";

export interface StoreEnv extends SecretEnv {
  DB: D1Database;
}
interface Ledger {
  device_id: string;
  sequence: number;
  body_hmac: string;
  hmac_key_id: string;
  receipt_json: string;
}
interface State {
  initialized: boolean;
  revision: number;
  config: Config | null;
  secrets: EncryptedSecret[];
}
interface RawState {
  kind: string;
  schema_version: number | null;
  revision: number | null;
  initialized: number | null;
  config_json: string | null;
  provider_id: string | null;
  key_id: string | null;
  nonce_hex: string | null;
  ciphertext_hex: string | null;
  secret_revision: number | null;
}
const blob = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
const fromHex = (s: string) =>
  btoa(
    String.fromCharCode(
      ...Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16)),
    ),
  );
const unavailable = () => new ServiceError("D1_UNAVAILABLE", 503, true);
export class SettingsStore {
  private env: StoreEnv;
  private session: D1DatabaseSession;
  private queries = 0;
  constructor(env: StoreEnv) {
    this.env = env;
    this.session = env.DB.withSession("first-primary");
  }
  private stmt(sql: string, ...values: unknown[]) {
    return this.session.prepare(sql).bind(...values);
  }
  private budget(count = 1) {
    this.queries += count;
    if (this.queries > 30) throw new ServiceError("WRITE_BUSY", 503, true);
  }
  private async all<T>(sql: string, ...values: unknown[]): Promise<T[]> {
    this.budget();
    try {
      const r = await this.stmt(sql, ...values).all<T>();
      if (!r.success) throw unavailable();
      return r.results;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw unavailable();
    }
  }
  private async state(): Promise<State> {
    const rows = await this
      .all<RawState>(`SELECT 'state' AS kind,schema_version,revision,initialized,config_json,NULL AS provider_id,NULL AS key_id,NULL AS nonce_hex,NULL AS ciphertext_hex,NULL AS secret_revision FROM settings_state WHERE id=1
UNION ALL SELECT 'secret',NULL,NULL,NULL,NULL,provider_id,key_id,hex(nonce),hex(ciphertext),secret_revision FROM settings_secrets`);
    const row = rows.find((r) => r.kind === "state");
    if (!row || row.schema_version !== 1 || row.revision === null)
      throw unavailable();
    let config: Config | null = null;
    if (row.initialized) {
      try {
        config = validateSnapshot({
          schemaVersion: 1,
          revision: row.revision,
          config: JSON.parse(row.config_json!) as Json,
        }).config;
      } catch {
        throw unavailable();
      }
    }
    const secrets = rows
      .filter((r) => r.kind === "secret")
      .map((r) => ({
        providerId: r.provider_id!,
        keyId: r.key_id!,
        nonce: fromHex(r.nonce_hex!),
        ciphertext: fromHex(r.ciphertext_hex!),
        secretRevision: r.secret_revision!,
      }));
    if (
      config &&
      secrets.some((s) => !config!.providers.some((p) => p.id === s.providerId))
    )
      throw unavailable();
    return {
      initialized: !!row.initialized,
      revision: row.revision,
      config,
      secrets,
    };
  }
  async bootstrap(): Promise<Bootstrap> {
    const state = await this.state();
    if (!state.initialized || !state.config)
      throw new ServiceError("NOT_INITIALIZED", 409);
    const secrets = await Promise.all(
      state.config.providers.map(async (p) => {
        const s = state.secrets.find((s) => s.providerId === p.id);
        return {
          providerId: p.id,
          value: s ? await decryptSecret(this.env, s) : null,
        };
      }),
    );
    const result: Bootstrap = {
      snapshot: {
        schemaVersion: 1,
        revision: state.revision,
        config: state.config,
      },
      secrets,
    };
    try {
      validateDocument(
        new TextEncoder().encode(JSON.stringify(result)),
        "bootstrap",
      );
    } catch {
      throw new ServiceError("SECRET_UNAVAILABLE", 503, true);
    }
    return result;
  }
  private async existing(
    input: Operation | Initialize,
    raw: Uint8Array<ArrayBuffer>,
  ): Promise<Receipt | null> {
    const [old] = await this.all<Ledger>(
      "SELECT device_id,sequence,body_hmac,hmac_key_id,receipt_json FROM settings_operations WHERE operation_id=?",
      input.operationId,
    );
    if (!old) return null;
    if (old.device_id !== input.deviceId || old.sequence !== input.sequence)
      throw new ServiceError("OPERATION_ID_REUSED", 409);
    const mac = await fingerprint(this.env, raw, old.hmac_key_id);
    if (!sameDigest(mac.digest, old.body_hmac))
      throw new ServiceError("OPERATION_ID_REUSED", 409);
    try {
      return validateDocument(
        new TextEncoder().encode(old.receipt_json),
        "receipt",
      ) as unknown as Receipt;
    } catch {
      throw unavailable();
    }
  }
  async check(raw: Uint8Array<ArrayBuffer>): Promise<Receipt> {
    const input = parseWriteEnvelope(raw, "operation");
    const receipt = await this.existing(input, raw);
    if (!receipt) throw new ServiceError("OPERATION_NOT_FOUND", 404);
    return receipt;
  }
  async write(
    raw: Uint8Array<ArrayBuffer>,
    kind: "operation" | "initialize",
    actorUserId: number,
    envelopeAccepted?: (id: string) => void,
  ): Promise<Receipt> {
    const input = parseWriteEnvelope(raw, kind);
    envelopeAccepted?.(input.operationId);
    const old = await this.existing(input, raw);
    if (old) return old;
    const mac = await fingerprint(this.env, raw);
    // 两次尝试以内；每个 batch 至多 13 条，包含所有读取总预算不超过 30。
    for (let attempt = 0; attempt < 2; attempt++) {
      const state = await this.state();
      const [device] = await this.all<{ last_sequence: number }>(
        "SELECT last_sequence FROM settings_devices WHERE device_id=?",
        input.deviceId,
      );
      if (device && device.last_sequence >= input.sequence) {
        const applied = await this.existing(input, raw);
        if (applied) return applied;
        throw new ServiceError("SEQUENCE_STALE", 409);
      }
      let next: Snapshot;
      const puts: EncryptedSecret[] = [];
      const clears = new Set<string>();
      const graves: string[] = [];
      if (kind === "initialize") {
        if (state.initialized) {
          const applied = await this.existing(input, raw);
          if (applied) return applied;
          throw new ServiceError("ALREADY_INITIALIZED", 409);
        }
        const init = validateDocument(
          raw,
          "initialize",
        ) as unknown as Initialize;
        next = { schemaVersion: 1, revision: 1, config: init.config };
        for (const s of init.secrets)
          if (s.value !== null)
            puts.push(await encryptSecret(this.env, s.providerId, s.value, 1));
      } else {
        if (!state.initialized || !state.config)
          throw new ServiceError("NOT_INITIALIZED", 409);
        const operation = input as Operation;
        next = validateOperation(
          input as unknown as Json,
          {
            schemaVersion: 1,
            revision: state.revision,
            config: state.config,
          } as unknown as Json,
        );
        // 只查询本操作打算创建的不可复用 ID，不下载整个永久墓碑表。
        const created = Array.isArray(operation.changes)
          ? operation.changes
              .filter((c) => c.type === "create" && c.entity !== "imagePreset")
              .map((c) => {
                const x = c as { entity: string; value: unknown };
                return entityKey(x.entity, x.value as { [key: string]: Json });
              })
          : [];
        const deleted = created.length
          ? (
              await this.all<{ entity_key: string }>(
                "SELECT entity_key FROM settings_deleted_entities WHERE entity_key IN (SELECT value FROM json_each(?))",
                JSON.stringify(created),
              )
            ).map((r) => r.entity_key)
          : [];
        if (deleted.length) throw new ServiceError("ENTITY_DELETED", 409);
        for (const change of operation.changes) {
          if (change.type === "setSecret")
            puts.push(
              await encryptSecret(
                this.env,
                change.providerId,
                change.value,
                next.revision,
              ),
            );
          if (change.type === "clearSecret") clears.add(change.providerId);
          if (change.type === "delete") {
            if (change.target.entity === "provider")
              clears.add(change.target.id);
            if (
              ["provider", "model", "template"].includes(change.target.entity)
            )
              graves.push(
                entityKey(
                  change.target.entity,
                  change.target as unknown as { [key: string]: Json },
                ),
              );
          }
        }
      }
      const receipt: Receipt = {
        schemaVersion: 1,
        operationId: input.operationId,
        deviceId: input.deviceId,
        sequence: input.sequence,
        revision: next.revision,
      };
      const statements = [
        this.stmt(
          `INSERT INTO settings_commit_guard(id,ok) VALUES(1,CASE WHEN EXISTS(SELECT 1 FROM settings_state WHERE id=1 AND schema_version=1 AND revision=? AND initialized=?) AND NOT EXISTS(SELECT 1 FROM settings_devices WHERE device_id=? AND last_sequence>=?) THEN 1 ELSE 0 END)`,
          state.revision,
          state.initialized ? 1 : 0,
          input.deviceId,
          input.sequence,
        ),
        this.stmt(
          "UPDATE settings_state SET revision=?,initialized=1,config_json=? WHERE id=1",
          next.revision,
          JSON.stringify(next.config),
        ),
      ];
      if (clears.size)
        statements.push(
          this.stmt(
            "DELETE FROM settings_secrets WHERE provider_id IN (SELECT value FROM json_each(?))",
            JSON.stringify([...clears]),
          ),
        );
      // BLOB 绑定避免把密钥/密文拼入 SQL；JSON 参数中只包含已加密数据。
      if (puts.length) {
        // 每次至多 64 个秘密；VALUES + BLOB 绑定，12 项一组控制参数及查询数。
        for (let offset = 0; offset < puts.length; offset += 12) {
          const group = puts.slice(offset, offset + 12);
          statements.push(
            this.stmt(
              `INSERT INTO settings_secrets(provider_id,encryption_version,key_id,nonce,ciphertext,secret_revision) VALUES ${group.map(() => "(?,1,?,?,?,?)").join(",")} ON CONFLICT(provider_id) DO UPDATE SET encryption_version=1,key_id=excluded.key_id,nonce=excluded.nonce,ciphertext=excluded.ciphertext,secret_revision=excluded.secret_revision`,
              ...group.flatMap((s) => [
                s.providerId,
                s.keyId,
                blob(s.nonce),
                blob(s.ciphertext),
                s.secretRevision,
              ]),
            ),
          );
        }
      }
      if (graves.length)
        statements.push(
          this.stmt(
            "INSERT INTO settings_deleted_entities(entity_key,deleted_revision) SELECT value,? FROM json_each(?) WHERE true ON CONFLICT(entity_key) DO NOTHING",
            next.revision,
            JSON.stringify(graves),
          ),
        );
      statements.push(
        this.stmt(
          "INSERT INTO settings_devices(device_id,last_sequence,updated_revision) VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET last_sequence=excluded.last_sequence,updated_revision=excluded.updated_revision",
          input.deviceId,
          input.sequence,
          next.revision,
        ),
        this.stmt(
          "INSERT INTO settings_operations(operation_id,device_id,sequence,body_hmac,hmac_key_id,applied_revision,receipt_json,actor_user_id,accepted_at) VALUES(?,?,?,?,?,?,?,?,?)",
          input.operationId,
          input.deviceId,
          input.sequence,
          mac.digest,
          mac.keyId,
          next.revision,
          JSON.stringify(receipt),
          actorUserId,
          new Date().toISOString(),
        ),
        this.stmt("DELETE FROM settings_commit_guard WHERE id=1"),
      );
      this.budget(statements.length);
      try {
        const results = await this.session.batch(statements);
        if (results.some((r) => !r.success)) throw unavailable();
        return receipt;
      } catch {
        // 响应丢失或并发重复可能已提交；先查同一成功账本，再决定是否重试。
        const applied = await this.existing(input, raw);
        if (applied) return applied;
        if (attempt === 1) throw new ServiceError("WRITE_BUSY", 503, true);
      }
    }
    throw new ServiceError("WRITE_BUSY", 503, true);
  }
}
