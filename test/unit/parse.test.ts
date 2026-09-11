import { describe, expect, it } from "vitest";
import { parseText } from "../../src/parser.js";
import { ParseError } from "../../src/errors.js";
import { Formula, Molecule, Reaction } from "../../src/model.js";
import "../../src/index.js";

describe("parseText", () => {
  it.each([
    "H",
    "He",
    "^14C",
    "Ca^2+",
    "Cl^-",
    "Ca^(II)",
    "H_2O",
    "(OH)_2",
    "[OH]_2",
    "H-O-H",
    "HC#CH",
    "2H_2 + O_2 -> 2H_2O",
    "Fe^(III)",
    "SO_4^2-",
    "C1-C-C-C-C-C1",
    "CH_3-CH_2-OH",
    "\"water\"",
    "`x^2 + 1`",
    "1s^2 2s^2 2p^6",
    "A ->[heat] B",
    "A <=> B",
    "A -> B -> C -> D",
    "H_2O @name(\"water\") @cas(\"7732-18-5\")",
    "crystal[NaCl](a=5.64,sg=Fm-3m){Na@f(0,0,0) Cl@f(0.5,0.5,0.5)}",
    "spectrum[nmr](type=1H,solvent=CDCl3){\n  1.2: 3H s \"CH3\"\n}",
    "calc(B3LYP/6-31G*){\n  energy: -209.3 Hartree\n}",
    "zmatrix{\n  H\n  O  1  0.96\n}",
    "mechanism",
    "(R)-CH_3CH(OH)COOH",
  ])("round-trips %s", (input) => {
    expect(parseText(input).toText()).toBe(input);
  });

  it("binds the prefix isotope to the atom, not a phantom carrier", () => {
    const formula = parseText("^14C");
    const molecule = formula.nodes[0] as Molecule;
    const atom = molecule.nodes[0] as import("../../src/model.js").Atom;
    expect(atom.element).toBe("C");
    expect(atom.isotope).toBe("14");
  });

  it("rejects a bare isotope prefix with no element", () => {
    expect(() => parseText("^14")).toThrow(ParseError);
  });

  it.each(["", "12", "@name(", "A ->", "crystal[", "spectrum{"])(
    "rejects malformed input %j",
    (input) => {
      expect(() => parseText(input)).toThrow(ParseError);
    },
  );

  it("parses hydrogen bare subscripts (H2O)", () => {
    const formula = parseText("H2O");
    const molecule = formula.nodes[0] as Molecule;
    expect(molecule.nodes.map((n) => (n as import("../../src/model.js").Atom).element)).toEqual([
      "H",
      "O",
    ]);
  });

  it("keeps two-letter symbols intact (He is not H + e)", () => {
    const formula = parseText("He");
    const molecule = formula.nodes[0] as Molecule;
    expect((molecule.nodes[0] as import("../../src/model.js").Atom).element).toBe("He");
  });

  it("canonicalises sign-first charges to number-then-sign", () => {
    expect(parseText("Ca^+2").toText()).toBe("Ca^2+");
  });

  it("canonicalises bare hydrogen subscripts to explicit markers", () => {
    expect(parseText("H2O").toText()).toBe("H_2O");
  });

  it("emits canonical wire JSON for water", () => {
    expect(parseText("H_2O").toModelJSON()).toEqual({
      type: "formula",
      nodes: [
        {
          type: "molecule",
          nodes: [
            { type: "atom", element: "H", subscript: "2" },
            { type: "atom", element: "O" },
          ],
        },
      ],
    });
  });

  it("drops fuzz-junk subscripts from wire emission but keeps them in text", () => {
    const formula = parseText("H_{2a}O");
    expect(formula.toText()).toBe("H_{2a}O");
    const wire = JSON.stringify(formula.toModelJSON());
    expect(wire).not.toContain("2a");
  });

  it("parses reaction conditions above and below the arrow", () => {
    const formula = parseText("N_2 + 3H_2 <=>[Fe][500C] 2NH_3");
    const reaction = formula.nodes[0] as Reaction;
    expect(reaction.conditions?.above).toBe("Fe");
    expect(reaction.conditions?.below).toBe("500C");
  });
});
