// Linear SVG formatter: renders a formula typographically (element
// glyphs with true sub/superscripts), left-to-right on a baseline.
// For bonded molecules with an authored structure, prefer
// StructuralSvgFormatter (2D diagram).
import {
  Atom,
  Bond,
  Calculation,
  Crystal,
  ElectronConfiguration,
  EmbeddedMath,
  Formula,
  Group,
  Mechanism,
  Molecule,
  Node,
  ARROW_KINDS,
  Reaction,
  ReactionCascade,
  Spectrum,
  Text,
  Visitor,
  ZMatrix,
  registerRenderer,
} from "../model.js";

const FONT_SIZE = 16;
const CHAR_WIDTH = FONT_SIZE * 0.62; // monospace-ish estimate
const LINE_HEIGHT = FONT_SIZE * 1.6;

interface Segment {
  text: string;
  dy: number;
  size: number;
}

export class SvgFormatter implements Visitor<string> {
  visitFormula(formula: Formula): string {
    const lines = formula.nodes.map((n) => this.segmentsFor(n));
    return this.document(lines);
  }

  visitMolecule(molecule: Molecule): string {
    return this.document([this.segmentsFor(molecule)]);
  }

  visitAtom(atom: Atom): string {
    return this.document([this.atomSegments(atom)]);
  }

  visitGroup(node: Group): string {
    return this.document([this.segmentsFor(node)]);
  }

  visitBond(node: Bond): string {
    return this.document([this.segmentsFor(node)]);
  }

  visitReaction(node: Reaction): string {
    return this.document([this.segmentsFor(node)]);
  }

  visitReactionCascade(node: ReactionCascade): string {
    return this.document([this.segmentsFor(node)]);
  }

  visitElectronConfiguration(node: ElectronConfiguration): string {
    return this.document([this.segmentsFor(node)]);
  }

  visitEmbeddedMath(node: EmbeddedMath): string {
    return this.document([this.segmentsFor(node)]);
  }

  visitText(node: Text): string {
    return this.document([this.segmentsFor(node)]);
  }

  visitCrystal(node: Crystal): string {
    return this.document([this.segmentsFor(node)]);
  }

  visitSpectrum(node: Spectrum): string {
    return this.document([this.segmentsFor(node)]);
  }

  visitCalculation(node: Calculation): string {
    return this.document([this.segmentsFor(node)]);
  }

  visitZMatrix(node: ZMatrix): string {
    return this.document([this.segmentsFor(node)]);
  }

  visitMechanism(node: Mechanism): string {
    return this.document([this.segmentsFor(node)]);
  }

  private segmentsFor(node: Node): Segment[] {
    if (node instanceof Formula) {
      return node.nodes.flatMap((n) => this.segmentsFor(n));
    }
    if (node instanceof Molecule) {
      const segments: Segment[] = [];
      if (node.stereo !== undefined) {
        segments.push(seg(`(${node.stereoLetter})-`, 0));
      }
      if (node.coefficient !== undefined) segments.push(seg(node.coefficient, 0));
      for (const child of node.nodes) segments.push(...this.segmentsFor(child));
      return segments;
    }
    if (node instanceof Atom) return this.atomSegments(node);
    if (node instanceof Group) {
      const segments: Segment[] = [seg(node.openChar, 0)];
      for (const child of node.nodes) segments.push(...this.segmentsFor(child));
      segments.push(seg(node.closeChar, 0));
      if (node.multiplicity !== undefined) segments.push(seg(node.multiplicity, +4));
      return segments;
    }
    if (node instanceof Bond) {
      return [seg(bondGlyph(node), 0)];
    }
    if (node instanceof Reaction) {
      return [
        ...node.reactants.flatMap((m) => this.segmentsFor(m)),
        seg(" ", 0),
        seg(arrowGlyph(node.arrow), 0),
        ...(node.conditions?.above !== undefined ? [seg(`[${node.conditions.above}]`, -8)] : []),
        ...(node.conditions?.below !== undefined ? [seg(`[${node.conditions.below}]`, +12)] : []),
        seg(" ", 0),
        ...node.products.flatMap((m) => this.segmentsFor(m)),
      ];
    }
    if (node instanceof ReactionCascade) {
      const segments: Segment[] = [];
      const [head, ...tail] = node.steps;
      segments.push(...head.reactants.flatMap((m) => this.segmentsFor(m)));
      for (const step of [head, ...tail]) {
        segments.push(seg(" ", 0), seg(arrowGlyph(step.arrow), 0));
        if (step.conditions?.above !== undefined)
          segments.push(seg(`[${step.conditions.above}]`, -8));
        if (step.conditions?.below !== undefined)
          segments.push(seg(`[${step.conditions.below}]`, +12));
        segments.push(seg(" ", 0));
        segments.push(...step.products.flatMap((m) => this.segmentsFor(m)));
      }
      return segments;
    }
    if (node instanceof ElectronConfiguration) {
      const segments: Segment[] = [];
      node.orbitals.forEach(([orb, occ], i) => {
        if (i > 0) segments.push(seg(" ", 0));
        segments.push(seg(orb, 0), seg(occ, -6));
      });
      return segments;
    }
    if (node instanceof EmbeddedMath) return [seg(`\`${node.source}\``, 0)];
    if (node instanceof Text) return [seg(`"${node.content}"`, 0)];
    if (node instanceof Crystal) return [seg(node.toText(), 0)];
    if (node instanceof Spectrum) return [seg(node.toText().split("\n")[0], 0)];
    if (node instanceof Calculation) return [seg(node.toText().split("\n")[0], 0)];
    if (node instanceof ZMatrix) return [seg(node.toText().split("\n")[0], 0)];
    if (node instanceof Mechanism) return [seg(node.toText().split("\n")[0], 0)];
    return [seg(node.toText(), 0)];
  }

