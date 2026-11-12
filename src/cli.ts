#!/usr/bin/env node
// The `asciichem` command-line interface — the TypeScript mirror of the
// Ruby Thor CLI (`asciichem-ruby/lib/asciichem/cli.rb`) and the Rust
// dispatch (`asciichem-rs/src/cli.rs`): the command set on ONE dispatch
// so the contract — stdout shapes and exit codes — is testable offline.
// This module IS the bin (the shebang survives the tsc emit; the
// package manifest points `bin` here) and the corpus's in-process
// test seam over [`runCli`].
//
// Contract: parse errors exit 1, unknown `convert` output formats 2,
// resolve errors 3, cite errors 4, identity errors 5, parsing-engine
// selection 6; `lint` exits 1 on error-severity findings, `roundtrip`
// 1 on a mismatch, `validate` 1 on a known-but-invalid identifier.
// Documented deviations (no Plurimath for embedded math, `--engine`
// accepting only parsanol) live in the command handlers and the PR.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ParseError, AsciiChemError } from "./errors.js";
import { parseText } from "./parser.js";
import { parseSmiles, writeSmiles } from "./smiles.js";
import { parseMolfile, writeMolfile } from "./molfile.js";
import { Formula, Molecule, Reaction, ReactionCascade } from "./model.js";
import { renderMathml } from "./formatter/mathml.js";
import { HtmlFormatter } from "./formatter/html.js";
import { LatexFormatter } from "./formatter/latex.js";
import { formulaToCml, initCml, parseCmlToFormula, CmlError } from "./cml.js";
import { runLinter } from "./linter.js";
import { inchiEngine, identityFor, EngineMissingError } from "./inchi.js";
import { knownConvention, validIdentifier } from "./identifiers.js";
import { registerChemomerEngine, chemomerAvailable } from "./inchi-chemomer.js";
import {
  Cache,
  NetFetch,
  ResolverRegistry,
  Substance,
  citationXml,
} from "./index.js";
import type { Fetch } from "./resolver/adapter.js";

// The parse-family error: an unknown convert format. Emit-side
// rejections (an unbonded formula's SMILES, a wire construct outside
// the subset) ride the parse family instead — the reference's convert
// maps every non-format failure to exit 1.
class FormatError extends AsciiChemError {}

// The command failure: the stderr line (already prefixed — "Parse
// error: ", "Resolve error: ", ...) and the exit code the reference
// maps it to. `line` is empty when the command already wrote its own
// stderr block (roundtrip's mismatch report).
interface Failure {
  code: number;
  line: string;
}

function failure(code: number, prefix: string, message: unknown): Failure {
  return { code, line: `${prefix}${messageText(message)}` };
}

function messageText(message: unknown): string {
  return message instanceof Error ? message.message : String(message);
}

// The mismatch/invalid outcomes that print no Failure line (their
// stderr block, if any, is already written).
function silent(code: number): Failure {
  return { code, line: "" };
}

// Ruby `puts` semantics: exactly one trailing newline, never two (the
// molfile writer's output already ends with one).
function emit(out: (text: string) => void, text: string): void {
  out(text);
  if (!text.endsWith("\n")) out("\n");
}

// The process I/O seam: in-process callers (the corpus runner, tests)
// capture chunks; the bin wires stdout/stderr/stdin.
export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  // The stdin text, read only when a command sees `-i -`.
  stdin?: () => string;
}

// The command environment: the network seam, the resolution cache, and
// the source registry. The shipped binary takes the real network path;
// tests inject the offline equivalents (the recorded-fixture pattern,
// now driving the whole dispatch).
export interface CliDeps {
  fetch?: Fetch;
  cache?: Cache;
  registry?: ResolverRegistry;
}

