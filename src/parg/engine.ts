// The PARG engine: parses through the compiled AsciiChem PARG artifact
// (vendored from the asciichem-parg contract at src/parg/asciichem.json —
// the same artifact the Ruby reference ships at
// lib/asciichem/engine/parg/asciichem.json and the Rust crate embeds from
// artifacts/) over the parsanol wasm runtime, and adapts the artifact's
// shape tree (parsanol-tree/v2) to the capture shapes src/transform.ts
// consumes — this module's own capture contract.
//
// Tree-shape notes (what the compiler bakes):
// - Captured leaves are slices {value, line, column, offset, length};
//   captured structural rules are objects/arrays keyed by capture name.
// - Absent optionals appear either as a missing key or as an empty
//   array (a zero-match repetition), depending on the production —
//   both normalise to undefined here.
// - Repetition continuations arrive as extra single-key wrappers
//   ({plus_term: {...}}, {segment: {...}}) that the adapter flattens.
// - Delimiter-only captures (*_close, *_quote) are dropped; the
//   capture contract never surfaced them.
//
// Rejection parity: the grammar anchors at end of input, and — as in
// the reference PargEngine (asciichem-ruby) — a tree that covers less
// input than was matched is refused (capture-completeness invariant,
// not end-of-input handling).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PargRuntime } from "parsanol";
import type { FormulaCapture } from "../transform.js";
import { ParseError } from "../errors.js";

// Version the vendored artifact was built from; load fails loudly on
// drift so the engine never runs a stale grammar (mirrors
// PargEngine::PARG_GRAMMAR_VERSION in asciichem-ruby).
const PARG_GRAMMAR_VERSION = "0.4.0";

// SHA-256 of the vendored artifact bytes — pins the vendored revision
// byte-exactly (parsanol's own checksum verifies the artifact's
// grammar-source integrity; this pins the vendored copy).
const ARTIFACT_SHA256 =
  "b5c1f5289f0487e974091e451f5b2703c12c861347c09dd8332bdcfd1822c34f";

const ENTRY = "formula";

// The wasm engine compiles lazily on first parse (~1.5 MB); importing
// this module costs nothing.
let cachedRuntime: PargRuntime | null = null;

function runtime(): PargRuntime {
  if (cachedRuntime === null) {
    const artifactJson = readFileSync(
      new URL("./asciichem.json", import.meta.url),
      "utf8",
    );
    const checksum = createHash("sha256").update(artifactJson).digest("hex");
    if (checksum !== ARTIFACT_SHA256) {
      throw new Error(
        `vendored PARG artifact checksum ${checksum} does not match the ` +
          `pinned revision ${ARTIFACT_SHA256} — re-vendor from asciichem-parg`,
      );
    }
    const rt = new PargRuntime(artifactJson, ENTRY);
    const version = rt.envelope.version as string;
    if (version !== PARG_GRAMMAR_VERSION) {
      throw new Error(
        `vendored PARG artifact version ${JSON.stringify(version)} does not ` +
          `match the engine's pinned grammar ${JSON.stringify(PARG_GRAMMAR_VERSION)} ` +
          "— re-vendor from asciichem-parg",
      );
    }
    cachedRuntime = rt;
  }
  return cachedRuntime;
}

// -- parse failures -------------------------------------------------------

export class PargSyntaxError extends Error {
  constructor(
    message: string,
    readonly location?: { line: number; column: number; offset: number },
  ) {
    super(message);
    this.name = "PargSyntaxError";
  }
}

// The wasm engine reports refusals as "Parse failed at offset N (line
// L, column C): expected ..."; unwrap the position for ParseError.
function toSyntaxError(error: unknown): PargSyntaxError {
  const match = /Parse failed at offset (\d+) \(line (\d+), column (\d+)\)/.exec(
    String(error),
  );
  if (match) {
    const [, offset, line, column] = match;
    return new PargSyntaxError(`AsciiChem parse error: ${String(error)}`, {
      offset: Number(offset),
      line: Number(line),
      column: Number(column),
    });
  }
  return new PargSyntaxError(`AsciiChem parse error: ${String(error)}`);
}

// -- shape tree to capture tree --------------------------------------------

type ShapeNode = Record<string, unknown>;

// Captured leaves: {value, line, column, offset, length}.
interface Slice {
  value: string;
  offset: number;
  length: number;
}

function isSlice(node: unknown): node is Slice {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as Slice).value === "string" &&
    typeof (node as Slice).offset === "number"
  );
}

// Absent optionals: missing key or empty array (zero-match repetition).
function opt(node: unknown): unknown {
  if (node === undefined || node === null) return undefined;
  if (Array.isArray(node) && node.length === 0) return undefined;
  return node;
}

