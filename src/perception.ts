// Perception pass (TODO.v2/13 item 2) — the TypeScript mirror of
// AsciiChem::Perception. Chemistry the syntax leaves implicit,
// derived once and consumed everywhere; semantics are conformance-
// tested through the shared corpus (fixtures/perception.json), never
// re-derived. nil in the corpus means perception declines — this
// implementation must decline identically.
import { Atom } from "./model.js";
import { buildGraph, type Edge } from "./structure.js";

// Default valences per element (the common ground-state values;
// multi-valent elements list their allowed valences in order).
export const DEFAULT_VALENCES: Record<string, number[]> = {
  H: [1],
  B: [3],
  C: [4],
  N: [3],
  O: [2],
  F: [1],
  Al: [3],
  Si: [4],
  P: [3, 5],
  S: [2, 4, 6],
  Cl: [1],
  Br: [1],
  I: [1],
};

export const BOND_ORDER: Record<string, number> = {
  single: 1,
  double: 2,
  triple: 3,
  quadruple: 4,
  aromatic: 1,
  wedge: 1,
  hash: 1,
  dative: 1,
  wavy: 1,
};

const AROMATIC_H_ORDER = 1.5;

// Neighbour indexes of an atom, in edge order.
export function neighbours(atomIndex: number, edges: Edge[]): number[] {
  const acc: number[] = [];
  for (const edge of edges) {
    if (edge.from === atomIndex) acc.push(edge.to);
    if (edge.to === atomIndex) acc.push(edge.from);
  }
  return acc;
}

// Valence-feasibility sum (aromatic orders as 1) — the max-valence
// check consumes this.
export function bondOrderSum(atomIndex: number, edges: Edge[]): number {
  let sum = 0;
  for (const edge of edges) {
    if (edge.from !== atomIndex && edge.to !== atomIndex) continue;
    sum += BOND_ORDER[edge.kind] ?? 1;
  }
  return sum;
}

// Hydrogen-counting sum: aromatic bonds order as 1.5 (Hückel), so
// both spellings of benzene sum to 3.0 at every carbon and perceive
// one implicit hydrogen.
export function hydrogenValenceSum(atomIndex: number, edges: Edge[]): number {
  let sum = 0;
  for (const edge of edges) {
    if (edge.from !== atomIndex && edge.to !== atomIndex) continue;
    sum += edge.kind === "aromatic" ? AROMATIC_H_ORDER : (BOND_ORDER[edge.kind] ?? 1);
  }
  return sum;
}

// Whole-number, non-negative gaps between each default valence and
// the hydrogen-valence sum; empty when the element is unknown or no
// valence fits integrally.
export function valenceDeficits(element: string, valenceSum: number): number[] {
  const valences = DEFAULT_VALENCES[element];
  if (!valences) return [];
  return valences.map((v) => v - valenceSum).filter((d) => d >= 0 && Number.isInteger(d));
}

// Implicit hydrogens for an atom: the smallest fitting default
// valence minus the hydrogen-valence sum.
// - Atoms that STATE hydrogens ([NH4+], [CH4]) return 0 — never add
//   to what the source said.
// - Charged atoms return null: charge algebra is deferred.
// - Unknown elements, non-integral or over-valent sums return null —
//   never invent.
export function implicitHydrogens(atom: Atom, valenceSum: number): number | null {
  if (atom.hydrogens != null) return 0;
  if (atom.charge != null) return null;

  const deficits = valenceDeficits(atom.element, valenceSum);
  if (deficits.length === 0) return null;

  return Math.min(...deficits);
}

// Six-membered cycles where every atom is sp2 (participates in a
// double bond) or aromatic-flagged — the fused-system rule. Full
// Hückel pi-electron counting is a later slice.
export function aromaticRings(atoms: Atom[], edges: Edge[]): number[][] {
  const cycles = ringCycles(edges, atoms.length)
    .filter((cycle) => cycle.length === 6)
    .filter((cycle) => cycle.every((i) => isSp2(i, atoms, edges)));
  return cycles;
}

export function isSp2(atomIndex: number, atoms: Atom[], edges: Edge[]): boolean {
  if (atoms[atomIndex].aromatic === true) return true;
  return edges.some(
    (edge) =>
      (edge.from === atomIndex || edge.to === atomIndex) && edge.kind === "double",
  );
}

export function bondKind(a: number, b: number, edges: Edge[]): Edge["kind"] | undefined {
  const edge = edges.find(
    (e) => (e.from === a && e.to === b) || (e.from === b && e.to === a),
  );
  return edge?.kind;
}

// Simple cycles up to size 6 via DFS (molecules are small), deduplicated
// by min/max endpoint (first occurrence kept — the Ruby reference).
function ringCycles(edges: Edge[], atomCount: number): number[][] {
  const found: number[][] = [];
  for (let start = 0; start < atomCount; start++) {
    dfsCycles(edges, start, start, [start], 6, found);
  }
  const seen = new Set<string>();
  const out: number[][] = [];
  for (const cycle of found) {
    const min = Math.min(...cycle);
    const max = Math.max(...cycle);
    const key = `${min},${max}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cycle);
    }
  }
  return out;
}

function dfsCycles(
  edges: Edge[],
  start: number,
  current: number,
  path: number[],
  maxSize: number,
  found: number[][],
): void {
  for (const nb of neighbours(current, edges)) {
    if (nb === path[path.length - 2]) continue;
    if (nb === start) {
      if (path.length >= 3) found.push([...path]);
    } else if (!path.includes(nb) && path.length < maxSize) {
      dfsCycles(edges, start, nb, [...path, nb], maxSize, found);
    }
  }
}
