// LaTeX formatter — the TypeScript mirror of AsciiChem::Formatter::Latex:
// mhchem `\ce{...}` at the formula level (output requires
// `\usepackage[version=4]{mhchem}` in the preamble). Beyond-formula
// constructs render as `\text{kind}[label]{ tabular body }` — clean
// inline LaTeX that avoids mhchem's `\ce{}` for non-chemistry fields.
//
// Embedded math degrades the same way the MathML port does (the
// reference renders Plurimath LaTeX; this implementation has no
// AsciiMath engine — the raw source renders between `$...$`).
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
  Spectrum,
  Text,
  Visitor,
  ZMatrix,
  registerRenderer,
} from "../model.js";

// The cell-parameter labels — the reference's CELL_LABELS[:latex]
// (the Greek angle names spelled as LaTeX macros).
const CELL_LABELS: Record<string, string> = {
  a: "a",
  b: "b",
  c: "c",
  alpha: "\\alpha",
  beta: "\\beta",
  gamma: "\\gamma",
};

export class LatexFormatter implements Visitor<string> {
  // mhchem nesting state: inside `\ce{}` bare digits after an element
  // are subscripts, so molecules render without their own wrapper.
  private insideCe = false;

  visitFormula(formula: Formula): string {
    return this.withinCe(
      () => `\\ce{${formula.nodes.map((n) => this.render(n)).join("")}}`,
    );
  }

  visitMolecule(molecule: Molecule): string {
    const prefix = isBlank(molecule.coefficient) ? "" : molecule.coefficient;
    const stereo = molecule.stereo ? `(${molecule.stereoLetter})-` : "";
    const body = molecule.nodes.map((n) => this.render(n)).join("");
    if (this.insideCe) return `${stereo}${prefix}${body}`;
    return `\\ce{${stereo}${prefix}${body}}`;
  }

  visitAtom(atom: Atom): string {
    const parts: string[] = [];
    if (atom.lonePairs !== undefined) parts.push(":".repeat(atom.lonePairs));
    if (atom.isotope !== undefined) parts.push(`^${wrap(atom.isotope)}`);
    parts.push(wrap(atom.element));
    if (atom.subscript !== undefined) parts.push(mhchemSubscript(atom.subscript));
    if (atom.charge !== undefined) {
      parts.push(`^${wrap(atom.charge)}`);
    } else if (atom.oxidationState !== undefined) {
      parts.push(`^{(${wrap(atom.oxidationState)})}`);
    } else if (atom.superscript !== undefined) {
      parts.push(`^${wrap(atom.superscript)}`);
    }
    if (atom.radicalElectrons !== undefined) parts.push(".".repeat(atom.radicalElectrons));
    if (atom.ringClosures !== undefined) parts.push(atom.ringClosures);
    return parts.join("");
  }

  visitGroup(group: Group): string {
    const body = group.nodes.map((n) => this.render(n)).join("");
    const [open, close] = bracketChars(group.bracket);
    const suffix = group.multiplicity !== undefined ? mhchemSubscript(group.multiplicity) : "";
    return `${open}${body}${close}${suffix}`;
  }

  visitBond(bond: Bond): string {
    switch (bond.kind) {
      case "single":
        return "-";
      case "double":
        return "=";
      case "triple":
        return "\\equiv{}";
      default:
        return bond.ascii;
    }
  }

  visitReaction(reaction: Reaction): string {
    const left = reaction.reactants.map((n) => this.render(n)).join(" + ");
    const right = reaction.products.map((n) => this.render(n)).join(" + ");
    const arrow = arrowFor(reaction.arrow);
    const conds = reaction.conditions;
    if (conds === undefined) return `${left} ${arrow} ${right}`;
    const above = conditionsBracket(conds.above);
    const below = conditionsBracket(conds.below);
    return `${left} ${arrow}${above}${below} ${right}`;
  }

  visitReactionCascade(cascade: ReactionCascade): string {
    if (cascade.steps.length === 0) return "";
    const head = cascade.steps[0];
    let out = head.reactants.map((n) => this.render(n)).join(" + ");
    for (const step of cascade.steps) {
      const arrow = arrowFor(step.arrow);
      const conds = step.conditions;
      if (conds !== undefined) {
        out += ` ${arrow}${conditionsBracket(conds.above)}${conditionsBracket(conds.below)}`;
      } else {
        out += ` ${arrow}`;
      }
      out += ` ${step.products.map((n) => this.render(n)).join(" + ")}`;
    }
    return out;
  }

  visitElectronConfiguration(ec: ElectronConfiguration): string {
    const inner = ec.orbitals.map(([orb, occ]) => `${wrap(orb)}^${wrap(occ)}`).join(" ");
    return `\\ce{${inner}}`;
  }

  visitEmbeddedMath(em: EmbeddedMath): string {
    return `$${em.source}$`;
  }

  visitText(text: Text): string {
    return text.content;
  }