function slice(node: unknown): string | undefined {
  const value = opt(node);
  return isSlice(value) ? value.value : undefined;
}

// The compiler wraps some captures ({value: slice}) when the named
// rule sits behind a lookahead/sequence — unwrap one level.
function wrappedSlice(node: unknown): string | undefined {
  const value = opt(node);
  if (isSlice(value)) return value.value;
  if (typeof value === "object" && value !== null && "value" in value) {
    return slice((value as ShapeNode)["value"]);
  }
  return undefined;
}

// Ruby PargEngine::TreeAdapter.consumed_length: slices contribute
// offset+length, hashes SUM their parts, arrays take the MAX. A tree
// that covers less input than was matched means a captured sequence
// left a literal uncaptured — a grammar-edit hazard, refused loudly.
function consumedLength(node: unknown): number {
  if (isSlice(node)) return node.offset + node.length;
  if (Array.isArray(node)) {
    return node.reduce((max, member) => Math.max(max, consumedLength(member)), 0);
  }
  if (typeof node === "object" && node !== null) {
    return Object.values(node as ShapeNode).reduce<number>(
      (sum, value) => sum + consumedLength(value),
      0,
    );
  }
  return 0;
}

// Single-key structural wrappers ({plus_term: ...}, {segment: ...},
// {molecule: ...}) — unwrap to the inner node.
function unwrapKey(node: unknown, key: string): ShapeNode | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const inner = (node as ShapeNode)[key];
  return typeof inner === "object" && inner !== null ? (inner as ShapeNode) : undefined;
}

// Unwrap with a loud refusal: the pinned artifact always carries the
// structural key when dispatch reached this branch.
function unwrapKeyStrict(node: ShapeNode, key: string, what: string): ShapeNode {
  const inner = unwrapKey(node, key);
  if (!inner) throw new ParseError(`${what} is missing its ${key}`);
  return inner;
}

// -- adapters, rule by rule ------------------------------------------------

function adaptFormulaRoot(root: unknown): FormulaCapture {
  const entries = Array.isArray(root) ? root : [root];
  return {
    kind: "formula",
    nodes: entries.filter((entry) => entry !== undefined).map(adaptFormulaNode),
  };
}

function adaptFormulaNode(node: unknown): unknown {
  if (typeof node !== "object" || node === null) {
    throw new ParseError(`unexpected PARG node: ${JSON.stringify(node)}`);
  }
  const n = node as ShapeNode;
  if (n["annotated_molecule"] !== undefined) return adaptAnnotated(unwrapKeyStrict(n, "annotated_molecule", "formula node"));
  if (n["molecule"] !== undefined) return adaptMolecule(unwrapKeyStrict(n, "molecule", "formula node"));
  if (n["reaction"] !== undefined) return adaptReaction(unwrapKeyStrict(n, "reaction", "formula node"));
  if (n["cascade"] !== undefined) return adaptCascade(unwrapKeyStrict(n, "cascade", "formula node"));
  if (n["electron_config"] !== undefined) return adaptElectronConfig(n["electron_config"]);
  if (n["embedded_math"] !== undefined) return adaptEmbeddedMath(unwrapKeyStrict(n, "embedded_math", "formula node"));
  if (n["text_run"] !== undefined) return adaptTextRun(n["text_run"]);
  if (n["crystal_node"] !== undefined) return adaptCrystal(unwrapKeyStrict(n, "crystal_node", "formula node"));
  if (n["spectrum_node"] !== undefined) return adaptSpectrum(unwrapKeyStrict(n, "spectrum_node", "formula node"));
  if (n["calc_node"] !== undefined) return adaptCalc(unwrapKeyStrict(n, "calc_node", "formula node"));
  if (n["zmatrix_node"] !== undefined) return adaptZMatrix(unwrapKeyStrict(n, "zmatrix_node", "formula node"));
  if (n["mechanism_node"] !== undefined) return adaptMechanism(unwrapKeyStrict(n, "mechanism_node", "formula node"));
  throw new ParseError(`unexpected PARG formula node: ${JSON.stringify(Object.keys(n))}`);
}

function adaptAnnotated(node: ShapeNode): unknown {
  const mol = unwrapKeyStrict(unwrapKeyStrict(node, "mol", "annotated molecule"), "molecule", "annotated molecule");
  const annotations = Array.isArray(node["annotations"]) ? (node["annotations"] as unknown[]) : [];
  return {
    kind: "annotated",
    molecule: adaptMolecule(mol),
    annotations: annotations.map((item) => {
      const annotation = unwrapKey(item, "annotation_item");
      if (!annotation) throw new ParseError("annotation is missing its item");
      const metaKey = slice(annotation["meta_key"]);
      if (metaKey !== undefined) {
        return { metaKey, metaValue: slice(annotation["meta_value"]) ?? "" };
      }
      return { annType: slice(annotation["ann_type"]) ?? "", annValue: slice(annotation["ann_value"]) ?? "" };
    }),
  };
}

