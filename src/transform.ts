// AST -> semantic model, the TypeScript mirror of AsciiChem::Transform.
// The grammar encodes semantics; this layer maps capture shapes onto
// model constructors with minimal logic of its own (AtomBuilder's
// charge/oxidation disambiguation is the one deliberate exception,
// exactly as in the reference).
import {
  Atom,
  Bond,
  BondKind,
  BracketKind,
  Calculation,
  CalculationProperty,
  Crystal,
  ElectronConfiguration,
  EmbeddedMath,
  Formula,
  Group,
  Identifier,
  Mechanism,
  MechanismStep,
  Molecule,
  MoleculeFormula,
  MoleculeLabel,
  MoleculeMeta,
  MoleculeProperty,
  Name,
  Node,
  ArrowKind,
  Reaction,
  ReactionCascade,
  ReactionConditions,
  Spectrum,
  SpectrumPeak,
  StereoKind,
  Text,
  ZMatrix,
  ZRow,
} from "./model.js";
import { ParseError } from "./errors.js";
import { parse } from "./generated/parser.mjs";

// -- capture shapes (what the grammar returns) -------------------------

interface AtomCapture {
  kind: "atom";
  element: string;
  isotope: string | null;
  subscript?: string;
  superscript?: string;
  lonePairs?: string;
  radicalElectrons?: string;
  ringClosures?: string;
  x2?: string;
  y2?: string;
  z2?: string;
  atomParity?: string;
  spinMultiplicity?: string;
  atomTitle?: string;
  xFract?: string;
  yFract?: string;
  zFract?: string;
}
interface BondCapture {
  kind: "bond";
  bondKind: BondKind;
}
interface GroupCapture {
  kind: "group";
  open: string;
  nodes: unknown[];
  multiplicity?: string;
}
interface MoleculeCapture {
  kind: "molecule";
  stereo?: string;
  coefficient?: string;
  units: (AtomCapture | BondCapture | GroupCapture)[];
}
interface AnnotatedCapture {
  kind: "annotated";
  molecule: MoleculeCapture;
  annotations: { metaKey?: string; metaValue?: string; annType?: string; annValue?: string }[];
}
interface ReactionCapture {
  kind: "reaction";
  reactants: MoleculeCapture[];
  arrow: { kind: string; above?: string; below?: string };
  products: MoleculeCapture[];
}
interface CascadeCapture {
  kind: "cascade";
  first: ReactionCapture;
  tail: { arrow: { kind: string; above?: string | null; below?: string | null }; products: MoleculeCapture[] }[];
}
export interface FormulaCapture {
  kind: "formula";
  nodes: unknown[];
}
interface SimpleCapture {
  kind: "text" | "math";
  content?: string;
  source?: string;
}
type RawCapture = {
  kind: "crystal" | "spectrum" | "calculation" | "zmatrix" | "mechanism" | "electron-config";
  [key: string]: unknown;
};

// -- entry point --------------------------------------------------------

export function buildFormula(capture: FormulaCapture): Formula {
  return new Formula(capture.nodes.map((node) => buildNode(node as never)));
}

function buildNode(capture: unknown): Node {
  const c = capture as { kind: string } & Record<string, unknown>;
  switch (c.kind) {
    case "formula":
      return buildFormula(c as never);
    case "atom":
      return AtomBuilder.build(c as never as AtomCapture);
    case "bond":
      return new Bond((c as never as BondCapture).bondKind);
    case "group":
      return buildGroup(c as never as GroupCapture);
    case "molecule":
      return buildMolecule(c as never as MoleculeCapture);
    case "annotated":
      return buildAnnotated(c as never as AnnotatedCapture);
    case "reaction":
      return buildReaction(
        (c as never as ReactionCapture).reactants,
        (c as never as ReactionCapture).arrow,
        (c as never as ReactionCapture).products,
      );
    case "cascade":
      return buildCascade(c as never as CascadeCapture);
    case "electron-config":
      return new ElectronConfiguration((c.pairs as [string, string][]) ?? []);
    case "math":
      return new EmbeddedMath((c as never as SimpleCapture).source ?? "");
    case "text":
      return new Text((c as never as SimpleCapture).content ?? "");
    case "crystal":
      return buildCrystal(c as never as RawCapture);
    case "spectrum":
      return buildSpectrum(c as never as RawCapture);
    case "calculation":
      return buildCalculation(c as never as RawCapture);
    case "zmatrix":
      return buildZMatrix(c as never as RawCapture);
    case "mechanism":
      return buildMechanism(c as never as RawCapture);
    default:
      throw new ParseError(`unknown capture kind: ${String(c.kind)}`);
  }
}

