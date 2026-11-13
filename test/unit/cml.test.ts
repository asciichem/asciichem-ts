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
  CmlError,
  ACI_NAMESPACE,
} from "../../src/cml.js";
import { parseText } from "../../src/parser.js";
import { Molecule, Reaction } from "../../src/model.js";

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
  // The mechanism channel (aci:mechanism): canonical text render,
  // re-parsed on read — gated here beyond the corpus family.
  "mechanism{\n  s1: A-B -> A + B | flow: A-B > A; B > B-C\n  s2: A + C -> A-C\n}",
  "mechanism{\n  s1: A -> B | flow: A > B\n  spectator: Na^+\n}",
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

describe("CML aci: top-level channels (crystal/spectrum/calculation/zmatrix)", () => {
  // The beyond-formulas constructs ride the same text-round-trip
  // channel the mechanism uses: canonical text render inside an
  // aci:<name> element, re-parsed on read (the reference TopLevel
  // channel's contract — the Text formatter is the canonicaliser).
  const CHANNEL_INPUTS = [
    "crystal[NaCl](a=5.64,b=5.64,c=5.64,alpha=90,beta=90,gamma=90,sg=Fm-3m){Na@f(0,0,0) Cl@f(0.5,0.5,0.5)}",
    "crystal[x](a=-1){Na@f(0,0,0)}",
    "spectrum[1H](solvent=CDCl3){\n  7.26: 1 s \"CHCl3\"\n}",
    "calc(B3LYP/6-31G*){\n  energy: -76.0 Hartree\n}",
    "zmatrix{\n  O\n  H  1  0.96\n  H  1  0.96  2  104.5\n}",
  ];

  for (const input of CHANNEL_INPUTS) {
    it(`${input.slice(0, 40)}... round-trips through its channel`, () => {
      const cml = parseText(input).toCml();
      expect(cml).toContain(`xmlns:aci="${ACI_NAMESPACE}"`);
      expect(parseCmlToFormula(cml).toText()).toBe(input);
    });
  }

  it("carries the crystal under aci:crystal with its position", () => {
    const input = "crystal[NaCl](a=5.64) H_2O";
    const cml = parseText(input).toCml();
    expect(cml).toContain('<aci:crystal position="0">');
    expect(parseCmlToFormula(cml).toText()).toBe(input);
  });

  it("keeps mixed top-level channels in node order", () => {
    const input = "crystal[x](a=1) 1s^2 2s^2 calc(b3lyp) H_2O";
    const cml = parseText(input).toCml();
    expect(cml).toContain('<aci:crystal position="0">');
    expect(cml).toContain('<aci:calculation position="2">');
    expect(parseCmlToFormula(cml).toText()).toBe(input);
  });

  it("reports constructs with neither wire representation nor channel, never drops them", () => {
    // Bare atoms outside a molecule stay unsupported (the parser wraps
    // bare atom spelling in molecules, so this shape only arises from
    // direct construction — the visitor-level guard).
    expect(() => formulaToCml(parseText("H_2O"))).not.toThrow();
  });
});

describe("CML reaction-conditions channel (native conditionList)", () => {
  it("emits the reference conditionList shape (scalars by title)", () => {
    const input = "H_2 + O_2 ->[Fe][400C] H_2O";
    const cml = parseText(input).toCml();
    expect(cml).toContain(
      "<conditionList><scalar title=\"above\">Fe</scalar><scalar title=\"below\">400C</scalar></conditionList>",
    );
    expect(parseCmlToFormula(cml).toText()).toBe(input);
  });

  it("round-trips only-above conditions", () => {
    const input = "A ->[cat: Pd] B";
    const cml = parseText(input).toCml();
    expect(cml).toContain('<scalar title="above">cat: Pd</scalar>');
    expect(parseCmlToFormula(cml).toText()).toBe(input);
  });

  it("round-trips conditions through reaction cascades", () => {
    const input = "A ->[c1] B ->[c2] C";
    const cml = parseText(input).toCml();
    expect(parseCmlToFormula(cml).toText()).toBe(input);
  });

  it("emits no conditionList for reactions without conditions", () => {
    const cml = parseText("H_2 + O_2 -> H_2O").toCml();
    expect(cml).not.toContain("conditionList");
    expect(parseCmlToFormula(cml).toText()).toBe("H_2 + O_2 -> H_2O");
  });

  it("reads the legacy aci: attribute channel for backwards compatibility", () => {
    const xml =
      `<cml xmlns="http://www.xml-cml.org/schema" xmlns:aci="${ACI_NAMESPACE}">` +
      '<reaction id="r1" type="forward" aci:conditionsAbove="Pt" aci:conditionsBelow="80C">' +
      "<reactantList/><productList/></reaction></cml>";
    const formula = parseCmlToFormula(xml);
    const reaction = formula.nodes[0] as Reaction;
    expect(reaction.conditions?.above).toBe("Pt");
    expect(reaction.conditions?.below).toBe("80C");
  });

  it("prefers the native conditionList over legacy attributes", () => {
    const xml =
      '<cml xmlns="http://www.xml-cml.org/schema">' +
      '<reaction id="r1" type="forward"><reactantList/><productList/>' +
      '<conditionList><scalar title="above">native</scalar></conditionList></reaction></cml>';
    const reaction = parseCmlToFormula(xml).nodes[0] as Reaction;
    expect(reaction.conditions?.above).toBe("native");
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
