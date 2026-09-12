import { describe, expect, it } from "vitest";
import { parseSmiles } from "../../src/smiles.js";
import { parseMolfile, writeMolfile } from "../../src/molfile.js";
import { buildGraph } from "../../src/structure.js";
import { Atom, Molecule, ParseError } from "../../src/index.js";
import { parseText } from "../../src/parser.js";

describe("parseSmiles", () => {
  it("parses chains into bonded molecules", () => {
    const molecule = parseSmiles("CCO").nodes[0] as Molecule;
    expect(molecule.toText()).toBe("C-C-O");
    const { atoms, edges } = buildGraph(molecule);
    expect(atoms.map((a) => a.element)).toEqual(["C", "C", "O"]);
    expect(edges.map((e) => e.kind)).toEqual(["single", "single"]);
  });

  it("marks aromatic atoms and bonds", () => {
    const molecule = parseSmiles("c1ccccc1").nodes[0] as Molecule;
    const { atoms, edges } = buildGraph(molecule);
    expect(atoms.every((a) => a.aromatic)).toBe(true);
    expect(edges.every((e) => e.kind === "aromatic")).toBe(true);
    expect(edges.length).toBe(6);
  });

  it("parses bracket atoms with charges, isotopes, H counts", () => {
    const a = parseSmiles("[13CH4]").nodes[0] as Molecule;
    const first = a.nodes[0] as Atom;
    expect(first.isotope).toBe("13");
    expect(first.hydrogens).toBe(4);
    expect(parseSmiles("[Fe++]").toSmiles()).toBe("[Fe+2]");
    expect(parseSmiles("[O-2]").toSmiles()).toBe("[O-2]");
  });

  it("splits dot components", () => {
    expect(parseSmiles("O.CCO").nodes.length).toBe(2);
  });

  it.each([
    "C1CCC",
    "[C@H](C)C",
    "C/C=C/C",
    "C=1CCCCC=1",
    "CC!X",
  ])("rejects %j with ParseError", (smiles) => {
    expect(() => parseSmiles(smiles)).toThrow(ParseError);
  });
});

describe("writeSmiles", () => {
  it("is stable and structure-preserving", () => {
    for (const smiles of [
      "CC(=O)OC1=CC=CC=C1C(=O)O",
      "c1ccc2ccccc2c1",
      "CC(C)(C)C",
    ]) {
      const once = parseSmiles(smiles).toSmiles();
      expect(parseSmiles(once).toSmiles()).toBe(once);
      expect(parseSmiles(once).toModelJSON()).toEqual(parseSmiles(smiles).toModelJSON());
    }
  });

  it("raises for formula-only molecules and unrepresentable bonds", () => {
    expect(() => parseTextFormula().toSmiles()).toThrow(ParseError);
  });

  it("carries aromatic and hydrogens through the wire form", () => {
    const wire = parseSmiles("c1ccccc1").toModelJSON() as { nodes: { nodes: unknown[] }[] };
    const atom = (wire.nodes[0].nodes[0] as { aromatic?: boolean }).aromatic;
    expect(atom).toBe(true);
  });
});

// H_2O parsed through the AsciiChem grammar has no connectivity.
function parseTextFormula() {
  return parseText("H_2O");
}

describe("molfile", () => {
  const atomLine = (x: number, y: number, z: number, sym: string) =>
    `${x.toFixed(4).padStart(10)}${y.toFixed(4).padStart(10)}${z
      .toFixed(4)
      .padStart(10)} ${sym.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`;
  const bondLine = (a: number, b: number, t: number, s = 0) =>
    `${String(a).padStart(3)}${String(b).padStart(3)}${String(t).padStart(3)}${String(s).padStart(3)}  0  0  0  0  0  0  0`;

  const ethanol = [
    "ethanol",
    "  fixture",
    "",
    "  3  2  0  0  0  0  0  0  0  0999 V2000",
    atomLine(-0.25, 0.375, 0, "C"),
    atomLine(0.4645, -0.0375, 0, "C"),
    atomLine(1.179, 0.375, 0, "O"),
    bondLine(1, 2, 1),
    bondLine(2, 3, 1),
    "M  END",
  ].join("\n");

  const benzene = [
    "benzene",
    "  fixture",
    "",
    "  6  6  0  0  0  0  0  0  0  0999 V2000",
    atomLine(-0.5, 0.866, 0, "C"),
    atomLine(0.5, 0.866, 0, "C"),
    atomLine(1.0, 0, 0, "C"),
    atomLine(0.5, -0.866, 0, "C"),
    atomLine(-0.5, -0.866, 0, "C"),
    atomLine(-1.0, 0, 0, "C"),
    bondLine(1, 2, 4),
    bondLine(2, 3, 4),
    bondLine(3, 4, 4),
    bondLine(4, 5, 4),
    bondLine(5, 6, 4),
    bondLine(6, 1, 4),
    "M  END",
  ].join("\n");

  it("parses atoms with coordinates and bonds", () => {
    const molecule = parseMolfile(ethanol);
    const { atoms, edges } = buildGraph(molecule);
    expect(atoms.map((a) => a.element)).toEqual(["C", "C", "O"]);
    expect(atoms[0].x2).toBe(-0.25);
    expect(edges.length).toBe(2);
  });

  it("marks aromatic atoms from type-4 bonds", () => {
    const { atoms, edges } = buildGraph(parseMolfile(benzene));
    expect(atoms.every((a) => a.aromatic)).toBe(true);
    expect(edges.every((e) => e.kind === "aromatic")).toBe(true);
  });

  it("round-trips through write/parse", () => {
    for (const text of [ethanol, benzene]) {
      const molecule = parseMolfile(text);
      const { atoms, edges } = buildGraph(molecule);
      const shape = edges.map((e) => [e.from, e.to, e.kind]).sort();
      const again = buildGraph(parseMolfile(writeMolfile(molecule)));
      expect(again.atoms.length).toBe(atoms.length);
      expect(again.edges.map((e) => [e.from, e.to, e.kind]).sort()).toEqual(shape);
    }
  });

  it("rejects malformed counts lines and truncated blocks", () => {
    expect(() => parseMolfile("bad\n  x\n\nzzz  0  0  0  0  0  0  0  0999 V2000\nM  END\n")).toThrow(
      ParseError,
    );
    expect(() => parseMolfile(ethanol.split("\n").slice(0, 5).join("\n"))).toThrow(ParseError);
  });
});
