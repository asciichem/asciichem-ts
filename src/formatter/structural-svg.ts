// Structural SVG renderer: 2D skeletal diagram of a bonded molecule.
// Atoms are labelled at their laid-out positions; bonds are drawn as
// lines (double/triple parallel), solid wedges as filled triangles,
// hash bonds as hatches, dative as arrowed lines. Falls back to the
// linear renderer for structures without bonds.
import {
  Adduct,
  Atom,
  Calculation,
  Crystal,
  ElectronConfiguration,
  EmbeddedMath,
  Formula,
  Group,
  Mechanism,
  Molecule,
  Node,
  Reaction,
  ReactionCascade,
  Spectrum,
  Text,
  Visitor,
  ZMatrix,
  registerRenderer,
} from "../model.js";
import { Bond } from "../model.js";
import { layoutMolecule, LayoutGraph, Point, unclosedRingAtoms } from "../layout.js";
import { SvgFormatter } from "./svg.js";

const FONT_SIZE = 15;
const LABEL_RADIUS = 11; // bond lines stop this far from atom centers

// Tetrahedral wedge synthesis: a chirality-carrying atom (the SMILES
// @/@@ parity, TH1/TH2 in the model) with no authored wedge/hash of
// its own draws one synthesized wedge/hash so enantiomers render as
// distinguishable drawings. The model's parity is defined against the
// reference ligand order — the stated hydrogens first, then the
// neighbours in bond order (the SMILES writer's chirality order) —
// and the synthesized wedge realizes that hand against the laid-out
// neighbour geometry: the wedged ligand rises out of the plane (hash:
// sinks), the stated hydrogen sits at the tetrahedral completion
// opposite the drawn neighbours, and the wedge/hash choice is the one
// whose 3D orientation matches the parity. Synthesis declines (the
// drawing renders exactly as without it) rather than guesses: atoms
// whose ligand set is not tetrahedral, atoms with no claimable plain
// single bond, and degenerate (zero-volume) drawn geometries.
interface SynthesizedWedge {
  center: number;
  neighbor: number;
  hash: boolean;
}

export function synthesizeStereoWedges(
  graph: LayoutGraph,
  positions: Point[],
): Map<number, SynthesizedWedge> {
  const claimed = new Map<number, SynthesizedWedge>();
  const used = new Set<number>();

  graph.atoms.forEach((atom, index) => {
    if (atom.chirality !== "TH1" && atom.chirality !== "TH2") return;
    const statedH = (atom.hydrogens ?? 0) > 0;

    const neighbors: number[] = [];
    graph.bonds.forEach((bond) => {
      if (bond.from === index) neighbors.push(bond.to);
      else if (bond.to === index) neighbors.push(bond.from);
    });
    if (new Set(neighbors).size !== neighbors.length) return;
    if (neighbors.length + (statedH ? 1 : 0) !== 4) return;

    // Claim this centre's wedge on the first incident bond (bond
    // order) that is a plain single and not already carrying another
    // centre's synthesized wedge; authored wedge/hash bonds are
    // rendered verbatim and never claimed.
    let bondIndex = -1;
    let neighbor = -1;
    graph.bonds.forEach((bond, i) => {
      if (bondIndex !== -1 || used.has(i) || bond.bond.kind !== "single") return;
      if (bond.from !== index && bond.to !== index) return;
      bondIndex = i;
      neighbor = bond.from === index ? bond.to : bond.from;
    });
    if (bondIndex === -1) return;
    const wedgeSlot = neighbors.indexOf(neighbor);

    const center = positions[index];
    const vectors = neighbors.map((n) => ({
      x: positions[n].x - center.x,
      y: positions[n].y - center.y,
    }));
    const hx = -vectors.reduce((sum, v) => sum + v.x, 0);
    const hy = -vectors.reduce((sum, v) => sum + v.y, 0);

    // Ligand points in reference order under a plain wedge (the
    // wedged ligand at +z toward the viewer, the stated H opposite);
    // a hash flips both out-of-plane signs, which inverts the
    // orientation exactly once.
    const points: [number, number, number][] = [];
    if (statedH) points.push([hx, hy, -1]);
    neighbors.forEach((_, i) => {
      points.push([vectors[i].x, vectors[i].y, i === wedgeSlot ? 1 : 0]);
    });
    const sign = Math.sign(orientation(points));
    if (sign === 0) return;

    // The fitted polarity (asciichem-rs's tests/stereo_depiction.rs
    // oracle gate): the stated-H construction (two out-of-plane
    // ligands) and the four-drawn-ligand construction (one apex) are
    // different point sets, so TH1's orientation target differs per
    // construction — each fitted against the engine, TH2 negated.
    const target =
      atom.chirality === "TH1" === statedH ? 1 : -1;
    used.add(bondIndex);
    claimed.set(bondIndex, {
      center: index,
      neighbor,
      hash: sign !== target,
    });
  });

  return claimed;
}

