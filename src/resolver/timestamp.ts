// UTC timestamps for provenance and cache entries — the same
// second-precision `YYYY-MM-DDTHH:MM:SSZ` form the Ruby resolver
// stamps (`Time.now.utc.strftime`). The clock is injectable: live
// resolution uses the real clock, replayed fixtures pin the instant.
import type { Provenance } from "./substance.js";

// The current UTC instant, second precision, wire form.
export function nowUtc(): string {
  return formatUtc(Math.floor(Date.now() / 1000));
}

// Formats a unix-epoch second count as `YYYY-MM-DDTHH:MM:SSZ`.
export function formatUtc(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// The clock seam: answers the current UTC instant in wire form.
export type Clock = () => string;

export function systemClock(): Clock {
  return nowUtc;
}

// Stamps a provenance with the clock's instant (the adapters'
// default_provenance).
export function stampedProvenance(
  source: string,
  attribution: string | undefined,
  clock: Clock,
): Provenance {
  return {
    source,
    retrievedAt: clock(),
    ...(attribution !== undefined ? { attribution } : {}),
  };
}
