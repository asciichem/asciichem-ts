// SMILES parser + deterministic writer (the TypeScript mirror of
// AsciiChem::Smiles). v1 subset deferrals, each raising an actionable
// ParseError: chirality @/@@, E/Z bond directions / \, wildcards,
// bonded ring closures the digit form cannot carry.
import { Atom, Bond, BondKind, Formula, Molecule, Node } from "./model.js";
import { ParseError } from "./errors.js";
import { buildGraph, linearize, Edge } from "./structure.js";

const ORGANIC = ["Cl", "Br", "B", "C", "N", "O", "P", "S", "F", "I"];
const AROMATIC = ["se", "as", "b", "c", "n", "o", "p", "s"];

export function parseSmiles(smiles: string): Formula {
  const p = new SmilesParser(smiles);
  return p.parse();
}

class SmilesParser {
  private pos = 0;
  private atoms: Atom[] = [];
  private adjacency: Map<number, BondKind>[] = [];
  private openRings = new Map<string, number>();
  private parent: number | undefined;
  private pendingKind: BondKind | undefined;
  private pendingDirection: "up" | "down" | undefined;
  private edgeDirections = new Map<string, "up" | "down">();

  constructor(private readonly source: string) {}

  parse(): Formula {
    const molecules = [this.component()];
    while (this.eat(".")) molecules.push(this.component());
    if (this.pos !== this.source.length) {
      throw new ParseError(
        `unexpected character ${this.peek()?.toString() ?? ""} at position ${this.pos} in ${JSON.stringify(this.source)}`,
      );
    }
    return new Formula(molecules);
  }

  private component(): Molecule {
    this.atoms = [];
    this.adjacency = [];
    this.openRings = new Map();
    this.parent = undefined;
    this.pendingKind = undefined;

    this.chain();

    if (this.openRings.size > 0) {
      const digits = [...this.openRings.keys()].sort().join(", ");
      throw new ParseError(`unclosed ring bond digit(s): ${digits} in ${JSON.stringify(this.source)}`);
    }

    const edges: Edge[] = [];
    this.adjacency.forEach((neighbors, index) => {
      neighbors.forEach((kind, to) => {
        if (to > index) {
          const direction = this.edgeDirections.get([index, to].sort().join("-"));
          edges.push({ from: index, to, kind, direction });
        }
      });
    });
    return new Molecule(linearize(this.atoms, edges));
  }

  private chain(): void {
    this.atomToken();
    while (!this.eoc()) {
      if (this.peek() === "(") {
        this.branch(undefined, undefined);
      } else if (this.bondStart()) {
        const { kind, direction } = this.bondToken();
        if (this.peek() === "(") {
          this.branch(kind, direction);
        } else if (this.digitStart()) {
          this.ringbond(kind, direction);
        } else {
          this.pendingKind = kind;
          this.pendingDirection = direction;
          this.atomToken();
        }
      } else if (this.digitStart()) {
        this.ringbond(undefined, undefined);
      } else {
        this.pendingKind = undefined;
        this.pendingDirection = undefined;
        this.atomToken();
      }
    }
  }

  private branch(
    kind: BondKind | undefined,
    direction: "up" | "down" | undefined,
  ): void {
    this.expect("(");
    if (kind === undefined && this.bondStart()) {
      const t = this.bondToken();
      kind = t.kind;
      direction = t.direction;
    }
    const savedParent = this.parent;
    const savedPending = this.pendingKind;
    const savedDirection = this.pendingDirection;
    this.pendingKind = kind;
    this.pendingDirection = direction;
    this.chain();
    this.expect(")");
    this.parent = savedParent;
    this.pendingKind = savedPending;
    this.pendingDirection = savedDirection;
  }

  private ringbond(
    kind: BondKind | undefined,
    direction: "up" | "down" | undefined,
  ): void {
    if (direction) {
      throw new ParseError(
        "directional ring closures are not representable in the model's ring-closure form",
      );
    }
    const digit = this.ringDigit();
    const opener = this.openRings.get(digit);
    if (opener !== undefined) {
      this.openRings.delete(digit);
      if (kind && kind !== this.defaultKind(opener, this.parent!)) {
        throw new ParseError(
          `bonded ring closures (${kind}) are not representable in the model's ring-closure form`,
        );
      }
      this.addEdge(opener, this.parent!, kind);
    } else {
      this.openRings.set(digit, this.parent!);
    }
  }

