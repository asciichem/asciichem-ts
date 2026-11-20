// The branch-projection port (asciichem-ruby#208's reference): the
// SMILES reader shapes the linearizer, so smiles-ingested molecules
// text as branch groups (no carbonyl ring digits) and round-trip
// through CML with chirality intact — byte-identical with the ruby
// reference's text for the same inputs.
import { beforeAll, describe, expect, it } from "vitest";
import "../../src/index.js";
import { initCml, parseCmlToFormula } from "../../src/cml.js";
import { parseSmiles, writeSmiles } from "../../src/smiles.js";

const REFERENCE_TEXT: readonly (readonly [string, string])[] = [
  ["CC(=O)O", "C-C(=O)-O"],
  ["CC(=O)OC1=CC=CC=C1C(=O)O", "C-C(=O)-O-C1=C-C=C-C=C1-C(=O)-O"],
  ["N[C@@H](C)C(=O)O", "N-C@TH2(-C)-C(=O)-O"],
  ["C1=CC=CC=C1", "C1=C-C=C-C=C1"],
];

describe("branch-projection structure port", () => {
  it("texts smiles molecules as branch groups (no carbonyl digits)", () => {
    for (const [source, expected] of REFERENCE_TEXT) {
      expect(parseSmiles(source).toText(), source).toBe(expected);
    }
  });

  it("keeps the canonical smiles write stable through the new shape", () => {
    for (const [source] of REFERENCE_TEXT) {
      const written = writeSmiles(parseSmiles(source));
      const again = writeSmiles(parseSmiles(written));
      expect(again, source).toBe(written);
    }
  });

  describe("cml round-trip on branch-grouped models", () => {
    beforeAll(async () => {
      await initCml();
    });

    for (const [source] of REFERENCE_TEXT) {
      it(source, () => {
        const formula = parseSmiles(source);
        const back = parseCmlToFormula(formula.toCml());
        expect(back.toText(), source).toBe(formula.toText());
      });
    }

    it("carries chirality through cml", () => {
      const back = parseCmlToFormula(parseSmiles("N[C@@H](C)C(=O)O").toCml());
      const chiral = back.nodes[0].nodes.find((n) => n.chirality);
      expect(chiral?.chirality).toBe("TH2");
    });
  });
});
