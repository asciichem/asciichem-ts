// Offline format validation for chemical identifier conventions
// (CAS RN, InChI, InChIKey, SMILES sanity) — the TypeScript mirror of
// AsciiChem::Identifiers.
//
// Validation is purely lexical/checksum based. It never touches the
// network and never decides whether an identifier is *assigned* to a
// real substance — that is resolution (the resolver module), not
// validation. Unknown conventions (e.g. `iupac`, `cid`, `chebi`) are
// simply not checkable offline, never errors.

import { known as elementKnown } from "./periodic-table.js";

export interface Validator {
  readonly convention: string;
  valid(value: string): boolean;
  diagnostic(value: string): string | null;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

// -- CAS Registry Number ------------------------------------------------
//
// A CAS RN is DDDDDDD-DD-D: 2–7 digits, hyphen, 2 digits, hyphen, one
// check digit. The check digit equals the weighted sum of the
// preceding digits (weights 1..n counted from the right) modulo 10.
export const CAS: Validator = {
  convention: "cas",
  valid(value) {
    return CAS.diagnostic(value) === null;
  },
  diagnostic(value) {
    if (!/^\d{2,7}-\d{2}-\d$/.test(value)) {
      return `CAS RN ${quote(value)} is not in DDDDDDD-DD-D form ` +
        "(2–7 digits, 2 digits, 1 check digit)";
    }
    const digits = value.replaceAll("-", "").split("").map(Number);
    const checkDigit = digits[digits.length - 1];
    let weighted = 0;
    for (const [index, digit] of digits.slice(0, -1).reverse().entries()) {
      weighted += digit * (index + 1);
    }
    const expected = weighted % 10;
    if (checkDigit === expected) return null;
    return `CAS RN ${quote(value)}: check digit ${checkDigit} does not ` +
      `match weighted sum (${expected})`;
  },
};

// -- InChI ---------------------------------------------------------------
//
// Lexical validation: versioned prefix plus a well-formed formula
// layer whose element symbols exist in the periodic table. Layers
// after the formula layer are not validated — full InChI semantics is
// the InChI software's job, not a validator's.
const INCHI_PREFIX = /^InChI=1S?\//;
const ELEMENT_TOKEN = /^([A-Z][a-z]?)(\d*)/;

function inchiFormulaLayer(value: string): string | null {
  const match = INCHI_PREFIX.exec(value);
  if (match === null) return null;
  const rest = value.slice(match[0].length);
  return rest === "" ? "" : rest.split("/")[0];
}

// Returns [counts, null] on success, [null, reason] otherwise.
function parseInchiFormulaLayer(
  layer: string,
): [Record<string, number>, null] | [null, string] {
  if (layer === "") return [null, "formula layer is empty"];
  const counts: Record<string, number> = {};
  let rest = layer;
  while (rest !== "") {
    const token = ELEMENT_TOKEN.exec(rest);
    if (token === null || token.index !== 0) {
      return [null, `malformed formula layer near ${quote(rest)}`];
    }
    const symbol = token[1];
    if (!elementKnown(symbol)) {
      return [null, `unknown element symbol ${quote(symbol)} in formula layer`];
    }
    counts[symbol] = (counts[symbol] ?? 0) + (token[2] === "" ? 1 : Number(token[2]));
    rest = rest.slice(token[0].length);
  }
  return [counts, null];
}

// Hash of element symbol => atom count from the formula layer, or null
// when the value is not analysable. Single source of truth for offline
// InChI/molecule composition checks.
export function inchiFormulaCounts(value: string): Record<string, number> | null {
  if (typeof value !== "string") return null;
  const layer = inchiFormulaLayer(value);
  if (layer === null) return null;
  const [counts] = parseInchiFormulaLayer(layer);
  return counts;
}

export const INCHI: Validator = {
  convention: "inchi",
  valid(value) {
    return INCHI.diagnostic(value) === null;
  },
  diagnostic(value) {
    const layer = inchiFormulaLayer(value);
    if (layer === null) {
      return `InChI ${quote(value)} must start with "InChI=1/" or "InChI=1S/"`;
    }
    const [counts, reason] = parseInchiFormulaLayer(layer);
    if (counts !== null) return null;
    return `InChI ${quote(value)}: ${reason}`;
  },
};

// -- InChIKey -------------------------------------------------------------
//
// 27 uppercase letters in three blocks of 14, 10, and 1, separated by
// hyphens (e.g. BSYNRYMUTXBXSQ-UHFFFAOYSA-N for aspirin). Check-
// character verification is left to the InChI engine — format alone
// catches the common corruptions (case, block lengths, misplaced
// hyphens).
const INCHIKEY_FORMAT = /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/;

export const INCHIKEY: Validator = {
  convention: "inchikey",
  valid(value) {
    return INCHIKEY_FORMAT.test(value);
  },
  diagnostic(value) {
    if (INCHIKEY_FORMAT.test(value)) return null;
    return `InChIKey ${quote(value)} must be 27 uppercase letters in ` +
      "XXXXXXXXXXXXXX-XXXXXXXXXX-X form (blocks of 14, 10, and 1)";
  },
};

// -- SMILES sanity ---------------------------------------------------------
//
// Deliberately *not* a SMILES parser (that is the structure
// interchange module) — it catches corruption: whitespace, unbalanced
// brackets and parentheses, unpaired ring-bond digits, and element
// tokens that are not in the periodic table.
//
// Lowercase aromatic atoms (c1ccccc1) are valid SMILES and pass;
// aromaticity only constrains future *ingestion* (Kekulé-first), not
// identifier validity.
const ORGANIC_SUBSET = new Set(["B", "C", "N", "O", "P", "S", "F", "I", "Cl", "Br", "H"]);
const AROMATIC_SUBSET = new Set(["b", "c", "n", "o", "p", "s", "f", "cl", "br"]);
const BRACKET_SYMBOL = /^\d*([A-Z][a-z]{0,2}|\*)/;

function balanced(value: string, opener: string, closer: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === opener) depth += 1;
    if (char === closer) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

// null when structurally plausible; a reason otherwise.
function smilesStructuralReasons(value: string): string | null {
  if (!balanced(value, "[", "]")) {
    return `SMILES ${quote(value)}: square brackets are not balanced`;
  }
  if (!balanced(value, "(", ")")) {
    return `SMILES ${quote(value)}: parentheses are not balanced`;
  }
  // Ring digits only exist outside brackets — bracket interiors hold
  // isotope/H-count digits, which must not pair up.
  const bare = value.replace(/\[[^\]]*\]/g, "");
  const counts = new Map<string, number>();
  for (const char of bare.match(/\d/g) ?? []) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  for (const [digit, count] of counts) {
    if (count % 2 === 1) {
      return `SMILES ${quote(value)}: ring-bond digit ${digit} appears an odd ` +
        "number of times (ring closures must pair)";
    }
  }
  return null;
}