// The offline command surface, in the reference's listing order. The
// tree command reads this table — one source of truth for names and
// descriptions (help and tree themselves excluded, as Thor's tree
// lists).
const COMMANDS: readonly { name: string; description: string }[] = [
  { name: "cite", description: "Resolve a substance and emit a dataset-type Relaton bibitem (XML)" },
  {
    name: "convert",
    description:
      "Convert INPUT to FORMAT (mathml|text|html|latex|svg|structural-svg|model-json|cml|smiles|molfile)",
  },
  {
    name: "identity",
    description: "Derive InChI/InChIKey locally from the structure (offline; requires an InChI engine)",
  },
  { name: "lint", description: "Run chemistry checks; exit 1 on error, 0 if clean" },
  { name: "parse-cml", description: "Parse CML XML and emit AsciiChem text" },
  { name: "resolve", description: "Resolve a substance from a source (network; cached)" },
  { name: "roundtrip", description: "Parse and re-emit; exit non-zero if not equal" },
  { name: "validate", description: "Offline identifier validation" },
  { name: "version", description: "Print the asciichem version" },
];

// The `--engine` value this CLI accepts. The parse path IS the
// parsanol-powered engine (the compiled PARG artifact on parsanol's
// portable engine) — the flag is accepted for compatibility with the
// Ruby CLI's `--engine parsanol`, and every other value is an
// engine-unavailable error (exit 6), mirroring the reference's
// missing-engine posture.
const ENGINE = "parsanol";

// The conventions with an offline validator (the reference
// `Identifiers` registry's keys) — "known" in `validate`'s status
// column. Conventions without one (`iupac`, `cid`, `chebi`) report
// `unknown convention` and never affect the exit code.
const KNOWN_CONVENTIONS = ["cas", "inchi", "inchikey", "smiles"];

function conventionKnown(convention: string): boolean {
  // Single source of truth: the offline validator registry (its key
  // set is the reference's KNOWN_CONVENTIONS).
  return KNOWN_CONVENTIONS.includes(convention) && knownConvention(convention);
}

// Flags that take a value, per command (everything else is boolean —
// the only boolean in the surface is --refresh).
const VALUE_FLAGS = new Set([
  "i",
  "input",
  "f",
  "file",
  "from",
  "t",
  "format",
  "engine",
  "engine_bin",
  "engine-bin",
  "cas",
  "name",
  "cid",
  "inchikey",
  "smiles",
  "source",
]);

// -- argv parsing -------------------------------------------------------

interface ParsedArgs {
  flags: Map<string, string | boolean>;
  positional: string[];
}

