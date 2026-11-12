// The built-in linter checks — the TypeScript mirror of the Ruby
// reference's check set (the corpus's linter-expectations family
// arbitrates the messages; substrings and node labels are pinned
// there, never invented here).
//
// Ported: balance, bracket balance, charge balance, crystal sanity,
// element validation, identifier consistency, identifier format, the
// engine-scaled identity cross-check, isotope sanity, unclosed rings,
// and valence. (The reference's spectrum-peak and z-matrix-reference
// checks gate model constructs this slice does not lint yet.)
//
// Every check is total: it reports, it never throws.
import {
  Atom,
  Crystal,
  Group,
  Molecule,
  Reaction,
} from "../model.js";
import { buildGraph } from "../structure.js";
import { bondOrderSum } from "../perception.js";
import { known as elementKnown, atomicNumber, maxValence } from "../periodic-table.js";
import {
  identifierDiagnostic,
  knownConvention,
  inchiFormulaCounts,
  smilesElementSet,
} from "../identifiers.js";
import { AsciiChemError } from "../errors.js";
import { identityFor, INSTALL_GUIDE, EngineMissingError } from "../inchi.js";
import {
  Diagnostic,
  LintCheck,
  lintError,
  lintInfo,
  lintWarning,
  registerCheck,
  walkNodes,
  LintOptions,
} from "../linter.js";

// -- shared enumeration helpers (the BalanceCheck's recursive walk) --

type Counts = Record<string, number>;

function addInto(target: Counts, source: Counts, multiplier = 1): void {
  for (const [element, count] of Object.entries(source)) {
    target[element] = (target[element] ?? 0) + count * multiplier;
  }
}

// Recursive atom-count enumeration with the current multiplier; null
// when the node kind carries no enumerable atoms (conservative skip).
function enumerateAtoms(node: unknown, multiplier: number): Counts | null {
  if (node instanceof Atom) {
    const sub = node.subscript === undefined ? NaN : Number(node.subscript);
    const count = (Number.isInteger(sub) && sub > 0 ? sub : 1) * multiplier;
    return { [node.element]: count };
  }
  if (node instanceof Molecule) return enumerateMany(node.nodes, multiplier * node.stoichiometricCoefficient());
  if (node instanceof Group) {
    const mult = node.multiplicity === undefined ? NaN : Number(node.multiplicity);
    const groupMultiplier = (Number.isInteger(mult) && mult > 0 ? mult : 1) * multiplier;
    return enumerateMany(node.nodes, groupMultiplier);
  }
  return null;
}

function enumerateMany(nodes: readonly unknown[], multiplier: number): Counts | null {
  const result: Counts = {};
  for (const node of nodes) {
    const counts = enumerateAtoms(node, multiplier);
    if (counts === null) return null;
    addInto(result, counts);
  }
  return result;
}

// Charge string ("2+", "+", "-1", "2-") as a signed integer; 0 for
// absent/empty/unparseable.
function parseCharge(charge: string | undefined): number {
  if (charge === undefined || charge === "") return 0;
  const digitsFirst = /^(\d*)([+-])$/.exec(charge);
  const signFirst = digitsFirst === null ? /^([+-])(\d*)$/.exec(charge) : null;
  const match = digitsFirst ?? signFirst;
  if (match === null) return 0;
  const digits = digitsFirst !== null ? match[1] : match[2];
  const n = digits === "" ? 1 : Number(digits);
  return charge.includes("+") ? n : -n;
}

function enumerateCharge(node: unknown): number | null {
  if (node instanceof Atom) return parseCharge(node.charge);
  if (node instanceof Group) {
    const mult = node.multiplicity === undefined ? NaN : Number(node.multiplicity);
    const multiplier = Number.isInteger(mult) && mult > 0 ? mult : 1;
    const inner = sumCharge(node.nodes);
    return inner === null ? null : inner * multiplier;
  }
  if (node instanceof Molecule) return sumCharge(node.nodes);
  return 0;
}

function sumCharge(nodes: readonly unknown[]): number | null {
  let total = 0;
  for (const node of nodes) {
    const charge = enumerateCharge(node);
    if (charge === null) return null;
    total += charge;
  }
  return total;
}

function formatCharge(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : `${value}`;
}