  private atomToken(): void {
    const atom = this.readAtom();
    const index = this.atoms.length;
    this.atoms.push(atom);
    this.adjacency.push(new Map());
    if (this.parent !== undefined) {
      this.addEdge(this.parent, index, this.pendingKind);
      if (this.pendingDirection !== undefined) {
        this.edgeDirections.set(
          [this.parent, index].sort((a, b) => a - b).join("-"),
          this.pendingDirection,
        );
      }
    }
    this.parent = index;
    this.pendingKind = undefined;
    this.pendingDirection = undefined;
  }

  private addEdge(from: number, to: number, explicit: BondKind | undefined): void {
    const kind = explicit ?? this.defaultKind(from, to);
    this.adjacency[from].set(to, kind);
    this.adjacency[to].set(from, kind);
  }

  private defaultKind(from: number, to: number): BondKind {
    return this.atoms[from].aromatic && this.atoms[to].aromatic ? "aromatic" : "single";
  }

  // -- tokens ----------------------------------------------------------

  private readAtom(): Atom {
    if (this.peek() === "[") return this.bracketAtom();

    const two = this.source.slice(this.pos, this.pos + 2);
    const organic = ORGANIC.find((s) => two.startsWith(s));
    if (organic) {
      this.pos += organic.length;
      return new Atom(organic);
    }
    const aromaticTwo = AROMATIC.find((s) => s.length === 2 && two.startsWith(s));
    const aromaticOne = AROMATIC.find((s) => this.peek() === s);
    const symbol = aromaticTwo ?? aromaticOne;
    if (symbol) {
      this.pos += symbol.length;
      return new Atom(capitalize(symbol), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true);
    }
    throw new ParseError(
      `unexpected character ${JSON.stringify(this.peek())} at position ${this.pos} in ${JSON.stringify(this.source)}`,
    );
  }

  private bracketAtom(): Atom {
    this.expect("[");
    const isotope = this.digits();
    const symbol = this.bracketSymbol();
    const chirality = this.readChirality();
    const hydrogens = this.hcount();
    const charge = this.bracketCharge();
    this.skipClass();
    this.expect("]");
    return new Atom(
      capitalize(symbol),
      isotope,
      undefined,
      undefined,
      charge,
      undefined,
      undefined,
      undefined,
      undefined,
      /^[a-z]/.test(symbol) || undefined,
      hydrogens,
      undefined,
      undefined,
      undefined,
      undefined,
      chirality,
    );
  }

  private bracketSymbol(): string {
    const two = this.source.slice(this.pos, this.pos + 2);
    if (AROMATIC.includes(two)) {
      this.pos += 2;
      return two;
    }
    const current = this.source[this.pos];
    if (current !== undefined && /[bcnops]/.test(current)) {
      this.pos += 1;
      return current;
    }
    if (current !== undefined && /[A-Z]/.test(current)) {
      let sym = current;
      if (/[a-z]/.test(this.source[this.pos + 1] ?? "")) sym += this.source[this.pos + 1];
      this.pos += sym.length;
      return sym;
    }
    throw new ParseError(
      `expected an element symbol at position ${this.pos} in ${JSON.stringify(this.source)}`,
    );
  }

  // `@` (TH1) / `@@` (TH2): SMILES ordered-neighbour tetrahedral
  // parity, stored verbatim on the atom.
  private readChirality(): string | undefined {
    if (this.peek() !== "@") return undefined;
    if (this.source.slice(this.pos, this.pos + 2) === "@@") {
      this.pos += 2;
      return "TH2";
    }
    this.pos += 1;
    return "TH1";
  }

  private hcount(): number | undefined {
    if (this.peek() !== "H") return undefined;
    this.pos += 1;
    const count = this.digits();
    return count ? Number(count) : 1;
  }

