// The mechanism step graph — the TypeScript port of the reference's
// AsciiChem::MechanismGraph (and the Rust engine's mechanism_graph,
// the authoritative model). `mechanism{}` entries stay verbatim
// (label + reaction text) in the model; this service derives the
// graph the text implies — each step's reaction parsed with the same
// grammar, species that appear on both sides of a step recognised as
// catalysts, and steps linked where a product species of an earlier
// step is a reactant of a later one. A cascade's entry side is its
// head and its exit side is its last step.
//
// Everything is computed; nothing mutates. A step whose value is not
// a reaction (prose, "proton transfer") keeps a null reaction and
// takes part in no links — never an error.
import { Mechanism, MechanismFlow, Molecule, Node, Reaction, ReactionCascade } from "./model.js";
import { parseText } from "./parser.js";
import { AsciiChemError } from "./errors.js";

// One derived step: the verbatim label and flows plus the parsed
// reaction (the model node when the step's value parses as a reaction
// or cascade) and the catalyst species the reaction's two sides share.
export interface MechanismGraphStep {
  label: string;
  reaction: Node | null;
  catalysts: string[];
  flows: MechanismFlow[];
}

// A link between two steps: the earlier step's product species that
// the later step consumes as reactants (coefficient-free names, in
// the producing step's product order).
export interface MechanismGraphLink {
  from: string;
  to: string;
  species: string[];
}

// The derived graph: every step plus the links between them.
export interface MechanismStepGraph {
  steps: MechanismGraphStep[];
  links: MechanismGraphLink[];
}

// Derives the step graph of a mechanism. Computed on the fly — the
// canonical text and the model are unchanged.
export function mechanismGraph(mechanism: Mechanism): MechanismStepGraph {
  const steps = mechanism.steps.map(graphStep);
  return { steps, links: links(steps) };
}

function graphStep(step: Mechanism["steps"][number]): MechanismGraphStep {
  const reaction = parseReaction(step.reaction);
  const sides = sidesOf(reaction);
  return {
    label: step.label,
    reaction,
    catalysts: sides ? intersect(sides.reactants, sides.products) : [],
    flows: step.flows,
  };
}

function links(steps: readonly MechanismGraphStep[]): MechanismGraphLink[] {
  const out: MechanismGraphLink[] = [];
  steps.forEach((from, index) => {
    const fromSides = sidesOf(from.reaction);
    if (!fromSides) return;
    for (const to of steps.slice(index + 1)) {
      const toSides = sidesOf(to.reaction);
      if (!toSides) continue;
      const shared = intersect(fromSides.products, toSides.reactants);
      if (shared.length > 0) out.push({ from: from.label, to: to.label, species: shared });
    }
  });
  return out;
}

// The step's reaction text parsed with the same grammar; kept only
// when it builds a reaction or a cascade (prose stays null).
function parseReaction(text: string): Node | null {
  let nodes;
  try {
    nodes = parseText(text);
  } catch (error) {
    if (error instanceof AsciiChemError) return null;
    throw error;
  }
  const first = nodes.nodes[0];
  if (first instanceof Reaction || first instanceof ReactionCascade) return first;
  return null;
}

// The coefficient-free species names per side. A cascade's entry side
// is its head and its exit side is its last step.
function sidesOf(reaction: Node | null): { reactants: string[]; products: string[] } | null {
  if (reaction instanceof Reaction) {
    return { reactants: sideKeys(reaction.reactants), products: sideKeys(reaction.products) };
  }
  if (reaction instanceof ReactionCascade) {
    const first = reaction.steps[0];
    const last = reaction.steps[reaction.steps.length - 1];
    if (first === undefined || last === undefined) return null;
    return { reactants: sideKeys(first.reactants), products: sideKeys(last.products) };
  }
  return null;
}

// Species names of one side, coefficient-free (the reference's
// side_stoichiometry keys: the term's canonical text with its leading
// integer stripped), in first-occurrence order.
function sideKeys(side: readonly Molecule[]): string[] {
  const keys: string[] = [];
  for (const term of side) {
    const name = stripCoefficient(term.toText());
    if (!keys.includes(name)) keys.push(name);
  }
  return keys;
}

// `"2A"` matches `"A"` — the leading integer is the stoichiometric
// coefficient, never part of the species name.
function stripCoefficient(text: string): string {
  return text.replace(/^\d+/, "");
}

// The receiver-order intersection (the reference's `Array#&`): the
// left side's names that the right side also has, deduplicated.
function intersect(left: readonly string[], right: readonly string[]): string[] {
  const shared: string[] = [];
  for (const name of left) {
    if (right.includes(name) && !shared.includes(name)) shared.push(name);
  }
  return shared;
}