// Long flags `--key value` / `--key=value`, short flags `-x value`,
// valueless booleans (`--refresh`), `-` as a value (stdin), and bare
// positionals. Whether a flag takes a value is decided by VALUE_FLAGS.
function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq >= 0) {
        flags.set(token.slice(2, eq), token.slice(eq + 1));
      } else {
        const name = token.slice(2);
        const next = argv[index + 1];
        if (VALUE_FLAGS.has(name) && next !== undefined && (next === "-" || !next.startsWith("-"))) {
          flags.set(name, next);
          index += 1;
        } else {
          flags.set(name, true);
        }
      }
    } else if (token.length > 1 && token.startsWith("-")) {
      const name = token.slice(1);
      const next = argv[index + 1];
      if (VALUE_FLAGS.has(name) && next !== undefined && (next === "-" || !next.startsWith("-"))) {
        flags.set(name, next);
        index += 1;
      } else {
        flags.set(name, true);
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

function flag(args: ParsedArgs, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = args.flags.get(name);
    if (typeof value === "string") return value;
  }
  return undefined;
}

function hasFlag(args: ParsedArgs, ...names: string[]): boolean {
  return names.some((name) => args.flags.has(name));
}

// -- dispatch -----------------------------------------------------------

// Runs the CLI. The returned number is the process exit code.
// Usage-level errors (unknown command, missing required input) exit 1
// — the Thor posture — and help/version render to stdout with exit 0.
export async function runCli(
  argv: readonly string[],
  io: CliIo,
  deps: CliDeps = {},
): Promise<number> {
  // The CML and citation paths share one leptris warm-up; the
  // dispatcher owns it so every command sees a ready engine. The
  // chemomer engine registers itself when the optional extra is
  // installed; without it the identity command fails with exit 5
  // guidance (the reference's missing-engine posture).
  await initCml();
  if (chemomerAvailable()) await registerChemomerEngine();

  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    emit(io.out, helpText());
    return 0;
  }
  if (command === "-v" || command === "--version") {
    emit(io.out, versionLine());
    return 0;
  }
  const args = parseArgs(rest);
  let outcome: Failure | null | Promise<Failure | null>;
  switch (command) {
    case "cite":
      outcome = cmdCite(args, io, deps);
      break;
    case "convert":
      outcome = cmdConvert(args, io);
      break;
    case "identity":
      outcome = cmdIdentity(args, io);
      break;
    case "lint":
      outcome = cmdLint(args, io);
      break;
    case "parse-cml":
    case "parse_cml":
      outcome = cmdParseCml(args, io);
      break;
    case "resolve":
      outcome = cmdResolve(args, io, deps);
      break;
    case "roundtrip":
      outcome = cmdRoundtrip(args, io);
      break;
    case "tree":
      outcome = cmdTree(io);
      break;
    case "validate":
      outcome = cmdValidate(args, io);
      break;
    case "version":
      emit(io.out, versionLine());
      return 0;
    default:
      io.err(`unknown command ${JSON.stringify(command)}\n`);
      io.err("Run 'asciichem --help' for usage.\n");
      return 1;
  }
  const failed = await outcome;
  if (failed === null) return 0;
  if (failed.line !== "") io.err(`${failed.line}\n`);
  return failed.code;
}

function helpText(): string {
  const commands = COMMANDS.map((entry) => `  ${entry.name.padEnd(10)} ${entry.description}`).join("\n");
  return `AsciiChem: ASCII syntax for chemistry parsed into a semantic model\n\nUsage: asciichem COMMAND [flags]\n\nCommands:\n${commands}\n`;
}

function versionLine(): string {
  return `asciichem ${packageVersion()}`;
}

// The implementation's own version (the "{version}" placeholder in the
// corpus's stdout matchers stands for this).
function packageVersion(): string {
  const require = createRequire(import.meta.url);
  // The module lives at src/cli.ts (dev) or dist/cli.js (installed);
  // ../package.json is the package root from either.
  return require("../package.json").version as string;
}

// -- source ingestion ---------------------------------------------------

// The source text: -f wins over -i, `-` reads stdin (the reference
// `read_source` order).
function sourceText(args: ParsedArgs, stdin?: () => string): string | undefined {
  const file = flag(args, "f", "file");
  if (file !== undefined) return readFileSync(file, "utf8");
  const input = flag(args, "i", "input");
  if (input === undefined) return undefined;
  if (input === "-") return stdin?.() ?? "";
  return input;
}

// One ingestion point per input grammar (TODO.v2 09): every grammar
// funnels into the same model, so every output format works regardless
// of the input language. Molfile input may be a file path.
function ingest(source: string, from: string): Formula {
  switch (from) {
    case "asciichem":
      return parseText(source);
    case "smiles":
      return parseSmiles(source);
    case "molfile": {
      const text = existsSync(source) ? readFileSync(source, "utf8") : source;
      return new Formula([parseMolfile(text)]);
    }
    default:
      throw new ParseError(`unknown --from grammar: ${from}`);
  }
}

// Molecules anywhere at the top level: direct formula nodes plus
// reaction terms. Identity derivation needs exactly one molecule.
function moleculesIn(formula: Formula): Molecule[] {
  const molecules: Molecule[] = [];
  for (const node of formula.nodes) {
    if (node instanceof Reaction) {
      molecules.push(...node.reactants, ...node.products);
    } else if (node instanceof ReactionCascade) {
      for (const step of node.steps) molecules.push(...step.reactants, ...step.products);
    } else if (node instanceof Molecule) {
      molecules.push(node);
    }
  }
  return molecules;
}

