// Presentation MathML formatter — byte-identical port of the
// reference AsciiChem::Formatter::Mathml (single-contract rule: the
// shared mathml corpus goldens are exact string comparisons).
//
// Emission mirrors Nokogiri's default pretty-printing: elements with
// element children are multi-line with 2-space indent; text-only
// elements are single-line; empty elements self-close.
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
import { parseText } from "../parser.js";
import { AsciiChemError } from "../errors.js";

const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

type XmlElement =
  | { name: string; attrs?: Record<string, string>; text: string }
  | { name: string; attrs?: Record<string, string>; children: XmlElement[] };

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function openTag(el: XmlElement): string {
  const attrs = el.attrs
    ? ` ${Object.entries(el.attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(" ")}`
    : "";
  return `<${el.name}${attrs}`;
}

function serialize(el: XmlElement, depth: number): string {
  const pad = " ".repeat(depth * 2);
  if ("text" in el) {
    if (el.text === "") return `${pad}${openTag(el)}/>`;
    return `${pad}${openTag(el)}>${escapeText(el.text)}</${el.name}>`;
  }
  if (el.children.length === 0) {
    return `${pad}${openTag(el)}/>`;
  }
  const inner = el.children.map((c) => serialize(c, depth + 1)).join("\n");
  return `${pad}${openTag(el)}>\n${inner}\n${pad}</${el.name}>`;
}

function el(name: string, attrs?: Record<string, string>, children: XmlElement[] = []): XmlElement {
  return { name, attrs, children };
}

function mi(content: string): XmlElement {
  return { name: "mi", attrs: { mathvariant: "normal" }, text: content };
}

function mn(content: string | number): XmlElement {
  return { name: "mn", text: String(content) };
}

function mo(content: string): XmlElement {
  return { name: "mo", text: content };
}

function mtext(content: string): XmlElement {
  return { name: "mtext", text: content };
}

export class MathmlFormatter implements Visitor<XmlElement> {
  visitFormula(formula: Formula): XmlElement {
    return el("math", { xmlns: MATHML_NS }, [this.rowOf(formula.nodes)]);
  }

  // The <mrow> wrapper around top-level formula children (the Ruby
  // formatter's visit_formula body).
  private rowOf(nodes: Node[]): XmlElement {
    return el("mrow", undefined, nodes.map((n) => n.accept(this)));
  }

  visitMolecule(molecule: Molecule): XmlElement {
    const children: XmlElement[] = [];
    if (molecule.stereo) children.push(mtext(`(${molecule.stereoLetter})-`));
    if (molecule.coefficient !== undefined) children.push(mn(molecule.coefficient));
    children.push(...molecule.nodes.map((n) => n.accept(this)));
    return el("mrow", undefined, children);
  }

  visitAtom(atom: Atom): XmlElement {
    let base: XmlElement = mi(atom.element);
    if (atom.isotope !== undefined) base = this.attachIsotopePrefix(base, atom.isotope);
    base = this.wrapLewisPrefix(base, atom);
    base = this.wrapSubAndSuper(base, atom);
    base = this.wrapLewisSuffix(base, atom);
    base = this.wrapRingClosures(base, atom);
    return base;
  }

  private wrapRingClosures(base: XmlElement, atom: Atom): XmlElement {
    if (atom.ringClosures === undefined) return base;
    return el("mrow", undefined, [base, mn(atom.ringClosures)]);
  }

  private attachIsotopePrefix(base: XmlElement, isotope: string): XmlElement {
    return el("mmultiscripts", undefined, [
      base,
      el("none"),
      el("none"),
      el("mprescripts"),
      el("none"),
      mn(isotope),
    ]);
  }

  private wrapLewisPrefix(base: XmlElement, atom: Atom): XmlElement {
    if (atom.lonePairs === undefined) return base;
    return el("mrow", undefined, [mtext(":".repeat(atom.lonePairs)), base]);
  }

  private wrapLewisSuffix(base: XmlElement, atom: Atom): XmlElement {
    if (atom.radicalElectrons === undefined) return base;
    return el("mrow", undefined, [base, mtext(".".repeat(atom.radicalElectrons))]);
  }

  private wrapSubAndSuper(base: XmlElement, atom: Atom): XmlElement {
    const hasSub = atom.subscript !== undefined && atom.subscript !== "";
    const superNode = this.superElement(atom);
    if (!hasSub && !superNode) return base;
    if (hasSub && !superNode) {
      return el("msub", undefined, [base, mn(atom.subscript as string)]);
    }
    if (!hasSub && superNode) {
      return el("msup", undefined, [base, superNode]);
    }
    return el("msubsup", undefined, [base, mn(atom.subscript as string), superNode as XmlElement]);
  }