// -- atoms ---------------------------------------------------------------

class AtomBuilder {
  static build(c: AtomCapture): Atom {
    const superscript = stripMarker(c.superscript);
    const charge = AtomBuilder.detectCharge(superscript);
    const oxidation = AtomBuilder.detectOxidationState(superscript);
    return new Atom(
      c.element,
      stripMarker(c.isotope),
      stripMarker(c.subscript, "_"),
      charge || oxidation ? undefined : superscript,
      charge,
      oxidation,
      lewisCount(c.lonePairs),
      lewisCount(c.radicalElectrons),
      nonEmpty(c.ringClosures),
      undefined,
      undefined,
      floatOrNil(c.x2),
      floatOrNil(c.y2),
      floatOrNil(c.z2),
      nilToUndefined(c.atomParity),
      nilToUndefined(c.spinMultiplicity),
      nilToUndefined(c.atomTitle),
      floatOrNil(c.xFract),
      floatOrNil(c.yFract),
      floatOrNil(c.zFract),
    );
  }

  // Exactly one of { charge, oxidationState, superscript } is set —
  // they are mutually exclusive views of the superscript position.
  // Sign-first charges are canonicalised to number-then-sign ("+2" ->
  // "2+"), matching the reference canonicaliser.
  private static detectCharge(s: string | undefined): string | undefined {
    if (!s) return undefined;
    const digitsThenSign = /^(\d*)([+-])$/.exec(s);
    if (digitsThenSign) {
      return digitsThenSign[1] === "" ? digitsThenSign[2] : digitsThenSign[1] + digitsThenSign[2];
    }
    const signThenDigits = /^([+-])(\d*)$/.exec(s);
    if (signThenDigits) {
      return signThenDigits[2] === "" ? signThenDigits[1] : signThenDigits[2] + signThenDigits[1];
    }
    return undefined;
  }

  private static detectOxidationState(s: string | undefined): string | undefined {
    if (!s) return undefined;
    return /^\(([IVXLCDM]+)\)$/.exec(s)?.[1];
  }
}

// Strip leading marker chars (`^` or `_`) from a captured value.
function stripMarker(value: string | undefined | null, marker?: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  let s = value;
  if (marker && s.startsWith(marker)) s = s.slice(1);
  if (s.startsWith("^") || s.startsWith("_")) s = s.slice(1);
  return s === "" ? undefined : s;
}

function lewisCount(value: string | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  return value.length > 0 ? value.length : undefined;
}

function floatOrNil(value: string | undefined): number | undefined {
  return value === undefined || value === null ? undefined : Number(value);
}

function nonEmpty(s: string | undefined | null): string | undefined {
  return s && s.length > 0 ? s : undefined;
}

// Peggy uses null (not undefined) for absent optionals; the model
// speaks undefined.
function nilToUndefined<T>(v: T | null | undefined): T | undefined {
  return v ?? undefined;
}

// -- molecules and groups --------------------------------------------------

const STEREO_MAP: Record<string, StereoKind> = {
  R: "R",
  S: "S",
  E: "E",
  Z: "Z",
  a: "alpha",
  alpha: "alpha",
  "α": "alpha",
  b: "beta",
  beta: "beta",
  "β": "beta",
};

function buildMolecule(c: MoleculeCapture): Molecule {
  return new Molecule(
    c.units.map((unit) => buildNode(unit) as Node),
    nilToUndefined(c.coefficient),
    c.stereo ? STEREO_MAP[c.stereo] : undefined,
  );
}