function compositionDiffStrings(moleculeCounts: Counts, identifierCounts: Counts): string[] {
  const keys = [...new Set([...Object.keys(moleculeCounts), ...Object.keys(identifierCounts)])].sort();
  const diffs: string[] = [];
  for (const element of keys) {
    const actual = moleculeCounts[element] ?? 0;
    const expected = identifierCounts[element] ?? 0;
    if (actual !== expected) diffs.push(`${element}: ${actual} vs ${expected}`);
  }
  return diffs;
}

function formulaString(counts: Counts): string {
  return Object.entries(counts)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([element, count]) => (count === 1 ? element : `${element}${count}`))
    .join("");
}

// -- balance -------------------------------------------------------------

// Verifies that a reaction is stoichiometrically balanced — the atom
// counts on the reactants side equal those on the products side.
// Coefficients and group multiplicities are applied. Electrons,
// conditions, and the arrow kind are ignored; any molecule that can't
// be enumerated is skipped, not flagged.
const balanceCheck: LintCheck = (formula) => {
  const diagnostics: Diagnostic[] = [];
  for (const node of walkNodes(formula)) {
    if (!(node instanceof Reaction)) continue;
    const reactants = countSide(node.reactants);
    const products = countSide(node.products);
    if (reactants === null || products === null) continue;
    if (sameCounts(reactants, products)) continue;
    diagnostics.push(
      lintError(`Reaction is not balanced: ${diffStringFrom(reactants, products)}`, node, elementDeltas(reactants, products)),
    );
  }
  return diagnostics;
};

function countSide(molecules: readonly Molecule[]): Counts | null {
  const counts: Counts = {};
  for (const molecule of molecules) {
    const own = enumerateAtoms(molecule, 1);
    if (own === null) return null;
    addInto(counts, own);
  }
  return counts;
}

function sameCounts(a: Counts, b: Counts): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((element) => (a[element] ?? 0) === (b[element] ?? 0));
}

// "E: r vs p" for every element whose counts differ — the numbers
// behind the message.
function diffStringFrom(reactants: Counts, products: Counts): string {
  const keys = [...new Set([...Object.keys(reactants), ...Object.keys(products)])].sort();
  const parts: string[] = [];
  for (const element of keys) {
    const r = reactants[element] ?? 0;
    const p = products[element] ?? 0;
    if (r !== p) parts.push(`${element}: ${r} vs ${p}`);
  }
  return parts.join(", ");
}

// Element => [reactant_count, product_count] for every element whose
// counts differ — the structured form of the same numbers.
function elementDeltas(reactants: Counts, products: Counts): Record<string, [number, number]> {
  const deltas: Record<string, [number, number]> = {};
  for (const element of new Set([...Object.keys(reactants), ...Object.keys(products)])) {
    const r = reactants[element] ?? 0;
    const p = products[element] ?? 0;
    if (r !== p) deltas[element] = [r, p];
  }
  return deltas;
}

// -- bracket balance -------------------------------------------------------

// Verifies that group brackets are matched. The grammar already
// enforces this at parse time; the linter adds defence in depth for
// direct model construction.
const bracketBalanceCheck: LintCheck = (formula) => {
  const diagnostics: Diagnostic[] = [];
  const expected: Record<string, [string, string]> = {
    paren: ["(", ")"],
    square: ["[", "]"],
    brace: ["{", "}"],
  };
  for (const node of walkNodes(formula)) {
    if (!(node instanceof Group)) continue;
    const [open, close] = expected[node.bracket];
    if (node.openChar !== open) {
      diagnostics.push(
        lintError(
          `Group bracket kind "${node.bracket}" expected opening "${open}", got "${node.openChar}"`,
          node,
        ),
      );
    }
    if (node.closeChar !== close) {
      diagnostics.push(
        lintError(
          `Group bracket kind "${node.bracket}" expected closing "${close}", got "${node.closeChar}"`,
          node,
        ),
      );
    }
  }
  return diagnostics;
};

// -- charge balance --------------------------------------------------------

