// CAS Common Chemistry source adapter (TODO.impl 40; TODO.v2 07).
//
// License posture (maintainer decision 2026-11-11): Common Chemistry
// data is CC BY-NC 4.0 — acceptable to enable by default; every result
// carries the required attribution, and the citation track carries it
// into rendered documents. Documents that must stay NC-free limit
// sources with `ResolverRegistry.resolveAll({ sources })`.
//
// API access: CAS key-gated the API (401 without a key; request one at
// cas.org/services/commonchemistry-api). The access email defines the
// contract: GET /direct-api/detail with the token as the X-API-KEY
// header plus x-origin and accept headers. The key comes per instance
// (`apiKey:`), from COMMON_CHEMISTRY_API_KEY, or from
// ~/.config/cas-common-chemistry-api.key (the token's stored
// location). Tokens are personal and expire after 12 months (CAS
// emails a renewal notice). Without a key, live lookups answer 401
// and the resolver skips this source; seeded caches keep working.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { ResolverError, Adapter, cgiEscape, parseStructure, type Fetch } from "./adapter.js";
import type { Clock } from "./timestamp.js";
import { Substance, type ResolverIdentifier, type ResolverProperty } from "./substance.js";

const BASE = "https://commonchemistry.cas.org/direct-api/detail";
const ORIGIN = "https://commonchemistry.cas.org/api-overview";
const KEY_FILE = `${homedir()}/.config/cas-common-chemistry-api.key`;

// The request URL — pinned byte-exactly by the corpus.
export function commonChemistryUrl(value: string): string {
  return `${BASE}?cas_rn=${cgiEscape(value)}`;
}

// The adapter-declared request headers. The `{api-key}` placeholder of
// the recorded fixtures maps to the X-API-KEY header, sent only when a
// key is configured.
export function commonChemistryHeaders(apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-origin": ORIGIN,
  };
  if (apiKey !== null) headers["X-API-KEY"] = apiKey;
  return headers;
}

// Explicit null means no key; the env/file lookup runs only when the
// argument is omitted (undefined).
export function defaultApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.COMMON_CHEMISTRY_API_KEY;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  try {
    return readFileSync(KEY_FILE, "utf8").trim() || null;
  } catch {
    return null;
  }
}

interface CommonChemistryDetail {
  rn?: string;
  name?: string;
  formula?: string;
  molecularMass?: number;
  smiles?: string;
  inchi?: string;
  inchikey?: string;
  iupacName?: string;
}

export class CommonChemistryAdapter extends Adapter {
  readonly apiKey: string | null;

  constructor(apiKey: string | null | undefined = defaultApiKey()) {
    super();
    this.apiKey = apiKey ?? null;
  }

  get sourceName(): string {
    return "common_chemistry";
  }

  get supportedConventions(): readonly string[] {
    return ["cas"];
  }

  attribution(): string {
    return "CAS Common Chemistry (CC BY-NC 4.0)";
  }

  async fetchRecord(
    value: string,
    _convention: string,
    { fetch, clock }: { fetch: Fetch; clock: Clock },
  ): Promise<Substance | null> {
    const headers = commonChemistryHeaders(this.apiKey);
    const body = await fetch.get(commonChemistryUrl(value), headers);
    if (body === null) return null;

    let data: CommonChemistryDetail;
    try {
      data = JSON.parse(body) as CommonChemistryDetail;
    } catch (error) {
      throw new ResolverError(`common_chemistry returned malformed JSON: ${(error as Error).message}`);
    }
    if (data.rn === undefined) return null;
    return substanceFromDetail(data, this.defaultProvenance(clock));
  }
}

function substanceFromDetail(
  data: CommonChemistryDetail,
  provenance: ReturnType<Adapter["defaultProvenance"]>,
): Substance | null {
  if (data.rn === undefined) return null;
  const identifiers: ResolverIdentifier[] = [{ value: data.rn, convention: "cas", provenance }];
  addIdentifier(identifiers, data.inchikey, "inchikey", provenance);
  addIdentifier(identifiers, data.smiles, "canonical-smiles", provenance);
  addIdentifier(identifiers, data.inchi, "inchi", provenance);
  addIdentifier(identifiers, data.iupacName, "iupac-name", provenance);

  const properties: ResolverProperty[] = [];
  if (data.formula !== undefined) {
    properties.push({ name: "molecular-formula", value: data.formula, provenance });
  }
  if (data.molecularMass !== undefined) {
    properties.push({
      name: "molecular-weight",
      value: String(data.molecularMass),
      units: "g/mol",
      provenance,
    });
  }

  return new Substance(
    data.name ?? null,
    [],
    data.formula ?? null,
    null,
    identifiers,
    properties,
    // Best effort within the supported SMILES subset; the SMILES stays
    // as an identifier when stereo keeps it out.
    parseStructure(data.smiles),
  );
}

function addIdentifier(
  list: ResolverIdentifier[],
  value: string | undefined,
  convention: string,
  provenance: ReturnType<Adapter["defaultProvenance"]>,
): void {
  if (value === undefined) return;
  list.push({ value, convention, provenance });
}
