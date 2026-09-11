// Deterministic 2D layout for bonded molecules. Ports the reference
// decomposition: a pure walker produces a neutral atom+bond graph
// (ring-closure pairing mirrors AsciiChem::RingBonds), then a
// chemistry-shaped deterministic placer — rings as regular polygons
// (fused rings anchored on shared atoms), chains as 120-degree
// zigzags grown breadth-first in source order.
import { Atom, Bond, Group, Molecule, Node } from "./model.js";

export interface RingBond {
  digit: string;
  fromAtom: number;
  toAtom: number;
}

export interface LayoutGraph {
  atoms: Atom[];
  bonds: { from: number; to: number; bond: Bond }[];
  ringBonds: RingBond[];
}

export interface Point {
  x: number;
  y: number;
}

export const BOND_LENGTH = 56;

// Ring-closure pairing, ported from AsciiChem::RingBonds: walk atoms
// in source order; a repeated digit closes the ring between the
// opener and the closer. Multiple digits per atom open in parallel.
export function ringBonds(atoms: Atom[]): RingBond[] {
  const openRings = new Map<string, number>();
  const bonds: RingBond[] = [];
  atoms.forEach((atom, index) => {
    if (!atom.ringClosures) return;
    for (const digit of atom.ringClosures) {
      const opener = openRings.get(digit);
      if (opener !== undefined) {
        bonds.push({ digit, fromAtom: opener, toAtom: index });
        openRings.delete(digit);
      } else {
        openRings.set(digit, index);
      }
    }
  });
  return bonds;
}

export function unclosedRingAtoms(atoms: Atom[]): number[] {
  const openRings = new Map<string, number>();
  atoms.forEach((atom, index) => {
    if (!atom.ringClosures) return;
    for (const digit of atom.ringClosures) {
      if (openRings.has(digit)) openRings.delete(digit);
      else openRings.set(digit, index);
    }
  });
  return [...openRings.values()];
}

// Walks a molecule into a neutral atom+bond graph. Bond tokens
// connect the last atom of the previous unit to the first atom of
// the next; nested groups contribute their walk order.
export function walkMolecule(molecule: Molecule): LayoutGraph {
  const atoms: Atom[] = [];
  const bonds: LayoutGraph["bonds"] = [];

  const walk = (node: Node): { first: number; last: number } | undefined => {
    if (node instanceof Atom) {
      atoms.push(node);
      return { first: atoms.length - 1, last: atoms.length - 1 };
    }
    if (node instanceof Group) {
      let first: number | undefined;
      let last: number | undefined;
      for (const child of node.nodes) {
        const span = walk(child);
        if (span) {
          if (first === undefined) first = span.first;
          last = span.last;
        }
      }
      return first !== undefined && last !== undefined ? { first, last } : undefined;
    }
    return undefined;
  };

  let previous: number | undefined;
  let pendingBond: Bond | undefined;
  for (const unit of molecule.nodes) {
    if (unit instanceof Bond) {
      pendingBond = unit;
      continue;
    }
    const span = walk(unit);
    if (span) {
      if (previous !== undefined && pendingBond) {
        bonds.push({ from: previous, to: span.first, bond: pendingBond });
      }
      previous = span.last;
      pendingBond = undefined;
    }
  }

  const rings = ringBonds(atoms);
  for (const ring of rings) {
    bonds.push({ from: ring.fromAtom, to: ring.toAtom, bond: new Bond("single") });
  }

  return { atoms, bonds, ringBonds: rings };
}

// -- placement -----------------------------------------------------------

function neighborsOf(graph: LayoutGraph, node: number): number[] {
  const out: number[] = [];
  for (const b of graph.bonds) {
    if (b.from === node) out.push(b.to);
    else if (b.to === node) out.push(b.from);
  }
  return out;
}