function buildAnnotated(c: AnnotatedCapture): Molecule {
  const molecule = buildMolecule(c.molecule);
  for (const ann of c.annotations) applyAnnotation(molecule, ann);
  return molecule;
}

const IDENTIFIER_TYPES = new Set(["inchi", "smiles", "cas", "iupac", "cid", "chebi"]);

function applyAnnotation(
  molecule: Molecule,
  ann: { metaKey?: string; metaValue?: string; annType?: string; annValue?: string },
): void {
  if (ann.metaKey !== undefined) {
    molecule.metadata.push(new MoleculeMeta(ann.metaKey, ann.metaValue ?? ""));
    return;
  }
  const type = ann.annType ?? "";
  const value = ann.annValue ?? "";
  if (type === "name") {
    molecule.names.push(new Name(value));
  } else if (type === "title") {
    molecule.title = value;
  } else if (type === "formula") {
    molecule.formulas.push(new MoleculeFormula(value));
  } else if (type === "label") {
    molecule.labels.push(new MoleculeLabel(value));
  } else if (IDENTIFIER_TYPES.has(type)) {
    molecule.identifiers.push(new Identifier(value, type));
  } else {
    molecule.properties.push(new MoleculeProperty(type, value));
  }
}

const BRACKET_BY_CHAR: Record<string, BracketKind> = {
  "(": "paren",
  "[": "square",
  "{": "brace",
};

function buildGroup(c: GroupCapture): Group {
  return new Group(
    c.nodes.map((node) => buildNode(node) as Node),
    nilToUndefined(c.multiplicity),
    BRACKET_BY_CHAR[c.open] ?? "paren",
  );
}

// -- reactions ---------------------------------------------------------------

const ARROW_BY_TOKEN: Record<string, ArrowKind> = {
  "<=>": "equilibrium",
  "<->": "resonance",
  "->": "forward",
  "<-": "reverse",
};

function buildReaction(
  reactants: MoleculeCapture[],
  arrow: { kind: string; above?: string | null; below?: string | null },
  products: MoleculeCapture[],
): Reaction {
  const above = nilToUndefined(arrow.above);
  const below = nilToUndefined(arrow.below);
  const conditions = above || below ? new ReactionConditions(above, below) : undefined;
  return new Reaction(
    reactants.map((m) => buildMolecule(m)),
    products.map((m) => buildMolecule(m)),
    ARROW_BY_TOKEN[arrow.kind] ?? "forward",
    conditions,
  );
}

function buildCascade(c: CascadeCapture): ReactionCascade {
  const steps: Reaction[] = [buildReaction(c.first.reactants, c.first.arrow, c.first.products)];
  for (const leg of c.tail) {
    const previousProducts = steps[steps.length - 1].products;
    steps.push(
      new Reaction(
        previousProducts,
        leg.products.map((m) => buildMolecule(m)),
        ARROW_BY_TOKEN[leg.arrow.kind] ?? "forward",
        nilToUndefined(leg.arrow.above) || nilToUndefined(leg.arrow.below)
          ? new ReactionConditions(
              nilToUndefined(leg.arrow.above),
              nilToUndefined(leg.arrow.below),
            )
          : undefined,
      ),
    );
  }
  return new ReactionCascade(steps);
}

// -- beyond-formulas builders (parse raw body strings) -------------------

function parseParams(str: string | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  if (!str) return params;
  for (const pair of str.split(",")) {
    const [key, value] = pair.trim().split("=", 2);
    if (key) params[key] = value?.trim() ?? "";
  }
  return params;
}

function buildCrystal(c: RawCapture): Crystal {
  const params = parseParams(c.params as string | undefined);
  const atoms = parseCrystalAtoms(c.body as string | undefined);
  return new Crystal(
    nonEmpty(c.name as string | undefined),
    numberOrNil(params["a"]),
    numberOrNil(params["b"]),
    numberOrNil(params["c"]),
    numberOrNil(params["alpha"]),
    numberOrNil(params["beta"]),
    numberOrNil(params["gamma"]),
    params["sg"],
    atoms,
  );
}

