// Model -> canonical wire JSON (asciichem-model v1). Field-for-field
// mirror of the reference WireAdapter emission, including its
// fuzz-junk guards: non-digit subscript/isotope/coefficient values
// are omitted rather than emitted (the model keeps them; the wire
// contract does not carry them).
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
  Name,
  Node,
  Reaction,
  ReactionCascade,
  Spectrum,
  Text,
  ZMatrix,
  Visitor,
  registerRenderer,
} from "../model.js";
import { parseText } from "../parser.js";
import { ParseError } from "../errors.js";
import type {
  Atom as WireAtom,
  Bond as WireBond,
  Calculation as WireCalculation,
  Crystal as WireCrystal,
  ElectronConfiguration as WireElectronConfiguration,
  EmbeddedMath as WireEmbeddedMath,
  Formula as WireFormula,
  Group as WireGroup,
  Identifier as WireIdentifier,
  Mechanism as WireMechanism,
  Molecule as WireMolecule,
  Name as WireName,
  Reaction as WireReaction,
  ReactionCascade as WireReactionCascade,
  Spectrum as WireSpectrum,
  Text as WireText,
  WireNode,
  ZMatrix as WireZMatrix,
} from "./types.js";

// Wire types declare readonly fields; emitters build them incrementally.
type Writable<T> = { -readonly [K in keyof T]: T[K] };

const digitsOrNil = (s: string | undefined): string | undefined =>
  s !== undefined && /^\d+$/.test(s) ? s : undefined;

class ToWireVisitor implements Visitor<WireNode> {
  visitFormula(node: Formula): WireNode {
    const wire: Writable<WireFormula> = {
      type: "formula",
      nodes: node.nodes.map((n) => n.toModelJSON()) as WireFormula["nodes"],
    };
    return wire;
  }

  visitAtom(node: Atom): WireNode {
    const wire: Writable<WireAtom> = { type: "atom", element: node.element };
    if (node.isotope !== undefined) wire.isotope = digitsOrNil(node.isotope);
    if (node.charge !== undefined) wire.charge = node.charge;
    if (node.subscript !== undefined) wire.subscript = digitsOrNil(node.subscript);
    if (node.oxidationState !== undefined) wire.oxidationState = node.oxidationState;
    if (node.lonePairs !== undefined) wire.lonePairs = node.lonePairs;
    if (node.radicalElectrons !== undefined) wire.radicalElectrons = node.radicalElectrons;
    if (node.ringClosures !== undefined) wire.ringClosures = digitsOrNil(node.ringClosures);
    return wire;
  }

  visitBond(node: Bond): WireNode {
    const wire: Writable<WireBond> = { type: "bond" };
    if (node.kind !== "single") wire.kind = node.kind;
    return wire;
  }

  visitGroup(node: Group): WireNode {
    const wire: Writable<WireGroup> = {
      type: "group",
      nodes: node.nodes.map((n) => n.toModelJSON()) as WireGroup["nodes"],
    };
    if (node.multiplicity !== undefined) wire.multiplicity = digitsOrNil(node.multiplicity);
    if (node.bracket !== "paren") wire.bracket = node.bracket;
    return wire;
  }

  visitMolecule(node: Molecule): WireNode {
    const wire: Writable<WireMolecule> = {
      type: "molecule",
      nodes: node.nodes.map((n) => n.toModelJSON()) as WireMolecule["nodes"],
    };
    if (node.coefficient !== undefined) wire.coefficient = digitsOrNil(node.coefficient);
    if (node.identifiers.length > 0) {
      wire.identifiers = node.identifiers.map((i) => {
        const w: Writable<WireIdentifier> = {
          type: "identifier",
          value: i.value,
          convention: i.convention as WireIdentifier["convention"],
        };
        if (i.dictRef !== undefined) w.dictRef = i.dictRef;
        return w;
      });
    }
    return wire;
  }

  visitName(node: Name): WireNode {
    const wire: Writable<WireName> = { type: "name", content: node.content };
    if (node.convention !== undefined) wire.convention = node.convention;
    if (node.dictRef !== undefined) wire.dictRef = node.dictRef;
    return wire;
  }

  visitReaction(node: Reaction): WireNode {
    const wire: Writable<WireReaction> = {
      type: "reaction",
      reactants: node.reactants.map((m) => m.toModelJSON() as WireMolecule),
      products: node.products.map((m) => m.toModelJSON() as WireMolecule),
    };
    if (node.arrow !== "forward") wire.arrow = node.arrow;
    if (node.conditions && (node.conditions.above || node.conditions.below)) {
      wire.conditions = {
        ...(node.conditions.above !== undefined ? { above: node.conditions.above } : {}),
        ...(node.conditions.below !== undefined ? { below: node.conditions.below } : {}),
      };
    }
    return wire;
  }

  visitReactionCascade(node: ReactionCascade): WireNode {
    const wire: Writable<WireReactionCascade> = {
      type: "reaction-cascade",
      steps: node.steps.map((s) => s.toModelJSON() as WireReaction),
    };
    return wire;
  }

