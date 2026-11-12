// The source adapter seam — the TypeScript mirror of
// AsciiChem::Resolver::Adapter. A source declares its name, its
// supported conventions and its attribution, and answers
// `fetchRecord`; everything around it (the TTL cache, provenance
// stamping) is `resolve`.
//
// The transport (`Fetch`) is injectable so specs and the conformance
// runner run offline on recorded fixtures — the same seam as the Ruby
// specs' injected fetch Structs and the Rust `Fetch` trait. `NetFetch`
// is the live default: the platform fetch (Node 20+ global), 5s
// connect / 10s read timeouts, at most three redirects — the Ruby
// NetFetch posture.
import { AsciiChemError } from "../errors.js";
import { Molecule } from "../model.js";
import { parseSmiles } from "../smiles.js";
import type { Provenance, ResolverIdentifier, Substance } from "./substance.js";
import { stampedProvenance, type Clock, systemClock } from "./timestamp.js";
import { Cache, type CacheDirOptions } from "./cache.js";

export class ResolverError extends AsciiChemError {}

// The transport seam: the body string on success, null for a
// not-found answer (HTTP 404) — sources legitimately answer "unknown
// substance" — and a thrown ResolverError for every other outcome.
// `headers` are the adapter-declared request headers.
export interface Fetch {
  get(url: string, headers: Record<string, string>): Promise<string | null>;
}

// Minimal HTTP transport over the platform fetch. No retries: PubChem
// asks for politeness, and every adapter's failure posture already
// isolates one dead endpoint. The transport may add its own
// User-Agent; adapter headers ride as declared.
export class NetFetch implements Fetch {
  async get(url: string, headers: Record<string, string>): Promise<string | null> {
      const response = await fetch(url, {
        headers: { "User-Agent": "asciichem-resolver", ...headers },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return await response.text();
      if (response.status === 404) return null;
      throw new ResolverError(`HTTP ${response.status}: ${response.statusText}`);
  }
}

// Percent-encoding for URL path/query values, byte-for-byte the Ruby
// `CGI.escape` table: unreserved alphanumerics plus `_`, `.`, `-` pass
// through, space becomes `+`, everything else (byte-wise, so
// multi-byte UTF-8 splits) becomes `%XX` uppercase.
export function cgiEscape(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let escaped = "";
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    if (/[a-zA-Z0-9_.-]/.test(char)) escaped += char;
    else if (char === " ") escaped += "+";
    else escaped += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return escaped;
}

export interface ResolveOptions {
  fetch?: Fetch;
  cache?: Cache;
  // Cache directory override (specs use a temp dir; the default is
  // the user cache dir — never the package install dir).
  cacheDir?: CacheDirOptions;
  refresh?: boolean;
  // The clock for provenance stamping (live resolution stamps the
  // real instant; replayed fixtures pin theirs).
  clock?: Clock;
}

export interface ResolveArgs {
  value: string;
  convention: string;
}

// A source adapter. Shipped sources subclass this and register into
// the registry; extension sources register the same shape.
export abstract class Adapter {
  // The source name — the registry key and the provenance `source`.
  abstract get sourceName(): string;

  // The identifier conventions this source answers.
  abstract get supportedConventions(): readonly string[];

  // The source's required attribution (licence terms — CAS Common
  // Chemistry's CC BY-NC 4.0 line must survive into the rendered
  // document). undefined when the source name itself is the whole
  // story.
  attribution(): string | undefined {
    return undefined;
  }

  supports(convention: string): boolean {
    return this.supportedConventions.includes(convention);
  }

  // The record this source answers for (value, convention), or null
  // when it does not know the substance — not-found is null, not an
  // error, because sources legitimately answer unknown during
  // multi-source resolution.
  abstract fetchRecord(
    value: string,
    convention: string,
    context: { fetch: Fetch; clock: Clock },
  ): Promise<Substance | null>;

  // The provenance stamped on identifiers that arrive without one.
  defaultProvenance(clock: Clock): Provenance {
    return stampedProvenance(this.sourceName, this.attribution(), clock);
  }

  // Cache-aware resolution around `fetchRecord`: serve from the TTL
  // cache unless `refresh`, cache the answer when there is one, and
  // stamp identifiers that arrived without provenance.
  async resolve(
    { value, convention }: ResolveArgs,
    { fetch, cache, cacheDir, refresh, clock }: ResolveOptions = {},
  ): Promise<Substance | null> {
    const chosenClock = clock ?? systemClock();
    const chosenCache = cache ?? new Cache(cacheDir);
    const chosenFetch = fetch ?? new NetFetch();
    const key = chosenCache.keyFor(this.sourceName, convention, value);

    if (!refresh) {
      const cached = await chosenCache.read(key);
      if (cached !== null) return cached;
    }

    const substance = await this.fetchRecord(value, convention, { fetch: chosenFetch, clock: chosenClock });
    if (substance !== null) {
      const defaultProvenance = this.defaultProvenance(chosenClock);
      for (const identifier of substance.identifiers as ResolverIdentifier[]) {
        if (identifier.provenance === null) identifier.provenance = defaultProvenance;
      }
      await chosenCache.write(key, substance);
    }
    return substance;
  }
}

// Best-effort structure from a source SMILES: parsed when the SMILES
// sits within the supported subset, null otherwise — the SMILES stays
// available as an identifier, nothing is dropped. Shared by all three
// shipped adapters.
export function parseStructure(smiles: string | undefined): Molecule | null {
  if (smiles === undefined) return null;
  try {
    const formula = parseSmiles(smiles);
    const molecule = formula.nodes.find((node): node is Molecule => node instanceof Molecule);
    return molecule ?? null;
  } catch {
    return null;
  }
}
