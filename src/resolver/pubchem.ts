// PubChem source adapter (TODO.impl 39; TODO.v2 07 layer 2). PubChem
// is the default source: keyless PUG-REST, permissive terms, and the
// bulk mirror of Common Chemistry's validated CAS RNs (CAS numbers are
// indexed as names). Politeness: one request per resolution, no
// retries — PubChem asks for max 5 requests/second.
//
// Citation profile (TODO.v2 08): publisher NCBI, per-access versioning
// (retrievedAt provenance), compound link
// https://pubchem.ncbi.nlm.nih.gov/compound/{cid}.
import { ResolverError, Adapter, cgiEscape, parseStructure, type Fetch } from "./adapter.js";
import type { Clock } from "./timestamp.js";
import { Substance, type ResolverIdentifier, type ResolverProperty } from "./substance.js";

const BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound";
const PROPERTIES = ["CanonicalSMILES", "IsomericSMILES", "MolecularFormula", "MolecularWeight", "IUPACName", "InChI", "InChIKey"];

// CAS numbers are indexed as PubChem names (Common Chemistry mirror),
// so both map to the name namespace.
const NAMESPACE_BY_CONVENTION: Record<string, string> = {
  name: "name",
  cas: "name",
  "pubchem-cid": "cid",
  inchikey: "inchikey",
  inchi: "inchi",
  smiles: "smiles",
  "canonical-smiles": "smiles",
};

// The request URL for (convention, value) — the corpus's resolver
// family pins this string byte-exactly (shared CGI.escape table).
export function pubchemUrl(value: string, convention: string): string {
  const namespace = NAMESPACE_BY_CONVENTION[convention];
  if (namespace === undefined) {
    throw new ResolverError(`pubchem does not support convention ${JSON.stringify(convention)}`);
  }
  return `${BASE}/${namespace}/${cgiEscape(value)}/property/${PROPERTIES.join(",")}/JSON`;
}

interface PubchemProperties {
  CID?: number;
  CanonicalSMILES?: string;
  IsomericSMILES?: string;
  MolecularFormula?: string;
  MolecularWeight?: string;
  IUPACName?: string;
  InChI?: string;
  InChIKey?: string;
}

export class PubChemAdapter extends Adapter {
  get sourceName(): string {
    return "pubchem";
  }

  get supportedConventions(): readonly string[] {
    return ["name", "cas", "pubchem-cid", "inchikey", "inchi", "smiles", "canonical-smiles"];
  }

  attribution(): string {
    return "PubChem, U.S. National Library of Medicine";
  }

  async fetchRecord(
    value: string,
    convention: string,
    { fetch, clock }: { fetch: Fetch; clock: Clock },
  ): Promise<Substance | null> {
    const body = await fetch.get(pubchemUrl(value, convention), {});
    if (body === null) return null;

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      throw new ResolverError(`pubchem returned malformed JSON: ${(error as Error).message}`);
    }
    const props = (payload as { PropertyTable?: { Properties?: PubchemProperties[] } })?.PropertyTable
      ?.Properties?.[0];
    if (props === undefined) return null;
    return substanceFromProperties(props, this.defaultProvenance(clock));
  }
}

function substanceFromProperties(
  props: PubchemProperties,
  provenance: ReturnType<Adapter["defaultProvenance"]>,
): Substance {
  const identifiers: ResolverIdentifier[] = [];
  if (props.CID !== undefined) {
    identifiers.push({ value: String(props.CID), convention: "pubchem-cid", provenance });
  }
  addIdentifier(identifiers, props.InChIKey, "inchikey", provenance);
  addIdentifier(identifiers, props.InChI, "inchi", provenance);
  addIdentifier(identifiers, props.CanonicalSMILES, "canonical-smiles", provenance);

  const properties: ResolverProperty[] = [];
  if (props.MolecularFormula !== undefined) {
    properties.push({ name: "molecular-formula", value: props.MolecularFormula, provenance });
  }
  if (props.MolecularWeight !== undefined) {
    properties.push({ name: "molecular-weight", value: props.MolecularWeight, units: "g/mol", provenance });
  }

  return new Substance(
    props.IUPACName ?? null,
    [],
    props.MolecularFormula ?? null,
    props.MolecularWeight !== undefined ? Number.parseFloat(props.MolecularWeight) : null,
    identifiers,
    properties,
    // Best effort: PubChem canonical SMILES may use constructs outside
    // the supported subset (stereo); then the SMILES stays as an
    // identifier and structure is null — no silent loss.
    parseStructure(props.CanonicalSMILES),
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
