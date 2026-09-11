// Semantic model — the TypeScript mirror of AsciiChem::Model. Every
// formatter consumes the same tree; the visitor interface is the
// extension point for new output formats (add visit_* methods).
import type { WireNode } from "./wire/types.js";

export type ArrowKind = "forward" | "reverse" | "equilibrium" | "resonance";
export type BondKind =
  | "single"
  | "double"
  | "triple"
  | "quadruple"
  | "wedge"
  | "hash"
  | "dative"
  | "wavy";
export type BracketKind = "paren" | "square" | "brace";
export type StereoKind = "R" | "S" | "E" | "Z" | "alpha" | "beta";

export const BOND_KINDS: Record<BondKind, { ascii: string }> = {
  single: { ascii: "-" },
  double: { ascii: "=" },
  triple: { ascii: "#" },
  quadruple: { ascii: "##" },
  wedge: { ascii: ">-" },
  hash: { ascii: "-<" },
  dative: { ascii: "~>" },
  wavy: { ascii: "~~" },
};

export const ARROW_KINDS: Record<ArrowKind, { ascii: string; wire: ArrowKind }> = {
  forward: { ascii: "->", wire: "forward" },
  reverse: { ascii: "<-", wire: "reverse" },
  equilibrium: { ascii: "<=>", wire: "equilibrium" },
  resonance: { ascii: "<->", wire: "resonance" },
};

export const STEREO_TO_LETTER: Record<StereoKind, string> = {
  R: "R",
  S: "S",
  E: "E",
  Z: "Z",
  alpha: "alpha",
  beta: "beta",
};

export const BRACKETS: Record<BracketKind, { open: string; close: string }> = {
  paren: { open: "(", close: ")" },
  square: { open: "[", close: "]" },
  brace: { open: "{", close: "}" },
};

export interface Visitor<T> {
  visitFormula(node: Formula): T;
  visitMolecule(node: Molecule): T;
  visitAtom(node: Atom): T;
  visitGroup(node: Group): T;
  visitBond(node: Bond): T;
  visitReaction(node: Reaction): T;
  visitReactionCascade(node: ReactionCascade): T;
  visitElectronConfiguration(node: ElectronConfiguration): T;
  visitEmbeddedMath(node: EmbeddedMath): T;
  visitText(node: Text): T;
  visitCrystal(node: Crystal): T;
  visitSpectrum(node: Spectrum): T;
  visitCalculation(node: Calculation): T;
  visitZMatrix(node: ZMatrix): T;
  visitMechanism(node: Mechanism): T;
}

// Formatter registry: formatter modules register themselves on import
// (index.ts imports them all). Keeps model -> formatter decoupled and
// the set open for extension without editing this file.
export type NodeRenderer<T> = (node: Node) => T;
const renderers: Record<string, NodeRenderer<unknown>> = {};

export function registerRenderer<T>(name: string, renderer: NodeRenderer<T>): void {
  renderers[name] = renderer as NodeRenderer<unknown>;
}

function renderWith<T>(name: string, node: Node): T {
  const renderer = renderers[name] as NodeRenderer<T> | undefined;
  if (!renderer) {
    throw new Error(
      `no "${name}" renderer registered — import "asciichem" (not a deep module) to load built-in formatters`,
    );
  }
  return renderer(node);
}

export abstract class Node {
  abstract accept<T>(visitor: Visitor<T>): T;
  abstract readonly type: string;

  toText(): string {
    return renderWith<string>("text", this);
  }

  toSvg(): string {
    return renderWith<string>("svg", this);
  }

  toStructuralSvg(): string {
    return renderWith<string>("structural-svg", this);
  }

  toModelJSON(): WireNode {
    return renderWith<WireNode>("wire", this);
  }
}

export class Formula extends Node {
  readonly type = "formula";
  constructor(readonly nodes: Node[]) {
    super();
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitFormula(this);
  }
}

export class Atom extends Node {
  readonly type = "atom";
  constructor(
    readonly element: string,
    readonly isotope?: string,
    readonly subscript?: string,
    readonly superscript?: string,
    readonly charge?: string,
    readonly oxidationState?: string,
    readonly lonePairs?: number,
    readonly radicalElectrons?: number,
    readonly ringClosures?: string,
    readonly x2?: number,
    readonly y2?: number,
    readonly z2?: number,
    readonly atomParity?: string,
    readonly spinMultiplicity?: string,
    readonly atomTitle?: string,
    readonly xFract?: number,
    readonly yFract?: number,
    readonly zFract?: number,
  ) {
    super();
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitAtom(this);
  }
}

export class Bond extends Node {
  readonly type = "bond";
  constructor(readonly kind: BondKind) {
    super();
  }
  get ascii(): string {
    return BOND_KINDS[this.kind].ascii;
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitBond(this);
  }
}

export class Group extends Node {
  readonly type = "group";
  constructor(
    readonly nodes: Node[],
    readonly multiplicity?: string,
    readonly bracket: BracketKind = "paren",
  ) {
    super();
  }
  get openChar(): string {
    return BRACKETS[this.bracket].open;
  }
  get closeChar(): string {
    return BRACKETS[this.bracket].close;
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitGroup(this);
  }
}

export class Identifier {
  constructor(
    readonly value: string,
    readonly convention: string,
    readonly dictRef?: string,
  ) {}
}

