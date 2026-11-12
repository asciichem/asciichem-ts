// Domain value objects for resolution results (TODO.v2 07 layer 2) —
// the TypeScript mirror of AsciiChem::Resolver::Substance. These are
// data carriers; (de)serialization to the canonical wire form goes
// through the shared wire substance-record types only (the wire module
// of asciichem-model v1 — never hand-rolled key munging).
import type { SubstanceRecord } from "../wire/types.js";

// The provenance record: retrieval source, instant, version and the
// source's required attribution — licence terms (CAS Common Chemistry
// is CC BY-NC 4.0) must survive into the rendered document.
export interface Provenance {
  source: string;
  retrievedAt: string | null;
  sourceVersion?: string;
  attribution?: string;
}

// The provenance record as one sentence (the citation track's bibitem
// note): retrieval source and version plus the source's required
// attribution. null when there is nothing beyond the source name
// itself.
export function provenanceNoteText(provenance: Provenance | null | undefined): string | null {
  if (provenance === null || provenance === undefined) return null;
  const details: string[] = [];
  if (provenance.sourceVersion !== undefined) details.push(`version ${provenance.sourceVersion}`);
  if (provenance.attribution !== undefined) details.push(provenance.attribution);
  if (details.length === 0) return null;
  return `Retrieved from ${provenance.source}; ${details.join("; ")}`;
}

export interface ResolverIdentifier {
  value: string;
  convention: string;
  provenance: Provenance | null;
}

export interface ResolverProperty {
  name: string;
  value: string;
  units?: string;
  provenance: Provenance | null;
}

// A resolved substance: identity + provenance + best-effort structure.
// `structure` is a model Molecule when the source's SMILES parses
// within the supported subset; otherwise undefined and the SMILES
// stays available as an identifier — nothing is dropped.
export class Substance {
  constructor(
    readonly preferredName: string | null = null,
    readonly synonyms: string[] = [],
    readonly formula: string | null = null,
    readonly molecularWeight: number | null = null,
    readonly identifiers: ResolverIdentifier[] = [],
    readonly properties: ResolverProperty[] = [],
    readonly structure: import("../model.js").Molecule | null = null,
  ) {}

  identifierValue(convention: string): string | undefined {
    return this.identifiers.find((identifier) => identifier.convention === convention)?.value;
  }

  provenance(): Provenance | null {
    return this.identifiers[0]?.provenance ?? null;
  }

  // Canonical wire form (asciichem-model v1 substance-record).
  toWire(): SubstanceRecord {
    return {
      type: "substance-record",
      ...(this.preferredName !== null ? { preferredName: this.preferredName } : {}),
      ...(this.synonyms.length > 0 ? { synonyms: this.synonyms } : {}),
      ...(this.formula !== null ? { formula: this.formula } : {}),
      ...(this.molecularWeight !== null ? { molecularWeight: this.molecularWeight } : {}),
      identifiers: this.identifiers.map((identifier) => ({
        identifier: {
          type: "identifier",
          value: identifier.value,
          convention: identifier.convention as SubstanceRecord["identifiers"][number]["identifier"]["convention"],
        },
        provenance: provenanceWire(identifier.provenance),
      })),
      ...(this.properties.length > 0
        ? {
            properties: this.properties.map((property) => ({
              name: property.name,
              value: property.value,
              ...(property.units !== undefined ? { units: property.units } : {}),
              provenance: provenanceWire(property.provenance),
            })),
          }
        : {}),
    };
  }

  // Rebuilds a Substance from the wire form (the cache path).
  static fromWire(wire: SubstanceRecord): Substance {
    return new Substance(
      wire.preferredName ?? null,
      wire.synonyms ?? [],
      wire.formula ?? null,
      wire.molecularWeight ?? null,
      wire.identifiers.map((provenanced) => ({
        value: provenanced.identifier.value,
        convention: provenanced.identifier.convention,
        provenance: provenanceDomain(provenanced.provenance),
      })),
      (wire.properties ?? []).map((property) => ({
        name: property.name,
        value: property.value,
        ...(property.units !== undefined ? { units: property.units } : {}),
        provenance: provenanceDomain(property.provenance),
      })),
    );
  }
}

function provenanceWire(provenance: Provenance | null): SubstanceRecord["identifiers"][number]["provenance"] {
  return {
    type: "provenance",
    source: provenance?.source ?? "",
    retrievedAt: provenance?.retrievedAt ?? "",
    ...(provenance?.sourceVersion !== undefined ? { sourceVersion: provenance.sourceVersion } : {}),
    ...(provenance?.attribution !== undefined ? { attribution: provenance.attribution } : {}),
  };
}

function provenanceDomain(wire: SubstanceRecord["identifiers"][number]["provenance"]): Provenance {
  return {
    source: wire.source,
    retrievedAt: wire.retrievedAt,
    ...(wire.sourceVersion !== undefined ? { sourceVersion: wire.sourceVersion } : {}),
    ...(wire.attribution !== undefined ? { attribution: wire.attribution } : {}),
  };
}