// Verifies charge conservation in reactions: total formal charge on
// the reactants side equals total on the products side. Parallel to
// the balance check — a reaction can be stoichiometrically balanced
// but charge-imbalanced.
const chargeBalanceCheck: LintCheck = (formula) => {
  const diagnostics: Diagnostic[] = [];
  for (const node of walkNodes(formula)) {
    if (!(node instanceof Reaction)) continue;
    const reactants = totalCharge(node.reactants);
    const products = totalCharge(node.products);
    if (reactants === null || products === null) continue;
    if (reactants === products) continue;
    diagnostics.push(
      lintError(
        `Reaction charge is not balanced: reactants ${formatCharge(reactants)} vs products ${formatCharge(products)}`,
        node,
      ),
    );
  }
  return diagnostics;
};

function totalCharge(molecules: readonly Molecule[]): number | null {
  let total = 0;
  for (const molecule of molecules) {
    const charge = enumerateCharge(molecule);
    if (charge === null) return null;
    total += charge * molecule.stoichiometricCoefficient();
  }
  return total;
}

// -- crystal sanity ----------------------------------------------------------

// Validates unit-cell parameters on a Crystal node: lengths positive,
// angles in (0, 180], fractional coordinates in [0, 1). Each cell
// parameter is optional — missing values are skipped, not flagged.
const crystalSanityCheck: LintCheck = (formula) => {
  const diagnostics: Diagnostic[] = [];
  for (const node of walkNodes(formula)) {
    if (!(node instanceof Crystal)) continue;
    for (const dim of ["a", "b", "c"] as const) {
      const value = node[dim];
      if (value === undefined) continue;
      if (value > 0) continue;
      diagnostics.push(lintError(`Crystal ${dim} must be positive, got ${value}`, node));
    }
    for (const dim of ["alpha", "beta", "gamma"] as const) {
      const value = node[dim];
      if (value === undefined) continue;
      if (value > 0 && value <= 180) continue;
      diagnostics.push(lintError(`Crystal ${dim} must be in (0, 180], got ${value}`, node));
    }
    for (const atom of node.atoms) {
      for (const axis of ["xFract", "yFract", "zFract"] as const) {
        const value = atom[axis];
        if (value === undefined) continue;
        if (value >= 0 && value < 1) continue;
        diagnostics.push(
          lintWarning(
            `Fractional coordinate ${axis}=${value} on ${atom.element} is outside [0, 1)`,
            node,
          ),
        );
      }
    }
  }
  return diagnostics;
};

// -- element validation -------------------------------------------------------

// Validates that each Atom's element symbol is in the periodic table.
// Catches typos like `Hx`, `Cy`, `Oq` that would otherwise silently
// parse and produce nonsense output. Severity is `warning`, not
// `error` — the parser is total and might intentionally accept
// placeholder elements (e.g. `X` for "unknown halogen").
const elementValidationCheck: LintCheck = (formula) => {
  const diagnostics: Diagnostic[] = [];
  for (const node of walkNodes(formula)) {
    if (!(node instanceof Atom)) continue;
    if (elementKnown(node.element)) continue;
    diagnostics.push(
      lintWarning(`Unknown element symbol ${JSON.stringify(node.element)}; not in the periodic table`, node),
    );
  }
  return diagnostics;
};

// -- identifier consistency ----------------------------------------------------

// Cross-checks identifier values against the molecule they annotate,
// where checkable offline:
//
// - InChI: the formula layer's element counts must match the
//   molecule's composition (error — the formula layer is
//   authoritative).
// - SMILES: the element set must agree with the molecule's elements
//   (warning — implicit hydrogens are tolerated, so only set membership
//   is checkable without a full parser).
//
// Identifiers describe the *substance*, not the stoichiometric
// multiplier, so comparisons use the composition without the
// coefficient.
const identifierConsistencyCheck: LintCheck = (formula) => {
  const diagnostics: Diagnostic[] = [];
  for (const node of walkNodes(formula)) {
    if (!(node instanceof Molecule)) continue;
    const counts = node.elementCounts(false);
    for (const identifier of node.identifiers) {
      if (identifier.convention === "inchi") {
        const inchiCounts = inchiFormulaCounts(identifier.value);
        if (inchiCounts === null) continue; // malformed — format check reports it
        const diffs = compositionDiffStrings(counts, inchiCounts);
        if (diffs.length === 0) continue;
        diagnostics.push(
          lintError(
            `InChI formula ${formulaString(inchiCounts)} does not match molecule ` +
              `${formulaString(counts)}: ${diffs.join(", ")}`,
            node,
          ),
        );
      } else if (identifier.convention === "smiles") {
        const message = smilesMismatch(counts, identifier.value);
        if (message !== null) diagnostics.push(lintWarning(message, node));
      }
    }
  }
  return diagnostics;
};

