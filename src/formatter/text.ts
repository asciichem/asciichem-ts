// Canonical AsciiChem text formatter — the round-trip contract:
// parseText(s).toText() === s for any canonical s. Port of
// AsciiChem::Formatter::Text.
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

export class TextFormatter implements Visitor<string> {
  visitFormula(formula: Formula): string {
    return formula.nodes.map((n) => this.render(n)).join(" ");
  }

  visitMolecule(molecule: Molecule): string {
    const prefix = molecule.coefficient ?? "";
    const stereo = molecule.stereo ? `(${molecule.stereoLetter})-` : "";
    const body = molecule.nodes.map((n) => this.render(n)).join("");
    return `${stereo}${prefix}${body}${this.moleculeAnnotations(molecule)}`;
  }

  private moleculeAnnotations(molecule: Molecule): string {
    const parts: string[] = [];
    for (const n of molecule.names) parts.push(`@name("${n.content}")`);
    for (const i of molecule.identifiers) parts.push(`@${i.convention}("${i.value}")`);
    if (molecule.title !== undefined) parts.push(`@title("${molecule.title}")`);
    for (const f of molecule.formulas) if (f.concise) parts.push(`@formula("${f.concise}")`);
    for (const l of molecule.labels) if (l.value) parts.push(`@label("${l.value}")`);
    for (const p of molecule.properties)
      if (p.title && p.value) parts.push(`@${p.title}("${p.value}")`);
    for (const m of molecule.metadata) parts.push(`@meta("${m.name}","${m.content}")`);
    return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
  }

  visitAtom(atom: Atom): string {
    const parts: string[] = [];
    if (atom.lonePairs !== undefined) parts.push(":".repeat(atom.lonePairs));
    if (atom.isotope !== undefined) parts.push(`^${atom.isotope}`);
    parts.push(atom.element);
    if (atom.subscript !== undefined) parts.push(`_${atom.subscript}`);
    if (atom.superscript !== undefined) parts.push(`^${atom.superscript}`);
    if (atom.charge !== undefined) parts.push(`^${atom.charge}`);
    if (atom.oxidationState !== undefined) parts.push(`^(${atom.oxidationState})`);
    if (atom.radicalElectrons !== undefined) parts.push(".".repeat(atom.radicalElectrons));
    if (atom.ringClosures !== undefined) parts.push(atom.ringClosures);
    parts.push(this.atomAnnotation(atom));
    return parts.join("");
  }

  private atomAnnotation(atom: Atom): string {
    const parts: string[] = [];
    if (atom.x2 !== undefined && atom.y2 !== undefined) {
      let coord = `@(${formatCoord(atom.x2)},${formatCoord(atom.y2)}`;
      if (atom.z2 !== undefined) coord += `,${formatCoord(atom.z2)}`;
      parts.push(`${coord})`);
    }
    if (atom.atomParity !== undefined) parts.push(`@${atom.atomParity}`);
    if (atom.spinMultiplicity !== undefined) parts.push(`@m(${atom.spinMultiplicity})`);
    if (atom.atomTitle !== undefined) parts.push(`@t("${atom.atomTitle}")`);
    if (atom.xFract !== undefined && atom.yFract !== undefined && atom.zFract !== undefined) {
      parts.push(
        `@f(${formatCoord(atom.xFract)},${formatCoord(atom.yFract)},${formatCoord(atom.zFract)})`,
      );
    }
    return parts.join("");
  }

  visitGroup(group: Group): string {
    const body = group.nodes.map((n) => this.render(n)).join("");
    const suffix = group.multiplicity !== undefined ? `_${group.multiplicity}` : "";
    return `${group.openChar}${body}${group.closeChar}${suffix}`;
  }

  visitBond(bond: Bond): string {
    return bond.ascii;
  }

  visitReaction(reaction: Reaction): string {
    const left = this.renderTerms(reaction.reactants);
    const right = this.renderTerms(reaction.products);
    return `${left} ${this.renderArrowWithConditions(reaction)} ${right}`;
  }

  visitReactionCascade(cascade: ReactionCascade): string {
    if (cascade.steps.length === 0) return "";
    const head = cascade.steps[0];
    let out = `${this.renderTerms(head.reactants)} ${this.renderArrowWithConditions(head)} ${this.renderTerms(head.products)}`;
    for (const step of cascade.steps.slice(1)) {
      out += ` ${this.renderArrowWithConditions(step)} ${this.renderTerms(step.products)}`;
    }
    return out;
  }

