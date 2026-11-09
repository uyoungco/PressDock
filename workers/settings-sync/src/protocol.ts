/** 协议 v1 的纯验证层；尚未接入部署入口，不访问网络、数据库或凭据库。 */
export const SCHEMA_VERSION = 1;
export const LIMITS = {
  documentBytes: 2 * 1024 * 1024,
  configBytes: 1024 * 1024,
  changes: 128,
  providers: 64,
  models: 1024,
  templates: 128,
  imagePresets: 2048,
} as const;
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectValue = { [key: string]: Json };
export interface Provider {
  id: string;
  displayName: string;
  baseUrl: string;
  protocol: "chatCompletions" | "responses";
  compatibility: {
    maxTokensField: "max_completion_tokens" | "max_tokens";
    systemRole: "system" | "developer";
    sendStore: boolean;
  };
}
export interface Model {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  reasoningEffort: "low" | "medium" | "high" | null;
}
export interface Template {
  id: string;
  purpose: "title" | "pagination";
  name: string;
  systemPrompt: string;
  userPrompt: string;
  modelConfigId: string | null;
  candidateCount: number;
  maxLength: number;
  paginationOptions: {
    minChars: number;
    targetChars: number;
    maxChars: number;
  } | null;
}
export interface ImagePreset {
  channel: string;
  subChannel: string;
  field: "titlePic" | "titlePic2";
  size: { width: number; height: number } | null;
  maxBytes: number | null;
  format: "jpeg" | "png" | "webp" | null;
}
export interface Config {
  providers: Provider[];
  models: Model[];
  templates: Template[];
  imagePresets: ImagePreset[];
  defaults: {
    titleTemplateId: string | null;
    paginationTemplateId: string | null;
  };
  harvest: {
    autoClassify: boolean;
    autoTags: boolean;
    autoSummary: boolean;
    aiAutoPaginate: boolean;
    modelConfigId: string | null;
  };
}
export interface Snapshot {
  schemaVersion: 1;
  revision: number;
  config: Config;
}
export type Entity = "provider" | "model" | "template" | "imagePreset";
export type Target =
  | { entity: "provider" | "model" | "template"; id: string }
  | {
      entity: "imagePreset";
      channel: string;
      subChannel: string;
      field: "titlePic" | "titlePic2";
    }
  | { entity: "defaults" | "harvest" };
export type Change =
  | { type: "create"; entity: "provider"; value: Provider }
  | { type: "create"; entity: "model"; value: Model }
  | { type: "create"; entity: "template"; value: Template }
  | { type: "create"; entity: "imagePreset"; value: ImagePreset }
  | { type: "set"; target: Target; field: string; value: Json }
  | {
      type: "delete";
      target: Exclude<Target, { entity: "defaults" | "harvest" }>;
    }
  | { type: "setSecret"; providerId: string; value: string }
  | { type: "clearSecret"; providerId: string };
export interface Operation {
  schemaVersion: 1;
  operationId: string;
  deviceId: string;
  sequence: number;
  changes: Change[];
}
/** 仅 Rust ↔ Worker 使用，禁止通过普通前端 IPC 返回。 */
export interface SecretValue {
  providerId: string;
  value: string | null;
}
export interface Initialize {
  schemaVersion: 1;
  operationId: string;
  deviceId: string;
  sequence: number;
  config: Config;
  secrets: SecretValue[];
}
export interface Bootstrap {
  snapshot: Snapshot;
  secrets: SecretValue[];
}
export interface Receipt {
  schemaVersion: 1;
  operationId: string;
  deviceId: string;
  sequence: number;
  revision: number;
}
export type Code =
  | "INVALID_DOCUMENT"
  | "UNSUPPORTED_VERSION"
  | "VALIDATION_FAILED"
  | "REFERENCE_NOT_FOUND"
  | "DUPLICATE_ENTITY"
  | "ENTITY_NOT_FOUND"
  | "UNKNOWN_FIELD"
  | "DUPLICATE_CHANGE"
  | "PAYLOAD_TOO_LARGE"
  | "ENTITY_DELETED";