// The orientation sign of a tetrahedral ligand set: the scalar triple
// product of the first three ligand vectors against the fourth.
function orientation(points: [number, number, number][]): number {
  const [a, b, c, d] = points;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  return (
    (u[1] * v[2] - u[2] * v[1]) * w[0] +
    (u[2] * v[0] - u[0] * v[2]) * w[1] +
    (u[0] * v[1] - u[1] * v[0]) * w[2]
  );
}

export class StructuralSvgFormatter implements Visitor<string> {
  visitFormula(formula: Formula): string {
    const children = formula.nodes.map((n) => this.render(n));
    const boxes = children.map(viewBoxOf);
    const bounds = unionBoxes(boxes);
    const inner = children
      .map((svg, i) => {
        const b = boxes[i];
        // The child's content is drawn in its own viewBox coordinates
        // (negative-origin for most layouts). Carrying the child's
        // viewBox maps that content into the placed viewport; without
        // it, raw coordinates paint outside the outer viewBox.
        return `<svg x="${round(b.minX - bounds.minX)}" y="${round(b.minY - bounds.minY)}" width="${round(b.width)}" height="${round(b.height)}" viewBox="${round(b.minX)} ${round(b.minY)} ${round(b.width)} ${round(b.height)}" overflow="visible">${stripOuter(svg)}</svg>`;
      })
      .map((s) => `    ${s}`)
      .join("\n");
    const width = Math.max(bounds.maxX - bounds.minX, 40);
    const height = Math.max(bounds.maxY - bounds.minY, 40);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}" role="img">\n${inner}\n</svg>`;
  }

  visitAdduct(adduct: Adduct): string {
    return new SvgFormatter().render(adduct);
  }

  visitMolecule(molecule: Molecule): string {
    const hasBond = molecule.nodes.some((n) => n instanceof Bond);
    if (!hasBond) {
      // No authored connectivity: a formula is not a structure (the
      // isomerism point) — render typographically.
      return new SvgFormatter().render(molecule);
    }
    const { graph, positions } = layoutMolecule(molecule);
    const wedges = synthesizeStereoWedges(graph, positions);
    const elements: string[] = [];
    const drawn = new Set<string>();

    for (const [bondIndex, bond] of graph.bonds.entries()) {
      const key = bond.from < bond.to ? `${bond.from}-${bond.to}` : `${bond.to}-${bond.from}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const wedge = wedges.get(bondIndex);
      if (wedge) {
        // The synthesized glyph points centre → neighbour: narrow at
        // the stereocentre, widening (or hatching) toward the ligand.
        elements.push(
          bondElement(
            positions[wedge.center],
            positions[wedge.neighbor],
            new Bond(wedge.hash ? "hash" : "wedge"),
          ),
        );
      } else {
        elements.push(bondElement(positions[bond.from], positions[bond.to], bond.bond));
      }
    }

    graph.atoms.forEach((atom, i) => {
      elements.push(atomElement(atom, positions[i]));
    });

    for (const i of unclosedRingAtoms(graph.atoms)) {
      const pos = positions[i];
      elements.push(
        `<text x="${round(pos.x + 14)}" y="${round(pos.y - 10)}" font-size="10" fill="#b45309" font-family="monospace">?</text>`,
      );
    }

    const xs = positions.map((p) => p.x).concat([freeLabelExtent(positions)]);
    const ys = positions.map((p) => p.y);
    const bounds = boundsOf(
      Math.min(...xs) - 24,
      Math.min(...ys) - 24,
      Math.max(...xs) + 24,
      Math.max(...ys) + 24,
    );
    return wrap(elements, bounds);
  }

  visitAtom(atom: Atom): string {
    return new SvgFormatter().render(atom);
  }

  private render(node: Node): string {
    if (node instanceof Molecule) return this.visitMolecule(node);
    // Reactions and beyond-formulas nodes fall back to the linear
    // renderer; structural diagrams are molecule-scoped.
    return new SvgFormatter().render(node);
  }

  // The remaining visitors exist to satisfy the Visitor interface; the
  // render() fallback handles all of them.
  visitBond(): string {
    return "";
  }
  visitReaction(node: Reaction): string {
    return this.render(node);
  }
  visitReactionCascade(node: ReactionCascade): string {
    return this.render(node);
  }
  visitElectronConfiguration(node: ElectronConfiguration): string {
    return this.render(node);
  }
  visitEmbeddedMath(node: EmbeddedMath): string {
    return this.render(node);
  }
  visitText(node: Text): string {
    return this.render(node);
  }
  visitCrystal(node: Crystal): string {
    return this.render(node);
  }
  visitSpectrum(node: Spectrum): string {
    return this.render(node);
  }
  visitCalculation(node: Calculation): string {
    return this.render(node);
  }
  visitZMatrix(node: ZMatrix): string {
    return this.render(node);
  }
  visitMechanism(node: Mechanism): string {
    return this.render(node);
  }
  visitGroup(node: Group): string {
    return new SvgFormatter().render(node);
  }

  renderTop(node: Node): string {
    return node.accept(this);
  }
}

function bondElement(from: Point, to: Point, bond: Bond): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const a = { x: from.x + ux * LABEL_RADIUS, y: from.y + uy * LABEL_RADIUS };
  const b = { x: to.x - ux * LABEL_RADIUS, y: to.y - uy * LABEL_RADIUS };
  const nx = -uy;
  const ny = ux;
  const lines: string[] = [];

  switch (bond.kind) {
    case "single":
      lines.push(line(a, b));
      break;
    case "aromatic": {
      const el = line(a, b).replace(
        'stroke-width="1.6"',
        'stroke-width="1.6" stroke-dasharray="4 2.5"',
      );
      lines.push(el);
      break;
    }
    case "double":
      lines.push(offsetLine(a, b, nx, ny, -2.6), offsetLine(a, b, nx, ny, 2.6));
      break;
    case "triple":
      lines.push(line(a, b), offsetLine(a, b, nx, ny, -3.4), offsetLine(a, b, nx, ny, 3.4));
      break;
    case "quadruple":
      lines.push(
        offsetLine(a, b, nx, ny, -4.8),
        offsetLine(a, b, nx, ny, -1.6),
        offsetLine(a, b, nx, ny, 1.6),
        offsetLine(a, b, nx, ny, 4.8),
      );
      break;
    case "wedge":
      lines.push(
        `<polygon points="${round(from.x)},${round(from.y)} ${round(b.x + nx * 4)},${round(b.y + ny * 4)} ${round(b.x - nx * 4)},${round(b.y - ny * 4)}" fill="currentColor"/>`,
      );
      break;
    case "hash": {
      for (let t = 0.25; t <= 0.95; t += 0.18) {
        const w = 1.5 + 3.5 * t;
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        lines.push(
          `<line x1="${round(px + nx * w)}" y1="${round(py + ny * w)}" x2="${round(px - nx * w)}" y2="${round(py - ny * w)}" stroke="currentColor" stroke-width="1.2"/>`,
        );
      }
      break;
    }
    case "dative":
      lines.push(`<line x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(b.x)}" y2="${round(b.y)}" stroke="currentColor" stroke-width="1.6"/>`);
      lines.push(arrowHead(b, ux, uy));
      break;
    case "wavy":
      lines.push(wavyPath(a, b));
      break;
  }
  return lines.join("");
}

