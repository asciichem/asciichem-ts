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

// pi-electron-donating heteroatoms: a ring atom with no double bond
// of its own contributes its lone pair (pyrrole N, furan O,
// thiophene S) — the 2 electrons that make those five-membered rings
// 4n+2.
export const LONE_PAIR_DONORS = ["N", "O", "S", "P", "Se", "As"];

// Aromatic rings by Hueckel counting: 5- and 6-membered cycles whose
// pi contributions total 6 or 10 (4n+2 with n >= 1; n = 0 is a charged
// three-membered ring, which perception declines). Per atom: an
// in-system double bond contributes 1; a lone-pair donor with no
// double contributes 2; a carbon with only single bonds or an
// exocyclic double contributes 0. Charged atoms make the count
// undecidable and the ring is declined; aromatic-flagged rings are
// taken as stated.
//
// This sees fused systems (naphthalene's shared bond is single, but
// each atom's double bond lies in the ring system) and keeps quinones
// out (their carbons' only doubles point at exocyclic oxygens).
export function aromaticRings(atoms: Atom[], edges: Edge[]): number[][] {
  const cycles = ringCycles(edges, atoms.length);
  const cyclicAtoms = new Set(cycles.flat());
  return cycles.filter((cycle) => aromaticCycle(cycle, atoms, edges, cyclicAtoms));
}

function aromaticCycle(
  cycle: number[],
  atoms: Atom[],
  edges: Edge[],
  cyclicAtoms: Set<number>,
): boolean {
  if (cycle.some((i) => atoms[i].aromatic === true)) return true;
  if (cycle.length !== 5 && cycle.length !== 6) return false;
  const electrons = cycle.map((i) => ringPiElectrons(atoms[i], i, edges, cyclicAtoms));
  if (electrons.some((e) => e === null)) return false;
  const total = electrons.reduce<number>((sum, e) => sum + (e as number), 0);
  return total === 6 || total === 10;
}

function ringPiElectrons(
  atom: Atom,
  atomIndex: number,
  edges: Edge[],
  cyclicAtoms: Set<number>,
): number | null {
  if (atom.charge != null) return null;
  if (inSystemDouble(atomIndex, edges, cyclicAtoms)) return 1;
  if (LONE_PAIR_DONORS.includes(atom.element)) return 2;
  return 0;
}

function inSystemDouble(atomIndex: number, edges: Edge[], cyclicAtoms: Set<number>): boolean {
  return edges.some((edge) => {
    if (edge.from !== atomIndex && edge.to !== atomIndex) return false;
    if (edge.kind !== "double") return false;
    const partner = edge.from === atomIndex ? edge.to : edge.from;
    return cyclicAtoms.has(partner);
  });
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