// -- convert ------------------------------------------------------------

function cmdConvert(args: ParsedArgs, io: CliIo): Failure | null {
  const engine = flag(args, "engine") ?? ENGINE;
  if (engine !== ENGINE) {
    return failure(6, "Engine error: ", `unknown engine ${JSON.stringify(engine)} (available: ${ENGINE})`);
  }
  const source = sourceText(args, io.stdin);
  if (source === undefined) {
    return failure(1, "Parse error: ", "provide -i INPUT or -f FILE");
  }
  let formula: Formula;
  try {
    formula = ingest(source, flag(args, "from") ?? "asciichem");
  } catch (error) {
    if (error instanceof ParseError) return failure(1, "Parse error: ", error);
    throw error;
  }
  let rendered: string;
  try {
    rendered = render(formula, flag(args, "t", "format") ?? "mathml");
  } catch (error) {
    if (error instanceof FormatError) return failure(2, "Format error: ", error);
    if (error instanceof ParseError) return failure(1, "Parse error: ", error);
    throw error;
  }
  emit(io.out, rendered);
  return null;
}

function render(formula: Formula, format: string): string {
  switch (format) {
    case "mathml":
      return renderMathml(formula);
    case "text":
      return formula.toText();
    case "svg":
      return formula.toSvg();
    case "structural-svg":
      return formula.toStructuralSvg();
    case "model-json":
      return JSON.stringify(formula.toModelJSON());
    case "cml":
      return formulaToCml(formula);
    case "smiles":
      return writeSmiles(formula);
    case "molfile": {
      const molecule = formula.nodes[0];
      if (!(molecule instanceof Molecule)) {
        throw new ParseError("molfile output needs a molecule");
      }
      return writeMolfile(molecule);
    }
    case "html":
      return formula.accept(new HtmlFormatter());
    case "latex":
      return formula.accept(new LatexFormatter());
    // An unknown or unshipped formatter is the format family (exit 2),
    // the reference's `unknown formatter` shape.
    default:
      throw new FormatError(`unknown formatter :${format}`);
  }
}

// -- parse-cml / roundtrip ----------------------------------------------

function cmdParseCml(args: ParsedArgs, io: CliIo): Failure | null {
  const input = flag(args, "i", "input");
  if (input === undefined) {
    return failure(1, "CML parse error: ", "provide -i INPUT");
  }
  let formula: Formula;
  try {
    formula = parseCmlToFormula(input);
  } catch (error) {
    if (error instanceof CmlError || error instanceof ParseError) {
      return failure(1, "CML parse error: ", error);
    }
    throw error;
  }
  emit(io.out, formula.toText());
  return null;
}

function cmdRoundtrip(args: ParsedArgs, io: CliIo): Failure | null {
  const input = flag(args, "i", "input");
  if (input === undefined) {
    return failure(1, "Parse error: ", "provide -i INPUT");
  }
  let rendered: string;
  try {
    rendered = parseText(input).toText();
  } catch (error) {
    if (error instanceof ParseError) return failure(1, "Parse error: ", error);
    throw error;
  }
  if (rendered === input) {
    emit(io.out, rendered);
    return null;
  }
  io.err(`round-trip mismatch:\n  input:    ${inspect(input)}\n  rendered: ${inspect(rendered)}\n`);
  return silent(1);
}

// Ruby inspect / Rust Debug for a string: double-quoted with escapes.
function inspect(value: string): string {
  return JSON.stringify(value);
}

// -- lint ---------------------------------------------------------------