function adaptMolecule(node: ShapeNode): unknown {
  const rawUnits = Array.isArray(node["units"]) ? (node["units"] as unknown[]) : [];
  return {
    kind: "molecule",
    stereo: slice(node["stereo"]),
    coefficient: wrappedSlice(node["coefficient"]),
    units: rawUnits.map(adaptUnit),
  };
}

const BOND_KEYS: Record<string, { bondKind: string; direction?: "up" | "down" }> = {
  single: { bondKind: "single" },
  double: { bondKind: "double" },
  triple: { bondKind: "triple" },
  quadruple: { bondKind: "quadruple" },
  wedge: { bondKind: "wedge" },
  hash: { bondKind: "hash" },
  dative: { bondKind: "dative" },
  wavy: { bondKind: "wavy" },
  direction_up: { bondKind: "single", direction: "up" },
  direction_down: { bondKind: "single", direction: "down" },
};

function adaptUnit(unit: unknown): unknown {
  if (typeof unit !== "object" || unit === null) {
    throw new ParseError(`unexpected PARG unit: ${JSON.stringify(unit)}`);
  }
  const n = unit as ShapeNode;
  if (n["atom"] !== undefined) return adaptAtom(unwrapKeyStrict(n, "atom", "unit"));
  if (n["group"] !== undefined) return adaptGroup(unwrapKeyStrict(n, "group", "unit"));
  for (const [key, bond] of Object.entries(BOND_KEYS)) {
    if (n[key] !== undefined) {
      const capture: Record<string, unknown> = { kind: "bond", ...bond };
      return capture;
    }
  }
  throw new ParseError(`unexpected PARG unit keys: ${JSON.stringify(Object.keys(n))}`);
}

// Marker captures keep their leading `^`/`_` in the value (the
// capture contract); AtomBuilder strips them.
const ATOM_FIELDS: Record<string, string> = {
  element: "element",
  isotope: "isotope",
  subscript: "subscript",
  superscript: "superscript",
  lone_pairs: "lonePairs",
  radical_electrons: "radicalElectrons",
  ring_closures: "ringClosures",
  x2: "x2",
  y2: "y2",
  z2: "z2",
  atom_parity: "atomParity",
  chirality: "chirality",
  spin_multiplicity: "spinMultiplicity",
  atom_title: "atomTitle",
  x_fract: "xFract",
  y_fract: "yFract",
  z_fract: "zFract",
};

function adaptAtom(node: ShapeNode): unknown {
  const capture: Record<string, unknown> = { kind: "atom" };
  for (const [key, field] of Object.entries(ATOM_FIELDS)) {
    const value = slice(node[key]);
    if (value !== undefined) capture[field] = value;
  }
  return capture;
}

function adaptGroup(node: ShapeNode): unknown {
  const rawNodes = Array.isArray(node["group_nodes"]) ? (node["group_nodes"] as unknown[]) : [];
  const open = slice(node["open_bracket"]);
  return {
    kind: "group",
    open: open ?? "(",
    nodes: rawNodes.map(adaptGroupNode),
    multiplicity: stripMultiplicity(slice(node["multiplicity"])),
  };
}

// The multiplicity slice keeps its leading `_`; the capture contract
// carries bare digits.
function stripMultiplicity(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.startsWith("_") ? value.slice(1) : value;
}

function adaptGroupNode(node: unknown): unknown {
  if (typeof node !== "object" || node === null) {
    throw new ParseError(`unexpected PARG group node: ${JSON.stringify(node)}`);
  }
  const n = node as ShapeNode;
  if (n["molecule"] !== undefined) return adaptMolecule(unwrapKeyStrict(n, "molecule", "group node"));
  if (n["reaction"] !== undefined) return adaptReaction(unwrapKeyStrict(n, "reaction", "group node"));
  if (n["electron_config"] !== undefined) return adaptElectronConfig(n["electron_config"]);
  if (n["embedded_math"] !== undefined) return adaptEmbeddedMath(unwrapKeyStrict(n, "embedded_math", "group node"));
  if (n["text_run"] !== undefined) return adaptTextRun(n["text_run"]);
  throw new ParseError(`unexpected PARG group node keys: ${JSON.stringify(Object.keys(n))}`);
}

function adaptTerms(node: unknown): unknown[] {
  const items = Array.isArray(node) ? node : [node];
  return items.map((item) => {
    const plus = unwrapKey(item, "plus_term");
    const molecule = plus
      ? (opt(plus["molecule"]) as ShapeNode | undefined)
      : unwrapKey(item, "molecule");
    if (!molecule) throw new ParseError("term is missing its molecule");
    return adaptMolecule(molecule);
  });
}

