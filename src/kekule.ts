// The text projection of an aromatic ring is its Kekulé form — the
// TypeScript mirror of AsciiChem::Structure::Kekule (asciichem-ruby#188).
//
// Aromatic text bonds are unparseable (the Lewis lone-pair prefix owns
// ':' in every position an aromatic bond could occupy), so `c1ccccc1`
// renders as `C1=C-C=C-C=C1`. A Kekulé assignment is a perfect
// matching on the component's atoms (each atom exactly one double
// bond), found by deterministic backtracking in Graph edge order
// (include before skip) so all runtimes derive identical output.
// Closure edges are never chosen: ring-closure digits are single by
// grammar, so a matching that doubles one would silently lose that
// bond's order in the text. Components with no perfect matching (odd
// rings like furan) stay out of the projection and keep the aromatic
// rendering (the spec'd text loss). The model itself is never touched
// — the projection is a render-time view, exactly like perception.
import type { Bond, Molecule } from "./model.js";
import { buildGraph, type Edge } from "./structure.js";

export type KekuleKind = "double" | "single";

// The Kekulé projection of `molecule`'s aromatic bonds, keyed by Bond
// reference (Maps key by identity). Every chain bond of a kekulized
// component gets its assigned kind — the single-assigned bonds must
// also lose the aromatic glyph or the text wouldn't re-parse.
export function bondKinds(molecule: Molecule): Map<Bond, KekuleKind> {
  const kinds = new Map<Bond, KekuleKind>();
  const { edges } = buildGraph(molecule);
  const aromatic = edges.filter((edge) => edge.kind === "aromatic");
  if (aromatic.length === 0) return kinds;

  for (const component of components(aromatic)) {
    const indices = matching(component);

    if (!indices) continue;
    component.forEach((edge, index) => {
      if (edge.bond) kinds.set(edge.bond, indices.includes(index) ? "double" : "single");
    });
  }
  return kinds;
}

// Connected components of the aromatic subgraph (edges sharing
// atoms). Edges leave in shift order — the Ruby port's order.
function components(aromatic: Edge[]): Edge[][] {
  const found: Edge[][] = [];
  const remaining = [...aromatic];
  while (remaining.length > 0) {
    const seed = remaining.shift() as Edge;
    const component = [seed];
    const atoms = [seed.from, seed.to];
    let grew = true;
    while (grew) {
      grew = false;
      const kept: Edge[] = [];
      for (const edge of remaining) {
        if (atoms.includes(edge.from) || atoms.includes(edge.to)) {
          component.push(edge);
          atoms.push(edge.from, edge.to);
          grew = true;
        } else {
          kept.push(edge);
        }
      }
      remaining.length = 0;
      remaining.push(...kept);
    }
    found.push(component);
  }
  return found;
}

// Indices of a perfect matching over the component's atoms, or
// undefined. Closure edges are unchoosable.
function matching(component: Edge[]): number[] | undefined {
  const atomSet = [...new Set(component.flatMap((edge) => [edge.from, edge.to]))];
  const counts = new Map<number, number>();
  const chosen: number[] = [];
  let found: number[] | undefined;
  search(component, 0, chosen, counts, atomSet, (indices) => {
    found = indices;
  });
  return found;
}

// Depth-first with include before skip; returns true once a matching
// has been reported (the caller stops exploring further branches).
function search(
  component: Edge[],
  index: number,
  chosen: number[],
  counts: Map<number, number>,
  atomSet: number[],
  report: (indices: number[]) => void,
): boolean {
  if (index === component.length) {
    if (atomSet.every((atom) => (counts.get(atom) ?? 0) === 1)) {
      report([...chosen]);
      return true;
    }
    return false;
  }
  const edge = component[index];
  const chain = Math.abs(edge.from - edge.to) === 1;
  const fromCount = counts.get(edge.from) ?? 0;
  const toCount = counts.get(edge.to) ?? 0;
  if (chain && fromCount !== 1 && toCount !== 1) {
    counts.set(edge.from, fromCount + 1);
    counts.set(edge.to, toCount + 1);
    chosen.push(index);
    const matched = search(component, index + 1, chosen, counts, atomSet, report);
    chosen.pop();
    counts.set(edge.from, fromCount);
    counts.set(edge.to, toCount);
    if (matched) return true;
  }
  return search(component, index + 1, chosen, counts, atomSet, report);
}