function cmdLint(args: ParsedArgs, io: CliIo): Failure | null {
  const input = flag(args, "i", "input");
  if (input === undefined) {
    return failure(1, "Parse error: ", "provide -i INPUT");
  }
  let formula: Formula;
  try {
    formula = parseText(input);
  } catch (error) {
    if (error instanceof ParseError) return failure(1, "Parse error: ", error);
    throw error;
  }
  const diagnostics = runLinter(formula, { engine: inchiEngine() ?? undefined });
  if (flag(args, "f", "format") === "json") {
    const payload = diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      message: diagnostic.message,
      node: diagnostic.label,
    }));
    emit(io.out, `${JSON.stringify(payload, null, 2)}\n`);
  } else {
    for (const diagnostic of diagnostics) emit(io.out, diagnostic.toString());
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return silent(1);
  return null;
}

// -- validate -----------------------------------------------------------

function cmdValidate(args: ParsedArgs, io: CliIo): Failure | null {
  const input = flag(args, "i", "input");
  if (input === undefined) {
    return failure(1, "Parse error: ", "provide -i INPUT");
  }
  let formula: Formula;
  try {
    formula = parseText(input);
  } catch (error) {
    if (error instanceof ParseError) return failure(1, "Parse error: ", error);
    throw error;
  }
  const annotations = formula.nodes.flatMap((node) => (node instanceof Molecule ? node.identifiers : []));
  if (annotations.length === 0) {
    emit(io.out, "no identifier annotations found");
    return null;
  }
  let invalid = false;
  for (const identifier of annotations) {
    const known = conventionKnown(identifier.convention);
    const valid = known && validIdentifier(identifier.convention, identifier.value);
    const status = !known ? "unknown convention" : valid ? "ok" : "INVALID";
    emit(io.out, `${identifier.convention.padEnd(12)} ${identifier.value.padEnd(40)} ${status}`);
    if (known && !valid) invalid = true;
  }
  return invalid ? silent(1) : null;
}

// -- identity -----------------------------------------------------------

function cmdIdentity(args: ParsedArgs, io: CliIo): Failure | null {
  if (hasFlag(args, "engine_bin", "engine-bin")) {
    return failure(
      5,
      "Identity error: ",
      "the wasm engine derives identities in-process through chemomer; --engine-bin is not supported",
    );
  }
  // The reference parses whatever read_source gives — no input means
  // the empty string, whose parse failure is an identity error (5).
  const source = sourceText(args, io.stdin) ?? "";
  let formula: Formula;
  try {
    formula = ingest(source, flag(args, "from") ?? "asciichem");
  } catch (error) {
    return failure(5, "Identity error: ", error);
  }
  const molecules = moleculesIn(formula);
  if (molecules.length !== 1) {
    return failure(
      5,
      "Identity error: ",
      `identity derivation needs exactly one molecule, got ${molecules.length}`,
    );
  }
  let identity: { inchi: string; inchikey?: string };
  try {
    identity = identityFor(molecules[0]);
  } catch (error) {
    if (error instanceof EngineMissingError || error instanceof AsciiChemError) {
      return failure(5, "Identity error: ", error);
    }
    throw error;
  }
  emit(io.out, identity.inchi);
  if (identity.inchikey !== undefined) emit(io.out, identity.inchikey);
  return null;
}

// -- resolve / cite -----------------------------------------------------

// The selected identifier: the first set of
// --cas/--name/--cid/--inchikey/--smiles wins (the reference's
// filter_map order); `--cid` answers under the `pubchem-cid`
// convention.
function selectedIdentifier(args: ParsedArgs): { convention: string; value: string } | undefined {
  const cas = flag(args, "cas");
  if (cas !== undefined) return { convention: "cas", value: cas };
  const name = flag(args, "name");
  if (name !== undefined) return { convention: "name", value: name };
  const cid = flag(args, "cid");
  if (cid !== undefined) return { convention: "pubchem-cid", value: cid };
  const inchikey = flag(args, "inchikey");
  if (inchikey !== undefined) return { convention: "inchikey", value: inchikey };
  const smiles = flag(args, "smiles");
  if (smiles !== undefined) return { convention: "smiles", value: smiles };
  return undefined;
}