export class ProtocolError extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super(code);
    this.code = code;
  }
}
const fail = (code: Code): never => {
  throw new ProtocolError(code);
};
const ensure = (condition: unknown, code: Code = "VALIDATION_FAILED") => {
  if (!condition) fail(code);
};
const obj = (v: Json): ObjectValue => {
  ensure(v !== null && typeof v === "object" && !Array.isArray(v));
  return v as ObjectValue;
};
function keys(v: Json, names: string[]) {
  const o = obj(v);
  ensure(
    Object.keys(o).length === names.length &&
      names.every((k) => Object.hasOwn(o, k)),
  );
  return o;
}
const trim = (s: string) =>
  s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
const text = (v: Json, max: number, empty = false) =>
  ensure(typeof v === "string" && (empty || !!trim(v)) && [...v].length <= max);
const integer = (v: Json, min: number, max = Number.MAX_SAFE_INTEGER) =>
  ensure(
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max,
  );
const boolean = (v: Json) => ensure(typeof v === "boolean");
const oneOf = (v: Json, values: Json[]) => ensure(values.includes(v));
const nullable = (v: Json, validate: (v: Json) => void) => {
  if (v !== null) validate(v);
};
const byteLength = (v: string) => new TextEncoder().encode(v).length;
const bytes = (v: Json) => byteLength(JSON.stringify(v));
const version = (v: ObjectValue) =>
  ensure(v.schemaVersion === 1, "UNSUPPORTED_VERSION");