  // charge > oxidation state > raw superscript, mirroring the
  // reference priority.
  private superElement(atom: Atom): XmlElement | undefined {
    if (atom.charge !== undefined) {
      const row = this.chargeRow(atom.charge);
      if (row) return row;
    }
    if (atom.oxidationState !== undefined) {
      return el("mrow", undefined, [mi(atom.oxidationState)]);
    }
    if (atom.superscript !== undefined) {
      return mn(atom.superscript);
    }
    return undefined;
  }

  private chargeRow(charge: string): XmlElement | undefined {
    // Two accepted orders: "2+"/"4-" (digits then sign) and "+2"
    // (sign then digits) — group positions differ per pattern.
    const digitsSign = charge.match(/^(\d*)([+-])$/);
    const signDigits = digitsSign ?? charge.match(/^([+-])(\d*)$/);
    if (!signDigits) return undefined;
    const digits = digitsSign ? digitsSign[1] : signDigits[2];
    const sign = digitsSign ? digitsSign[2] : signDigits[1];
    const children: XmlElement[] = [];
    if (digits !== "") children.push(mn(digits));
    children.push(mo(sign));
    return el("mrow", undefined, children);
  }

  visitGroup(group: Group): XmlElement {
    const children: XmlElement[] = [mo(group.openChar)];
    children.push(...group.nodes.map((n) => n.accept(this)));
    children.push(mo(group.closeChar));
    const row = el("mrow", undefined, children);
    if (group.multiplicity === undefined) return row;
    return el("msub", undefined, [row, mn(group.multiplicity)]);
  }

  visitBond(bond: Bond): XmlElement {
    return mo(bond.entity);
  }

  visitReaction(reaction: Reaction): XmlElement {
    const children: XmlElement[] = [];
    this.addTerms(children, reaction.reactants);
    children.push(this.renderArrow(reaction));
    this.addTerms(children, reaction.products);
    return el("mrow", undefined, children);
  }

  visitReactionCascade(cascade: ReactionCascade): XmlElement {
    if (cascade.steps.length === 0) return el("mrow");
    const children: XmlElement[] = [];
    this.addTerms(children, cascade.steps[0].reactants);
    for (const step of cascade.steps) {
      children.push(this.renderArrow(step));
      this.addTerms(children, step.products);
    }
    return el("mrow", undefined, children);
  }

  visitElectronConfiguration(ec: ElectronConfiguration): XmlElement {
    const children: XmlElement[] = [];
    ec.orbitals.forEach(([orbital, occupancy], index) => {
      if (index > 0) children.push(mo(" "));
      children.push(el("msup", undefined, [mi(orbital), mn(occupancy)]));
    });
    return el("mrow", undefined, children);
  }

  // The reference embeds Plurimath-rendered MathML here; this port
  // has no AsciiMath engine, so the source degrades to <mtext>. The
  // gap is spec'd (test/unit/mathml.test.ts) and tracked in
  // TODO.impl/61 until an engine lands.
  visitEmbeddedMath(em: EmbeddedMath): XmlElement {
    return mtext(em.source);
  }

  visitText(text: Text): XmlElement {
    return mtext(text.content);
  }

  visitCrystal(crystal: Crystal): XmlElement {
    const children: XmlElement[] = [mi("crystal")];
    if (crystal.name !== undefined) children.push(this.namedBracket(crystal.name));
    const params = this.cellParameters(crystal);
    if (params.length > 0) children.push(this.simpleTable(params));
    if (crystal.atoms.length > 0) {
      const rows = crystal.atoms.map((atom, i) => [mn(i + 1), atom.accept(this)] as XmlElement[]);
      children.push(this.simpleTable(rows));
    }
    return el("mrow", undefined, children);
  }

  visitSpectrum(spectrum: Spectrum): XmlElement {
    const children: XmlElement[] = [mi("spectrum")];
    if (spectrum.technique !== undefined) {
      children.push(this.namedBracket(spectrum.technique));
    }
    const paramEntries = Object.entries(spectrum.params);
    if (paramEntries.length > 0) {
      children.push(
        this.simpleTable(paramEntries.map(([k, v]) => [mi(k), mtext(String(v))] as XmlElement[])),
      );
    }
    if (spectrum.peaks.length > 0) {
      const rows = spectrum.peaks.map((peak) => {
        const row: XmlElement[] = [mn(peak.position ?? ""), mn(peak.intensity ?? "")];
        if (peak.multiplicity !== undefined) row.push(mi(peak.multiplicity));
        if (peak.assignment !== undefined) row.push(mtext(peak.assignment));
        return row;
      });
      children.push(this.simpleTable(rows));
    }
    return el("mrow", undefined, children);
  }

