// Resolution cache in the USER cache dir (never the package install
// dir — library packages are immutable after installation): entries
// carry source, retrieved-at, attribution, TTL. The key is
// sha256("source:convention:value") — the shared caching contract the
// corpus's resolver family pins (`keyFormula`).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Substance, type Substance as SubstanceValue } from "./substance.js";

export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // chemistry identifiers are stable

export interface CacheDirOptions {
  // Base cache directory. Default: $XDG_CACHE_HOME or ~/.cache.
  base?: string;
  // The sub-path under the base (default asciichem/resolver).
  subPath?: string;
  // TTL in seconds (default 7 days).
  ttlSeconds?: number;
}

function defaultBase(): string {
  return process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
}

interface CacheEntry {
  cached_at: string;
  ttl_seconds: number;
  substance: unknown;
}

export class Cache {
  readonly dir: string;
  readonly ttlSeconds: number;

  constructor(options: CacheDirOptions = {}) {
    this.dir = join(options.base ?? defaultBase(), options.subPath ?? "asciichem/resolver");
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  // The shared key formula: sha256("source:convention:value").
  keyFor(source: string, convention: string, value: string): string {
    return createHash("sha256").update(`${source}:${convention}:${value}`).digest("hex");
  }

  // The cached substance, or null on miss/expiry/corruption (a broken
  // entry re-resolves; it never surfaces as an error).
  async read(key: string): Promise<SubstanceValue | null> {
    const path = join(this.dir, `${key}.json`);
    if (!existsSync(path)) return null;
    try {
      const entry = JSON.parse(readFileSync(path, "utf8")) as CacheEntry;
      if (this.isStale(entry)) return null;
      return Substance.fromWire(entry.substance as Parameters<typeof Substance.fromWire>[0]);
    } catch {
      return null;
    }
  }

  async write(key: string, substance: Substance): Promise<Substance> {
    mkdirSync(this.dir, { recursive: true });
    const entry: CacheEntry = {
      cached_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      ttl_seconds: this.ttlSeconds,
      substance: substance.toWire(),
    };
    writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(entry, null, 2));
    return substance;
  }

  private isStale(entry: CacheEntry): boolean {
    const cachedAt = Date.parse(`${entry.cached_at}`);
    if (Number.isNaN(cachedAt)) return true;
    return Date.now() - cachedAt > (entry.ttl_seconds ?? this.ttlSeconds) * 1000;
  }
}
