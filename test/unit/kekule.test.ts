import { describe, expect, it } from "vitest";
import { parseText } from "../../src/parser.js";
import { parseSmiles } from "../../src/smiles.js";
import { buildGraph } from "../../src/structure.js";
import { bondKinds } from "../../src/kekule.js";
import { Bond, Molecule } from "../../src/index.js";

function moleculeFor(smiles: string): Molecule {
  return parseSmiles(smiles).nodes[0] as Molecule;
}

function doubleCount(text: string): number {
  const molecule = parseText(text).nodes[0] as Molecule;
  return molecule.nodes.filter((n) => n instanceof Bond && n.kind === "double").length;
}

describe("bondKinds", () => {
  it("assigns alternating kinds along the chain, closure single by grammar", () => {
    const molecule = moleculeFor("c1ccccc1");
    const { edges } = buildGraph(molecule);

    const kinds = bondKinds(molecule);

    const chainKinds = edges
      .filter((edge) => edge.bond)
      .map((edge) => kinds.get(edge.bond as Bond));
    expect(chainKinds).toEqual(["double", "single", "double", "single", "double"]);
    expect(edges.filter((e) => e.kind === "aromatic").length).toBe(6);
  });

  it("never touches the model — aromatic bonds stay aromatic", () => {
    const molecule = moleculeFor("c1ccccc1");
    bondKinds(molecule);
    const { atoms, edges } = buildGraph(molecule);
    expect(atoms.every((a) => a.aromatic)).toBe(true);
    expect(edges.every((e) => e.kind === "aromatic")).toBe(true);
  });

  it("gives no projection for odd rings (the spec'd text loss)", () => {
    expect(bondKinds(moleculeFor("c1ccoc1")).size).toBe(0);
  });

  it("kekulizes fused systems that admit a Kekulé form", () => {
    const molecule = moleculeFor("c1ccc2ccccc2c1");
    const kinds = bondKinds(molecule);
    expect(kinds.size).toBeGreaterThan(0);
    expect([...kinds.values()]).toContain("double");
    expect([...kinds.values()]).toContain("single");
  });

  it("returns an empty projection for models without aromatic bonds", () => {
    expect(bondKinds(moleculeFor("C1CCCCC1")).size).toBe(0);
  });
});

describe("text projection round-trip", () => {
  it("renders benzene as re-parseable Kekulé text", () => {
    const text = moleculeFor("c1ccccc1").toText();
    expect(text).toBe("C1=C-C=C-C=C1");
    expect(doubleCount(text)).toBe(3);
    expect(parseText(text).toText()).toBe(text);
  });

  it("renders pyridine as re-parseable Kekulé text", () => {
    const text = moleculeFor("c1ccncc1").toText();
    expect(text).toBe("C1=C-C=N-C=C1");
    expect(doubleCount(text)).toBe(3);
    expect(parseText(text).toText()).toBe(text);
  });

  it("keeps the Kekulé spelling itself unchanged", () => {
    expect(parseText("C1=CC=CC=C1").toText()).toBe("C1=CC=CC=C1");
  });

  it("declines odd rings to the aromatic glyph", () => {
    expect(moleculeFor("c1ccoc1").toText()).toBe("C1:C:C:O:C1");
  });
});