  visitCalculation(calc: Calculation): XmlElement {
    const children: XmlElement[] = [mi("calc")];
    if (calc.method !== undefined || calc.basis !== undefined) {
      children.push(this.namedBracket([calc.method, calc.basis].filter(Boolean).join("/")));
    }
    if (calc.properties.length > 0) {
      const rows = calc.properties.map((p) => {
        const row: XmlElement[] = [mi(p.title), mn(p.value)];
        if (p.units !== undefined) row.push(mi(p.units));
        return row;
      });
      children.push(this.simpleTable(rows));
    }
    return el("mrow", undefined, children);
  }

  visitZMatrix(zm: ZMatrix): XmlElement {
    const children: XmlElement[] = [mi("zmatrix")];
    if (zm.rows.length > 0) {
      const rows = zm.rows.map((row) => {
        const cells: XmlElement[] = [mi(row.atom)];
        if (row.ref1 !== undefined) cells.push(mi(row.ref1), mn(row.distance ?? ""));
        if (row.ref2 !== undefined) cells.push(mi(row.ref2), mn(row.angle ?? ""));
        if (row.ref3 !== undefined) cells.push(mi(row.ref3), mn(row.dihedral ?? ""));
        return cells;
      });
      children.push(this.simpleTable(rows));
    }
    return el("mrow", undefined, children);
  }

  visitMechanism(mech: Mechanism): XmlElement {
    const children: XmlElement[] = [mi("mechanism")];
    if (mech.steps.length > 0 || mech.spectators.length > 0) {
      const rows: XmlElement[][] = mech.steps.map((s) => [mi(s.label), mtext(s.reaction)]);
      for (const sp of mech.spectators) rows.push([mi("spectator"), mtext(sp)]);
      children.push(this.simpleTable(rows));
    }
    return el("mrow", undefined, children);
  }

  renderMathml(formula: Formula): string {
    const xml = serialize(formula.accept(this), 0);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}\n`;
  }

  private addTerms(parent: XmlElement[], terms: Molecule[]): void {
    terms.forEach((term, index) => {
      if (index > 0) parent.push(mo("+"));
      parent.push(term.accept(this));
    });
  }

  private renderArrow(reaction: Reaction): XmlElement {
    const op = mo(reaction.arrowEntity);
    if (!reaction.conditions) return op;
    const { above, below } = reaction.conditions;
    if (above === undefined && below === undefined) return op;
    const name = above !== undefined && below !== undefined ? "munderover" : above !== undefined ? "mover" : "munder";
    const children: XmlElement[] = [op];
    if (above !== undefined) children.push(this.renderCondition(above));
    if (below !== undefined) children.push(this.renderCondition(below));
    return el(name, undefined, children);
  }

  // A condition parses as AsciiChem when it can (`400^o C`), and is
  // rendered in place with this same formatter; free-form prose falls
  // back to plain <mtext>.
  private renderCondition(text: string): XmlElement {
    if (text === undefined || text === "") return mtext("");
    try {
      const formula = parseText(text);
      return el("mrow", undefined, formula.nodes.map((n) => n.accept(this)));
    } catch (e) {
      if (e instanceof AsciiChemError) return mtext(text);
      throw e;
    }
  }

  // Build `[content]` as <mrow><mo>[</mo>...<mo>]</mo></mrow>.
  private namedBracket(content: string): XmlElement {
    return el("mrow", undefined, [mo("["), mtext(content), mo("]")]);
  }

  // Flat <mtable> from rows of ready-made cells.
  private simpleTable(rows: XmlElement[][]): XmlElement {
    return el(
      "mtable",
      undefined,
      rows.map((cells) => el("mtr", undefined, cells.map((c) => el("mtd", undefined, [c])))),
    );
  }

  // Cell-parameter [label, value] pairs in the canonical iteration
  // order, with the MathML label set (α/β/γ for angles).
  private cellParameters(crystal: Crystal): XmlElement[][] {
    const labels: Record<string, string> = {
      a: "a", b: "b", c: "c", alpha: "α", beta: "β", gamma: "γ",
    };
    const result: XmlElement[][] = [];
    for (const key of ["a", "b", "c", "alpha", "beta", "gamma"] as const) {
      const value = crystal[key];
      if (value !== undefined) result.push([mi(labels[key]), mn(value)]);
    }
    return result;
  }
}

registerRenderer<string>("mathml", (node) => new MathmlFormatter().renderMathml(node as Formula));

export function renderMathml(formula: Formula): string {
  return new MathmlFormatter().renderMathml(formula);
}
