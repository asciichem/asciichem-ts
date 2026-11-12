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
  | "wavy"
  | "aromatic";
export type BracketKind = "paren" | "square" | "brace";
export type StereoKind = "R" | "S" | "E" | "Z" | "alpha" | "beta";

export const BOND_KINDS: Record<BondKind, { ascii: string; entity: string }> = {
  single: { ascii: "-", entity: "-" },
  double: { ascii: "=", entity: "=" },
  triple: { ascii: "#", entity: "≡" },
  quadruple: { ascii: "##", entity: "≣" },
  wedge: { ascii: ">-", entity: "↑" },
  hash: { ascii: "-<", entity: "↓" },
  dative: { ascii: "~>", entity: "→" },
  wavy: { ascii: "~~", entity: "∼" },
  aromatic: { ascii: ":", entity: ":" },
};

export const ARROW_KINDS: Record<ArrowKind, { ascii: string; wire: ArrowKind; entity: string }> = {
  forward: { ascii: "->", wire: "forward", entity: "→" },
  reverse: { ascii: "<-", wire: "reverse", entity: "←" },
  equilibrium: { ascii: "<=>", wire: "equilibrium", entity: "⇌" },
  resonance: { ascii: "<->", wire: "resonance", entity: "↔" },
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

  toSmiles(): string {
    return renderWith<string>("smiles", this);
  }

  toMolfile(name?: string): string {
    return renderWith<string>("molfile", this);
  }

  // The linter's diagnostic context (the Ruby Diagnostic#to_s shape):
  // `Atom(C)`, `Crystal(x)`, and the snake-case class name in words
  // for everything else (`Reaction`, `Electron Configuration`).
  // Container/atom overrides live on the classes; adding a new model
  // class means overriding this — no edits in the linter.
  diagnosticLabel(): string {
    return this.type
      .split("-")
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" ");
  }

  // Child nodes for traversal (the Ruby Node#children contract).
  // Default: no children. Container classes override; leaves inherit
  // the empty default. Used by the linter walk — adding a new
  // container class means overriding this, no edits in the linter.
  children(): Node[] {
    return [];
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
  children(): Node[] {
    return this.nodes;
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
    public ringClosures?: string,
    readonly aromatic?: boolean,
    readonly hydrogens?: number,
    readonly x2?: number,
    readonly y2?: number,
    readonly z2?: number,
    readonly atomParity?: string,
    readonly chirality?: string,
    readonly spinMultiplicity?: string,
    readonly atomTitle?: string,
    readonly xFract?: number,
    readonly yFract?: number,
    readonly zFract?: number,
  ) {
    super();
  }
  // Immutably-constructed atoms are awkward to adjust during
  // ingestion (molfile property blocks, aromatic marking); patch
  // returns a copy with the named fields replaced.
  patch(changes: Partial<Omit<Atom, "type" | "accept" | "patch" | "toSmiles" | "toMolfile">>): Atom {
    return new Atom(
      changes.element ?? this.element,
      "isotope" in changes ? changes.isotope : this.isotope,
      "subscript" in changes ? changes.subscript : this.subscript,
      "superscript" in changes ? changes.superscript : this.superscript,
      "charge" in changes ? changes.charge : this.charge,
      "oxidationState" in changes ? changes.oxidationState : this.oxidationState,
      "lonePairs" in changes ? changes.lonePairs : this.lonePairs,
      "radicalElectrons" in changes ? changes.radicalElectrons : this.radicalElectrons,
      "ringClosures" in changes ? changes.ringClosures : this.ringClosures,
      "aromatic" in changes ? changes.aromatic : this.aromatic,
      "hydrogens" in changes ? changes.hydrogens : this.hydrogens,
      "x2" in changes ? changes.x2 : this.x2,
      "y2" in changes ? changes.y2 : this.y2,
      "z2" in changes ? changes.z2 : this.z2,
      "atomParity" in changes ? changes.atomParity : this.atomParity,
      "chirality" in changes ? changes.chirality : this.chirality,
      "spinMultiplicity" in changes ? changes.spinMultiplicity : this.spinMultiplicity,
      "atomTitle" in changes ? changes.atomTitle : this.atomTitle,
      "xFract" in changes ? changes.xFract : this.xFract,
      "yFract" in changes ? changes.yFract : this.yFract,
      "zFract" in changes ? changes.zFract : this.zFract,
    );
  }

  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitAtom(this);
  }

  diagnosticLabel(): string {
    return `Atom(${this.element})`;
  }
}

