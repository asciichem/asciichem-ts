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

const COLLISION_RADIUS = BOND_LENGTH / 2;

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

// Rings first, in source order. Each cycle is placed free (nothing
// placed yet), fused (two or more atoms already placed — fit the
// polygon to them), or anchored (one placed atom — orient away from
// the placed region).
export function placeGraph(graph: LayoutGraph): Point[] {
  const positions: (Point | undefined)[] = graph.atoms.map(() => undefined);

  const cycles: RingCycle[] = [];
  for (const closure of graph.ringBonds) {
    const path = ringCycle(graph, closure);
    if (path && path.length >= 3) cycles.push({ members: path });
  }

  let freeCenterX = 0;
  for (const cycle of cycles) {
    const anchored = cycle.members.filter((m) => positions[m] !== undefined);
    if (anchored.length === 0) {
      freeCenterX = placeFreeCycle(cycle.members, positions, freeCenterX);
    } else if (anchored.length >= 2) {
      placeFusedCycle(cycle.members, positions);
    } else {
      placeAnchoredCycle(cycle.members, positions);
    }
  }

  // Grow chains breadth-first from every placed atom (zigzag), then
  // from any still-unplaced atom (new component at origin baseline).
  for (let i = 0; i < graph.atoms.length; i++) {
    if (positions[i] === undefined) continue;
    grow(i, positions, graph);
  }
  for (let i = 0; i < graph.atoms.length; i++) {
    if (positions[i] !== undefined) continue;
    positions[i] = { x: freeCenterX, y: 0 };
    freeCenterX += BOND_LENGTH;
    grow(i, positions, graph);
  }

  return positions as Point[];
}

function placeFreeCycle(members: number[], positions: (Point | undefined)[], freeCenterX: number): number {
  const radius = polygonRadius(members.length);
  placePolygon(members, { x: freeCenterX, y: 0 }, radius, 0, positions);
  return freeCenterX + radius * 2 + BOND_LENGTH;
}

// Fused on shared atoms: derive the rigid transform (rotation +
// translation) that maps the ideal polygon's two placed members onto
// their laid-out positions, then fill only the unplaced members.
// Placed atoms never move — the first ring keeps its geometry.
function placeFusedCycle(members: number[], positions: (Point | undefined)[]): void {
  const a = members.find((m) => positions[m] !== undefined)!;
  const b = members.find((m) => positions[m] !== undefined && m !== a)!;
  const ia = members.indexOf(a);
  const ib = members.indexOf(b);
  const idealA = idealPoint(members.length, ia, 0);
  const idealB = idealPoint(members.length, ib, 0);
  const theta =
    Math.atan2(positions[b]!.y - positions[a]!.y, positions[b]!.x - positions[a]!.x) -
    Math.atan2(idealB.y - idealA.y, idealB.x - idealA.x);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  members.forEach((member, i) => {
    if (positions[member] !== undefined) return;
    const ideal = idealPoint(members.length, i, 0);
    const dx = ideal.x - idealA.x;
    const dy = ideal.y - idealA.y;
    positions[member] = {
      x: positions[a]!.x + dx * cos - dy * sin,
      y: positions[a]!.y + dx * sin + dy * cos,
    };
  });
}

// One placed atom: centre the polygon outward, away from the
// centroid of everything already placed (a spiro centre must not
// fold the new ring back onto the old one). The anchor sits opposite
// the centre direction, so the shift must put the anchor's own
// vertex there (+π).
function placeAnchoredCycle(members: number[], positions: (Point | undefined)[]): void {
  const anchor = members.find((m) => positions[m] !== undefined)!;
  const anchorIndex = members.indexOf(anchor);
  const anchorPos = positions[anchor]!;
  const vertexAngle = angleOfMember(members.length, anchorIndex);
  const centerAngle = centerAngleAwayFromPlaced(anchorPos, positions, vertexAngle);
  const shift = centerAngle + Math.PI - vertexAngle;
  const radius = polygonRadius(members.length);
  const center = {
    x: anchorPos.x + radius * Math.cos(centerAngle),
    y: anchorPos.y + radius * Math.sin(centerAngle),
  };
  members.forEach((member, i) => {
    if (positions[member] !== undefined) return;
    const ideal = idealPoint(members.length, i, shift);
    positions[member] = { x: center.x + ideal.x, y: center.y + ideal.y };
  });
}

function centerAngleAwayFromPlaced(
  anchorPos: Point,
  positions: (Point | undefined)[],
  fallback: number,
): number {
  const placed = positions.filter((p) => p !== undefined) as Point[];
  if (placed.length < 2) return fallback;
  const centroid = {
    x: placed.reduce((sum, p) => sum + p.x, 0) / placed.length,
    y: placed.reduce((sum, p) => sum + p.y, 0) / placed.length,
  };
  return Math.atan2(anchorPos.y - centroid.y, anchorPos.x - centroid.x);
}

// Zigzag growth: each generation turns the opposite way from its
// parent, so chains alternate instead of curling. Tracked per atom
// as [parent, incomingAngle, turn].
function grow(start: number, positions: (Point | undefined)[], graph: LayoutGraph): void {
  const startPos = positions[start]!;
  const visited = new Map<number, [number | undefined, number, number]>([
    [start, [undefined, Math.atan2(startPos.y, startPos.x), -1]],
  ]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentPos = positions[current];
    if (!currentPos) continue;
    const [, incomingAngle] = visited.get(current)!;
    const children = neighborsOf(graph, current).filter(
      (n) => !visited.has(n) && positions[n] === undefined,
    );
    for (const child of children) {
      if (visited.has(child)) continue;
      const turn = -visited.get(current)![2];
      const angle = incomingAngle + turn * (Math.PI / 3);
      positions[child] = clearPosition(currentPos, angle, positions);
      visited.set(child, [current, angle, turn]);
      queue.push(child);
    }
  }
}

// Try the preferred spot, then spread out; if the preferred spot is
// occupied (another substituent, a ring atom), fall back to the
// candidate farthest from any placed atom. Deterministic: first best
// wins ties.
function clearPosition(fromPos: Point, angle: number, positions: (Point | undefined)[]): Point {
  const candidates = [0, -Math.PI / 3, Math.PI / 3, (-2 * Math.PI) / 3, (2 * Math.PI) / 3, Math.PI].map(
    (spread) => {
      const candidateAngle = angle + spread;
      return {
        x: fromPos.x + BOND_LENGTH * Math.cos(candidateAngle),
        y: fromPos.y + BOND_LENGTH * Math.sin(candidateAngle),
      };
    },
  );
  const occupied = positions.filter((p) => p !== undefined) as Point[];
  for (const candidate of candidates) {
    if (occupied.every((other) => distance(candidate, other) >= COLLISION_RADIUS)) {
      return candidate;
    }
  }
  let best = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = occupied.reduce((sum, other) => sum + distance(candidate, other), 0);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
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
  center: Point,
  radius: number,
  shift = 0,
  positions?: (Point | undefined)[],
): void {
  if (!positions) return;
  members.forEach((atom, i) => {
    const angle = angleOfMember(members.length, i) + shift;
    positions[atom] = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

// The ideal polygon vertex position relative to the centre.
function idealPoint(sides: number, memberIndex: number, shift: number): Point {
  const radius = polygonRadius(sides);
  const angle = angleOfMember(sides, memberIndex) + shift;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export function layoutMolecule(molecule: Molecule): { graph: LayoutGraph; positions: Point[] } {
  const graph = walkMolecule(molecule);
  return { graph, positions: placeGraph(graph) };
}
