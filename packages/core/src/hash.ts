import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 as nobleSha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/** Canonical JSON: stable key order so identical data hashes identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/** keccak256 hex (0x-prefixed) of a UTF-8 string or bytes. */
export function keccak256(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? utf8ToBytes(data) : data;
  return `0x${bytesToHex(keccak_256(bytes))}`;
}

/** sha256 hex (0x-prefixed) of a UTF-8 string or bytes. */
export function sha256(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? utf8ToBytes(data) : data;
  return `0x${bytesToHex(nobleSha256(bytes))}`;
}

/** Content commitment for a response payload (content-addressed mode). */
export function commitment(payload: unknown): string {
  return keccak256(canonicalJson(payload));
}