  private atomSegments(atom: Atom): Segment[] {
    const segments: Segment[] = [];
    if (atom.lonePairs !== undefined) segments.push(seg(":".repeat(atom.lonePairs), -6));
    if (atom.isotope !== undefined) segments.push(seg(atom.isotope, -6));
    segments.push(seg(atom.element, 0));
    if (atom.subscript !== undefined) segments.push(seg(atom.subscript, +5));
    if (atom.superscript !== undefined) segments.push(seg(atom.superscript, -6));
    if (atom.charge !== undefined) segments.push(seg(atom.charge, -6));
    if (atom.oxidationState !== undefined) segments.push(seg(`(${atom.oxidationState})`, -6));
    if (atom.radicalElectrons !== undefined) segments.push(seg("·".repeat(atom.radicalElectrons), -6));
    if (atom.ringClosures !== undefined) segments.push(seg(atom.ringClosures, 0));
    return segments;
  }

  private document(lines: Segment[][]): string {
    const tspans = lines
      .map((segments, lineIndex) => {
        const baseline = 20 + lineIndex * LINE_HEIGHT;
        let x = 4;
        let out = "";
        for (const s of segments) {
          out += `<tspan x="${round(x)}" y="${round(baseline + s.dy)}" font-size="${round(s.size)}">${escapeXml(s.text)}</tspan>`;
          x += s.text.length * CHAR_WIDTH * (s.size / FONT_SIZE);
        }
        return `    <text x="4" y="${round(baseline)}" font-family="monospace" font-size="${FONT_SIZE}">${out}</text>`;
      })
      .join("\n");
    const width = Math.max(
      ...lines.map((segments) => segments.reduce((w, s) => w + s.text.length * CHAR_WIDTH, 0)),
      40,
    );
    const height = Math.max(lines.length, 1) * LINE_HEIGHT + 12;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}" role="img">\n${tspans}\n  </svg>`;
  }

  render(node: Node): string {
    return node.accept(this);
  }
}

function seg(text: string, dy: number): Segment {
  return { text, dy, size: dy === 0 ? FONT_SIZE : FONT_SIZE * 0.72 };
}

function bondGlyph(bond: Bond): string {
  switch (bond.kind) {
    case "single":
      return "–";
    case "double":
      return "═";
    case "triple":
      return "≡";
    case "quadruple":
      return "≣";
    case "wedge":
      return "▲–";
    case "hash":
      return "–▨";
    case "dative":
      return "→";
    case "wavy":
      return "∼";
  }
}

function arrowGlyph(kind: keyof typeof ARROW_KINDS): string {
  switch (kind) {
    case "forward":
      return "→";
    case "reverse":
      return "←";
    case "equilibrium":
      return "⇌";
    case "resonance":
      return "↔";
  }
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

registerRenderer<string>("svg", (node) => new SvgFormatter().render(node));