  // "+" | "++" | "+n" | "-" | "--" | "-n" → number-then-sign.
  private bracketCharge(): string | undefined {
    const sign = this.peek();
    if (sign !== "+" && sign !== "-") return undefined;
    this.pos += 1;
    const second = this.source[this.pos] ?? "";
    let count: number | undefined;
    if (second === sign) {
      this.pos += 1;
      count = 2;
    } else if (/[0-9]/.test(second)) {
      count = Number(this.digits());
    }
    return count && count > 0 ? `${count}${sign}` : sign;
  }

  private skipClass(): void {
    if (this.peek() !== ":") return;
    this.pos += 1;
    this.digits();
  }

  private bondToken(): { kind: BondKind; direction?: "up" | "down" } {
    const ch = this.peek();
    const kinds: Record<string, BondKind> = {
      "-": "single",
      "=": "double",
      "#": "triple",
      $: "quadruple",
      ":": "aromatic",
    };
    if (ch === "/" || ch === "\\") {
      this.pos += 1;
      // Directional single bonds (SMILES E/Z stereo).
      return { kind: "single", direction: ch === "/" ? "up" : "down" } as const;
    }
    const kind = ch === undefined ? undefined : kinds[ch];
    if (!kind) {
      throw new ParseError(
        `expected a bond or atom at position ${this.pos} in ${JSON.stringify(this.source)}`,
      );
    }
    this.pos += 1;
    return { kind } as const;
  }

  private ringDigit(): string {
    if (this.peek() === "%") {
      this.pos += 1;
      const digit = this.source.slice(this.pos, this.pos + 2);
      if (!/^\d\d$/.test(digit)) throw new ParseError("malformed %nn ring closure");
      this.pos += 2;
      return digit;
    }
    const d = this.peek();
    if (d === undefined || !/[0-9]/.test(d)) {
      throw new ParseError(`expected ring digit at position ${this.pos}`);
    }
    this.pos += 1;
    return d;
  }

  // -- character helpers -------------------------------------------------

  private peek(): string | undefined {
    return this.source[this.pos];
  }

  private digits(): string | undefined {
    const start = this.pos;
    while (/[0-9]/.test(this.source[this.pos] ?? "")) this.pos += 1;
    return this.pos === start ? undefined : this.source.slice(start, this.pos);
  }

  private bondStart(): boolean {
    return ["-", "=", "#", "$", ":", "/", "\\"].includes(this.peek() ?? "");
  }

  private digitStart(): boolean {
    return /[0-9%]/.test(this.peek() ?? "");
  }

  private eoc(): boolean {
    const ch = this.peek();
    return ch === undefined || ch === "." || ch === ")";
  }

  private eat(char: string): boolean {
    if (this.peek() !== char) return false;
    this.pos += 1;
    return true;
  }