// Shortest path between the closure endpoints, excluding the closure
// edge itself — the path plus the closure edge is the ring cycle.
function ringCycle(graph: LayoutGraph, closure: RingBond): number[] | undefined {
  const queue: number[][] = [[closure.fromAtom]];
  const visited = new Set<number>([closure.fromAtom]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const node = path[path.length - 1];
    if (node === closure.toAtom) return path;
    for (const neighbor of neighborsOf(graph, node)) {
      const isClosureEdge =
        (node === closure.fromAtom && neighbor === closure.toAtom) ||
        (node === closure.toAtom && neighbor === closure.fromAtom);
      if (isClosureEdge || visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push([...path, neighbor]);
    }
  }
  return undefined;
}

interface RingCycle {
  members: number[]; // ordered around the ring
}

export function placeGraph(graph: LayoutGraph): Point[] {
  const positions: (Point | undefined)[] = graph.atoms.map(() => undefined);

  const cycles: RingCycle[] = [];
  for (const closure of graph.ringBonds) {
    const path = ringCycle(graph, closure);
    if (path && path.length >= 3) cycles.push({ members: path });
  }

  // Place rings first: each ring is a regular polygon. A ring with an
  // already-placed member anchors on it (fused look); a ring in a new
  // component starts at the next free center to the right.
  let freeCenterX = 0;
  const placedRings: number[][] = [];
  for (const cycle of cycles) {
    const anchorIndex = cycle.members.findIndex((m) => positions[m] !== undefined);
    const radius = polygonRadius(cycle.members.length);
    if (anchorIndex === -1) {
      const center = { x: freeCenterX, y: 0 };
      placePolygon(cycle.members, anchorIndex, center, radius, positions);
      freeCenterX += radius * 2 + BOND_LENGTH;
    } else {
      const anchor = cycle.members[anchorIndex];
      const anchorPos = positions[anchor]!;
      // Direction pointing away from any already-placed neighbor of
      // the anchor; the polygon center sits opposite that direction.
      let outward = Number.NEGATIVE_INFINITY;
      for (const neighbor of neighborsOf(graph, anchor)) {
        const npos = positions[neighbor];
        if (npos) {
          const angle = Math.atan2(anchorPos.y - npos.y, anchorPos.x - npos.x);
          outward = angle;
          break;
        }
      }
      const vertexAngle = angleOfMember(cycle.members.length, anchorIndex);
      const centerAngle = outward === Number.NEGATIVE_INFINITY ? vertexAngle + Math.PI : outward;
      const center = {
        x: anchorPos.x + radius * Math.cos(centerAngle),
        y: anchorPos.y + radius * Math.sin(centerAngle),
      };
      // Rotate the polygon so the anchor lands on its own position.
      const shift = centerAngle - vertexAngle;
      placePolygon(cycle.members, anchorIndex, center, radius, positions, shift);
    }
    placedRings.push(cycle.members);
  }

  // Grow chains breadth-first from every placed atom (zigzag), then
  // from any still-unplaced atom (new component at origin baseline).
  for (let i = 0; i < graph.atoms.length; i++) {
    if (positions[i] === undefined) continue;
    grow(i, positions, graph, new Set([i]));
  }
  for (let i = 0; i < graph.atoms.length; i++) {
    if (positions[i] !== undefined) continue;
    positions[i] = { x: freeCenterX, y: 0 };
    freeCenterX += BOND_LENGTH;
    grow(i, positions, graph, new Set([i]));
  }

  return positions as Point[];
}

function grow(
  start: number,
  positions: (Point | undefined)[],
  graph: LayoutGraph,
  visited: Set<number>,
): void {
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentPos = positions[current];
    if (!currentPos) continue;
    // Direction the chain is travelling: away from the origin of the
    // component (0,0) — keeps zigzags deterministic and horizontal-ish.
    const heading = Math.atan2(-currentPos.y, currentPos.x);
    const children = neighborsOf(graph, current).filter(
      (n) => !visited.has(n) && positions[n] === undefined,
    );
    children.forEach((child, i) => {
      if (visited.has(child)) return;
      const spread = i === 0 ? -Math.PI / 3 : i === 1 ? Math.PI / 3 : 0;
      const angle = heading + spread;
      positions[child] = {
        x: currentPos.x + BOND_LENGTH * Math.cos(angle),
        y: currentPos.y + BOND_LENGTH * Math.sin(angle),
      };
      visited.add(child);
      queue.push(child);
    });
  }
}

function polygonRadius(sides: number): number {
  // Circumradius for a regular polygon with the given side length.
  return BOND_LENGTH / (2 * Math.sin(Math.PI / sides));
}

function angleOfMember(sides: number, memberIndex: number): number {
  return (Math.PI * 2 * memberIndex) / sides - Math.PI / 2;
}

function placePolygon(
  members: number[],
  anchorIndex: number,
  center: Point,
  radius: number,
  positions: (Point | undefined)[],
  shift = 0,
): void {
  members.forEach((atom, i) => {
    const angle = angleOfMember(members.length, i) + shift;
    positions[atom] = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
  void anchorIndex;
}

export function layoutMolecule(molecule: Molecule): { graph: LayoutGraph; positions: Point[] } {
  const graph = walkMolecule(molecule);
  return { graph, positions: placeGraph(graph) };
}