  visitElectronConfiguration(ec: ElectronConfiguration): string {
    const parts = ec.orbitals.map(([orb, occ]) => `${orb}^${occ}`);
    if (ec.termSymbol) parts.push(ec.termSymbol.toString());
    return parts.join(" ");
  }

  visitEmbeddedMath(em: EmbeddedMath): string {
    return `\`${em.source}\``;
  }

  visitText(text: Text): string {
    return `"${text.content}"`;
  }

  visitCrystal(crystal: Crystal): string {
    const parts = ["crystal"];
    if (crystal.name !== undefined) parts.push(`[${crystal.name}]`);
    const params: string[] = [];
    if (crystal.a !== undefined) params.push(`a=${crystal.a}`);
    if (crystal.b !== undefined) params.push(`b=${crystal.b}`);
    if (crystal.c !== undefined) params.push(`c=${crystal.c}`);
    if (crystal.alpha !== undefined) params.push(`alpha=${crystal.alpha}`);
    if (crystal.beta !== undefined) params.push(`beta=${crystal.beta}`);
    if (crystal.gamma !== undefined) params.push(`gamma=${crystal.gamma}`);
    if (crystal.spacegroup !== undefined) params.push(`sg=${crystal.spacegroup}`);
    if (params.length > 0) parts.push(`(${params.join(",")})`);
    if (crystal.atoms.length > 0) {
      parts.push(`{${crystal.atoms.map((a) => this.render(a)).join(" ")}}`);
    }
    return parts.join("");
  }

  visitSpectrum(spectrum: Spectrum): string {
    const parts = ["spectrum"];
    if (spectrum.technique !== undefined) parts.push(`[${spectrum.technique}]`);
    const params = Object.entries(spectrum.params)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    if (params !== "") parts.push(`(${params})`);
    if (spectrum.peaks.length > 0) {
      const body = spectrum.peaks
        .map((peak) => {
          let line = `${peak.position}: ${peak.intensity}`;
          if (peak.multiplicity !== undefined) line += ` ${peak.multiplicity}`;
          if (peak.assignment !== undefined) line += ` "${peak.assignment}"`;
          return line;
        })
        .join("\n  ");
      parts.push(`{\n  ${body}\n}`);
    }
    return parts.join("");
  }

  visitCalculation(calc: Calculation): string {
    const parts = ["calc"];
    const params: string[] = [];
    if (calc.method !== undefined) params.push(calc.method);
    if (calc.basis !== undefined) params.push(calc.basis);
    if (params.length > 0) parts.push(`(${params.join("/")})`);
    if (calc.properties.length > 0) {
      const lines = calc.properties
        .map((p) => {
          let line = `${p.title}: ${p.value}`;
          if (p.units !== undefined) line += ` ${p.units}`;
          return line;
        })
        .join("\n  ");
      parts.push(`{\n  ${lines}\n}`);
    }
    return parts.join("");
  }

  visitZMatrix(zm: ZMatrix): string {
    const parts = ["zmatrix"];
    if (zm.rows.length > 0) {
      const lines = zm.rows
        .map((row) => {
          const tokens: (string | undefined)[] = [row.atom];
          if (row.ref1 !== undefined) tokens.push(row.ref1, row.distance);
          if (row.ref2 !== undefined) tokens.push(row.ref2, row.angle);
          if (row.ref3 !== undefined) tokens.push(row.ref3, row.dihedral);
          return tokens.filter((t): t is string => t !== undefined).join("  ");
        })
        .join("\n  ");
      parts.push(`{\n  ${lines}\n}`);
    }
    return parts.join("");
  }

  visitMechanism(mech: Mechanism): string {
    const parts = ["mechanism"];
    if (mech.steps.length > 0 || mech.spectators.length > 0) {
      const lines = mech.steps.map((s) => `${s.label}: ${s.reaction}`);
      for (const sp of mech.spectators) lines.push(`spectator: ${sp}`);
      parts.push(`{\n  ${lines.join("\n  ")}\n}`);
    }
    return parts.join("");
  }

  render(node: Node): string {
    return node.accept(this);
  }

  private renderTerms(terms: Molecule[]): string {
    return terms.map((n) => this.render(n)).join(" + ");
  }

  private renderArrowWithConditions(reaction: Reaction): string {
    let arrow = reaction.arrowAscii;
    const conds = reaction.conditions;
    if (conds) {
      if (conds.above !== undefined) arrow += `[${conds.above}]`;
      if (conds.below !== undefined) arrow += `[${conds.below}]`;
    }
    return arrow;
  }
}

function formatCoord(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

registerRenderer<string>("text", (node) => node.accept(new TextFormatter()));
