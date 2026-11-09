import { ServiceError } from "./service-error.ts";

export interface SecretEnv {
  SETTINGS_ENCRYPTION_KEYRING: string;
  SETTINGS_HMAC_KEYRING: string;
  SETTINGS_ENVIRONMENT: string;
}
interface Keyring {
  current: string;
  keys: Record<string, string>;
}
function keyring(raw: string): Keyring {
  try {
    const r = JSON.parse(raw) as Keyring;
    if (
      !r.current ||
      !/^[a-zA-Z0-9-]{1,64}$/.test(r.current) ||
      !r.keys ||
      !Object.hasOwn(r.keys, r.current)
    )
      throw new Error();
    return r;
  } catch {
    throw new ServiceError("SECRET_UNAVAILABLE", 503, true);
  }
}
function bytes(encoded: string): Uint8Array<ArrayBuffer> {
  try {
    const b = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    if (b.length !== 32) throw new Error();
    return b;
  } catch {
    throw new ServiceError("SECRET_UNAVAILABLE", 503, true);
  }
}
function encoded(b: Uint8Array) {
  return btoa(String.fromCharCode(...b));
}
export interface EncryptedSecret {
  providerId: string;
  keyId: string;
  nonce: string;
  ciphertext: string;
  secretRevision: number;
}
function aad(env: SecretEnv, providerId: string, revision: number) {
  if (!env.SETTINGS_ENVIRONMENT)
    throw new ServiceError("SECRET_UNAVAILABLE", 503, true);
  return new TextEncoder().encode(
    JSON.stringify([env.SETTINGS_ENVIRONMENT, providerId, revision, 1]),
  );
}
export async function encryptSecret(
  env: SecretEnv,
  providerId: string,
  value: string,
  revision: number,
): Promise<EncryptedSecret> {
  const r = keyring(env.SETTINGS_ENCRYPTION_KEYRING);
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(r.keys[r.current]),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aad(env, providerId, revision),
      tagLength: 128,
    },
    key,
    new TextEncoder().encode(value),
  );
  return {
    providerId,
    keyId: r.current,
    nonce: encoded(nonce),
    ciphertext: encoded(new Uint8Array(ciphertext)),
    secretRevision: revision,
  };
}
export async function decryptSecret(
  env: SecretEnv,
  secret: EncryptedSecret,
): Promise<string> {
  try {
    const r = keyring(env.SETTINGS_ENCRYPTION_KEYRING);
    if (!Object.hasOwn(r.keys, secret.keyId)) throw new Error();
    const key = await crypto.subtle.importKey(
      "raw",
      bytes(r.keys[secret.keyId]),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const decode = (s: string) =>
      Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(secret.nonce),
        additionalData: aad(env, secret.providerId, secret.secretRevision),
        tagLength: 128,
      },
      key,
      decode(secret.ciphertext),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plain);
  } catch {
    throw new ServiceError("SECRET_UNAVAILABLE", 503, true);
  }
}
export async function fingerprint(
  env: SecretEnv,
  raw: Uint8Array<ArrayBuffer>,
  keyId?: string,
) {
  const r = keyring(env.SETTINGS_HMAC_KEYRING);
  const id = keyId ?? r.current;
  if (!Object.hasOwn(r.keys, id))
    throw new ServiceError("SECRET_UNAVAILABLE", 503, true);
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(r.keys[id]),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
  return {
    keyId: id,
    digest: [...mac].map((b) => b.toString(16).padStart(2, "0")).join(""),
  };
}
export function sameDigest(a: string, b: string) {
  if (a.length !== 64 || b.length !== 64) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