function arrowHead(b: Point, ux: number, uy: number): string {
  const size = 6;
  const left = { x: b.x - ux * size - uy * size * 0.6, y: b.y - uy * size + ux * size * 0.6 };
  const right = { x: b.x - ux * size + uy * size * 0.6, y: b.y - uy * size - ux * size * 0.6 };
  return `<polyline points="${round(left.x)},${round(left.y)} ${round(b.x)},${round(b.y)} ${round(right.x)},${round(right.y)}" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
}

function wavyPath(a: Point, b: Point): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const waves = Math.max(2, Math.round(len / 12));
  let d = `M ${round(a.x)} ${round(a.y)}`;
  for (let i = 1; i <= waves; i++) {
    const t = i / waves;
    const amp = (i % 2 === 0 ? 1 : -1) * 3.5 * Math.sin(Math.PI * t);
    d += ` L ${round(a.x + dx * t + nx * amp)} ${round(a.y + dy * t + ny * amp)}`;
  }
  return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
}

function line(a: Point, b: Point): string {
  return `<line x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(b.x)}" y2="${round(b.y)}" stroke="currentColor" stroke-width="1.6"/>`;
}

function offsetLine(a: Point, b: Point, nx: number, ny: number, off: number): string {
  return line({ x: a.x + nx * off, y: a.y + ny * off }, { x: b.x + nx * off, y: b.y + ny * off });
}

