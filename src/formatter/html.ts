// Inline HTML formatter — the TypeScript mirror of AsciiChem::Formatter::Html:
// `<sub>`/`<sup>` typography wrapped in one `<span class="asciichem">` (no
// MathJax, no MathML). Beyond-formula constructs render as semantic
// `<span class="asciichem-<kind>">` hooks with `<dl>`/`<ol>`/`<table>`
// bodies, so downstream CSS can style per construct.
//
// Embedded math degrades the same way the MathML port does (the reference
// embeds Plurimath-rendered MathML; this implementation has no AsciiMath
// engine — the source renders inside a `<math><mtext>` pair, the gap
// spec'd in test/unit/html.test.ts and tracked upstream).
import {
  Atom,
  Bond,
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

// The cell-parameter labels, per construct — the reference's
// Crystal::CELL_LABELS[:html] (a, b, c, then the Greek angle names).
const CELL_LABELS: Record<string, string> = {
  a: "a",
  b: "b",
  c: "c",
  alpha: "α",
  beta: "β",
  gamma: "γ",
};

export class HtmlFormatter implements Visitor<string> {
  visitFormula(formula: Formula): string {
    const inner = formula.nodes.map((n) => this.render(n)).join("");
    return `<span class="asciichem">${inner}</span>`;
  }

  visitMolecule(molecule: Molecule): string {
    const prefix = molecule.coefficient === undefined || molecule.coefficient === "" ? "" : escape(molecule.coefficient);
    const stereo = molecule.stereo ? `(${molecule.stereoLetter})-` : "";
    const body = molecule.nodes.map((n) => this.render(n)).join("");
    return `${stereo}${prefix}${body}`;
  }

  visitAtom(atom: Atom): string {
    const parts: string[] = [];
    if (atom.isotope !== undefined) parts.push(`<sup>${escape(atom.isotope)}</sup>`);
    parts.push(escape(atom.element));
    if (atom.subscript !== undefined) parts.push(`<sub>${escape(atom.subscript)}</sub>`);
    if (atom.superscript !== undefined) parts.push(`<sup>${escape(atom.superscript)}</sup>`);
    if (atom.charge !== undefined) parts.push(`<sup>${escape(atom.charge)}</sup>`);
    if (atom.oxidationState !== undefined) parts.push(`<sup>(${escape(atom.oxidationState)})</sup>`);
    if (atom.ringClosures !== undefined) parts.push(escape(atom.ringClosures));
    return parts.join("");
  }

  visitGroup(group: Group): string {
    const body = group.nodes.map((n) => this.render(n)).join("");
    const suffix = group.multiplicity !== undefined ? `<sub>${escape(group.multiplicity)}</sub>` : "";
    return `${escape(group.openChar)}${body}${escape(group.closeChar)}${suffix}`;
  }

  visitBond(bond: Bond): string {
    return escape(bond.ascii);
  }

  visitReaction(reaction: Reaction): string {
    const left = reaction.reactants.map((n) => this.render(n)).join(" + ");
    const right = reaction.products.map((n) => this.render(n)).join(" + ");
    const arrow = escape(reaction.arrowEntity);
    const conds = reaction.conditions;
    if (conds === undefined) return `${left} ${arrow} ${right}`;
    const above = conds.above !== undefined ? `<sup>${escape(conds.above)}</sup>` : "";
    const below = conds.below !== undefined ? `<sub>${escape(conds.below)}</sub>` : "";
    return `${left} ${above}${arrow}${below} ${right}`;
  }

  visitReactionCascade(cascade: ReactionCascade): string {
    if (cascade.steps.length === 0) return "";
    const head = cascade.steps[0];
    let out = head.reactants.map((n) => this.render(n)).join(" + ");
    for (const step of cascade.steps) {
      const arrow = escape(step.arrowEntity);
      const conds = step.conditions;
      if (conds !== undefined) {
        const above = conds.above !== undefined ? `<sup>${escape(conds.above)}</sup>` : "";
        const below = conds.below !== undefined ? `<sub>${escape(conds.below)}</sub>` : "";
        out += ` ${above}${arrow}${below}`;
      } else {
        out += ` ${arrow}`;
      }
      out += ` ${step.products.map((n) => this.render(n)).join(" + ")}`;
    }
    return out;
  }

  visitElectronConfiguration(ec: ElectronConfiguration): string {
    return ec.orbitals.map(([orb, occ]) => `${escape(orb)}<sup>${escape(occ)}</sup>`).join(" ");
  }

  visitEmbeddedMath(em: EmbeddedMath): string {
    return `<math><mtext>${escape(em.source)}</mtext></math>`;
  }

  visitText(text: Text): string {
    return escape(text.content);
  }

  // -- Beyond-formulas constructs --------------------------------

  visitCrystal(crystal: Crystal): string {
    const parts: string[] = ['<span class="asciichem-crystal">'];
    if (crystal.name !== undefined) {
      parts.push(`<span class="asciichem-name">[${escape(crystal.name)}]</span>`);
    }
    parts.push(this.cellParamDl(crystal));
    if (crystal.atoms.length > 0) {
      parts.push('<ol class="asciichem-atoms">');
      for (const atom of crystal.atoms) parts.push(`<li>${this.render(atom)}</li>`);
      parts.push("</ol>");
    }
    parts.push("</span>");
    return parts.join("");
  }

  visitSpectrum(spectrum: Spectrum): string {
    const parts: string[] = ['<span class="asciichem-spectrum">'];
    if (spectrum.technique !== undefined) {
      parts.push(`<span class="asciichem-type">[${escape(spectrum.technique)}]</span>`);
    }
    parts.push(this.kvDl(Object.entries(spectrum.params)));
    if (spectrum.peaks.length > 0) {
      parts.push('<table class="asciichem-peaks">');
      parts.push("<thead><tr><th>position</th><th>intensity</th><th>multiplicity</th><th>assignment</th></tr></thead>");
      parts.push("<tbody>");
      for (const peak of spectrum.peaks) {
        parts.push("<tr>");
        parts.push(`<td>${escape(peak.position)}</td>`);
        parts.push(`<td>${escape(peak.intensity)}</td>`);
        parts.push(`<td>${escape(peak.multiplicity)}</td>`);
        parts.push(`<td>${escape(peak.assignment)}</td>`);
        parts.push("</tr>");
      }
      parts.push("</tbody></table>");
    }
    parts.push("</span>");
    return parts.join("");
  }

  visitCalculation(calc: Calculation): string {
    const parts: string[] = ['<span class="asciichem-calc">'];
    if (calc.method !== undefined || calc.basis !== undefined) {
      const label = [calc.method, calc.basis].filter((v) => v !== undefined).join("/");
      parts.push(`<span class="asciichem-method">[${escape(label)}]</span>`);
    }
    if (calc.properties.length > 0) {
      parts.push('<dl class="asciichem-properties">');
      for (const property of calc.properties) {
        let value = escape(property.value);
        if (property.units !== undefined) value += ` ${escape(property.units)}`;
        parts.push(`<dt>${escape(property.title)}</dt><dd>${value}</dd>`);
      }
      parts.push("</dl>");
    }
    parts.push("</span>");
    return parts.join("");
  }

  visitZMatrix(zm: ZMatrix): string {
    const parts: string[] = ['<span class="asciichem-zmatrix">'];
    if (zm.rows.length === 0) return `${parts.join("")}</span>`;
    parts.push('<table class="asciichem-rows"><tbody>');
    for (const row of zm.rows) {
      const cells: string[] = [row.atom];
      if (row.ref1 !== undefined) cells.push(row.ref1, row.distance ?? "");
      if (row.ref2 !== undefined) cells.push(row.ref2, row.angle ?? "");
      if (row.ref3 !== undefined) cells.push(row.ref3, row.dihedral ?? "");
      parts.push(`<tr>${cells.map((c) => `<td>${escape(c)}</td>`).join("")}</tr>`);
    }
    parts.push("</tbody></table></span>");
    return parts.join("");
  }

  visitMechanism(mech: Mechanism): string {
    const parts: string[] = ['<span class="asciichem-mechanism">'];
    if (mech.steps.length === 0 && mech.spectators.length === 0) return `${parts.join("")}</span>`;
    parts.push('<dl class="asciichem-steps">');
    for (const step of mech.steps) {
      parts.push(`<dt>${escape(step.label)}</dt><dd>${escape(step.reaction)}</dd>`);
    }
    for (const spectator of mech.spectators) {
      parts.push(`<dt>spectator</dt><dd>${escape(spectator)}</dd>`);
    }
    parts.push("</dl></span>");
    return parts.join("");
  }

  render(node: Node): string {
    return node.accept(this);
  }

  // Minimal HTML escaper. The model content is plain text (digits,
  // element symbols, conditions text) so only the four XML-mandated
  // characters need escaping — the reference's Html#escape.
  private cellParamDl(crystal: Crystal): string {
    const pairs: [string, string][] = [];
    for (const param of ["a", "b", "c", "alpha", "beta", "gamma"] as const) {
      const value = crystal[param];
      if (value !== undefined) pairs.push([CELL_LABELS[param], String(value)]);
    }
    return this.kvDl(pairs);
  }

  private kvDl(pairs: [string, string][]): string {
    if (pairs.length === 0) return "";
    const parts: string[] = ["<dl>"];
    for (const [key, value] of pairs) parts.push(`<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`);
    parts.push("</dl>");
    return parts.join("");
  }
}

// Minimal HTML escaper. The model content is plain text (digits,
// element symbols, conditions text) so only the four XML-mandated
// characters need escaping — the reference's Html#escape (nil renders
// as the empty string).
function escape(value: string | undefined): string {
  if (value === undefined) return "";
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

registerRenderer<string>("html", (node) => node.accept(new HtmlFormatter()));
