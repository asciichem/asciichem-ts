import { describe, expect, it } from "vitest";
import { parseText } from "../../src/parser.js";
import { fromModelJSON } from "../../src/wire/from-wire.js";
import { ParseError } from "../../src/errors.js";
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
  });

  it("rejects non-formula roots", () => {
    expect(() => fromModelJSON({ type: "atom", element: "H" })).toThrow(ParseError);
  });
});
