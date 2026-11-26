// The plurimath-ts math engine — the OPTIONAL math extra for
// asciichem-ts. The npm package `@plurimath/plurimath` (the native
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
//   npm install @plurimath/plurimath   # the math extra (README)
//
// CI mirrors the chemomer posture's two-job shape: the default job
// runs the math-less posture; the `plurimath-posture` job installs
// the extra and runs the same suite with the referenceRender rows
// live.
import { createRequire } from "node:module";
import { AsciiChemError } from "./errors.js";

interface PlurimathCompat {
  new (data: string, format: string): { data: unknown; toMathml(): string; toLatex(): string };
}

interface PlurimathDeepApi {
  toMathml(node: unknown, options?: { displayStyle?: boolean | string | null }): string;
  toLatex(node: unknown): string;
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
    createRequire(import.meta.url).resolve("@plurimath/plurimath");
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
  // posture (the extra is not a dependency of this package). The
  // parse rides the compat class (the package's own Asciimath
  // pipeline, wrapping exactly as its CLI does) and the render rides
  // the deep per-format entries with the reference's option surface —
  // the same call the package's CLI makes (`displayStyle` is always
  // given, "true" unless said otherwise).
  const specifier = "@plurimath/plurimath";
  const [compat, mathml, latex] = (await Promise.all([
    import(/* @vite-ignore */ specifier),
    import(/* @vite-ignore */ `${specifier}/mathml`),
    import(/* @vite-ignore */ `${specifier}/latex`),
  ])) as [{ Plurimath?: PlurimathCompat; default?: PlurimathCompat }, { toMathml: PlurimathDeepApi["toMathml"] }, { toLatex: PlurimathDeepApi["toLatex"] }];
  const Plurimath = compat.Plurimath ?? compat.default;
  if (typeof Plurimath !== "function" || typeof mathml.toMathml !== "function" || typeof latex.toLatex !== "function") {
    throw new AsciiChemError(
      "the @plurimath/plurimath package does not expose the render API — upgrade the math extra",
    );
  }
  const { initCml } = await import("./cml.js");
  await initCml();
  engine = {
    mathml(source: string): string {
      const formula = new Plurimath(source, "asciimath");
      return mathml.toMathml(formula.data, { displayStyle: true });
    },
    latex(source: string): string {
      return new Plurimath(source, "asciimath").toLatex();
    },
  };
}

// The browser path: bundlers resolve `import("@plurimath/plurimath")`
// themselves (a chunk, not a runtime specifier), and the node-only
// createRequire resolution above cannot run there — so the consumer
// imports the module(s) and hands them over. The three entries are
// optional: an absent mathml/latex entry renders that surface through
// the compat class's own method.
export function registerPlurimathMathFromModule(
  mod: { Plurimath?: PlurimathCompat; default?: PlurimathCompat },
  entries?: { mathml?: { toMathml: PlurimathDeepApi["toMathml"] }; latex?: { toLatex: PlurimathDeepApi["toLatex"] } },
): void {
  if (engine) return;
  const Plurimath = mod.Plurimath ?? mod.default;
  if (typeof Plurimath !== "function") {
    throw new AsciiChemError(
      "the @plurimath/plurimath package does not expose the compat class — upgrade the math extra",
    );
  }
  engine = {
    mathml(source: string): string {
      const formula = new Plurimath(source, "asciimath");
      if (entries?.mathml) return entries.mathml.toMathml(formula.data, { displayStyle: true });
      return formula.toMathml();
    },
    latex(source: string): string {
      if (entries?.latex) return entries.latex.toLatex(new Plurimath(source, "asciimath").data);
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
