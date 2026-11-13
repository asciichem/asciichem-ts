// CML (Chemical Markup Language) round-trip — the TypeScript mirror of
// asciichem-rs's cml.rs (the contract port of the reference pipeline):
//
// ```text
// model::Node  ──emit──►  canonical wire (molecule/atom/bond/reaction
//                         + the aci: extension channels)
//              ──DOM──►   libleptris  ──serialize──►  XML string
//
// XML string  ──leptris parse──►  namespace-resolved tree
//              ──read──►  canonical wire  ──restore──►  model
// ```
//
// The leptris directive: every byte of XML parsing and serialization
// goes through the leptris engine (the mandated serialization layer —
// never hand-rolled strings). The write face rides the Sync builder the
// citation track uses; the read face rides loadSync/treeSync.
//
// The engine's wasm load is asynchronous, so the Sync face requires one
// `await initCml()` per process first (the leptris contract). The CLI
// dispatcher and the conformance runner own that warm-up; `toCml` /
// `parseCml` throw guidance when it has not happened.
//
// The aci: extension namespace carries what CML's standard wire does
// not (oxidation state, Lewis markers, electron configuration, embedded
// math, free-form text, mechanism, crystal, spectrum, z-matrix,
// calculation, group structure) — three channels, one per scope:
//
// - **Atom attributes** — `aci:<wire_name>` attributes on `<atom>`
//   (`oxidationState`, `lonePairs`, `radicalElectrons`, `ringClosures`).
// - **Top-level elements** — `<aci:<name> position="N">text</…>`
//   children of `<cml>` (ElectronConfiguration, EmbeddedMath, Text,
//   Mechanism, Crystal, Spectrum, Calculation, ZMatrix); `position`
//   preserves formula node order. The wire format for each is the
//   canonical text render — round-trip-safe by construction (the Text
//   formatter is the canonicaliser), the reference TopLevel channel's
//   exact contract.
// - **Molecule groups** — `<aci:group multiplicity="N" bracket="X"
//   atomRefs="a1 a2"/>` children of `<molecule>`.
//
// Reaction conditions ride the core wire natively: `<conditionList>`
// with `<scalar title="above|below">` (the reference adapter's v0.11.0+
// emission), read back by scalar title; the legacy
// `aci:conditionsAbove`/`aci:conditionsBelow` attributes are read for
// backwards compatibility. The `xmlns:aci` declaration appears only
// when at least one extension is present. Constructs with neither wire
// representation nor channel (molecule annotations) report CmlError
// rather than dropping silently.
import {
  Atom,
  Bond,
  BracketKind,
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
  ReactionConditions,
  Spectrum,
  Text,
  ZMatrix,
} from "./model.js";
import { AsciiChemError } from "./errors.js";
import { parseText } from "./parser.js";
import * as leptris from "leptris";

// The CML core namespace (the standard wire) and the AsciiChem
// extension namespace (the `aci:` channels).
export const CML_NAMESPACE = "http://www.xml-cml.org/schema";
export const ACI_NAMESPACE = "https://asciichem.org/cml-ext";
// The written prefix for ACI_NAMESPACE on emit.
export const ACI_PREFIX = "aci";

// An error surfaced by CML emit or read (an AsciiChemError, so the
// CLI's error families map it like the reference's CML errors).
export class CmlError extends AsciiChemError {}

// One leptris warm-up per process: idempotent, shared by every CML
// path (the citation track warms the same engine for itself).
let engineReady: Promise<void> | null = null;

export function initCml(): Promise<void> {
  engineReady ??= leptris.init().then(() => undefined);
  return engineReady;
}

function requireEngine(): void {
  if (engineReady === null) {
    throw new CmlError(
      "leptris engine not initialised — await initCml() (or go through the CLI) before CML emit or read",
    );
  }
}

// -- frozen channel registries (the aci: extension surface) ------------
// Adding a channel member is one entry here — no other code changes.

type AtomExtensionField = "oxidationState" | "lonePairs" | "radicalElectrons" | "ringClosures";

// Atom-attribute channel: model field name → wire attribute name
// (without the `aci:` prefix), in wire order.
const ATOM_FIELDS: readonly (readonly [AtomExtensionField, string])[] = [
  ["oxidationState", "oxidationState"],
  ["lonePairs", "lonePairs"],
  ["radicalElectrons", "radicalElectrons"],
  ["ringClosures", "ringClosures"],
];

// Top-level channel element names (the reference TopLevel::HANDLERS
// element_name set).
const TOP_LEVEL_ELEMENTS = [
  "electronConfiguration",
  "embeddedMath",
  "text",
  "mechanism",
  "crystal",
  "spectrum",
  "calculation",
  "zmatrix",
];

// Group brackets on the wire (the model stores the same names).
const BRACKETS: readonly BracketKind[] = ["paren", "square", "brace"];

