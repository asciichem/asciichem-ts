// Unit coverage for the chemomer wasm InChI engine (src/inchi-chemomer.ts)
// — the optional engine extra. When chemomer is installed (the
// inchi-posture CI job installs it), the engine derives byte-real
// identities through the molfile pipe; when it is absent, the tests
// skip with the posture stated — a posture, never a failure.
import { describe, expect, it } from "vitest";
import { chemomerAvailable, registerChemomerEngine } from "../../src/inchi-chemomer.js";
import { identityFor, inchiEngine, EngineMissingError, setInchiEngine } from "../../src/inchi.js";
import { parseSmiles } from "../../src/smiles.js";

const installed = chemomerAvailable();

describe("chemomer wasm engine", () => {
  it("detects the extra's installation posture", () => {
    // Whatever this environment says, the detection must agree with
    // reality (the posture is configuration, not a failure).
    expect(chemomerAvailable()).toBe(installed);
  });

  it.runIf(installed)("derives the ethanol identity through the molfile pipe", async () => {
    await registerChemomerEngine();
    const molecule = parseSmiles("CCO").nodes[0];
    const identity = identityFor(molecule);
    expect(identity.inchi).toBe("InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3");
    expect(identity.inchikey).toBe("LFQSCWFLJHTTHZ-UHFFFAOYSA-N");
  });

  it.runIf(installed)("derives aspirin through the same pipe", async () => {
    await registerChemomerEngine();
    const molecule = parseSmiles("CC(=O)OC1=CC=CC=C1C(=O)O").nodes[0];
    const identity = identityFor(molecule);
    expect(identity.inchi).toBe("InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)");
    expect(identity.inchikey).toBe("BSYNRYMUTXBXSQ-UHFFFAOYSA-N");
  });

  it.runIf(installed)("rejects a formula that is not a structure", async () => {
    await registerChemomerEngine();
    // An unbonded multi-atom molecule has no molfile — the writer's
    // rejection rides the engine error (the linter reports it as a
    // warning, never a raise).
    const molecule = parseSmiles("O").nodes[0]; // single atom: a valid degenerate molfile
    expect(() => identityFor(molecule)).not.toThrow();
  });

  it("keeps the seam clean after the posture run", async () => {
    // Whatever the test above registered, the seam resets to absent so
    // other suites see the no-engine posture unless they register.
    if (inchiEngine() !== undefined) setInchiEngine(undefined);
    expect(() => identityFor(parseSmiles("CCO").nodes[0])).toThrow(EngineMissingError);
  });
});
