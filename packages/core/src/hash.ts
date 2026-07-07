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

/**
 * Decimal string → micro-units bigint (6 decimals), e.g. "50000.25" → 50000250000n.
 * Deterministic integer math — this is the scaling used for on-chain numeric
 * consensus values (i64 LE).
 */
export function decimalToMicro(value: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`not a decimal: ${value}`);
  const [, sign, whole, frac = ""] = m;
  const fracPadded = (frac + "000000").slice(0, 6);
  if (frac.length > 6 && BigInt(frac.slice(6)) !== 0n) {
    throw new Error(`more than 6 decimal places: ${value}`);
  }
  const micro = BigInt(whole!) * 1_000_000n + BigInt(fracPadded);
  return sign === "-" ? -micro : micro;
}

/** Micro-units bigint → decimal string, e.g. 50000250000n → "50000.25". */
export function microToDecimal(micro: bigint): string {
  const sign = micro < 0n ? "-" : "";
  const abs = micro < 0n ? -micro : micro;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}
