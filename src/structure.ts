// Shared structure plumbing for the interchange formats (SMILES,
// molfile) — the TypeScript mirror of AsciiChem::Structure.
//
// - `buildGraph(molecule)` — model molecule → neutral atom array +
//   bond list (adjacency) using the same pending-bond walk as the
//   layout walker, plus ring-closure edges (aromatic between aromatic
//   atoms — the same default rule the SMILES parser applies).
// - `linearize(atoms, edges)` — adjacency → linear model nodes: bond
//   tokens for consecutive edges, ring-closure digits for the rest,
//   with interval-aware digit reuse (digits pair by occurrence order,
//   so overlapping intervals never share a digit).
import { Atom, Bond, Group, Molecule, Node } from "./model.js";
import { ParseError } from "./errors.js";

export interface Edge {
  from: number;
  to: number;
  kind: Bond["kind"];
}

export function buildGraph(molecule: Molecule): { atoms: Atom[]; edges: Edge[] } {
  const atoms: Atom[] = [];
  const edges: Edge[] = [];
  let pending: Bond | undefined;
  let last: number | undefined;

  const walk = (nodes: Node[]): void => {
    for (const node of nodes) {
      if (node instanceof Atom) {
        const index = atoms.length;
        atoms.push(node);
        if (pending && last !== undefined) {
          edges.push({ from: last, to: index, kind: pending.kind });
        }
        last = index;
        pending = undefined;
      } else if (node instanceof Bond) {
        pending = node;
      } else if (node instanceof Group || node instanceof Molecule) {
        walk(node.nodes);
      }
    }
  };
  walk(molecule.nodes);

  for (const ring of ringBondPairs(atoms)) {
    edges.push({
      from: ring.from,
      to: ring.to,
      kind: atoms[ring.from].aromatic && atoms[ring.to].aromatic ? "aromatic" : "single",
    });
  }

  return { atoms, edges };
}

// Ring-closure pairing by digit occurrence order (RingBonds port).
export function ringBondPairs(atoms: Atom[]): { digit: string; from: number; to: number }[] {
  const open = new Map<string, number>();
  const pairs: { digit: string; from: number; to: number }[] = [];
  atoms.forEach((atom, index) => {
    if (!atom.ringClosures) return;
    for (const digit of atom.ringClosures) {
      const opener = open.get(digit);
      if (opener !== undefined) {
        pairs.push({ digit, from: opener, to: index });
        open.delete(digit);
      } else {
        open.set(digit, index);
      }
    }
  });
  return pairs;
}

const MAX_DIGIT = 9;

export function linearize(atoms: Atom[], edges: Edge[]): Node[] {
  const closeAt: number[] = Array(MAX_DIGIT).fill(-1);
  const digitsFor: string[] = atoms.map(() => "");
  const tokenBefore: (Bond["kind"] | undefined)[] = atoms.map(() => undefined);

  for (const edge of edges) {
    const first = Math.min(edge.from, edge.to);
    const last = Math.max(edge.from, edge.to);
    if (last - first === 1) {
      tokenBefore[last] = edge.kind;
    } else {
      const digitIndex = closeAt.findIndex((closed) => closed <= first);
      if (digitIndex === -1) {
        throw new ParseError(
          `more than ${MAX_DIGIT} overlapping non-adjacent bonds — beyond the model's ring-closure digit capacity`,
        );
      }
      closeAt[digitIndex] = last;
      const digit = String(digitIndex + 1);
      digitsFor[first] += digit;
      digitsFor[last] += digit;
    }
  }

  const nodes: Node[] = [];
  atoms.forEach((atom, index) => {
    const kind = tokenBefore[index];
    if (index > 0 && kind) nodes.push(new Bond(kind));
    atom.ringClosures = digitsFor[index] || undefined;
    nodes.push(atom);
  });
  return nodes;
}
