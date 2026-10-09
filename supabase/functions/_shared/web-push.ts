/**
 * Web Push for Supabase Edge Functions, on WebCrypto only.
 *
 * Browsers take pushes in a private format (RFC 8291: ECDH P-256 + HKDF +
 * AES-128-GCM) and the request has to be signed with a VAPID JWT (RFC 8292).
 * Rather than pull `web-push` and its Node built-ins into Deno, this implements
 * both directly — the crypto is short, and it keeps the function's cold start
 * small.
 *
 * Keys come from the function's environment:
 *   VAPID_PUBLIC_KEY   base64url, 65 bytes (0x04 || x || y)
 *   VAPID_PRIVATE_KEY  base64url, 32 bytes
 *   VAPID_SUBJECT      "mailto:…" or an origin (who is sending)
 */

export type WebPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

export type WebPushResult = {
  ok: boolean;
  status: number;
  /** 404/410 mean the browser dropped the subscription — disable the token. */
  expired: boolean;
};

/** Deno's global, typed locally so this file type-checks outside the Deno toolchain. */
const deno = (globalThis as unknown as {
  Deno?: { env: { get: (key: string) => string | undefined } };
}).Deno;

type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const RECORD_SIZE = 4096;
const DEFAULT_TTL = 60 * 60 * 24 * 28; // four weeks, the maximum browsers accept.

function base64UrlToBytes(value: string): Bytes {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...parts: Uint8Array[]): Bytes {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** HKDF-Extract + HKDF-Expand in one call, which is what WebCrypto's HKDF is. */
async function hkdf(
  salt: Uint8Array,
  inputKeyMaterial: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Bytes> {
  const key = await crypto.subtle.importKey(
    "raw",
    inputKeyMaterial as Bytes,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as Bytes, info: info as Bytes },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export function vapidKeysFromEnv(): VapidKeys | null {
  const publicKey = deno?.env.get("VAPID_PUBLIC_KEY") ?? "";
  const privateKey = deno?.env.get("VAPID_PRIVATE_KEY") ?? "";
  const subject = deno?.env.get("VAPID_SUBJECT") ?? "mailto:support@sheree.app";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

/**
 * RFC 8291 encryption: the message is sealed with a key the browser can
 * recompute from its own private key, and the ephemeral public key rides along
 * in the aes128gcm header so it can.
 */
async function encryptPayload(subscription: WebPushSubscription, message: string): Promise<Bytes> {
  const clientPublic = base64UrlToBytes(subscription.keys.p256dh);
  const authSecret = base64UrlToBytes(subscription.keys.auth);

  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const ephemeralPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", ephemeral.publicKey),
  );
  const clientKey = await crypto.subtle.importKey(
    "raw",
    clientPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, ephemeral.privateKey, 256),
  );

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info\0" || ua_public || as_public)
  const ikm = await hkdf(
    authSecret,
    sharedSecret,
    concatBytes(
      encoder.encode("WebPush: info"),
      new Uint8Array([0]),
      clientPublic,
      ephemeralPublic,
    ),
    32,
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(
    salt,
    ikm,
    concatBytes(encoder.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    concatBytes(encoder.encode("Content-Encoding: nonce"), new Uint8Array([0])),
    12,
  );

  // 0x02 marks the final record; without it browsers reject the payload.
  const plaintext = concatBytes(encoder.encode(message), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext),
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE);

  return concatBytes(
    salt,
    recordSize,
    new Uint8Array([ephemeralPublic.length]),
    ephemeralPublic,
    ciphertext,
  );
}

/**
 * Signed VAPID header. The signature must be a raw r||s pair, which is what
 * WebCrypto's ECDSA returns.
 */
async function vapidAuthorization(subscription: WebPushSubscription, keys: VapidKeys) {
  const audience = new URL(subscription.endpoint).origin;
  const publicBytes = base64UrlToBytes(keys.publicKey);
  if (publicBytes.length !== 65) throw new Error("VAPID_PUBLIC_KEY must be a 65-byte point.");

  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: keys.subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;

  const signingKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: bytesToBase64Url(publicBytes.slice(1, 33)),
      y: bytesToBase64Url(publicBytes.slice(33, 65)),
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      encoder.encode(signingInput),
    ),
  );

  return `vapid t=${signingInput}.${bytesToBase64Url(signature)}, k=${keys.publicKey}`;
}

export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: Record<string, unknown>,
  keys: VapidKeys,
  options: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high" } = {},
): Promise<WebPushResult> {
  const body = await encryptPayload(subscription, JSON.stringify(payload));
  const authorization = await vapidAuthorization(subscription, keys);

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(options.ttl ?? DEFAULT_TTL),
      Urgency: options.urgency ?? "normal",
    },
    body,
  });

  return {
    ok: response.ok,
    status: response.status,
    expired: response.status === 404 || response.status === 410,
  };
}