function numberOrNil(s: string | undefined): number | undefined {
  return s === undefined || s === "" ? undefined : Number(s);
}

function parseCrystalAtoms(body: string | undefined): Atom[] {
  if (!body) return [];
  const formula = buildFormula(parse(body) as FormulaCapture);
  const atoms: Atom[] = [];
  for (const node of formula.nodes) {
    if (node instanceof Molecule) {
      for (const child of node.nodes) if (child instanceof Atom) atoms.push(child);
    }
  }
  return atoms;
}

function buildSpectrum(c: RawCapture): Spectrum {
  const body = c.body as string | undefined;
  const peaks: SpectrumPeak[] = [];
  if (body) {
    validateColonLines(body, "spectrum peak");
    for (let line of body.split("\n")) {
      line = line.trim();
      if (!line) continue;
      peaks.push(parsePeak(line));
    }
  }
  return new Spectrum(nonEmpty(c.type as string | undefined), parseParams(c.params as string | undefined), peaks);
}

function parsePeak(line: string): SpectrumPeak {
  let assignment: string | undefined;
  const quoted = /"([^"]*)"/.exec(line);
  if (quoted) {
    assignment = quoted[1];
    line = line.replace(/"[^"]*"/, "").trim();
  }
  const [position, rest] = splitOnce(line, ":");
  const tokens = rest?.trim().split(/\s+/) ?? [];
  return new SpectrumPeak(position?.trim(), tokens[0], tokens[1], assignment);
}

function buildCalculation(c: RawCapture): Calculation {
  const params = nonEmpty(c.params as string | undefined);
  let method: string | undefined;
  let basis: string | undefined;
  if (params) {
    const parts = params.split("/", 2);
    method = parts[0]?.trim();
    basis = parts[1]?.trim();
  }
  const body = c.body as string | undefined;
  const properties: CalculationProperty[] = [];
  if (body) {
    validateColonLines(body, "calculation property");
    for (let line of body.split("\n")) {
      line = line.trim();
      if (!line) continue;
      const [key, rest] = splitOnce(line, ":");
      if (!key) continue;
      const tokens = rest?.trim().split(/\s+/) ?? [];
      properties.push(new CalculationProperty(key.trim(), tokens[0], tokens[1]));
    }
  }
  return new Calculation(method, basis, properties);
}

function buildZMatrix(c: RawCapture): ZMatrix {
  const body = c.body as string | undefined;
  const rows: ZRow[] = [];
  if (body) {
    for (let line of body.split("\n")) {
      line = line.trim();
      if (!line) continue;
      const t = line.split(/\s+/);
      rows.push(new ZRow(t[0], t[1], t[2], t[3], t[4], t[5], t[6]));
    }
  }
  return new ZMatrix(rows);
}

function buildMechanism(c: RawCapture): Mechanism {
  const body = c.body as string | undefined;
  const steps: MechanismStep[] = [];
  const spectators: string[] = [];
  if (body) {
    validateColonLines(body, "mechanism entry");
    for (let line of body.split("\n")) {
      line = line.trim();
      if (!line) continue;
      const [key, value] = splitOnce(line, ":");
      if (!key || value === undefined) continue;
      if (key.trim() === "spectator") {
        spectators.push(...value.trim().split(/\s+/));
      } else {
        steps.push(new MechanismStep(key.trim(), value.trim()));
      }
    }
  }
  return new Mechanism(steps, spectators);
}

function validateColonLines(body: string, what: string): void {
  body.split("\n").forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.includes(":")) return;
    throw new ParseError(`${what} on line ${idx + 1} is missing ':' separator: ${JSON.stringify(line)}`);
  });
}

function splitOnce(s: string, sep: string): [string | undefined, string | undefined] {
  const i = s.indexOf(sep);
  return i === -1 ? [undefined, undefined] : [s.slice(0, i), s.slice(i + 1)];
}