  visitElectronConfiguration(node: ElectronConfiguration): WireNode {
    const wire: Writable<WireElectronConfiguration> = {
      type: "electron-configuration",
      orbitals: node.orbitals.map(([orbital, occupancy]) => ({
        orbital,
        occupancy: digitsOrNil(occupancy) ?? occupancy,
      })),
    };
    if (node.termSymbol) {
      wire.termSymbol = {};
      if (node.termSymbol.multiplicity !== undefined)
        wire.termSymbol.multiplicity = node.termSymbol.multiplicity;
      if (node.termSymbol.letter !== undefined) wire.termSymbol.letter = node.termSymbol.letter;
      if (node.termSymbol.jValue !== undefined) wire.termSymbol.jValue = node.termSymbol.jValue;
    }
    return wire;
  }

  visitEmbeddedMath(node: EmbeddedMath): WireNode {
    const wire: Writable<WireEmbeddedMath> = { type: "embedded-math", source: node.source };
    return wire;
  }

  visitText(node: Text): WireNode {
    return { type: "text", content: node.content };
  }

  visitCrystal(node: Crystal): WireNode {
    const wire: Writable<WireCrystal> = { type: "crystal" };
    if (node.name !== undefined) wire.name = node.name;
    if (node.a !== undefined) wire.a = node.a;
    if (node.b !== undefined) wire.b = node.b;
    if (node.c !== undefined) wire.c = node.c;
    if (node.alpha !== undefined) wire.alpha = node.alpha;
    if (node.beta !== undefined) wire.beta = node.beta;
    if (node.gamma !== undefined) wire.gamma = node.gamma;
    if (node.spacegroup !== undefined) wire.spacegroup = node.spacegroup;
    if (node.atoms.length > 0) {
      wire.atoms = node.atoms.map((a) => a.toModelJSON() as WireAtom);
    }
    return wire;
  }

  visitSpectrum(node: Spectrum): WireNode {
    const wire: Writable<WireSpectrum> = { type: "spectrum" };
    if (node.technique !== undefined) wire.technique = node.technique;
    if (Object.keys(node.params).length > 0) {
      wire.params = { ...node.params } as WireSpectrum["params"];
    }
    if (node.peaks.length > 0) {
      wire.peaks = node.peaks.map((p) => {
        const peak: Writable<NonNullable<WireSpectrum["peaks"]>[number]> = {
          position: p.position ?? "",
        };
        if (p.intensity !== undefined) peak.intensity = p.intensity;
        if (p.multiplicity !== undefined) peak.multiplicity = p.multiplicity;
        if (p.assignment !== undefined) peak.assignment = p.assignment;
        return peak;
      });
    }
    return wire;
  }

  visitCalculation(node: Calculation): WireNode {
    const wire: Writable<WireCalculation> = { type: "calculation" };
    if (node.method !== undefined) wire.method = node.method;
    if (node.basis !== undefined) wire.basis = node.basis;
    if (node.properties.length > 0) {
      wire.properties = node.properties.map((p) => ({
        title: p.title,
        value: p.value,
        ...(p.units !== undefined ? { units: p.units } : {}),
      }));
    }
    return wire;
  }

  visitZMatrix(node: ZMatrix): WireNode {
    const wire: Writable<WireZMatrix> = { type: "zmatrix" };
    if (node.rows.length > 0) {
      wire.rows = node.rows.map((r) => ({
        atom: r.atom,
        ...(r.ref1 !== undefined ? { ref1: r.ref1 } : {}),
        ...(r.distance !== undefined ? { distance: r.distance } : {}),
        ...(r.ref2 !== undefined ? { ref2: r.ref2 } : {}),
        ...(r.angle !== undefined ? { angle: r.angle } : {}),
        ...(r.ref3 !== undefined ? { ref3: r.ref3 } : {}),
        ...(r.dihedral !== undefined ? { dihedral: r.dihedral } : {}),
      }));
    }
    return wire;
  }

  visitMechanism(node: Mechanism): WireNode {
    const wire: Writable<WireMechanism> = { type: "mechanism" };
    if (node.steps.length > 0) {
      wire.steps = node.steps.map((s) => ({
        label: s.label,
        reaction: wireReactionFromString(s.reaction),
      }));
    }
    if (node.spectators.length > 0) {
      wire.spectators = node.spectators.map((s) => wireMoleculeFromString(s));
    }
    return wire;
  }
}

// Mechanism bodies hold raw capture strings (round-trip fidelity); the
// wire contract requires real nodes. Re-enter the parser — the same
// pattern the reference uses for crystal bodies.
function wireReactionFromString(source: string): WireReaction {
  const formula = parseToFormula(source);
  const node = formula.nodes[0];
  if (!(node instanceof Reaction) || formula.nodes.length !== 1) {
    throw new ParseError(`mechanism step body is not a reaction: ${JSON.stringify(source)}`);
  }
  return node.toModelJSON() as WireReaction;
}

function wireMoleculeFromString(source: string): WireMolecule {
  const formula = parseToFormula(source);
  const node = formula.nodes[0];
  if (!(node instanceof Molecule) || formula.nodes.length !== 1) {
    throw new ParseError(`mechanism spectator is not a molecule: ${JSON.stringify(source)}`);
  }
  return node.toModelJSON() as WireMolecule;
}

function parseToFormula(source: string): Formula {
  return parseText(source);
}

export function toWireNode(node: Node): WireNode {
  return node.accept(new ToWireVisitor());
}

registerRenderer<WireNode>("wire", toWireNode);