// null when the SMILES element set agrees with the molecule (implicit
// hydrogens tolerated); a message otherwise.
function smilesMismatch(counts: Counts, smiles: string): string | null {
  const smilesElements = smilesElementSet(smiles);
  if (smilesElements === null) return null; // unanalysable — format check reports it
  const elements = Object.keys(counts);
  const extra = smilesElements.filter((el) => !elements.includes(el)).sort();
  const missing = elements.filter((el) => el !== "H" && !smilesElements.includes(el)).sort();
  if (extra.length === 0 && missing.length === 0) return null;
  return `SMILES elements ${JSON.stringify(smilesElements)} do not match molecule ` +
    `${formulaString(counts)}: unexpected ${JSON.stringify(extra)}, missing ${JSON.stringify(missing)}`;
}

// -- identifier format --------------------------------------------------------

// Validates the *format* of molecule identifier annotations
// (`@cas("...")`, `@inchi("...")`, `@smiles("...")`) whose convention
// has a registered offline validator. Lexical/checksum only — checking
// that an identifier is actually *assigned* to a substance is
// resolution, not linting. Conventions without a validator (e.g.
// `iupac`, `cid`) are skipped silently.
const identifierFormatCheck: LintCheck = (formula) => {
  const diagnostics: Diagnostic[] = [];
  for (const node of walkNodes(formula)) {
    if (!(node instanceof Molecule)) continue;
    for (const identifier of node.identifiers) {
      if (!knownConvention(identifier.convention)) continue;
      const message = identifierDiagnostic(identifier.convention, identifier.value);
      if (message === null) continue;
      const hill = node.hillFormula();
      diagnostics.push(
        lintError(`${message} (${identifier.convention} identifier on ${hill === "" ? "molecule" : hill})`, node),
      );
    }
  }
  return diagnostics;
};

// -- identity cross-check (engine-scaled) ---------------------------------------

// Structural cross-check of identity annotations. Where the identifier
// consistency check compares offline-analysable layers (formula
// composition), this check derives the InChI of the drawn structure via
// the configured engine and compares it to the annotated `@inchi` —
// catching transcription errors that composition checks cannot (wrong
// connectivity, stereo, isotopes).
//
// Behaviour is engine-scaled: with no engine configured the check
// emits one warning explaining how to enable it (protection off is
// worth saying); with an engine, mismatches are errors. Molecules
// without identity annotations are never checked.
const identityCrossCheck: LintCheck = (formula, options: LintOptions) => {
  const annotated: Molecule[] = [];
  for (const node of walkNodes(formula)) {
    if (!(node instanceof Molecule)) continue;
    if (node.identifiers.some((identifier) => identifier.convention === "inchi" || identifier.convention === "inchikey")) {
      annotated.push(node);
    }
  }
  if (annotated.length === 0) return [];

  const engine = options.engine ?? undefined;
  if (engine === undefined || engine === null) {
    return [lintWarning(skipMessage(annotated.length))];
  }
  return annotated.flatMap((molecule) => crossCheck(molecule, engine));
};

function crossCheck(molecule: Molecule, engine: NonNullable<LintOptions["engine"]>): Diagnostic[] {
  let identity: { inchi: string; inchikey?: string };
  try {
    identity = identityFor(molecule, engine);
  } catch (error) {
    if (error instanceof EngineMissingError || error instanceof AsciiChemError) {
      // Not derivable (e.g. a formula is not a structure: no bonds) or
      // the engine rejected it — report, never raise: the linter stays
      // total.
      return [lintWarning(`cannot derive InChI for cross-check: ${error.message}`, molecule)];
    }
    throw error;
  }
  return molecule.identifiers.flatMap((identifier) => {
    if (identifier.convention === "inchi") {
      if (identifier.value === identity.inchi) return [];
      return [
        lintError(
          `InChI annotation does not match the drawn structure: annotated ${identifier.value}, ` +
            `computed ${identity.inchi}`,
          molecule,
        ),
      ];
    }
    if (identifier.convention === "inchikey") {
      if (identity.inchikey === undefined || identifier.value === identity.inchikey) return [];
      return [
        lintError(
          `InChIKey annotation does not match the drawn structure: annotated ${identifier.value}, ` +
            `computed ${identity.inchikey}`,
          molecule,
        ),
      ];
    }
    return [];
  });
}

