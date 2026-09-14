import { describe, expect, it } from "vitest";
import { parseSmiles } from "../../src/index.js";
import { EngineMissingError, identityFor, setInchiEngine } from "../../src/inchi.js";

describe("InChI engine seam", () => {
  it("raises EngineMissingError with guidance when no engine is registered", () => {
    const molecule = parseSmiles("CCO").nodes[0];
    expect(() => identityFor(molecule)).toThrow(EngineMissingError);
    expect(() => identityFor(molecule)).toThrow(/no InChI engine configured/);
  });

  it("derives identity through a registered engine", () => {
    const identity = { inchi: "InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3" };
    const engine = { identity: () => identity };
    setInchiEngine(engine);
    try {
      const molecule = parseSmiles("CCO").nodes[0];
      expect(identityFor(molecule)).toBe(identity);
    } finally {
      setInchiEngine(undefined);
    }
  });
});
