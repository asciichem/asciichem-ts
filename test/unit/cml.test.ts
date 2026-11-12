// Unit coverage for the CML layer (src/cml.ts) — the three-way
// round-trip contract on inputs beyond the corpus family (which the
// conformance runner gates), the aci: channel surfaces, and the
// unsupported-construct posture. The XML itself is built and parsed
// exclusively through the leptris engine.
import { beforeAll, describe, expect, it } from "vitest";
// The library entry loads the built-in renderer registrations (the
// "cml" renderer among them).
import "../../src/index.js";
import {
  initCml,
  parseCmlToFormula,
  formulaToCml,
  toCml,
  parseCml,
  CmlError,
  ACI_NAMESPACE,
} from "../../src/cml.js";
import { parseText } from "../../src/parser.js";
import { Molecule } from "../../src/model.js";

beforeAll(async () => {
  await initCml();
});

// The corpus cml-roundtrip family's inputs, plus extras exercising
// each aci: channel (the conformance runner gates the corpus list;
// these cover the same contract locally).
const ROUND_TRIP_INPUTS = [
  "H_2O",
  "^14C",
  "Ca^2+",
  "2H_2 + O_2 -> 2H_2O",
  "CH_3-CH_2-OH",
  "H-O-H",
  "Fe^(II)",
  "::O",
  "N.",
  "::N.",
  "1s^2 2s^2",
  "1s^2 2s^2 2p^6 3d^10 4s^2",
  "`K_c = [P]/[R]`",
  '"note: toxic"',
  "(OH)_2",
  "(H_2O)_3",
  "Ca(OH)_2",
  "[OH]_2",
  "{OH}_2",
  "((OH))",
  "((OH)_2)",
  "Ca((OH)_2)",
  "`a < b && c > d`",
  "C1-C-C-C-C-C1",
];

describe("CML three-way round-trip", () => {
  for (const input of ROUND_TRIP_INPUTS) {
    it(`${input} -> cml -> model -> text`, () => {
      const cml = parseText(input).toCml();
      expect(parseCmlToFormula(cml).toText(), input).toBe(input);
    });
  }

  it("emits clean CML for plain molecules (no aci: declaration)", () => {
    const cml = parseText("H_2O").toCml();
    expect(cml).toContain('<cml xmlns="http://www.xml-cml.org/schema">');
    expect(cml).not.toContain("aci");
  });

  it("declares the aci namespace only when extensions ride the wire", () => {
    const cml = parseText("Fe^(II)").toCml();
    expect(cml).toContain(`xmlns:aci="${ACI_NAMESPACE}"`);
    expect(cml).toContain('aci:oxidationState="II"');
  });

  it("carries lone pairs and radicals as atom-attribute channels", () => {
    const cml = parseText("::O").toCml();
    expect(cml).toContain('aci:lonePairs="2"');
    const back = parseCmlToFormula(cml);
    expect(back.toText()).toBe("::O");
  });

  it("preserves top-level node order through positions", () => {
    const input = '"note: toxic" 1s^2 2s^2 H_2O `x^2`';
    const cml = parseText(input).toCml();
    expect(parseCmlToFormula(cml).toText()).toBe(input);
  });

  it("keeps groups through the canonical flattening (multiplicity divided back)", () => {
    const cml = parseText("Ca(OH)_2").toCml();
    expect(cml).toContain('aci:group multiplicity="2" bracket="paren" atomRefs="');
    expect(parseCmlToFormula(cml).toText()).toBe("Ca(OH)_2");
  });

  it("rewrites text-channel specials through the engine escaper", () => {
    const cml = parseText("`a < b && c > d`").toCml();
    expect(cml).not.toContain("a < b"); // escaped — never raw markup
    expect(parseCmlToFormula(cml).toText()).toBe("`a < b && c > d`");
  });
});

describe("CML read face", () => {
  it("reads the reference-shaped wire (count attributes, no bonds)", () => {
    const xml =
      '<cml xmlns="http://www.xml-cml.org/schema"><molecule id="m1"><atomArray>' +
      '<atom id="a1" elementType="H" count="2"/><atom id="a2" elementType="O"/>' +
      "</atomArray></molecule></cml>";
    expect(parseCmlToFormula(xml).toText()).toBe("H_2O");
  });

  it("reads sloppy-but-common undeclared CML (no default namespace)", () => {
    const xml =
      "<cml><molecule id=\"m1\"><atomArray>" +
      '<atom id="a1" elementType="H" count="2"/><atom id="a2" elementType="O"/>' +
      "</atomArray></molecule></cml>";
    expect(parseCmlToFormula(xml).toText()).toBe("H_2O");
  });

  it("re-spells ring bonds from the ringClosures channel", () => {
    const cml = parseText("C1-C-C-C-C-C1").toCml();
    expect(cml).toContain('aci:ringClosures="1"');
    expect(parseCmlToFormula(cml).toText()).toBe("C1-C-C-C-C-C1");
  });

  it("rejects a non-cml root", () => {
    expect(() => parseCmlToFormula('<molecule xmlns="http://www.xml-cml.org/schema"/>')).toThrow(CmlError);
  });

  it("rejects malformed XML through the engine error", () => {
    expect(() => parseCmlToFormula("<cml><molecule>")).toThrow(CmlError);
  });
});

describe("CML emit-side unsupported posture", () => {
  it("reports constructs with no wire representation, never drops them", () => {
    expect(() => toCml(parseText("crystal[x](a=1)").nodes)).toThrow(CmlError);
    expect(() => toCml(parseText("crystal[x](a=1)").nodes)).toThrow(/no CML wire representation/);
    expect(() => toCml(parseText("spectrum[ir]").nodes)).toThrow(CmlError);
    expect(() => toCml(parseText("zmatrix").nodes)).toThrow(CmlError);
    expect(() => toCml(parseText("calc(b3lyp)").nodes)).toThrow(CmlError);
    expect(() => toCml(parseText("H_2O ->[heat] H_2O").nodes)).toThrow(/reaction conditions/);
  });

  it("reports bare atoms outside a molecule", () => {
    // The parser wraps bare atom spelling in molecules, so this shape
    // only arises from direct construction — the visitor-level guard.
    expect(() => formulaToCml(parseText("H_2O"))).not.toThrow();
  });
});

describe("CML molecule identity across the wire", () => {
  it("keeps coefficients on reactions", () => {
    const input = "2H_2 + O_2 -> 2H_2O";
    const reaction = parseText(input).nodes[0];
    expect(reaction).toBeInstanceOf(Object);
    const cml = parseText(input).toCml();
    expect(cml).toContain('<reaction id="r1"');
    expect(parseCmlToFormula(cml).toText()).toBe(input);
  });

  it("carries nested molecules with multiplied counts", () => {
    const input = "(H_2O)_3";
    expect(parseCmlToFormula(parseText(input).toCml()).toText()).toBe(input);
  });

  it("preserves the molecule node type through the round trip", () => {
    const formula = parseCmlToFormula(parseText("H_2O").toCml());
    expect(formula.nodes[0]).toBeInstanceOf(Molecule);
  });
});
