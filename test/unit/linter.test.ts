// Linter unit tests — the semantics the reference gem's linter specs
// pin (real model instances via the parser; never doubles).
//
// The built-in checks register as a side effect of importing the
// package root (the same pattern as the formatter registrations).
import { describe, expect, it } from "vitest";
import { parseText, runLinter, Formula, type Diagnostic } from "../../src/index.js";
import { ParseError } from "../../src/errors.js";
import { checkNames } from "../../src/linter.js";

const lint = (input: string): Diagnostic[] => runLinter(parseText(input));

describe("linter", () => {
  it("registers the eleven built-in checks", () => {
    expect([...checkNames()].sort()).toEqual(
      [
        "balance",
        "bracket_balance",
        "charge_balance",
        "crystal_sanity",
        "element_validation",
        "identifier_consistency",
        "identifier_format",
        "identity_cross_check",
        "isotope_sanity",
        "unclosed_ring",
        "valence",
      ].sort(),
    );
  });

  describe("balance", () => {
    it("flags an unbalanced reaction with the per-element counts", () => {
      const diagnostics = lint("H_2 + O_2 -> H_2O");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toBe("Reaction is not balanced: O: 2 vs 1");
      expect(diagnostics[0].label).toBe("Reaction");
      expect(diagnostics[0].details).toEqual({ O: [2, 1] });
    });

    it("applies group multiplicities and coefficients", () => {
      expect(lint("Ca(OH)_2 + 2HCl -> CaCl_2 + 2H_2O")).toEqual([]);
    });

    it("passes a balanced reaction", () => {
      expect(lint("2H_2 + O_2 -> 2H_2O")).toEqual([]);
    });
  });

  describe("charge balance", () => {
    it("reports both sides with signed charge forms", () => {
      const positive = lint("H^+ + OH^- -> H_2O^+");
      expect(positive).toHaveLength(1);
      expect(positive[0].message).toBe("Reaction charge is not balanced: reactants 0 vs products +1");
      expect(positive[0].label).toBe("Reaction");

      expect(lint("Na^+ + Cl^- -> NaCl^-")[0].message).toBe(
        "Reaction charge is not balanced: reactants 0 vs products -1",
      );
      expect(lint("Ca^2+ + Cl^- -> CaCl")[0].message).toBe(
        "Reaction charge is not balanced: reactants +1 vs products 0",
      );
    });

    it("passes a charge-balanced reaction with coefficients", () => {
      expect(lint("Ca^2+ + 2Cl^- -> CaCl_2")).toEqual([]);
    });
  });

  describe("element validation", () => {
    it("warns on unknown elements and reports the valence skip as info", () => {
      const diagnostics = lint("Hx_2O");
      expect(diagnostics.map((d) => d.severity).sort()).toEqual(["info", "warning"]);
      expect(diagnostics.some((d) => d.severity === "warning" && d.message.includes("Unknown element"))).toBe(true);
      expect(diagnostics.some((d) => d.severity === "info" && d.message.includes("not in valence table"))).toBe(true);
      expect(diagnostics.every((d) => d.label === "Atom(Hx)")).toBe(true);
    });

    it("is total across the reference's typo cases", () => {
      expect(lint("Cy-H").every((d) => d.severity === "warning" || d.severity === "info")).toBe(true);
    });
  });

  describe("isotope sanity", () => {
    it("errors when the mass number is below the atomic number", () => {
      const diagnostics = lint("^5C");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toBe("Isotope mass 5 is less than atomic number 6 for C");
      expect(diagnostics[0].label).toBe("Atom(C)");
    });

    it("passes deuterium", () => {
      expect(lint("^2H")).toEqual([]);
    });
  });

  describe("unclosed rings", () => {
    it("errors on a ring digit with no partner", () => {
      const diagnostics = lint("C-C-C1");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toContain("unmatched ring closure");
      expect(diagnostics[0].label).toBe("Atom(C)");
    });

    it("passes a closed ring", () => {
      expect(lint("C1-C-C-C-C-C1")).toEqual([]);
    });
  });

  describe("valence", () => {
    it("errors on an atom above its max valence", () => {
      // Linear text chains each atom to its neighbours, so the middle
      // oxygen of H-O=O-H carries three bond orders.
      const diagnostics = lint("H-O=O-H");
      expect(diagnostics.some((d) => d.message.includes("Atom O has bond order 3; max valence is 2"))).toBe(true);
    });

    it("flags over-bonded hydrogens in a branched chain", () => {
      expect(lint("C(-H)(-H)(-H)(-H)(-H)").every((d) => d.severity === "error")).toBe(true);
    });

    it("passes a double-bonded chain", () => {
      expect(lint("H-C=C-H")).toEqual([]);
    });
  });

  describe("identifier format", () => {
    it("errors on a bad CAS check digit", () => {
      const diagnostics = lint("C @cas(\"74-82-9\")");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toContain("check digit 9");
      expect(diagnostics[0].message).toContain("(cas identifier on C)");
    });

    it("errors on malformed CAS shape", () => {
      expect(lint("H_2O @cas(\"50782\")")[0].message).toContain("not in DDDDDDD-DD-D form");
    });

    it("errors on an InChI without the versioned prefix", () => {
      expect(lint("H_2O @inchi(\"garbage\")")[0].message).toContain("must start with");
    });

    it("errors on unbalanced SMILES parentheses", () => {
      expect(lint("C @smiles(\"C(C\")")[0].message).toContain("parentheses are not balanced");
    });

    it("skips conventions without a validator silently", () => {
      expect(lint("C @chebi(\"CHEBI:16183\")")).toEqual([]);
    });
  });

  describe("identifier consistency", () => {
    it("errors when the InChI formula layer disagrees with the molecule", () => {
      const diagnostics = lint(
        "H_2O @inchi(\"InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)\")",
      );
      expect(diagnostics.some((d) => d.severity === "error" && d.message.includes("does not match molecule"))).toBe(
        true,
      );
    });

    it("warns on SMILES element-set drift, both directions", () => {
      const unexpected = lint("H_2O @smiles(\"CCO\")");
      expect(unexpected.some((d) => d.message.includes("unexpected [\"C\"]"))).toBe(true);
      const missing = lint("C_2H_6O @smiles(\"CC\")");
      expect(missing.some((d) => d.message.includes("missing [\"O\"]"))).toBe(true);
    });

    it("passes when the sets agree (aspirin, aromatic subset tolerated)", () => {
      expect(lint("C_9H_8O_4 @smiles(\"CC(=O)Oc1ccccc1C(=O)O\")")).toEqual([]);
    });
  });

  describe("identity cross-check (engine-scaled)", () => {
    it("emits the skip warning when no engine is configured", () => {
      const diagnostics = lint(
        "C_9H_8O_4 @inchi(\"InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)\")",
      );
      const warnings = diagnostics.filter((d) => d.severity === "warning");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain("no InChI engine configured");
    });

    it("emits the skip warning once for the run, not per molecule", () => {
      // Two annotated molecules in one formula (model construction —
      // the reference spec's route; annotated reaction terms are not
      // in either implementation's grammar).
      const first = parseText('H_2O @inchi("InChI=1S/H2O/h1H2")').nodes[0];
      const second = parseText('H_2O @inchi("InChI=1S/H2O/h1H2")').nodes[0];
      const diagnostics = runLinter(new Formula([first, second]));
      expect(diagnostics.filter((d) => d.message.includes("no InChI engine configured"))).toHaveLength(1);
    });

    it("never checks molecules without identity annotations", () => {
      expect(lint("H_2O @name(\"water\")")).toEqual([]);
    });
  });

  describe("crystal sanity", () => {
    it("errors on non-positive cell lengths", () => {
      const diagnostics = lint("crystal[x](a=-1){Na@f(0,0,0)}");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toBe("Crystal a must be positive, got -1");
      expect(diagnostics[0].label).toBe("Crystal(x)");
    });

    it("errors on out-of-range angles and warns on fractional coordinates", () => {
      const diagnostics = lint("crystal[x](a=4,alpha=200){Na@f(1.5,0,0)}");
      expect(diagnostics.some((d) => d.message.includes("alpha must be in (0, 180]"))).toBe(true);
      expect(diagnostics.some((d) => d.severity === "warning" && d.message.includes("outside [0, 1)"))).toBe(true);
    });

    it("passes a sane cell", () => {
      expect(lint("crystal[x](a=4,b=4,c=4,alpha=90,beta=90,gamma=90){Na@f(0,0,0)}")).toEqual([]);
    });
  });

  describe("totality", () => {
    it("never throws across rough-but-valid inputs", () => {
      for (const input of [
        "crystal[x](a=1,b=1,c=1,alpha=90){Na@f(0,0,0)}",
        "`x^2`",
        '"just text"',
        "NaCl @cas(\"7647-14-5\") @smiles(\"[Na+].[Cl-]\")",
        "H_2O + H_2O_2 -> H_2O + O_2",
      ]) {
        const formula = parseText(input);
        expect(() => runLinter(formula), input).not.toThrow();
      }
    });

    it("rejects parse errors as parse errors, not lint failures", () => {
      expect(() => parseText("H_(")).toThrow(ParseError);
    });
  });

  it("sorts errors before warnings and dedupes per (message, node)", () => {
    const diagnostics = lint("Hx_2O");
    const severities = diagnostics.map((d) => d.severity);
    expect(severities).toEqual(["warning", "info"]);
  });

  it("renders the reference's diagnostic line shape", () => {
    const [diagnostic] = lint("H_2 + O_2 -> H_2O");
    expect(diagnostic?.toString()).toBe("[error] Reaction: Reaction is not balanced: O: 2 vs 1");
  });
});
