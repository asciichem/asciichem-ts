import { describe, expect, it } from "vitest";
import { parseText } from "../../src/parser.js";
import { BOND_LENGTH, layoutMolecule } from "../../src/layout.js";
import { Molecule } from "../../src/model.js";
import type { Point } from "../../src/layout.js";

function placedMolecule(source: string): { positions: Point[]; atomCount: number } {
  const formula = parseText(source);
  const molecule = formula.nodes.find((n) => n instanceof Molecule);
  if (!(molecule instanceof Molecule)) throw new Error(`no molecule in: ${source}`);
  const { graph, positions } = layoutMolecule(molecule);
  return { positions, atomCount: graph.atoms.length };
}

function bondLengths(source: string): number[] {
  const formula = parseText(source);
  const molecule = formula.nodes.find((n) => n instanceof Molecule);
  if (!(molecule instanceof Molecule)) throw new Error(`no molecule in: ${source}`);
  const { graph, positions } = layoutMolecule(molecule);
  return graph.bonds.map((bond) => {
    const from = positions[bond.from];
    const to = positions[bond.to];
    return Math.sqrt((from.x - to.x) ** 2 + (from.y - to.y) ** 2);
  });
}

describe("depiction placement", () => {
  it("places benzene as a regular hexagon with uniform bond lengths", () => {
    const lengths = bondLengths("C1-C-C-C-C-C1");
    expect(lengths).toHaveLength(6);
    for (const length of lengths) {
      expect(length).toBeCloseTo(BOND_LENGTH, 1);
    }
  });

  it("keeps uniform bond lengths across ring sizes and fused systems", () => {
    for (const source of [
      "C1-C-C-C1",
      "C1-C-C-C-C-C-C1",
      "C1-C-C-C2-C-C-C2-C1",
      "C1-C-C-C-C-C12-C-C-C-C-C2-C1",
      "C-C1-C-C-C-C-C1",
    ]) {
      for (const length of bondLengths(source)) {
        expect(length).toBeCloseTo(BOND_LENGTH, 1);
      }
    }
  });

  it("never places two atoms at the same position", () => {
    for (const source of [
      "C-C-C",
      "C-C1-C-C-C-C-C1",
      "C1-C-C-C-C-C12-C-C-C-C-C2-C1",
      "C12-C-C1-C2",
    ]) {
      const { positions, atomCount } = placedMolecule(source);
      const keys = positions.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`);
      expect(new Set(keys).size).toBe(atomCount);
    }
  });

  it("is deterministic across runs", () => {
    const snapshots = [1, 2, 3].map(() => {
      const { positions } = placedMolecule("C1-C-C-C2-C-C-C2-C1");
      return positions.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join("|");
    });
    expect(new Set(snapshots).size).toBe(1);
  });

  it("zigzags chains rather than curling them", () => {
    const { positions } = placedMolecule("C-C-C-C");
    const xs = positions.map((p) => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(positions.map((p) => p.y.toFixed(2))).size).toBeGreaterThanOrEqual(2);
  });

  it("feeds the structural SVG formatter with a full graph", () => {
    const formula = parseText("C1-C-C-C-C-C1");
    const molecule = formula.nodes.find((n) => n instanceof Molecule) as Molecule;
    const { graph } = layoutMolecule(molecule);
    expect(graph.atoms).toHaveLength(6);
    expect(graph.bonds).toHaveLength(6);
  });
});
