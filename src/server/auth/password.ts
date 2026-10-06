/**
 * PBKDF2-SHA256 password hashing via WebCrypto. 100k iterations is the Workers runtime
 * maximum. Format: pbkdf2$<iterations>$<salt b64url>$<hash b64url>
 */
import { base64UrlToBytes, bytesToBase64Url, timingSafeEqual } from "@/server/lib/crypto";

const ITERATIONS = 100_000;
const KEY_BITS = 256;
const enc = new TextEncoder();

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = ITERATIONS): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltStr, hashStr] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterStr || !saltStr || !hashStr) return false;
  const iterations = Number(iterStr);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
  const expected = base64UrlToBytes(hashStr);
  const actual = await derive(password, base64UrlToBytes(saltStr), iterations);
  return timingSafeEqual(actual, expected);
}

/** A precomputed hash used to keep login timing uniform when the user does not exist. */
export const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
