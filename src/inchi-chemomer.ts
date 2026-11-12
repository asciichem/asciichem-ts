// The chemomer wasm InChI engine — the OPTIONAL engine extra for
// asciichem-ts. The npm package `chemomer` (published by chemomer-ts)
// exposes the native engine over wasm: `from_molfile(molfile) ->
// InChI`, `inchikey(molfile) -> InChIKey`, `aux_from_molfile(molfile)
// -> AuxInfo`. The pipe mirrors the reference engines (Ruby's
// BinaryEngine, PY's RdkitEngine): molecule → molfile → engine →
// Identity. The InChI algorithm is never reimplemented here.
//
// The engine stays OPTIONAL — never a hard dependency, so the default
// posture stays no-engine (the corpus's engine:"none" cases run and
// the engine:"inchi" cases skip-and-report). Installing the extra
// flips the posture:
//
//   npm install chemomer     # the engine extra (documented in README)
//
// CI mirrors the PY repo's two-job shape: the default job runs the
// no-engine posture; the `inchi-posture` job installs chemomer and
// runs the same suite with the engine cases live.
import { createRequire } from "node:module";
import { Molecule } from "./model.js";
import { writeMolfile } from "./molfile.js";
import { AsciiChemError } from "./errors.js";
import { setInchiEngine, type InchiEngine, type InchiIdentity } from "./inchi.js";

// The chemomer wasm surface (the published chemomer.d.ts).
interface ChemomerWasm {
  from_molfile(molfile: string): string;
  inchikey(molfile: string): string;
  aux_from_molfile(molfile: string): string;
}

// Whether the engine extra is installed. Resolvability — not an import
// — keeps the posture detection synchronous, so a test file can decide
// its posture at describe-eval time and register in beforeAll.
export function chemomerAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve("chemomer");
    return true;
  } catch {
    return false;
  }
}

// The engine: molecule → molfile → chemomer wasm → Identity. The wasm
// module initialises synchronously at import time (its glue compiles
// the .wasm in the module body), so once imported every call is sync.
class WasmEngine implements InchiEngine {
  constructor(private readonly chemomer: ChemomerWasm) {}

  identity(molecule: Molecule): InchiIdentity {
    // A molecular formula is not a structure: the molfile writer
    // rejects unbonded multi-atom molecules, and that rejection is the
    // identity error the linter cross-check reports (never a raise).
    const molfile = writeMolfile(molecule);
    return {
      inchi: this.chemomer.from_molfile(molfile),
      inchikey: this.chemomer.inchikey(molfile),
    };
  }
}

// Imports the engine extra and registers it in the global seam.
// Idempotent per call site; the posture jobs and the CLI dispatcher
// call this once before deriving identities. The specifier rides a
// variable (the extra is optional — never a hard dependency, so it is
// absent from the import graph at typecheck time).
export async function registerChemomerEngine(): Promise<void> {
  const specifier = "chemomer";
  const mod = (await import(specifier)) as ChemomerWasm;
  if (typeof mod.from_molfile !== "function" || typeof mod.inchikey !== "function") {
    throw new AsciiChemError(
      "the chemomer package does not expose from_molfile/inchikey — upgrade the engine extra",
    );
  }
  setInchiEngine(new WasmEngine(mod));
}