export class Name {
  constructor(
    readonly content: string,
    readonly convention?: string,
    readonly dictRef?: string,
  ) {}
}

export class MoleculeProperty {
  constructor(
    readonly title: string,
    readonly value: string,
    readonly units?: string,
    readonly dictRef?: string,
    readonly convention?: string,
  ) {}
}

export class MoleculeMeta {
  constructor(readonly name: string, readonly content: string) {}
}

export class MoleculeLabel {
  constructor(
    readonly value: string,
    readonly dictRef?: string,
    readonly convention?: string,
  ) {}
}

export class MoleculeFormula {
  constructor(
    readonly concise?: string,
    readonly inline?: string,
    readonly formalCharge?: string,
    readonly count?: string,
    readonly title?: string,
    readonly convention?: string,
    readonly dictRef?: string,
  ) {}
}

export class Molecule extends Node {
  readonly type = "molecule";
  constructor(
    readonly nodes: Node[],
    readonly coefficient?: string,
    readonly stereo?: StereoKind,
    readonly names: Name[] = [],
    readonly identifiers: Identifier[] = [],
    public title?: string,
    readonly formulas: MoleculeFormula[] = [],
    readonly properties: MoleculeProperty[] = [],
    readonly labels: MoleculeLabel[] = [],
    readonly metadata: MoleculeMeta[] = [],
  ) {
    super();
  }
  get stereoLetter(): string | undefined {
    return this.stereo ? STEREO_TO_LETTER[this.stereo] : undefined;
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitMolecule(this);
  }
}

export class ReactionConditions {
  constructor(
    readonly above?: string,
    readonly below?: string,
  ) {}
}

export class Reaction extends Node {
  readonly type = "reaction";
  constructor(
    readonly reactants: Molecule[],
    readonly products: Molecule[],
    readonly arrow: ArrowKind = "forward",
    readonly conditions?: ReactionConditions,
  ) {
    super();
  }
  get arrowAscii(): string {
    return ARROW_KINDS[this.arrow].ascii;
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitReaction(this);
  }
}

export class ReactionCascade extends Node {
  readonly type = "reaction-cascade";
  constructor(readonly steps: Reaction[]) {
    super();
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitReactionCascade(this);
  }
}

export class TermSymbol {
  constructor(
    readonly multiplicity?: string,
    readonly letter?: string,
    readonly jValue?: string,
  ) {}
  toString(): string {
    const j = this.jValue ? `_${this.jValue}` : "";
    return `${this.multiplicity ?? ""}${this.letter ?? ""}${j}`;
  }
}

export class ElectronConfiguration extends Node {
  readonly type = "electron-configuration";
  constructor(
    readonly orbitals: [string, string][],
    readonly termSymbol?: TermSymbol,
  ) {
    super();
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitElectronConfiguration(this);
  }
}

export class EmbeddedMath extends Node {
  readonly type = "embedded-math";
  // The Ruby reference pairs `source` with a parsed Plurimath formula;
  // the TS implementation retains the source (rendered verbatim) until
  // an AsciiMath engine is embedded (tracked in TODO.v2 05 phase 2).
  constructor(readonly source: string) {
    super();
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitEmbeddedMath(this);
  }
}

export class Text extends Node {
  readonly type = "text";
  constructor(readonly content: string) {
    super();
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitText(this);
  }
}

export class Crystal extends Node {
  readonly type = "crystal";
  constructor(
    readonly name?: string,
    readonly a?: number,
    readonly b?: number,
    readonly c?: number,
    readonly alpha?: number,
    readonly beta?: number,
    readonly gamma?: number,
    readonly spacegroup?: string,
    readonly atoms: Atom[] = [],
  ) {
    super();
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitCrystal(this);
  }
}

export class SpectrumPeak {
  constructor(
    readonly position?: string,
    readonly intensity?: string,
    readonly multiplicity?: string,
    readonly assignment?: string,
  ) {}
}

export class Spectrum extends Node {
  readonly type = "spectrum";
  constructor(
    readonly technique?: string,
    readonly params: Record<string, string> = {},
    readonly peaks: SpectrumPeak[] = [],
  ) {
    super();
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitSpectrum(this);
  }
}

export class CalculationProperty {
  constructor(
    readonly title: string,
    readonly value: string,
    readonly units?: string,
  ) {}
}

export class Calculation extends Node {
  readonly type = "calculation";
  constructor(
    readonly method?: string,
    readonly basis?: string,
    readonly properties: CalculationProperty[] = [],
  ) {
    super();
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitCalculation(this);
  }
}

export class ZRow {
  constructor(
    readonly atom: string,
    readonly ref1?: string,
    readonly distance?: string,
    readonly ref2?: string,
    readonly angle?: string,
    readonly ref3?: string,
    readonly dihedral?: string,
  ) {}
}

export class ZMatrix extends Node {
  readonly type = "zmatrix";
  constructor(readonly rows: ZRow[] = []) {
    super();
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitZMatrix(this);
  }
}

export class MechanismStep {
  constructor(readonly label: string, readonly reaction: string) {}
}

export class Mechanism extends Node {
  readonly type = "mechanism";
  constructor(
    readonly steps: MechanismStep[] = [],
    readonly spectators: string[] = [],
  ) {
    super();
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitMechanism(this);
  }
}