  visitCrystal(crystal: Crystal): string {
    const parts: string[] = ["\\text{crystal}"];
    if (crystal.name !== undefined) parts.push(`[${wrapLatex(crystal.name)}]`);
    const cellPairs: [string, string][] = [];
    for (const param of ["a", "b", "c", "alpha", "beta", "gamma"] as const) {
      const value = crystal[param];
      if (value !== undefined) cellPairs.push([CELL_LABELS[param], String(value)]);
    }
    if (cellPairs.length > 0) parts.push(latexTabular(cellPairs));
    if (crystal.atoms.length > 0) {
      const rows = crystal.atoms.map((atom) => [this.render(atom)]);
      parts.push(latexTabular(rows, 1));
    }
    return parts.join("");
  }

  visitSpectrum(spectrum: Spectrum): string {
    const parts: string[] = ["\\text{spectrum}"];
    if (spectrum.technique !== undefined) parts.push(`[${wrapLatex(spectrum.technique)}]`);
    if (Object.keys(spectrum.params).length > 0) {
      parts.push(latexTabular(Object.entries(spectrum.params)));
    }
    if (spectrum.peaks.length > 0) {
      const rows = spectrum.peaks.map((peak) => {
        const cells = [peak.position ?? "", peak.intensity ?? ""];
        if (peak.multiplicity !== undefined) cells.push(peak.multiplicity);
        if (peak.assignment !== undefined) cells.push(`"${peak.assignment}"`);
        return cells;
      });
      parts.push(latexTabular(rows));
    }
    return parts.join("");
  }

  visitCalculation(calc: Calculation): string {
    const parts: string[] = ["\\text{calc}"];
    if (calc.method !== undefined || calc.basis !== undefined) {
      const label = [calc.method, calc.basis].filter((v) => v !== undefined).join("/");
      parts.push(`[${wrapLatex(label)}]`);
    }
    if (calc.properties.length > 0) {
      const rows = calc.properties.map((property) => {
        const cells = [property.title, property.value];
        if (property.units !== undefined) cells.push(property.units);
        return cells;
      });
      parts.push(latexTabular(rows));
    }
    return parts.join("");
  }

  visitZMatrix(zm: ZMatrix): string {
    const parts: string[] = ["\\text{zmatrix}"];
    if (zm.rows.length === 0) return parts.join("");
    const rows = zm.rows.map((row) => {
      const cells: string[] = [row.atom];
      if (row.ref1 !== undefined) cells.push(row.ref1, row.distance ?? "");
      if (row.ref2 !== undefined) cells.push(row.ref2, row.angle ?? "");
      if (row.ref3 !== undefined) cells.push(row.ref3, row.dihedral ?? "");
      return cells;
    });
    parts.push(latexTabular(rows));
    return parts.join("");
  }

  visitMechanism(mech: Mechanism): string {
    const parts: string[] = ["\\text{mechanism}"];
    if (mech.steps.length === 0 && mech.spectators.length === 0) return parts.join("");
    const rows: string[][] = mech.steps.map((step) => [step.label, step.reaction]);
    for (const spectator of mech.spectators) rows.push(["spectator", spectator]);
    parts.push(latexTabular(rows));
    return parts.join("");
  }

  render(node: Node): string {
    return node.accept(this);
  }

  private withinCe(render: () => string): string {
    const previous = this.insideCe;
    this.insideCe = true;
    try {
      return render();
    } finally {
      this.insideCe = previous;
    }
  }
}

// mhchem accepts bare digits after an element as subscripts. Bare form
// for digit-only values; brace form for anything else.
function mhchemSubscript(value: string): string {
  return /^\d+$/.test(value) ? value : `_{${value}}`;
}

// mhchem accepts bare digits (and plain alphanumerics) for superscript
// values (`^14`); braces only for non-digit values.
function wrap(value: string): string {
  return /^[a-zA-Z0-9]+$/.test(value) ? value : `{${value}}`;
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value === "";
}

function bracketChars(kind: BracketKind): [string, string] {
  switch (kind) {
    case "square":
      return ["[", "]"];
    case "brace":
      return ["{", "}"];
    default:
      return ["(", ")"];
  }
}

function arrowFor(kind: Reaction["arrow"]): string {
  switch (kind) {
    case "reverse":
      return "<-";
    case "equilibrium":
      return "<=>";
    case "resonance":
      return "<->";
    default:
      return "->";
  }
}

function conditionsBracket(value: string | undefined): string {
  if (value === undefined || value === "") return "";
  return `[${value}]`;
}

// Wrap content in \text{} when it carries spaces or special characters,
// so tabular cells render cleanly in both pdflatex and xelatex.
function wrapLatex(content: string): string {
  return /^[a-zA-Z0-9+\-\/.*]+$/.test(content) ? content : `\\text{${content}}`;
}

// A tabular environment from rows of cells. Column count is the max row
// length (rows may be ragged, e.g. ZMatrix rows).
function latexTabular(rows: string[][], columns?: number): string {
  if (rows.length === 0) return "";
  const cols = columns ?? Math.max(...rows.map((row) => row.length));
  const alignment = "l".repeat(cols);
  const body = rows
    .map((cells) => {
      const padded = cells.slice(0, cols);
      while (padded.length < cols) padded.push("");
      return `${padded.join(" & ")} \\\\`;
    })
    .join("\n");
  return `\\begin{tabular}{${alignment}}\n${body}\n\\end{tabular}`;
}

registerRenderer<string>("latex", (node) => node.accept(new LatexFormatter()));