function skipMessage(count: number): string {
  return `structural identity cross-check skipped for ${count} annotated molecule(s): ` +
    `no InChI engine configured — ${INSTALL_GUIDE}`;
}

// -- isotope sanity -----------------------------------------------------------

// Sanity-checks isotope mass numbers against the element's atomic
// number: a nucleus can't have fewer protons than its mass number
// suggests. Unknown elements produce an info diagnostic, not an error.
const isotopeSanityCheck: LintCheck = (formula) => {
  const diagnostics: Diagnostic[] = [];
  for (const node of walkNodes(formula)) {
    if (!(node instanceof Atom) || node.isotope === undefined) continue;
    const z = atomicNumber(node.element);
    if (z === undefined) {
      diagnostics.push(
        lintInfo(
          `Element ${JSON.stringify(node.element)} not in periodic table; skipping isotope check`,
          node,
        ),
      );
      continue;
    }
    const mass = Number.parseInt(node.isotope, 10);
    if (mass >= z) continue;
    diagnostics.push(
      lintError(`Isotope mass ${mass} is less than atomic number ${z} for ${node.element}`, node),
    );
  }
  return diagnostics;
};

// -- unclosed rings -------------------------------------------------------------

// Flags ring closure digits that have no matching partner. Catches
// typos like `C1-C-C` (digit 1 opened but never closed). Uses the
// shared ring-bond pairing (structure.ts, the RingBonds port) as the
// single source of truth: walk atoms in source order; a digit still
// open at the end belongs to an unclosed atom.
const unclosedRingCheck: LintCheck = (formula) => {
  const diagnostics: Diagnostic[] = [];
  for (const node of walkNodes(formula)) {
    if (!(node instanceof Molecule)) continue;
    const { atoms } = buildGraph(node);
    const open = new Map<string, Atom>();
    for (const atom of atoms) {
      if (atom.ringClosures === undefined) continue;
      for (const digit of atom.ringClosures) {
        if (open.has(digit)) open.delete(digit);
        else open.set(digit, atom);
      }
    }
    for (const atom of new Set(open.values())) {
      diagnostics.push(
        lintError(
          `Atom has unmatched ring closure digit(s) ${JSON.stringify([...(atom.ringClosures ?? "")])}`,
          atom,
        ),
      );
    }
  }
  return diagnostics;
};

// -- valence ----------------------------------------------------------------

// Verifies that each atom's total bond order plus |charge| does not
// exceed the element's typical valence. Catches typos like `CH_5`
// (carbon with five bonds). Runs over the perception pass's graph view
// — every atom's bond order counts ALL its bonds (rings and branches
// included). Unknown elements produce an info diagnostic, not an error.
const valenceCheck: LintCheck = (formula) => {
  const diagnostics: Diagnostic[] = [];
  for (const node of walkNodes(formula)) {
    if (!(node instanceof Molecule)) continue;
    const { atoms, edges } = buildGraph(node);
    for (const [index, atom] of atoms.entries()) {
      const load = bondOrderSum(index, edges);
      const max = maxValence(atom.element);
      if (max === undefined) {
        diagnostics.push(lintInfo(`Element ${JSON.stringify(atom.element)} not in valence table; skipping`, atom));
        continue;
      }
      if (load <= max) continue;
      diagnostics.push(lintError(`Atom ${atom.element} has bond order ${load}; max valence is ${max}`, atom));
    }
  }
  return diagnostics;
};

// -- registration (insertion order = the reference's registry order) --

registerCheck("balance", balanceCheck);
registerCheck("bracket_balance", bracketBalanceCheck);
registerCheck("charge_balance", chargeBalanceCheck);
registerCheck("crystal_sanity", crystalSanityCheck);
registerCheck("element_validation", elementValidationCheck);
registerCheck("identifier_consistency", identifierConsistencyCheck);
registerCheck("identifier_format", identifierFormatCheck);
registerCheck("identity_cross_check", identityCrossCheck);
registerCheck("isotope_sanity", isotopeSanityCheck);
registerCheck("unclosed_ring", unclosedRingCheck);
registerCheck("valence", valenceCheck);