const collection: Record<Entity, string> = {
  provider: "providers",
  model: "models",
  template: "templates",
  imagePreset: "imagePresets",
};
const fields: Record<string, string[]> = {
  provider: [
    "displayName",
    "baseUrl",
    "protocol",
    "compatibility.maxTokensField",
    "compatibility.systemRole",
    "compatibility.sendStore",
  ],
  model: [
    "modelId",
    "displayName",
    "contextWindow",
    "maxOutputTokens",
    "reasoningEffort",
  ],
  template: [
    "name",
    "systemPrompt",
    "userPrompt",
    "modelConfigId",
    "candidateCount",
    "maxLength",
    "paginationOptions",
  ],
  imagePreset: ["size", "maxBytes", "format"],
  defaults: ["titleTemplateId", "paginationTemplateId"],
  harvest: [
    "autoClassify",
    "autoTags",
    "autoSummary",
    "aiAutoPaginate",
    "modelConfigId",
  ],
};
function validateEntity(entity: Entity, value: Json) {
  const o = obj(value);
  if (entity === "provider") {
    keys(o, ["id", "displayName", "baseUrl", "protocol", "compatibility"]);
    ensure(typeof o.id === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(o.id));
    text(o.displayName, 100);
    text(o.baseUrl, 2048);
    ensure(byteLength(o.baseUrl as string) <= 2048);
    try {
      const u = new URL(o.baseUrl as string);
      ensure(
        (u.protocol === "https:" ||
          (u.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))) &&
          !!u.hostname &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          !(o.baseUrl as string).includes("?") &&
          !(o.baseUrl as string).includes("#"),
      );
    } catch {
      fail("VALIDATION_FAILED");
    }
    oneOf(o.protocol, ["chatCompletions", "responses"]);
    const c = keys(o.compatibility, [
      "maxTokensField",
      "systemRole",
      "sendStore",
    ]);
    oneOf(c.maxTokensField, ["max_completion_tokens", "max_tokens"]);
    oneOf(c.systemRole, ["system", "developer"]);
    boolean(c.sendStore);
  } else if (entity === "model") {
    keys(o, [
      "id",
      "providerId",
      "modelId",
      "displayName",
      "contextWindow",
      "maxOutputTokens",
      "reasoningEffort",
    ]);
    text(o.id, 100);
    text(o.providerId, 64);
    text(o.modelId, 200);
    text(o.displayName, 100);
    nullable(o.contextWindow, (v) => integer(v, 1, 4294967295));
    nullable(o.maxOutputTokens, (v) => integer(v, 1, 4294967295));
    ensure(
      o.contextWindow === null ||
        o.maxOutputTokens === null ||
        (o.maxOutputTokens as number) <= (o.contextWindow as number),
    );
    oneOf(o.reasoningEffort, [null, "low", "medium", "high"]);
  } else if (entity === "template") {
    keys(o, [
      "id",
      "purpose",
      "name",
      "systemPrompt",
      "userPrompt",
      "modelConfigId",
      "candidateCount",
      "maxLength",
      "paginationOptions",
    ]);
    text(o.id, 100);
    text(o.name, 100);
    text(o.systemPrompt, 20000, true);
    text(o.userPrompt, 20000);
    oneOf(o.purpose, ["title", "pagination"]);
    nullable(o.modelConfigId, (v) => text(v, 100));
    integer(o.candidateCount, 1, 10);
    integer(o.maxLength, 1, 200);
    for (const prompt of [o.systemPrompt, o.userPrompt] as string[]) {
      const allowed =
        o.purpose === "title"
          ? ["title", "content", "count", "max_length", "requirements"]
          : ["title", "blocks"];
      const pattern = /\{\{([\s\S]*?)\}\}/g;
      for (const m of prompt.matchAll(pattern))
        ensure(allowed.includes(trim(m[1])));
      ensure(!prompt.replace(pattern, "").includes("{{"));
    }
    if (o.paginationOptions !== null) {
      const p = keys(o.paginationOptions, [
        "minChars",
        "targetChars",
        "maxChars",
      ]);
      for (const v of Object.values(p)) integer(v, 1, 10000);
      ensure(
        (p.minChars as number) <= (p.targetChars as number) &&
          (p.targetChars as number) <= (p.maxChars as number),
      );
    }
    ensure(o.purpose !== "pagination" || o.paginationOptions !== null);
  } else {
    keys(o, ["channel", "subChannel", "field", "size", "maxBytes", "format"]);
    text(o.channel, 1024);
    text(o.subChannel, 1024);
    oneOf(o.field, ["titlePic", "titlePic2"]);
    nullable(o.maxBytes, (v) => integer(v, 1, 20971520));
    oneOf(o.format, [null, "jpeg", "png", "webp"]);
    if (o.size !== null) {
      const s = keys(o.size, ["width", "height"]);
      integer(s.width, 1, 16384);
      integer(s.height, 1, 16384);
      ensure((s.width as number) * (s.height as number) <= 24000000);
    }
  }
}
export function entityKey(entity: string, o: ObjectValue) {
  return JSON.stringify(
    entity === "imagePreset"
      ? [entity, o.channel, o.subChannel, o.field]
      : [entity, o.id],
  );
}
function validateConfig(value: Json) {
  const c = keys(value, [
    "providers",
    "models",
    "templates",
    "imagePresets",
    "defaults",
    "harvest",
  ]);
  ensure(bytes(c) <= LIMITS.configBytes, "PAYLOAD_TOO_LARGE");
  for (const [entity, name] of Object.entries(collection) as [
    Entity,
    keyof typeof LIMITS,
  ][]) {
    const list = c[name];
    ensure(Array.isArray(list) && list.length <= LIMITS[name]);
    const seen = new Set<string>();
    for (const item of list as Json[]) {
      validateEntity(entity, item);
      const key = entityKey(entity, obj(item));
      ensure(!seen.has(key), "DUPLICATE_ENTITY");
      seen.add(key);
    }
  }
  const providers = new Set((c.providers as ObjectValue[]).map((p) => p.id));
  const models = new Set((c.models as ObjectValue[]).map((m) => m.id));
  const pairs = new Set<string>();
  for (const m of c.models as ObjectValue[]) {
    ensure(providers.has(m.providerId), "REFERENCE_NOT_FOUND");
    const pair = JSON.stringify([m.providerId, m.modelId]);
    ensure(!pairs.has(pair), "DUPLICATE_ENTITY");
    pairs.add(pair);
  }
  for (const t of c.templates as ObjectValue[])
    ensure(
      t.modelConfigId === null || models.has(t.modelConfigId),
      "REFERENCE_NOT_FOUND",
    );
  const defaults = keys(c.defaults, [
    "titleTemplateId",
    "paginationTemplateId",
  ]);
  for (const purpose of ["title", "pagination"]) {
    const id = defaults[`${purpose}TemplateId`];
    nullable(id, (v) => text(v, 100));
    ensure(
      id === null ||
        (c.templates as ObjectValue[]).some(
          (t) => t.id === id && t.purpose === purpose,
        ),
      "REFERENCE_NOT_FOUND",
    );
  }
  const h = keys(c.harvest, [
    "autoClassify",
    "autoTags",
    "autoSummary",
    "aiAutoPaginate",
    "modelConfigId",
  ]);
  for (const k of ["autoClassify", "autoTags", "autoSummary", "aiAutoPaginate"])
    boolean(h[k]);
  nullable(h.modelConfigId, (v) => {
    text(v, 100);
    ensure(byteLength(v as string) <= 100);
  });
  ensure(
    h.modelConfigId === null || models.has(h.modelConfigId),
    "REFERENCE_NOT_FOUND",
  );
}
export function validateSnapshot(input: Json): Snapshot {
  const s = keys(input, ["schemaVersion", "revision", "config"]);
  version(s);
  integer(s.revision, 1);
  validateConfig(s.config);
  return input as unknown as Snapshot;
}
function envelope(o: ObjectValue) {
  version(o);
  for (const k of ["operationId", "deviceId"])
    ensure(
      typeof o[k] === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          o[k] as string,
        ),
    );
  integer(o.sequence, 1);
}
function secret(v: Json) {
  text(v, 8192);
  ensure(byteLength(v as string) <= 8192 && !/\p{Cc}/u.test(v as string));
}
function secrets(input: Json, config: ObjectValue) {
  ensure(Array.isArray(input));
  const ids = new Set((config.providers as ObjectValue[]).map((p) => p.id));
  const seen = new Set<Json>();
  for (const item of input as Json[]) {
    const s = keys(item, ["providerId", "value"]);
    ensure(ids.has(s.providerId), "REFERENCE_NOT_FOUND");
    ensure(!seen.has(s.providerId), "DUPLICATE_ENTITY");
    seen.add(s.providerId);
    nullable(s.value, secret);
  }
  ensure(seen.size === ids.size);
}
function target(input: Json) {
  const t = obj(input);
  ensure(
    typeof t.entity === "string" && Object.hasOwn(fields, t.entity),
    "UNKNOWN_FIELD",
  );
  if (t.entity === "imagePreset") {
    keys(t, ["entity", "channel", "subChannel", "field"]);
    text(t.channel, 1024);
    text(t.subChannel, 1024);
    oneOf(t.field, ["titlePic", "titlePic2"]);
  } else if (t.entity === "defaults" || t.entity === "harvest")
    keys(t, ["entity"]);
  else {
    keys(t, ["entity", "id"]);
    text(t.id, t.entity === "provider" ? 64 : 100);
  }
  return t;
}
export function validateOperation(
  input: Json,
  current: Json,
  deletedKeys: string[] = [],
): Snapshot {
  validateSnapshot(current);
  const o = keys(input, [
    "schemaVersion",
    "operationId",
    "deviceId",
    "sequence",
    "changes",
  ]);
  envelope(o);
  ensure(
    Array.isArray(o.changes) &&
      o.changes.length > 0 &&
      o.changes.length <= LIMITS.changes,
  );
  const next = structuredClone(current) as ObjectValue;
  const c = obj(next.config);
  const touched = new Map<string, string[]>();
  const secretIds = new Set<Json>();
  const touch = (key: string, field: string) => {
    const old = touched.get(key) ?? [];
    ensure(
      !old.includes(field) &&
        !old.includes("*") &&
        (field !== "*" || old.length === 0),
      "DUPLICATE_CHANGE",
    );
    touched.set(key, [...old, field]);
  };
  for (const value of o.changes as Json[]) {
    const change = obj(value);
    if (change.type === "setSecret" || change.type === "clearSecret") {
      keys(
        change,
        change.type === "setSecret"
          ? ["type", "providerId", "value"]
          : ["type", "providerId"],
      );
      text(change.providerId, 64);
      ensure(!secretIds.has(change.providerId), "DUPLICATE_CHANGE");
      secretIds.add(change.providerId);
      if (change.type === "setSecret") secret(change.value);
      continue;
    }
    if (change.type === "create") {
      keys(change, ["type", "entity", "value"]);
      ensure(
        typeof change.entity === "string" &&
          Object.hasOwn(collection, change.entity),
        "UNKNOWN_FIELD",
      );
      const entity = change.entity as Entity;
      validateEntity(entity, change.value);
      const key = entityKey(entity, obj(change.value));
      touch(key, "*");
      ensure(!deletedKeys.includes(key), "ENTITY_DELETED");
      const list = c[collection[entity]] as ObjectValue[];
      ensure(
        !list.some((v) => entityKey(entity, v) === key),
        "DUPLICATE_ENTITY",
      );
      list.push(structuredClone(obj(change.value)));
      continue;
    }
    ensure(change.type === "set" || change.type === "delete", "UNKNOWN_FIELD");
    keys(
      change,
      change.type === "set"
        ? ["type", "target", "field", "value"]
        : ["type", "target"],
    );
    const t = target(change.target);
    const entity = t.entity as string;
    const singleton = entity === "defaults" || entity === "harvest";
    const key = singleton ? entity : entityKey(entity, t);
    if (change.type === "set")
      ensure(
        typeof change.field === "string" &&
          fields[entity].includes(change.field),
        "UNKNOWN_FIELD",
      );
    else ensure(!singleton, "UNKNOWN_FIELD");
    touch(key, change.type === "set" ? (change.field as string) : "*");
    const list = singleton
      ? []
      : (c[collection[entity as Entity]] as ObjectValue[]);
    const index = list.findIndex((v) => entityKey(entity, v) === key);
    ensure(singleton || index >= 0, "ENTITY_NOT_FOUND");
    if (change.type === "delete") list.splice(index, 1);
    else {
      const parts = (change.field as string).split(".");
      const row = singleton ? obj(c[entity]) : list[index];
      const dest = parts.length === 2 ? obj(row[parts[0]]) : row;
      dest[parts.at(-1)!] = structuredClone(change.value);
    }
  }
  validateConfig(c);
  for (const id of secretIds)
    ensure(
      (c.providers as ObjectValue[]).some((p) => p.id === id),
      "REFERENCE_NOT_FOUND",
    );
  integer((next.revision as number) + 1, 1);
  next.revision = (next.revision as number) + 1;
  return next as unknown as Snapshot;
}
export type DocumentKind =
  "snapshot" | "operation" | "initialize" | "bootstrap" | "receipt";