  private expect(char: string): void {
    if (this.peek() !== char) {
      throw new ParseError(
        `expected ${JSON.stringify(char)} at position ${this.pos} in ${JSON.stringify(this.source)}`,
      );
    }
    this.pos += 1;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// -- writer -------------------------------------------------------------

const LOWERCASE_AROMATIC = ["C", "N", "O", "S", "P", "B", "Se", "As"];
const WRITER_ORGANIC = ["B", "C", "N", "O", "P", "S", "F", "Cl", "Br", "I"];
const BOND_TOKENS: Partial<Record<BondKind, string>> = {
  single: "-",
  double: "=",
  triple: "#",
  quadruple: "$",
  aromatic: ":",
};
const CONTINUATION_BONDS: BondKind[] = ["single", "aromatic"];

export function writeSmiles(node: Formula | Molecule): string {
  if (node instanceof Formula) {
    return node.nodes.map((m) => writeMolecule(m as Molecule)).join(".");
  }
  return writeMolecule(node);
}

function writeMolecule(molecule: Molecule): string {
  const { atoms, edges } = buildGraph(molecule);
  // A single-atom component is valid SMILES; multiple unbonded atoms
  // are a formula, not a structure.
  if (edges.length === 0 && atoms.length > 1) {
    throw new ParseError("molecule has no bonds — a formula is not a structure");
  }

  const adjacency: Map<number, BondKind>[] = atoms.map(() => new Map());
  const directions = new Map<string, "up" | "down">();
  for (const edge of edges) {
    adjacency[edge.from].set(edge.to, edge.kind);
    adjacency[edge.to].set(edge.from, edge.kind);
    if (edge.direction !== undefined) {
      directions.set(
        [Math.min(edge.from, edge.to), Math.max(edge.from, edge.to)].join("-"),
        edge.direction,
      );
    }
  }

  const modelNeighbours: number[][] = atoms.map(() => []);
  for (const edge of edges) {
    modelNeighbours[edge.from].push(edge.to);
    modelNeighbours[edge.to].push(edge.from);
  }
  const writer = new DeterministicWriter(atoms, adjacency, directions, modelNeighbours);
  return writer.write();
}

class DeterministicWriter {
  private visited = new Set<number>();
  private digits: string[][] = [];
  private digitByEdge = new Map<string, string>();
  private nextDigit = 1;
  private treeChildren: number[][] = [];
  private closures: number[][] = [];
  private treeSize: number[] = [];

  private directions = new Map<string, "up" | "down">();
  private modelNeighbours: number[][] = [];
  private writtenOrder: number[][] = [];

  constructor(
    private readonly atoms: Atom[],
    private readonly adjacency: Map<number, BondKind>[],
    private readonly edgeDirections: Map<string, "up" | "down"> = new Map(),
    private readonly modelOrder: number[][] = [],
  ) {}

  write(): string {
    if (this.atoms.length === 0) return "";
    this.digits = this.atoms.map(() => []);
    this.buildTree(0, undefined);
    this.computeTreeSize(0);
    this.computeWrittenOrders();
    const units = this.emit(0, undefined, undefined);
    return units
      .map((unit) => {
        if (unit.kind !== "atom") return unit.text ?? "";
        const index = unit.index as number;
        return this.atomToken(index) + (this.digits[index] ?? []).join("");
      })
      .join("");
  }

  // Deterministic DFS tree: children in index order; edges to
  // already-visited atoms become ring digits. Recording the tree
  // first means a branch can never walk around a ring and swallow
  // the continuation.
  private buildTree(index: number, parent: number | undefined): void {
    this.visited.add(index);
    this.treeChildren[index] = [];
    this.closures[index] = [];
    const neighbors = [...this.adjacency[index].keys()].sort((a, b) => a - b);
    for (const nb of neighbors) {
      if (nb !== parent && this.visited.has(nb)) {
        this.closures[index].push(nb);
      } else if (!this.visited.has(nb)) {
        this.treeChildren[index].push(nb);
        this.buildTree(nb, index);
      }
    }
  }

  // The order neighbours are WRITTEN in: parent first, then ring
  // closures, then branches (rank order), then the continuation.
  // Tetrahedral parity flips with odd permutations of this order
  // against the model's reference order, so the emitted @/@@ is
  // corrected per atom (acyclic-correct; ring closures in the
  // reference order are a later slice).
  private computeWrittenOrders(): void {
    this.writtenOrder = this.atoms.map(() => []);
    const walk = (index: number, parent: number | undefined): void => {
      const order: number[] = parent !== undefined ? [parent] : [];
      order.push(...this.closures[index]);
      const ordered = [...this.treeChildren[index]].sort((a, b) =>
        this.compareContinuation(index, a, b),
      );
      if (ordered.length > 0) order.push(...ordered.slice(1), ordered[0]);
      this.writtenOrder[index] = order;
      for (const child of this.treeChildren[index]) walk(child, index);
    };
    walk(0, undefined);
  }

  private chiralityToken(index: number): string {
    const atom = this.atoms[index];
    if (!atom.chirality) return "";
    const ref: (number | "h")[] = [];
    if (atom.hydrogens) ref.push("h");
    ref.push(...this.modelOrder[index]);
    const written: (number | "h")[] = [];
    if (atom.hydrogens) written.push("h");
    written.push(...this.writtenOrder[index]);
    let inversions = 0;
    written.forEach((item, i) => {
      for (const later of written.slice(i + 1)) {
        if (ref.indexOf(item) > ref.indexOf(later)) inversions += 1;
      }
    });
    const token = atom.chirality === "TH2" || inversions % 2 === 1 ? "@@" : "@";
    return token;
  }

  private computeTreeSize(index: number): void {
    let size = 1;
    for (const child of this.treeChildren[index]) {
      this.computeTreeSize(child);
      size += this.treeSize[child];
    }
    this.treeSize[index] = size;
  }

  private emit(
    index: number,
    parent: number | undefined,
    incomingKind: BondKind | undefined,
  ): { kind: "atom" | "literal"; index?: number; text?: string }[] {
    const units: { kind: "atom" | "literal"; index?: number; text?: string }[] = [];
    if (parent !== undefined) units.push({ kind: "literal", text: this.bondToken(incomingKind!, parent, index) });
    units.push({ kind: "atom", index });
    // Ring digits attach to per-atom lists (both endpoints); no
    // literal units — they would render twice.
    for (const nb of this.closures[index]) this.ringDigitFor(index, nb);

    const children = this.treeChildren[index];
    if (children.length === 0) return units;

    const ordered = [...children].sort((a, b) => this.compareContinuation(index, a, b));
    const [continuation, ...branches] = ordered;

    for (const child of branches) {
      units.push({ kind: "literal", text: "(" });
      units.push(...this.emit(child, index, this.adjacency[index].get(child)));
      units.push({ kind: "literal", text: ")" });
    }
    units.push(...this.emit(continuation, index, this.adjacency[index].get(continuation)));
    return units;
  }

  // Single/aromatic bonds continue the chain (multiple bonds branch),
  // then larger subtrees, then the lexicographically smallest atom
  // token — order-independent, so the canonical form does not depend
  // on how the input numbered its atoms.
  private compareContinuation(index: number, a: number, b: number): number {
    const rank = (child: number): [number, number, string] => {
      const kind = this.adjacency[index].get(child)!;
      return [
        CONTINUATION_BONDS.includes(kind) ? 0 : 1,
        -this.treeSize[child],
        this.atomToken(child),
      ];
    };
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
  }

  private ringDigitFor(a: number, b: number): string {
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    const existing = this.digitByEdge.get(key);
    if (existing) return existing;
    if (this.nextDigit > 9) throw new ParseError("too many ring closures for SMILES output");

    const digit = String(this.nextDigit++);
    this.digitByEdge.set(key, digit);
    this.digits[Math.min(a, b)].push(digit);
    this.digits[Math.max(a, b)].push(digit);
    return digit;
  }

  private bondToken(kind: BondKind, from: number, to: number): string {
    if (kind === "single") {
      const direction = this.edgeDirections.get(
        [Math.min(from, to), Math.max(from, to)].join("-"),
      );
      if (direction) return direction === "up" ? "/" : "\\";
      if (direction) return direction === "up" ? "/" : "\\";
      return this.aromatic(from) && this.aromatic(to) ? "-" : "";
    }
    const token = BOND_TOKENS[kind];
    if (!token) throw new ParseError(`${kind} bonds have no SMILES form (v1 subset)`);
    return this.aromatic(from) && this.aromatic(to) ? "" : token;
  }

  private atomToken(index: number): string {
    const atom = this.atoms[index];
    const aromatic = atom.aromatic === true;
    const lowercase = aromatic && LOWERCASE_AROMATIC.includes(atom.element);
    const needsBracket =
      atom.charge !== undefined ||
      atom.isotope !== undefined ||
      atom.hydrogens !== undefined ||
      atom.chirality !== undefined ||
      (!WRITER_ORGANIC.includes(atom.element) && !lowercase) ||
      (aromatic && !lowercase);
    if (!needsBracket) return lowercase ? atom.element.toLowerCase() : atom.element;

    const symbol = lowercase ? atom.element.toLowerCase() : atom.element;
    let token = "[";
    if (atom.isotope !== undefined) token += atom.isotope;
    token += symbol;
    token += this.chiralityToken(index);
    if (atom.hydrogens !== undefined) {
      token += "H";
      if (atom.hydrogens > 1) token += String(atom.hydrogens);
    }
    if (atom.charge !== undefined) token += this.chargeSuffix(atom.charge);
    return token + "]";
  }

  // The model's number-then-sign charge ("2+") → SMILES ("+2").
  private chargeSuffix(charge: string): string {
    const count = /^\d+/.exec(charge)?.[0];
    const sign = charge[charge.length - 1];
    return count && Number(count) > 1 ? `${sign}${count}` : sign;
  }

  private aromatic(index: number): boolean {
    return this.atoms[index].aromatic === true;
  }
}
