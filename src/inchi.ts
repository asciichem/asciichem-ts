// Local identity derivation seam (TODO.v2 10; TODO.impl 48).
//
// The InChI algorithm is never reimplemented: engines wrap an InChI
// implementation (a WASM build of the IUPAC library in this
// environment). Engines are opt-in — without one, derivation raises
// EngineMissingError with guidance; no silent fallback.
import { Molecule } from "./model.js";
import { AsciiChemError } from "./errors.js";

export interface InchiIdentity {
  readonly inchi: string;
  readonly inchikey?: string;
}

export interface InchiEngine {
  identity(molecule: Molecule): InchiIdentity;
}

export const INSTALL_GUIDE =
  "install an InChI engine for asciichem-ts (WASM build of the IUPAC " +
  "library, TODO.impl/48) and register it via setInchiEngine";

export class EngineMissingError extends AsciiChemError {
  constructor(message = `no InChI engine configured — ${INSTALL_GUIDE}`) {
    super(message);
  }
}

let engine: InchiEngine | undefined;

export function setInchiEngine(selected: InchiEngine | undefined): void {
  engine = selected;
}

export function inchiEngine(): InchiEngine | undefined {
  return engine;
}

export function identityFor(molecule: Molecule, selected?: InchiEngine): InchiIdentity {
  const chosen = selected ?? engine;
  if (!chosen) throw new EngineMissingError();
  return chosen.identity(molecule);
}