/** 所有接收端均先限制原始 UTF-8 字节；错误不携带原文或密钥。 */
export function decodeDocument(raw: Uint8Array): Json {
  ensure(raw.byteLength <= LIMITS.documentBytes, "PAYLOAD_TOO_LARGE");
  let input: Json;
  try {
    input = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw),
    ) as Json;
    // Rust JSON 解码拒绝孤立 UTF-16 代理项；JS 保持相同行为。
    const check = (v: Json, depth = 0): void => {
      ensure(depth <= 32, "INVALID_DOCUMENT");
      if (typeof v === "number") ensure(Number.isFinite(v), "INVALID_DOCUMENT");
      else if (typeof v === "string")
        ensure(
          !/[\uD800-\uDFFF]/u.test(
            v.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""),
          ),
          "INVALID_DOCUMENT",
        );
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          check(k, depth);
          check(x, depth + 1);
        }
      }
    };
    check(input);
  } catch {
    fail("INVALID_DOCUMENT");
  }
  return input!;
}
export function parseWriteEnvelope(
  raw: Uint8Array,
  kind: "operation" | "initialize",
): Operation | Initialize {
  const input = decodeDocument(raw);
  const o = keys(
    input,
    kind === "operation"
      ? ["schemaVersion", "operationId", "deviceId", "sequence", "changes"]
      : [
          "schemaVersion",
          "operationId",
          "deviceId",
          "sequence",
          "config",
          "secrets",
        ],
  );
  envelope(o);
  return input as unknown as Operation | Initialize;
}
export function validateDocument(
  raw: Uint8Array,
  kind: DocumentKind,
  current?: Json,
  deletedKeys: string[] = [],
): Json {
  const input = decodeDocument(raw);
  if (kind === "snapshot") return validateSnapshot(input!) as unknown as Json;
  if (kind === "operation") {
    ensure(current !== undefined, "INVALID_DOCUMENT");
    return validateOperation(input!, current!, deletedKeys) as unknown as Json;
  }
  if (kind === "receipt") {
    const o = keys(input!, [
      "schemaVersion",
      "operationId",
      "deviceId",
      "sequence",
      "revision",
    ]);
    envelope(o);
    integer(o.revision, 1);
  } else if (kind === "initialize") {
    const o = keys(input!, [
      "schemaVersion",
      "operationId",
      "deviceId",
      "sequence",
      "config",
      "secrets",
    ]);
    envelope(o);
    validateConfig(o.config);
    secrets(o.secrets, obj(o.config));
  } else {
    const o = keys(input!, ["snapshot", "secrets"]);
    const s = validateSnapshot(o.snapshot);
    secrets(o.secrets, obj((s as unknown as ObjectValue).config));
  }
  return input!;
}
