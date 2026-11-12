// OPSIN source adapter (TODO.v2/13 item 3): IUPAC name → structure —
// name-to-structure perception for systematic names, the piece
// PubChem's name lookup cannot do (PubChem indexes a curated name
// list; OPSIN *derives* the structure from any systematic IUPAC name).
// Uses the public OPSIN web service (https://opsin.ch.cam.ac.uk),
// which answers with CML or SMILES.
//
// Citation profile: publisher University of Cambridge Centre for
// Molecular Informatics; per-access retrievedAt provenance.
import { ResolverError, Adapter, cgiEscape, parseStructure, type Fetch } from "./adapter.js";
import type { Clock } from "./timestamp.js";
import { Substance } from "./substance.js";

const BASE = "https://opsin.ch.cam.ac.uk/opsin";

// The request URL for the value — `.smiles` answer, shared
// CGI.escape percent-encoding (pinned byte-exactly by the corpus).
export function opsinUrl(value: string): string {
  return `${BASE}/${cgiEscape(value)}.smiles`;
}

export class OpsinAdapter extends Adapter {
  get sourceName(): string {
    return "opsin";
  }

  // Derivation only: 'name' is the curated-lookup convention
  // (PubChem/Common Chemistry). OPSIN DERIVES structures from
  // systematic names — reachable via 'iupac-name' so it can never
  // preempt a lookup source.
  get supportedConventions(): readonly string[] {
    return ["iupac-name"];
  }

  attribution(): string {
    return "OPSIN, University of Cambridge Centre for Molecular Informatics";
  }

  async fetchRecord(
    value: string,
    _convention: string,
    { fetch, clock }: { fetch: Fetch; clock: Clock },
  ): Promise<Substance | null> {
    let body: string | null;
    try {
      body = await fetch.get(opsinUrl(value), {});
    } catch (error) {
      throw new ResolverError(`opsin request failed: ${(error as Error).message}`);
    }
    if (body === null) return null;
    return substanceFromSmiles(body.trim(), this.defaultProvenance(clock));
  }
}

function substanceFromSmiles(smiles: string, provenance: ReturnType<Adapter["defaultProvenance"]>): Substance | null {
  if (smiles === "") return null;
  return new Substance(
    null,
    [],
    null,
    null,
    [{ value: smiles, convention: "canonical-smiles", provenance }],
    [],
    // OPSIN answers SMILES that may use features outside the supported
    // subset (wildcards, exotic stereo); then the SMILES stays as an
    // identifier and structure is null — no silent loss.
    parseStructure(smiles),
  );
}