// Bond kind → CML order code (the reference's CML_ORDER_CODES).
function orderCode(kind: string): string {
  switch (kind) {
    case "double":
      return "D";
    case "triple":
      return "T";
    case "quadruple":
      return "Q";
    case "wedge":
      return "W";
    case "hash":
      return "H";
    case "dative":
      return "A";
    case "wavy":
      return "V";
    default:
      return "S";
  }
}

// CML order code → bond kind (the reference's KIND_BY_CML_ORDER).
function kindFromOrder(order: string): string {
  switch (order) {
    case "D":
      return "double";
    case "T":
      return "triple";
    case "Q":
      return "quadruple";
    case "W":
      return "wedge";
    case "H":
      return "hash";
    case "A":
      return "dative";
    case "V":
      return "wavy";
    default:
      return "single";
  }
}

// Parse an atom charge ("2+", "+2", "-", "2-") into a signed value;
// null when the string is not a charge.
function chargeValue(charge: string): number | null {
  const digitsFirst = /^(\d*)([+-])$/.exec(charge);
  const signFirst = digitsFirst === null ? /^([+-])(\d*)$/.exec(charge) : null;
  const match = digitsFirst ?? signFirst;
  if (match === null) return null;
  const digits = digitsFirst !== null ? match[1] : match[2];
  const magnitude = digits === "" ? 1 : Number(digits);
  if (!Number.isInteger(magnitude)) return null;
  return charge.endsWith("+") ? magnitude : -magnitude;
}

