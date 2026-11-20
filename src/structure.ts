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
  direction?: "up" | "down";
  // The source Bond token (undefined for ring-closure edges — digits
  // carry no kind), so projections can map an assignment back to the
  // node that renders it.
  bond?: Bond;
  // The SMILES reader's structural mark — the linearizer partitions
  // by it instead of index arithmetic (branch atoms parsed before
  // their continuation are index-consecutive and would masquerade as
  // chain tokens). Undefined for edges derived from an
  // already-linearized model.
  shape?: "chain" | "branch" | "ring";
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
          edges.push({
            from: last,
            to: index,
            kind: pending.kind,
            direction: pending.direction,
            bond: pending,
          });
        }
        last = index;
        pending = undefined;
      } else if (node instanceof Bond) {
        pending = node;
      } else if (node instanceof Group || node instanceof Molecule) {
        // A group whose FIRST node is a bond is a BRANCH group: the
        // leading bond attaches the branch to the atom before the
        // group (the branch root), not to whatever atom the flat
        // stream last visited — `C(-O)=O` reads C-O and C=O, never
        // O=O. After the group the continuation resumes from the
        // root.
        let branchRoot: number | undefined;
        if (node instanceof Group && last !== undefined) {
          let first: Node | undefined = node.nodes[0];
          while (first instanceof Molecule) first = first.nodes[0];
          branchRoot = first instanceof Bond ? last : undefined;
        }
        walk(node.nodes);
        if (branchRoot !== undefined) last = branchRoot;
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
  // Partition by the parser's own shape marks — tokens and digits
  // first (so the chain map is complete), then the branch trees. A
  // branch edge inside another branch's tree emits as a NESTED group
  // (the tree emission walks it through children); only top-level
  // branches render at the flat stream. Producers without shape
  // marks (molfile, CML) ride the flat rule: consecutive indices are
  // chain tokens, every other non-ring edge a digit pair — the shape
  // those producers were recorded against.
  const closeAt: number[] = Array(MAX_DIGIT).fill(-1);
  const digitsFor: string[] = atoms.map(() => "");
  const tokenBefore: (Edge | undefined)[] = atoms.map(() => undefined);
  const children: Edge[][] = atoms.map(() => []);
  const inBranch = new Set<number>();
  const branchEdges: Edge[] = [];

  for (const edge of edges) {
    if (edge.shape === "branch") {
      branchEdges.push(edge);
    } else if (edge.shape === "chain" || (edge.shape === undefined && Math.abs(edge.to - edge.from) === 1)) {
      tokenBefore[edge.to] = edge;
      children[edge.from].push(edge);
    } else {
      const first = Math.min(edge.from, edge.to);
      const last = Math.max(edge.from, edge.to);
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
  for (const edge of branchEdges) {
    collectBranch(edge.to);
    children[edge.from].push(edge);
  }
  const branchAt = new Map<number, Edge[]>();
  for (const edge of branchEdges) {
    if (!inBranch.has(edge.from)) {
      const list = branchAt.get(edge.from) ?? [];
      list.push(edge);
      branchAt.set(edge.from, list);
    }
  }

  function collectBranch(start: number): void {
    inBranch.add(start);
    for (const edge of children[start]) collectBranch(edge.to);
  }

  // The branch's group: the leading bond, then the tree's atoms in
  // walk order with their chain tokens.
  function branchGroup(edge: Edge): Group {
    const nodes: Node[] = [new Bond(edge.kind, edge.direction)];
    emitTree(edge.to, nodes);
    return new Group(nodes, undefined, "paren");
  }

  function emitTree(atomIndex: number, nodes: Node[]): void {
    const atom = atoms[atomIndex];
    if (digitsFor[atomIndex]) atom.ringClosures = digitsFor[atomIndex];
    nodes.push(atom);
    // Branch groups sit directly after their parent atom (the walkers
    // bind a group's leading bond to the atom before it — emitting a
    // continuation first would steal the binding).
    for (const edge of children[atomIndex]) {
      if (branchEdges.includes(edge)) nodes.push(branchGroup(edge));
    }
    for (const edge of children[atomIndex]) {
      if (branchEdges.includes(edge)) continue;
      nodes.push(new Bond(edge.kind, edge.direction));
      emitTree(edge.to, nodes);
    }
  }

  const nodes: Node[] = [];
  atoms.forEach((atom, index) => {
    if (inBranch.has(index)) return;
    const edge = tokenBefore[index];
    if (index > 0 && edge) nodes.push(new Bond(edge.kind, edge.direction));
    atom.ringClosures = digitsFor[index] || undefined;
    nodes.push(atom);
    for (const branch of branchAt.get(index) ?? []) nodes.push(branchGroup(branch));
  });
  return nodes;
}