// `node` is the arrow capture itself ({kind, above?, below?}).
function adaptArrow(node: unknown): { kind: string; above?: string; below?: string } {
  const n = opt(node) as ShapeNode | undefined;
  if (!n) throw new ParseError("reaction is missing its arrow");
  return {
    kind: slice(n["kind"]) ?? "->",
    above: adaptCondition(n["above"]),
    below: adaptCondition(n["below"]),
  };
}

// A matched condition with empty text captures as ""; an unmatched
// condition is absent.
function adaptCondition(node: unknown): string | undefined {
  const condition = unwrapKey(node, "condition");
  if (!condition) return undefined;
  return slice(condition["text"]) ?? "";
}

function adaptReaction(node: ShapeNode): unknown {
  return {
    kind: "reaction",
    reactants: adaptTerms(node["reactants"]),
    arrow: adaptArrow(node["arrow"]),
    products: adaptTerms(node["products"]),
  };
}

function adaptCascade(node: ShapeNode): unknown {
  const first = unwrapKeyStrict(unwrapKeyStrict(node, "first", "cascade"), "reaction", "cascade");
  const segments = Array.isArray(node["segments"]) ? (node["segments"] as unknown[]) : [];
  return {
    kind: "cascade",
    first: adaptReaction(first),
    tail: segments.map((segment) => {
      const inner = unwrapKeyStrict(segment as ShapeNode, "segment", "cascade");
      return { arrow: adaptArrow(inner["arrow"]), products: adaptTerms(inner["products"]) };
    }),
  };
}

function adaptElectronConfig(node: unknown): unknown {
  const pairs = Array.isArray(node) ? node : [];
  return {
    kind: "electron-config",
    pairs: pairs.map((pair) => {
      const n = pair as ShapeNode;
      return [slice(n["orbital"]) ?? "", slice(n["occupancy"]) ?? ""];
    }),
  };
}

function adaptEmbeddedMath(node: ShapeNode): unknown {
  return { kind: "math", source: slice(node["math_source"]) ?? "" };
}

// Text captures keep their surrounding quotes (the whole run is one
// slice); the capture contract strips them.
function adaptTextRun(node: unknown): unknown {
  const value = slice(node) ?? '""';
  return { kind: "text", content: value.slice(1, -1) };
}

function adaptCrystal(node: ShapeNode): unknown {
  return {
    kind: "crystal",
    name: slice(node["crystal_name"]),
    params: slice(node["crystal_params"]),
    body: slice(node["crystal_body"]),
  };
}

function adaptSpectrum(node: ShapeNode): unknown {
  return {
    kind: "spectrum",
    type: slice(node["spectrum_type"]),
    params: slice(node["spectrum_params"]),
    body: slice(node["spectrum_body"]),
  };
}

function adaptCalc(node: ShapeNode): unknown {
  return {
    kind: "calculation",
    params: slice(node["calc_params"]),
    body: slice(node["calc_body"]),
  };
}

function adaptZMatrix(node: ShapeNode): unknown {
  return { kind: "zmatrix", body: slice(node["zmatrix_body"]) };
}

function adaptMechanism(node: ShapeNode): unknown {
  return { kind: "mechanism", body: slice(node["mechanism_body"]) };
}

// -- entry point -----------------------------------------------------------

// The grammar skips leading whitespace but not trailing; the capture
// contract expects both sides skipped — strip exactly the ASCII
// whitespace class before parsing, as the reference PargEngine does
// with Ruby's #strip.
function stripWhitespace(input: string): string {
  return input.replace(/^[ \t\r\n\f\v]+/, "").replace(/[ \t\r\n\f\v]+$/, "");
}

// Parse to the capture shapes transform.ts consumes. Throws
// PargSyntaxError on refusal — parser.ts wraps it into ParseError.
export function parseFormulaCaptures(input: string): FormulaCapture {
  const source = stripWhitespace(input);
  let shape: unknown;
  try {
    shape = runtime().parseShape(source);
  } catch (error) {
    if (error instanceof PargSyntaxError) throw error;
    throw toSyntaxError(error);
  }
  if (typeof shape !== "object" || shape === null) {
    throw new PargSyntaxError(`AsciiChem parse error: empty parse result for ${JSON.stringify(input)}`);
  }
  const root = (shape as ShapeNode)[ENTRY] as unknown;
  if (typeof root !== "object" || root === null) {
    throw new PargSyntaxError(`AsciiChem parse error: empty parse result for ${JSON.stringify(input)}`);
  }
  if (consumedLength(root) < source.length) {
    throw new PargSyntaxError(
      `AsciiChem parse error: input not fully captured at ${JSON.stringify(input)}`,
    );
  }
  return adaptFormulaRoot(root);
}