function atomElement(atom: Atom, pos: Point): string {
  let label = atom.element;
  if (atom.isotope !== undefined) label = `<tspan font-size="10" dy="-4">${escapeXml(atom.isotope)}</tspan><tspan dy="4">${escapeXml(atom.element)}</tspan>`;
  if (atom.charge !== undefined) {
    label += `<tspan font-size="10" dy="-5">${escapeXml(atom.charge)}</tspan>`;
  }
  const anchor = atom.element.length > 1 ? "middle" : "middle";
  return `<text x="${round(pos.x)}" y="${round(pos.y + 5)}" text-anchor="${anchor}" font-family="Helvetica, Arial, sans-serif" font-size="${FONT_SIZE}" font-weight="500" fill="currentColor">${label}</text>`;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

interface Box {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function boundsOf(minX: number, minY: number, maxX: number, maxY: number): Bounds {
  return {
    minX,
    minY,
    maxX,
    maxY,
    get width() {
      return this.maxX - this.minX;
    },
    get height() {
      return this.maxY - this.minY;
    },
  };
}

function viewBoxOf(svg: string): Box {
  const m = /viewBox="([^"]+)"/.exec(svg);
  if (m) {
    const [x, y, w, h] = m[1].trim().split(/\s+/).map(Number);
    return { minX: x, minY: y, width: w, height: h };
  }
  return { minX: 0, minY: 0, width: 40, height: 40 };
}

function unionBoxes(boxes: Box[]): Bounds {
  const all = boxes.length > 0 ? boxes : [{ minX: 0, minY: 0, width: 40, height: 40 }];
  return {
    minX: Math.min(...all.map((b) => b.minX)),
    minY: Math.min(...all.map((b) => b.minY)),
    maxX: Math.max(...all.map((b) => b.minX + b.width)),
    maxY: Math.max(...all.map((b) => b.minY + b.height)),
    get width() {
      return this.maxX - this.minX;
    },
    get height() {
      return this.maxY - this.minY;
    },
  };
}

// Widest right-edge a text label can reach from the rightmost atom.
function freeLabelExtent(positions: Point[]): number {
  return Math.max(...positions.map((p) => p.x + 12));
}

function stripOuter(svg: string): string {
  const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg);
  return inner ? inner[1].trim() : svg;
}

function wrap(elements: string[], bounds: Bounds): string {
  const width = Math.max(bounds.maxX - bounds.minX, 40);
  const height = Math.max(bounds.maxY - bounds.minY, 40);
  const body = elements.map((e) => `    ${e}`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(bounds.minX)} ${round(bounds.minY)} ${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}" role="img">\n  <g fill="none" stroke="currentColor">\n${body}\n  </g>\n</svg>`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

registerRenderer<string>("structural-svg", (node) => new StructuralSvgFormatter().renderTop(node));