// The reference's lenient XML integer cast (Ruby `String#to_i`): the
// leading integer literal, or 0 when the value starts with none.
function leadingInteger(value: string): number {
  const match = /^\s*[-+]?\d+/.exec(value);
  if (match === null) return 0;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------
// Canonical IDs — a/b/m/r/g counters shared across one translation pass,
// so re-running on equivalent input yields byte-equal output.
// ---------------------------------------------------------------------------

class Ids {
  atoms = 0;
  bonds = 0;
  molecules = 0;
  reactions = 0;
  groups = 0;
  nextAtom(): string {
    this.atoms += 1;
    return `a${this.atoms}`;
  }
  nextBond(): string {
    this.bonds += 1;
    return `b${this.bonds}`;
  }
  nextMolecule(): string {
    this.molecules += 1;
    return `m${this.molecules}`;
  }
  nextReaction(): string {
    this.reactions += 1;
    return `r${this.reactions}`;
  }
  nextGroup(): string {
    this.groups += 1;
    return `g${this.groups}`;
  }
}

// ---------------------------------------------------------------------------
// Emit: model → DOM → XML. The DOM is built through the leptris engine's
// construction face against a one-element shell document (the same
// pattern the citation track uses); serialization is the engine's.
// ---------------------------------------------------------------------------

// Serializes formula nodes to a CML XML string.
// `parseCml(toCml(nodes))` rebuilds the model for the gated surface —
// the three-way round-trip contract.
export function toCml(nodes: readonly Node[]): string {
  requireEngine();
  const documentId = leptris.loadSync("<shell/>");
  try {
    const ids = new Ids();

    // Walk every formula node, per-category, like the reference
    // adapter: molecules, reactions, cascades regroup; top-level aci:
    // entries keep their formula position.
    const molecules: number[] = [];
    const reactions: number[] = [];
    const reactionLists: number[] = [];
    const topLevel: { position: number; element: string; content: string }[] = [];
    let needsAci = false;

    nodes.forEach((node, position) => {
      if (node instanceof Molecule) {
        const emitted = emitMolecule(documentId, ids, node);
        needsAci ||= emitted.extensions;
        molecules.push(emitted.element);
      } else if (node instanceof Reaction) {
        const emitted = emitReaction(documentId, ids, node);
        needsAci ||= emitted.extensions;
        reactions.push(emitted.element);
      } else if (node instanceof ReactionCascade) {
        const emitted = emitReactionList(documentId, ids, node);
        needsAci ||= emitted.extensions;
        reactionLists.push(emitted.element);
      } else if (node instanceof Atom || node instanceof Bond) {
        throw new CmlError(
          `construct has no CML wire representation: bare ${node.diagnosticLabel()} outside a molecule`,
        );
      } else {
        const payload = topLevelPayload(node);
        needsAci = true;
        topLevel.push({ position, element: payload.element, content: payload.content });
      }
    });

    const root = leptris.createElementSync(documentId, "cml");
    leptris.setAttributeSync(root, "xmlns", CML_NAMESPACE);
    if (needsAci) leptris.setAttributeSync(root, "xmlns:aci", ACI_NAMESPACE);
    for (const { position, element, content } of topLevel) {
      const entry = leptris.createElementSync(documentId, `${ACI_PREFIX}:${element}`);
      leptris.setAttributeSync(entry, "position", String(position));
      leptris.appendChildSync(entry, leptris.createTextSync(documentId, content));
      leptris.appendChildSync(root, entry);
    }
    for (const element of molecules) leptris.appendChildSync(root, element);
    for (const element of reactions) leptris.appendChildSync(root, element);
    for (const element of reactionLists) leptris.appendChildSync(root, element);
    leptris.setRootSync(documentId, root);
    return leptris.xmlSync(documentId);
  } catch (error) {
    if (error instanceof leptris.XmlError) throw new CmlError(`CML XML engine error: ${(error as Error).message}`);
    throw error;
  } finally {
    leptris.closeSync(documentId);
  }
}

// The top-level channel payload: wire element name + text content.
// Text-shaped constructs serialize as their canonical text render
// (round-trip-safe by construction); embedded math carries the raw
// source (the backticks are re-added on read).
function topLevelPayload(node: Node): { element: string; content: string } {
  if (node instanceof ElectronConfiguration) return { element: "electronConfiguration", content: node.toText() };
  if (node instanceof EmbeddedMath) return { element: "embeddedMath", content: node.source };
  if (node instanceof Mechanism) return { element: "mechanism", content: node.toText() };
  if (node instanceof Crystal) return { element: "crystal", content: node.toText() };
  if (node instanceof Spectrum) return { element: "spectrum", content: node.toText() };
  if (node instanceof Calculation) return { element: "calculation", content: node.toText() };
  if (node instanceof ZMatrix) return { element: "zmatrix", content: node.toText() };
  if (node instanceof Text) return { element: "text", content: `"${node.content}"` };
  throw new CmlError(`construct has no CML wire representation: ${node.diagnosticLabel()}`);
}

// A wire atom mid-emit.
interface WireAtom {
  id: string;
  element: string;
  isotope?: string;
  formalCharge?: string;
  count?: string;
  extensions: { [K in AtomExtensionField]: string | undefined };
}

interface WireBond {
  id: string;
  from: string;
  to: string;
  order: string;
}

interface WireGroup {
  multiplicity?: string;
  bracket: string;
  atomIds: string[];
}

// Walks a molecule's nodes, producing the ordered atom list, the bond
// list with atomRefs, and the group records — the single source of
// atom ID assignment. Mirrors the reference's MoleculeWalker.
class MoleculeWalker {
  readonly atoms: WireAtom[] = [];
  readonly bonds: WireBond[] = [];
  readonly groups: WireGroup[] = [];
  private readonly groupStack: number[] = [];
  private pendingBond: string | undefined;
  private lastAtom: string | undefined;
  private readonly openRings: { digit: string; id: string }[] = [];
  private ringPairs: [string, string][] = [];

  constructor(private readonly ids: Ids) {}

  walkNodes(nodes: readonly Node[], multiplier: number | undefined): void {
    for (const node of nodes) {
      if (node instanceof Atom) {
        this.emitAtom(node, multiplier);
      } else if (node instanceof Bond) {
        this.pendingBond = node.kind;
      } else if (node instanceof Group) {
        this.enterGroup(node, multiplier);
      } else if (node instanceof Molecule) {
        const inner = combineMultiplier(multiplier, node.coefficient);
        this.walkNodes(node.nodes, inner);
      }
    }
  }

  private enterGroup(group: Group, multiplier: number | undefined): void {
    const multiplicity = group.multiplicity;
    const inner = combineMultiplier(multiplier, multiplicity);
    const bracket = BRACKETS.includes(group.bracket) ? group.bracket : "paren";
    // The canonical walk assigns group IDs (`g1`, ...) at the same
    // point the reference's GroupRecord does, keeping the ID stream
    // identical; the wire itself carries groups by atomRefs only.
    this.ids.nextGroup();
    this.groups.push({ multiplicity, bracket, atomIds: [] });
    this.groupStack.push(this.groups.length - 1);
    this.walkNodes(group.nodes, inner);
    this.groupStack.pop();
  }

  private emitAtom(atom: Atom, multiplier: number | undefined): void {
    const id = this.ids.nextAtom();
    for (const index of this.groupStack) this.groups[index].atomIds.push(id);
    if (atom.ringClosures !== undefined) {
      for (const digit of atom.ringClosures) {
        const index = this.openRings.findIndex((open) => open.digit === digit);
        if (index >= 0) {
          const { id: from } = this.openRings.splice(index, 1)[0];
          this.ringPairs.push([from, id]);
        } else {
          this.openRings.push({ digit, id });
        }
      }
    }
    const count =
      multiplier === undefined
        ? atom.subscript
        : (combineMultiplier(multiplier, atom.subscript) ?? multiplier).toString();
    let bond: WireBond | undefined;
    if (this.pendingBond !== undefined && this.lastAtom !== undefined) {
      bond = { id: this.ids.nextBond(), from: this.lastAtom, to: id, order: orderCode(this.pendingBond) };
      this.pendingBond = undefined;
    }
    if (bond !== undefined) this.bonds.push(bond);
    this.atoms.push({
      id,
      element: atom.element,
      isotope: atom.isotope,
      formalCharge: atom.charge,
      count,
      extensions: {
        oxidationState: atom.oxidationState,
        lonePairs: atom.lonePairs === undefined ? undefined : String(atom.lonePairs),
        radicalElectrons: atom.radicalElectrons === undefined ? undefined : String(atom.radicalElectrons),
        ringClosures: atom.ringClosures,
      },
    });
    this.lastAtom = id;
  }

  // Emits canonical bonds for each ring-closure pair, skipping pairs a
  // positional bond already covers (the degenerate `C1-C1`).
  emitRingBonds(): void {
    const pairs = this.ringPairs;
    this.ringPairs = [];
    for (const [from, to] of pairs) {
      const duplicate = this.bonds.some(
        (bond) => (bond.from === from && bond.to === to) || (bond.from === to && bond.to === from),
      );
      if (!duplicate) this.bonds.push({ id: this.ids.nextBond(), from, to, order: "S" });
    }
  }
}

// The reference walker's multiplier combine: numeric multiply,
// undefined when neither side carries a usable integer, the usable
// side otherwise. A numeric left with a non-numeric right yields the
// multiplier (a group without multiplicity inside a `2`-coefficient
// molecule still doubles its atom counts).
function combineMultiplier(left: number | undefined, right: string | undefined): number | undefined {
  // Mirror Ruby's Integer(value, exception: false): only a full
  // integer literal combines; "2a" stays a raw string subscript.
  const rightValue = right === undefined || !/^-?\d+$/.test(right) ? undefined : Number(right);
  if (left === undefined && rightValue === undefined) return undefined;
  return (left ?? 1) * (rightValue ?? 1);
}

// Emits one molecule; the bool reports whether any aci: extension was
// written (atom attributes or group elements), so the root can declare
// the namespace only when needed.
function emitMolecule(
  documentId: number,
  ids: Ids,
  molecule: Molecule,
): { element: number; extensions: boolean } {
  const walker = new MoleculeWalker(ids);
  walker.walkNodes(molecule.nodes, undefined);
  walker.emitRingBonds();
  const { atoms, bonds, groups } = walker;

  let extensions = false;
  const element = leptris.createElementSync(documentId, "molecule");
  leptris.setAttributeSync(element, "id", ids.nextMolecule());
  if (molecule.coefficient !== undefined) leptris.setAttributeSync(element, "count", molecule.coefficient);
  const totalCharge = totalFormalCharge(atoms);
  if (totalCharge !== null) leptris.setAttributeSync(element, "formalCharge", totalCharge);
  if (atoms.length > 0) {
    const array = leptris.createElementSync(documentId, "atomArray");
    for (const atom of atoms) {
      const atomElement = leptris.createElementSync(documentId, "atom");
      leptris.setAttributeSync(atomElement, "id", atom.id);
      leptris.setAttributeSync(atomElement, "elementType", atom.element);
      if (atom.isotope !== undefined) leptris.setAttributeSync(atomElement, "isotope", atom.isotope);
      if (atom.formalCharge !== undefined) leptris.setAttributeSync(atomElement, "formalCharge", atom.formalCharge);
      if (atom.count !== undefined) leptris.setAttributeSync(atomElement, "count", atom.count);
      for (const [field, wire] of ATOM_FIELDS) {
        const value = atom.extensions[field];
        if (value !== undefined) {
          leptris.setAttributeSync(atomElement, `${ACI_PREFIX}:${wire}`, value);
          extensions = true;
        }
      }
      leptris.appendChildSync(array, atomElement);
    }
    leptris.appendChildSync(element, array);
  }
  if (bonds.length > 0) {
    const array = leptris.createElementSync(documentId, "bondArray");
    for (const bond of bonds) {
      const bondElement = leptris.createElementSync(documentId, "bond");
      leptris.setAttributeSync(bondElement, "id", bond.id);
      leptris.setAttributeSync(bondElement, "atomRefs2", `${bond.from} ${bond.to}`);
      leptris.setAttributeSync(bondElement, "order", bond.order);
      leptris.appendChildSync(array, bondElement);
    }
    leptris.appendChildSync(element, array);
  }
  if (groups.length > 0) {
    extensions = true;
    for (const group of groups) {
      const groupElement = leptris.createElementSync(documentId, `${ACI_PREFIX}:group`);
      if (group.multiplicity !== undefined) {
        leptris.setAttributeSync(groupElement, "multiplicity", group.multiplicity);
      }
      leptris.setAttributeSync(groupElement, "bracket", group.bracket);
      leptris.setAttributeSync(groupElement, "atomRefs", group.atomIds.join(" "));
      leptris.appendChildSync(element, groupElement);
    }
  }
  return { element, extensions };
}

function totalFormalCharge(atoms: readonly WireAtom[]): string | null {
  let sum = 0;
  let charged = false;
  for (const atom of atoms) {
    if (atom.formalCharge === undefined) continue;
    const value = chargeValue(atom.formalCharge);
    if (value === null) continue;
    charged = true;
    sum += value;
  }
  if (!charged) return null;
  return sum > 0 ? `+${sum}` : String(sum);
}

function emitReaction(
  documentId: number,
  ids: Ids,
  reaction: Reaction,
): { element: number; extensions: boolean } {
  const element = leptris.createElementSync(documentId, "reaction");
  leptris.setAttributeSync(element, "id", ids.nextReaction());
  leptris.setAttributeSync(element, "title", reaction.arrow);
  leptris.setAttributeSync(element, "type", reaction.arrow);
  let extensions = false;
  const reactantList = leptris.createElementSync(documentId, "reactantList");
  for (const molecule of reaction.reactants) {
    extensions = emitParticipant(documentId, ids, reactantList, "reactant", molecule) || extensions;
  }
  leptris.appendChildSync(element, reactantList);
  const productList = leptris.createElementSync(documentId, "productList");
  for (const molecule of reaction.products) {
    extensions = emitParticipant(documentId, ids, productList, "product", molecule) || extensions;
  }
  leptris.appendChildSync(element, productList);
  // The conditions channel rides the core wire natively (the
  // reference adapter's emission): `<conditionList>` with
  // `<scalar title="above|below">` children, in above-then-below
  // order. A reaction without conditions emits no conditionList.
  const conditions = reaction.conditions;
  if (conditions?.above !== undefined || conditions?.below !== undefined) {
    leptris.appendChildSync(element, emitConditionList(documentId, conditions));
  }
  return { element, extensions };
}

// `<conditionList><scalar title="above">…</scalar>…</conditionList>` —
// the reference's build_condition_list shape.
function emitConditionList(documentId: number, conditions: ReactionConditions): number {
  const list = leptris.createElementSync(documentId, "conditionList");
  for (const [title, value] of [
    ["above", conditions.above],
    ["below", conditions.below],
  ] as const) {
    if (value === undefined) continue;
    const scalar = leptris.createElementSync(documentId, "scalar");
    leptris.setAttributeSync(scalar, "title", title);
    leptris.appendChildSync(scalar, leptris.createTextSync(documentId, value));
    leptris.appendChildSync(list, scalar);
  }
  return list;
}

function emitParticipant(
  documentId: number,
  ids: Ids,
  list: number,
  role: string,
  molecule: Molecule,
): boolean {
  const participant = leptris.createElementSync(documentId, role);
  const substance = leptris.createElementSync(documentId, "substance");
  leptris.setAttributeSync(substance, "role", role);
  const { element, extensions } = emitMolecule(documentId, ids, molecule);
  leptris.appendChildSync(substance, element);
  leptris.appendChildSync(participant, substance);
  leptris.appendChildSync(list, participant);
  return extensions;
}

function emitReactionList(documentId: number, ids: Ids, cascade: ReactionCascade): { element: number; extensions: boolean } {
  const element = leptris.createElementSync(documentId, "reactionList");
  let extensions = false;
  for (const step of cascade.steps) {
    const emitted = emitReaction(documentId, ids, step);
    extensions ||= emitted.extensions;
    leptris.appendChildSync(element, emitted.element);
  }
  return { element, extensions };
}

// ---------------------------------------------------------------------------
// Read: XML → namespace-resolved tree → model. The tree comes from the
// engine's detached snapshot (treeSync) — element namespace URIs are
// resolved through the declared prefix mappings, so top-level channel
// classification is exact regardless of the written prefix. The engine's
// snapshot keeps attribute names lexical (its .d.ts notes the contract),
// so the atom-attribute channel classifies via the xmlns declaration
// bound to ACI_NAMESPACE instead of a bare "aci:" literal.
// ---------------------------------------------------------------------------

interface XAttr {
  name: string;
  value: string;
}

interface XNode {
  namespaceURI: string | null;
  localName: string;
  attrs: XAttr[];
  children: XNode[];
  text: string;
}

// Flattens the engine's snapshot into the read tree, concatenating text.
function toXNode(element: leptris.XmlElement): XNode {
  let text = "";
  const children: XNode[] = [];
  for (const child of element.children) {
    if (child.kind === "element") {
      children.push(toXNode(child));
    } else if (child.kind === "text" || child.kind === "cdata") {
      text += child.text;
    }
  }
  return {
    namespaceURI: element.namespaceURI,
    localName: element.localName,
    attrs: element.attributes.map(([name, value]) => ({ name, value })),
    children,
    text,
  };
}

function attr(node: XNode, local: string): string | undefined {
  return node.attrs.find((candidate) => candidate.name === local)?.value;
}

// The written prefix bound to ACI_NAMESPACE (scan the document's xmlns
// declarations; the emitted prefix `aci` is the fallback). Attributes
// ride lexical names in the engine's snapshot, so channel attributes
// are matched through this prefix — a foreign namespace written as
// `aci:` can never be mistaken for the channel, because the prefix is
// resolved by URI value, not by the literal string.
function aciPrefixOf(root: XNode): string {
  const declared = root.attrs.find(
    (candidate) => candidate.name.startsWith("xmlns:") && candidate.value === ACI_NAMESPACE,
  );
  return declared !== undefined ? declared.name.slice("xmlns:".length) : ACI_PREFIX;
}

function attrAci(node: XNode, prefix: string, local: string): string | undefined {
  return attr(node, `${prefix}:${local}`);
}

// True when this node rides the core CML namespace (or no namespace —
// sloppy-but-common undeclared CML).
function isCore(node: XNode): boolean {
  return node.namespaceURI === null || node.namespaceURI === CML_NAMESPACE;
}

// The engine's snapshot resolves element namespace URIs through the
// declared prefix mappings, so channel classification is by URI — a
// foreign namespace can never be mistaken for a channel.
function isAci(node: XNode): boolean {
  return node.namespaceURI === ACI_NAMESPACE;
}

function childrenNamed(node: XNode, local: string): XNode[] {
  return node.children.filter((child) => child.localName === local);
}

function childNamed(node: XNode, local: string): XNode | undefined {
  return node.children.find((child) => child.localName === local);
}

// Parses a CML XML string back into formula nodes.
export function parseCml(xml: string): Node[] {
  requireEngine();
  let documentId!: number;
  try {
    documentId = leptris.loadSync(xml);
  } catch (error) {
    if (error instanceof leptris.XmlError) throw new CmlError(`CML XML engine error: ${(error as Error).message}`);
    throw error;
  }
  try {
    const root = toXNode(leptris.treeSync(documentId));
    if (root.localName !== "cml" || !isCore(root)) {
      throw new CmlError(`CML wire violation: expected a <cml> root, got <${root.localName}>`);
    }
    const prefix = aciPrefixOf(root);

    // Restore order mirrors the reference translator: core wire (atoms
    // carry the atom-attribute channel inline), then group rebuild,
    // then top-level insertion at preserved positions.
    const nodes: Node[] = [];
    const topLevel: { position: number; node: Node }[] = [];
    for (const childNode of root.children) {
      if (isAci(childNode)) {
        if (TOP_LEVEL_ELEMENTS.includes(childNode.localName)) topLevel.push(readTopLevel(childNode));
        continue;
      }
      if (!isCore(childNode)) continue;
      switch (childNode.localName) {
        case "molecule":
          nodes.push(readMolecule(childNode, prefix));
          break;
        case "reaction":
          nodes.push(readReaction(childNode, prefix));
          break;
        case "reactionList": {
          const steps = childrenNamed(childNode, "reaction").map((reaction) => readReaction(reaction, prefix));
          nodes.push(new ReactionCascade(steps));
          break;
        }
        default:
          break;
      }
    }

    // Ascending position order, like the reference restore: earlier
    // inserts never shift the later positions.
    topLevel.sort((a, b) => a.position - b.position);
    for (const entry of topLevel) {
      nodes.splice(Math.min(entry.position, nodes.length), 0, entry.node);
    }
    return nodes;
  } catch (error) {
    if (error instanceof leptris.XmlError) throw new CmlError(`CML XML engine error: ${(error as Error).message}`);
    throw error;
  } finally {
    leptris.closeSync(documentId);
  }
}

function readTopLevel(element: XNode): { position: number; node: Node } {
  const positionAttr = attr(element, "position");
  const position = positionAttr === undefined ? 0 : Math.max(leadingInteger(positionAttr), 0);
  const content = element.text;
  // The wire carries the construct's canonical text render; wrapped
  // constructs get their delimiters back before re-parsing.
  const text = element.localName === "embeddedMath" ? `\`${content}\`` : content;
  let node: Node;
  try {
    const parsed = parseText(text);
    if (parsed.nodes.length === 0) {
      throw new CmlError(`CML wire violation: aci:${element.localName} content is empty`);
    }
    node = parsed.nodes[0];
  } catch (error) {
    if (error instanceof CmlError) throw error;
    throw new CmlError(
      `CML wire violation: aci:${element.localName} content failed to parse: ${(error as Error).message}`,
    );
  }
  return { position, node };
}

function readMolecule(element: XNode, prefix: string): Molecule {
  const coefficient = attr(element, "count");
  const wireAtoms: { id?: string; atom: Atom }[] = [];
  const wireBonds: { refs: string[]; order: string }[] = [];
  const groups: { multiplicity?: string; bracket: string; atomIds: string[] }[] = [];
  for (const childNode of element.children) {
    if (isAci(childNode)) {
      if (childNode.localName === "group") groups.push(readGroup(childNode));
      continue;
    }
    switch (childNode.localName) {
      case "atomArray":
        for (const atomElement of childrenNamed(childNode, "atom")) {
          wireAtoms.push(readAtom(atomElement, prefix));
        }
        break;
      case "bondArray":
        for (const bondElement of childrenNamed(childNode, "bond")) {
          wireBonds.push(readBond(bondElement));
        }
        break;
      default:
        break;
    }
  }

  const molecule = new Molecule([], coefficient);
  rebuildAtomsAndBonds(molecule, wireAtoms, wireBonds);
  rebuildGroups(molecule, groups);
  return molecule;
}

function readAtom(element: XNode, prefix: string): { id?: string; atom: Atom } {
  const elementType = attr(element, "elementType");
  if (elementType === undefined) throw new CmlError("CML wire violation: atom without elementType");
  const count = attr(element, "count");
  const lonePairs = attrAci(element, prefix, "lonePairs");
  const radicalElectrons = attrAci(element, prefix, "radicalElectrons");
  return {
    id: attr(element, "id"),
    atom: new Atom(
      elementType,
      attr(element, "isotope"),
      count === undefined || count === "1" ? undefined : count,
      undefined,
      attr(element, "formalCharge"),
      attrAci(element, prefix, "oxidationState"),
      lonePairs === undefined ? undefined : Math.max(leadingInteger(lonePairs), 0),
      radicalElectrons === undefined ? undefined : Math.max(leadingInteger(radicalElectrons), 0),
      attrAci(element, prefix, "ringClosures"),
    ),
  };
}

function readBond(element: XNode): { refs: string[]; order: string } {
  const refs = (attr(element, "atomRefs2") ?? "").split(/\s+/).filter((ref) => ref !== "");
  if (refs.length !== 2) {
    throw new CmlError(`CML wire violation: bond atomRefs2 must reference two atoms, got ${JSON.stringify(refs)}`);
  }
  return { refs, order: attr(element, "order") ?? "S" };
}

function readGroup(element: XNode): { multiplicity?: string; bracket: string; atomIds: string[] } {
  const bracket = attr(element, "bracket");
  return {
    multiplicity: attr(element, "multiplicity"),
    bracket: bracket !== undefined && (BRACKETS as readonly string[]).includes(bracket) ? bracket : "paren",
    atomIds: (attr(element, "atomRefs") ?? "").split(/\s+/).filter((ref) => ref !== ""),
  };
}

// Rebuilds the molecule's node list: atoms in wire order, bonds
// inserted just before their later endpoint (the linear-spelling
// position), ring bonds (spanning atoms) left to the atom-attribute
// channel's ring-closure digits.
function rebuildAtomsAndBonds(
  molecule: Molecule,
  wireAtoms: readonly { id?: string; atom: Atom }[],
  wireBonds: readonly { refs: readonly string[]; order: string }[],
): void {
  const ids = wireAtoms.map((restored) => restored.id);
  const nodes: Node[] = wireAtoms.map((restored) => restored.atom);
  if (wireBonds.length === 0) {
    molecule.nodes.splice(0, molecule.nodes.length, ...nodes);
    return;
  }
  const positionOf = (id: string): number | undefined => {
    const index = ids.indexOf(id);
    return index === -1 ? undefined : index;
  };
  const placed = wireBonds.map((bond) => {
    const positions = bond.refs.map(positionOf).filter((position): position is number => position !== undefined);
    positions.sort((a, b) => a - b);
    const later = positions[positions.length - 1] ?? 0;
    const span = positions.length > 0 ? later - positions[0] : 0;
    return { bond, later, span };
  });
  // Descending later position so earlier insertions don't shift the
  // pending ones.
  placed.sort((a, b) => b.later - a.later);
  for (const { bond, later, span } of placed) {
    // A ring bond connects non-adjacent atoms; its endpoints span a
    // gap, and the aci:ringClosures digits re-spell it.
    if (span > 1) continue;
    nodes.splice(later, 0, new Bond(kindFromOrder(bond.order) as Bond["kind"]));
  }
  molecule.nodes.splice(0, molecule.nodes.length, ...nodes);
}

// Rebuilds Group nodes from the aci:group records. Records are
// processed in reverse order so inner groups rebuild before their
// outer parents (the walker records outer groups first).
function rebuildGroups(molecule: Molecule, groups: readonly { multiplicity?: string; bracket: string; atomIds: string[] }[]): void {
  for (const record of [...groups].reverse()) {
    rebuildOneGroup(molecule, record);
  }
}

function rebuildOneGroup(molecule: Molecule, record: { multiplicity?: string; bracket: string; atomIds: readonly string[] }): void {
  const targets: number[] = [];
  for (const id of record.atomIds) {
    const match = /^a(\d+)$/.exec(id);
    if (match !== null) targets.push(Number(match[1]));
  }
  if (targets.length === 0) return;
  const span = findTargetSpan(molecule.nodes, targets);
  if (span === null) return;
  const [first, last] = span;
  applyGroupMultiplicity(molecule.nodes, first, last, record.multiplicity);
  spliceGroup(molecule, first, last, record);
}

// Walks the molecule's nodes in canonical-walk order, tracking which
// atom id each position covers; the group spans the contiguous run
// covering any referenced atom (bonds included, preserving the chain
// inside the group).
function findTargetSpan(nodes: readonly Node[], targets: readonly number[]): [number, number] | null {
  let first: number | undefined;
  let last: number | undefined;
  let canonical = 0;
  nodes.forEach((node, index) => {
    const count = countAtoms(node);
    const covers = targets.some((target) => target > canonical && target <= canonical + count);
    if (covers) {
      first ??= index;
      last = index;
    }
    canonical += count;
  });
  if (first === undefined) return null;
  return [first, last ?? first];
}

// Counts the atoms transitively contained in a node.
function countAtoms(node: Node): number {
  if (node instanceof Atom) return 1;
  if (node instanceof Group) return node.nodes.reduce((sum, child) => sum + countAtoms(child), 0);
  if (node instanceof Molecule) return node.nodes.reduce((sum, child) => sum + countAtoms(child), 0);
  return 0;
}

// Divides each covered atom's subscript by the group multiplicity (the
// emit side multiplied it in). Inner groups were already divided when
// they rebuilt, so only bare atoms in this slice move.
function applyGroupMultiplicity(nodes: Node[], first: number, last: number, multiplicity: string | undefined): void {
  if (multiplicity === undefined) return;
  const divisor = leadingInteger(multiplicity);
  if (divisor <= 0) return;
  for (let index = first; index <= last; index += 1) {
    const node = nodes[index];
    if (!(node instanceof Atom) || node.subscript === undefined) continue;
    const divided = Math.trunc(leadingInteger(node.subscript) / divisor);
    // Atoms are immutable; the patch returns the divided copy.
    nodes[index] = node.patch({ subscript: divided === 1 ? undefined : String(divided) });
  }
}

// Replaces the target run with a Group node. A bond immediately before
// the group's first node is its attachment bond (the grammar keeps it
// inside the group), so it moves in rather than re-spelling as a stray
// prefix marker.
function spliceGroup(
  molecule: Molecule,
  first: number,
  last: number,
  record: { multiplicity?: string; bracket: string },
): void {
  const inner = molecule.nodes.splice(first, last - first + 1);
  let start = first;
  if (start > 0 && molecule.nodes[start - 1] instanceof Bond) {
    const bond = molecule.nodes.splice(start - 1, 1)[0];
    inner.unshift(bond);
    start -= 1;
  }
  molecule.nodes.splice(
    start,
    0,
    new Group(inner, record.multiplicity, (BRACKETS as readonly string[]).includes(record.bracket) ? (record.bracket as BracketKind) : "paren"),
  );
}

function readReaction(element: XNode, prefix: string): Reaction {
  const arrowWire = attr(element, "type") ?? attr(element, "title");
  const arrow = (["forward", "reverse", "equilibrium", "resonance"] as const).includes(arrowWire as Reaction["arrow"])
    ? (arrowWire as Reaction["arrow"])
    : "forward";
  const reactants: Molecule[] = [];
  const products: Molecule[] = [];
  let conditions: ReactionConditions | undefined;
  for (const childNode of element.children) {
    if (!isCore(childNode)) continue;
    switch (childNode.localName) {
      case "reactantList":
        for (const participant of childrenNamed(childNode, "reactant")) {
          reactants.push(readParticipant(participant, prefix));
        }
        break;
      case "productList":
        for (const participant of childrenNamed(childNode, "product")) {
          products.push(readParticipant(participant, prefix));
        }
        break;
      case "conditionList":
        conditions = readConditionList(childNode);
        break;
      default:
        break;
    }
  }
  // Legacy fallback: the pre-0.11.0 `aci:conditionsAbove`/`Below`
  // attributes (the reference's ConditionsExtensions.extract). The
  // native conditionList wins when both ride the wire.
  if (conditions === undefined) {
    const above = attrAci(element, prefix, "conditionsAbove");
    const below = attrAci(element, prefix, "conditionsBelow");
    if (above !== undefined || below !== undefined) {
      conditions = new ReactionConditions(above, below);
    }
  }
  return new Reaction(reactants, products, arrow, conditions);
}

// `<scalar title="above|below">text</scalar>` children (the reference's
// conditions_from_canonical): scalars are matched by title; unknown
// titles are skipped.
function readConditionList(element: XNode): ReactionConditions | undefined {
  let above: string | undefined;
  let below: string | undefined;
  for (const scalar of childrenNamed(element, "scalar")) {
    const title = attr(scalar, "title");
    if (title === "above" && above === undefined) above = scalar.text;
    if (title === "below" && below === undefined) below = scalar.text;
  }
  if (above === undefined && below === undefined) return undefined;
  return new ReactionConditions(above, below);
}

function readParticipant(element: XNode, prefix: string): Molecule {
  const substance = childNamed(element, "substance");
  if (substance === undefined) {
    throw new CmlError(`CML wire violation: ${element.localName} without substance`);
  }
  const molecule = childNamed(substance, "molecule");
  if (molecule === undefined) {
    throw new CmlError("CML wire violation: substance without molecule");
  }
  return readMolecule(molecule, prefix);
}

// -- formula-level convenience (the Ruby to_cml / Cml.parse faces) -----

export function formulaToCml(formula: Formula): string {
  return toCml(formula.nodes);
}

export function parseCmlToFormula(xml: string): Formula {
  return new Formula(parseCml(xml));
}
