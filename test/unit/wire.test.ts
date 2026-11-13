import { describe, expect, it } from "vitest";
import { parseText } from "../../src/parser.js";
import { fromModelJSON } from "../../src/wire/from-wire.js";
import { ParseError } from "../../src/errors.js";
import { Crystal, Formula } from "../../src/model.js";
import "../../src/index.js";

describe("wire round-trip", () => {
  it.each([
    "H_2O",
    "^14C",
    "Ca^2+",
    "(OH)_2",
    "2H_2 + O_2 -> 2H_2O",
    "C1-C-C-C-C-C1",
    "N_2 + 3H_2 <=>[Fe][500C] 2NH_3",
    "H_2O @cas(\"7732-18-5\") @inchi(\"InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3\")",
    "(R)-C_2H_5OH",
    "(alpha)-C_6H_12O_6",
    "\"plain text\"",
  ])("model -> wire -> model preserves text for %s", (input) => {
    const wire = parseText(input).toModelJSON();
    expect(fromModelJSON(wire).toText()).toBe(input);
  });

  // The crystal rides the v1 wire with NUMBERS (the schema's
  // `type: number`); the model keeps the authored strings. Wire
  // round-trip therefore re-renders the plain float text (90 -> "90").
  it("crystal wire round-trips through the numeric cell form", () => {
    const input = "crystal[NaCl](a=5.64,b=5.64,c=5.64,alpha=90,beta=90,gamma=90,sg=Fm-3m){Na Cl}";
    const wire = parseText(input).toModelJSON() as {
      nodes: [
        {
          type: string;
          name?: string;
          a?: number;
          alpha?: number;
          spacegroup?: string;
          atoms?: unknown[];
        },
      ];
    };
    const node = wire.nodes[0];
    expect(node.type).toBe("crystal");
    expect(node.name).toBe("NaCl");
    expect(node.a).toBe(5.64);
    expect(node.alpha).toBe(90);
    expect(node.spacegroup).toBe("Fm-3m");
    expect(node.atoms).toHaveLength(2);
    expect(fromModelJSON(wire).toText()).toBe(input);
  });

  // Fractional coordinates are model-only render data — the v1 wire
  // atom carries none (reference parity). The loss is spec'd, never
  // silent.
  it("crystal wire drops fractional coordinates (reference parity)", () => {
    const wire = parseText("crystal[NaCl](a=5.64){Na@f(0,0,0)}").toModelJSON() as {
      nodes: [{ atoms?: { xFract?: unknown }[] }];
    };
    expect(wire.nodes[0].atoms?.[0].xFract).toBeUndefined();
    expect(fromModelJSON(wire).toText()).toBe("crystal[NaCl](a=5.64){Na}");
  });

  // A non-numeric cell capture is a malformed wire record, not a
  // silent null (the reference's exact posture). The grammar only
  // accepts numeric literals, so a non-numeric string can only arrive
  // via a hand-built node.
  it("rejects a non-numeric crystal cell param as a malformed record", () => {
    const formula = new Formula([new Crystal("x", "not-a-number")]);
    expect(() => formula.toModelJSON()).toThrow(/crystal cell param "not-a-number" is not a number/);
  });

  // Known wire gap (schema parity with the reference): v1 Molecule
  // carries identifiers but not names/titles/labels — those live in
  // the CML side-channel. Spec'd here so the loss stays visible.
  it("drops molecule names in wire v1 (reference parity)", () => {
    const wire = parseText("H_2O @name(\"water\")").toModelJSON() as {
      nodes: { names?: unknown }[];
    };
    expect(wire.nodes[0].names).toBeUndefined();
  });

  it("ingests JSON strings", () => {
    const json = JSON.stringify(parseText("H_2O").toModelJSON());
    expect(fromModelJSON(json).toText()).toBe("H_2O");
  });

  it("rejects beyond-core node types on ingestion", () => {
    const wire = parseText("spectrum[nmr]").toModelJSON() as { nodes: unknown[] };
    expect(() => fromModelJSON(wire)).toThrow(ParseError);
    // Crystal is in the core ingest set; spectrum is not.
    const crystal = parseText("crystal[x](a=1)").toModelJSON();
    expect(() => fromModelJSON(crystal)).not.toThrow();
  });

  it("rejects non-formula roots", () => {
    expect(() => fromModelJSON({ type: "atom", element: "H" })).toThrow(ParseError);
  });
});