// Bracket atom content: optional isotope digits, then the symbol.
// Wildcards make composition unknown → null.
function bracketAtomSymbol(content: string): string | null {
  const match = BRACKET_SYMBOL.exec(content);
  if (match === null) return null;
  const symbol = match[1];
  if (symbol === "*") return null;
  return elementKnown(symbol) ? symbol : null;
}

// Two-letter element first (Cl/Br, aromatic cl/br), then the
// single-letter organic/aromatic subsets. Returns [symbol, consumed]
// or null.
function twoLetterToken(value: string, index: number): [string, number] | null {
  const two = value.slice(index, index + 2);
  const char = value[index];
  if (ORGANIC_SUBSET.has(two)) return [two, 2];
  if (AROMATIC_SUBSET.has(two)) return [two[0].toUpperCase() + two[1], 2];
  if (ORGANIC_SUBSET.has(char)) return [char, 1];
  if (AROMATIC_SUBSET.has(char)) return [char.toUpperCase(), 1];
  return null;
}

// Sorted unique element symbols appearing in the SMILES (bracket atoms
// and the organic/aromatic subsets, aromatic normalised to element
// symbols), or null when the value is not analysable. Single source of
// truth for offline SMILES/molecule element-set checks.
export function smilesElementSet(value: string): string[] | null {
  if (typeof value !== "string") return null;
  if (smilesStructuralReasons(value) !== null) return null;
  const symbols: string[] = [];
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === "[") {
      const close = value.indexOf("]", index);
      if (close === -1) return null;
      const symbol = bracketAtomSymbol(value.slice(index + 1, close));
      if (symbol === null) return null;
      symbols.push(symbol);
      index = close + 1;
    } else if (/[A-Za-z]/.test(char)) {
      const token = twoLetterToken(value, index);
      if (token === null) return null;
      symbols.push(token[0]);
      index += token[1];
    } else {
      index += 1;
    }
  }
  return [...new Set(symbols)].sort();
}

export const SMILES: Validator = {
  convention: "smiles",
  valid(value) {
    return SMILES.diagnostic(value) === null;
  },
  diagnostic(value) {
    if (value === "") return "SMILES must not be empty";
    if (/\s/.test(value)) return `SMILES ${quote(value)} must not contain whitespace`;
    return smilesStructuralReasons(value) ??
      (smilesElementSet(value) === null
        ? `SMILES ${quote(value)}: contains a malformed or unknown element token`
        : null);
  },
};

// -- Registry ---------------------------------------------------------------

const REGISTRY = new Map<string, Validator>(
  [CAS, INCHI, INCHIKEY, SMILES].map((validator) => [validator.convention, validator]),
);

// Whether a validator is registered for the convention. Unknown
// conventions are not errors — they are simply not checkable offline.
export function knownConvention(convention: string): boolean {
  return REGISTRY.has(convention);
}

export function validatorFor(convention: string): Validator | undefined {
  return REGISTRY.get(convention);
}

export function validIdentifier(convention: string, value: string): boolean {
  const validator = validatorFor(convention);
  return validator !== undefined && validator.valid(value);
}

// null when the value is valid (or the convention is unknown); a
// human-readable reason otherwise.
export function identifierDiagnostic(convention: string, value: string): string | null {
  return validatorFor(convention)?.diagnostic(value) ?? null;
}
