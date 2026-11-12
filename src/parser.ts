// Parse entry point: PARG artifact -> capture tree -> semantic model.
// Callers only ever see AsciiChem's own error types.
import { parseFormulaCaptures, PargSyntaxError } from "./parg/engine.js";
import { buildFormula } from "./transform.js";
import { Formula } from "./model.js";
import { ParseError } from "./errors.js";

export function parseText(input: string): Formula {
  let captures;
  try {
    captures = parseFormulaCaptures(input);
  } catch (error) {
    if (error instanceof PargSyntaxError) {
      throw new ParseError(error.message, error.location);
    }
    throw error;
  }
  return buildFormula(captures);
}
