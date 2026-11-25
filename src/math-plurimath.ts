// The plurimath-ts math engine — the OPTIONAL math extra for
// asciichem-ts. The npm package `@plurimath/plurimath-ts` (the native
// TypeScript Plurimath) renders AsciiMath to MathML and LaTeX;
// embedded math (`K_c = 1` between backticks) renders through it
// byte-identically with the reference. AsciiMath is never
// reimplemented here.
//
// The engine stays OPTIONAL — never a hard dependency, so the default
// posture stays math-less (embedded math degrades: the source renders
// inside a `<math><mtext>` pair in html, `<mtext>` in mathml, and raw
// between `$...$` in latex — the corpus's referenceRender rows skip).
// Installing the extra flips the posture:
//
//   npm install @plurimath/plurimath-ts   # the math extra (README)
//
// CI mirrors the chemomer posture's two-job shape: the default job
// runs the math-less posture; the `plurimath-posture` job installs
// the extra and runs the same suite with the referenceRender rows
// live.
import { createRequire } from "node:module";
import { AsciiChemError } from "./errors.js";

interface PlurimathCompat {
  new (data: string, format: string): {
    toMathml(): string;
    toLatex(): string;
  };
}

interface PlurimathMathEngine {
  mathml(source: string): string;
  latex(source: string): string;
}

let engine: PlurimathMathEngine | null = null;

// Whether the math extra is installed. Resolvability — not an import
// — keeps the posture detection synchronous, so a test file can
// decide its posture at describe-eval time and register in beforeAll.
export function plurimathAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve("@plurimath/plurimath-ts");
    return true;
  } catch {
    return false;
  }
}

// Registration is the async boundary: it imports the extra and warms
// the leptris engine (the mathml graft parses the engine's MathML
// through leptris — every byte of XML parsing rides the leptris
// engine, never hand-rolled). Rendering itself stays synchronous.
export async function registerPlurimathMath(): Promise<void> {
  if (engine) return;
  // The specifier is a variable so typecheck passes in the math-less
  // posture (the extra is not a dependency of this package); the
  // runtime shape is verified below, like the chemomer extra.
  const specifier = "@plurimath/plurimath-ts";
  const mod = (await import(/* @vite-ignore */ specifier)) as { Plurimath?: PlurimathCompat; default?: PlurimathCompat };
  const Plurimath = mod.Plurimath ?? mod.default;
  if (typeof Plurimath !== "function") {
    throw new AsciiChemError(
      "the @plurimath/plurimath-ts package does not export the compat class — upgrade the math extra",
    );
  }
  const { initCml } = await import("./cml.js");
  await initCml();
  engine = {
    mathml(source: string): string {
      return new Plurimath(source, "asciimath").toMathml();
    },
    latex(source: string): string {
      return new Plurimath(source, "asciimath").toLatex();
    },
  };
}

export function mathmlForSource(source: string): string | null {
  return engine ? engine.mathml(source) : null;
}

export function latexForSource(source: string): string | null {
  return engine ? engine.latex(source) : null;
}