export class Bond extends Node {
  readonly type = "bond";
  constructor(
    readonly kind: BondKind,
    // SMILES directional single bond (/ up, \ down) flanking a
    // stereogenic double bond — orthogonal to the kind.
    readonly direction?: "up" | "down",
  ) {
    super();
  }
  get ascii(): string {
    return BOND_KINDS[this.kind].ascii;
  }
  get entity(): string {
    return BOND_KINDS[this.kind].entity;
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
  children(): Node[] {
    return this.nodes;
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
  children(): Node[] {
    return this.nodes;
  }

  // The integer stoichiometric coefficient: the authored leading
  // number, or 1 when absent or not positive. Single source for every
  // consumer (reaction stoichiometry, the balance check, composition).
  stoichiometricCoefficient(): number {
    const own = this.coefficient === undefined ? NaN : Number(this.coefficient);
    return Number.isInteger(own) && own > 0 ? own : 1;
  }

  // Hash of element symbol => total atom count, recursing through
  // groups and nested molecules with subscripts and multiplicities
  // applied. Pass `withCoefficient: false` for the composition of a
  // single molecule instance — identifiers describe the substance,
  // not the stoichiometric multiplier.
  elementCounts(withCoefficient = true): Record<string, number> {
    const tally: Record<string, number> = {};
    const multiplier = withCoefficient ? this.stoichiometricCoefficient() : 1;
    for (const node of this.nodes) tallyElement(node, tally, multiplier);
    return tally;
  }

  // Hill-system canonical formula: C first, then H, then others
  // alphabetically. Single source of truth for "what is the canonical
  // formula string of this molecule".
  hillFormula(): string {
    const counts = this.elementCounts();
    const present = Object.entries(counts).filter(([, count]) => count !== 0);
    if (present.length === 0) return "";
    const carbon = present.filter(([el]) => el === "C");
    const hydrogen = present.filter(([el]) => el === "H");
    const others = present
      .filter(([el]) => el !== "C" && el !== "H")
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return [...carbon, ...hydrogen, ...others]
      .map(([el, count]) => (count === 1 ? el : `${el}${count}`))
      .join("");
  }
}

function tallyElement(node: Node, tally: Record<string, number>, multiplier: number): void {
  if (node instanceof Atom) {
    const sub = node.subscript === undefined ? NaN : Number(node.subscript);
    const count = (Number.isInteger(sub) && sub > 0 ? sub : 1) * multiplier;
    tally[node.element] = (tally[node.element] ?? 0) + count;
  } else if (node instanceof Group) {
    const mult = node.multiplicity === undefined ? NaN : Number(node.multiplicity);
    const groupMultiplier = (Number.isInteger(mult) && mult > 0 ? mult : 1) * multiplier;
    for (const child of node.nodes) tallyElement(child, tally, groupMultiplier);
  } else if (node instanceof Molecule) {
    const inner = node.nodes;
    const coeff = node.stoichiometricCoefficient();
    for (const child of inner) tallyElement(child, tally, multiplier * coeff);
  }
}

export type ConditionRole = "catalyst" | "solvent" | "reagent";

export interface ConditionEntry {
  readonly role: ConditionRole | null;
  readonly value: string;
  readonly side: "above" | "below";
}

const CONDITION_ROLE_PREFIXES: Record<string, ConditionRole> = {
  cat: "catalyst",
  catalyst: "catalyst",
  solv: "solvent",
  solvent: "solvent",
  reag: "reagent",
  reagent: "reagent",
};

function conditionEntriesFor(side: "above" | "below", text?: string): ConditionEntry[] {
  if (text == null || text.trim() === "") return [];
  const out: ConditionEntry[] = [];
  for (const chunk of text.split(";")) {
    const trimmed = chunk.trim();
    if (trimmed === "") continue;
    const colon = trimmed.indexOf(":");
    const role =
      colon >= 0 ? CONDITION_ROLE_PREFIXES[trimmed.slice(0, colon).trim().toLowerCase()] : undefined;
    out.push({
      role: role ?? null,
      value: role ? trimmed.slice(colon + 1).trim() : trimmed,
      side,
    });
  }
  return out;
}

export class ReactionConditions {
  constructor(
    readonly above?: string,
    readonly below?: string,
  ) {}

  // Typed `role: value` entries derived from the bracket text (which
  // stays verbatim — the round-trip source). `;` separates entries;
  // unknown role prefixes are free text, never an error.
  get entries(): ConditionEntry[] {
    return [
      ...conditionEntriesFor("above", this.above),
      ...conditionEntriesFor("below", this.below),
    ];
  }
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
  get arrowEntity(): string {
    return ARROW_KINDS[this.arrow].entity;
  }
  accept<T>(visitor: Visitor<T>): T {
    return visitor.visitReaction(this);
  }
  children(): Node[] {
    return [...this.reactants, ...this.products];
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
  children(): Node[] {
    return this.steps.flatMap((step) => [...step.reactants, ...step.products]);
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
  children(): Node[] {
    return this.atoms;
  }
  diagnosticLabel(): string {
    return `Crystal(${this.name ?? "unnamed"})`;
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

export class MechanismFlow {
  constructor(
    readonly source: string,
    readonly target: string,
  ) {}
}

export class MechanismStep {
  constructor(
    readonly label: string,
    readonly reaction: string,
    readonly flows: MechanismFlow[] = [],
  ) {}
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