// The resolution options over the injected (or real) seams. The
// unknown-source lookup errors immediately (the reference's
// `Resolver[source]` raises before any request) because the selected
// source list is passed through the registry.
function resolveOptions(args: ParsedArgs, deps: CliDeps) {
  return {
    fetch: deps.fetch ?? new NetFetch(),
    cache: deps.cache ?? new Cache(),
    sources: [flag(args, "source") ?? "pubchem"],
    refresh: hasFlag(args, "refresh"),
  };
}

async function resolveForCite(args: ParsedArgs, deps: CliDeps): Promise<Substance | null> {
  const selected = selectedIdentifier(args);
  if (selected === undefined) throw new NoSelectionError();
  const registry = deps.registry ?? ResolverRegistry.shipped();
  return registry.resolve(selected, resolveOptions(args, deps));
}

class NoSelectionError extends AsciiChemError {
  constructor(message = "no identifier selection given") {
    super(message);
  }
}

async function cmdResolve(args: ParsedArgs, io: CliIo, deps: CliDeps): Promise<Failure | null> {
  const prefix = "Resolve error: ";
  const selected = selectedIdentifier(args);
  if (selected === undefined) {
    return failure(3, prefix, "give one of --cas/--name/--cid/--inchikey/--smiles");
  }
  let substance: Substance | null;
  try {
    substance = await resolveForCite(args, deps);
  } catch (error) {
    if (error instanceof NoSelectionError) throw error;
    if (error instanceof AsciiChemError) return failure(3, prefix, error);
    throw error;
  }
  if (substance === null) {
    return failure(3, prefix, `${flag(args, "source") ?? "pubchem"} does not know ${JSON.stringify(selected.value)}`);
  }
  const format = flag(args, "t", "format") ?? "model-json";
  const text =
    format === "text"
      ? (substance.preferredName ?? "")
      : format === "smiles"
        ? (substance.identifierValue("canonical-smiles") ?? "")
        : JSON.stringify(substance.toWire());
  emit(io.out, text);
  return null;
}

async function cmdCite(args: ParsedArgs, io: CliIo, deps: CliDeps): Promise<Failure | null> {
  const prefix = "Cite error: ";
  const selected = selectedIdentifier(args);
  if (selected === undefined) {
    return failure(4, prefix, "give one of --cas/--name/--cid/--inchikey/--smiles");
  }
  let substance: Substance | null;
  try {
    substance = await resolveForCite(args, deps);
  } catch (error) {
    if (error instanceof NoSelectionError) throw error;
    if (error instanceof AsciiChemError) return failure(4, prefix, error);
    throw error;
  }
  if (substance === null) {
    return failure(4, prefix, `${flag(args, "source") ?? "pubchem"} does not know ${JSON.stringify(selected.value)}`);
  }
  try {
    emit(io.out, await citationXml(substance));
  } catch (error) {
    if (error instanceof AsciiChemError) return failure(4, prefix, error);
    throw error;
  }
  return null;
}

// -- tree ---------------------------------------------------------------

function cmdTree(io: CliIo): Failure | null {
  // Thor 1.5's built-in `tree` task, mirrored: the root label and the
  // connector shape are the reference's; the entries come from the
  // command table — one source of truth for names and descriptions.
  let text = "ascii_chem:cli\n";
  const last = COMMANDS.length - 1;
  COMMANDS.forEach((entry, index) => {
    const connector = index === last ? "└─" : "├─";
    text += `  ${connector} ${entry.name} (${entry.description})\n`;
  });
  emit(io.out, text);
  return null;
}

// -- the bin ------------------------------------------------------------

// The bin main: real stdout/stderr/stdin, the process exit code.
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const code = await runCli(argv, {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    stdin: () => readFileSync(0, "utf8"),
  });
  return code;
}

// Entry when executed directly (node dist/cli.js …).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
