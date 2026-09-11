// AsciiChem grammar for peggy — a rule-by-rule port of the reference
// implementation (asciichem-ruby lib/asciichem/grammar.rb).
//
// Invariants preserved from the reference grammar:
// - Alternation order is significant (PEG ordered choice), e.g.
//   `crystal`/`spectrum` keywords are tried before `molecule`, the
//   cascade before the single reaction, annotated molecules before
//   bare molecules, and bond/arrow tokens longest-first.
// - The prefix-isotope binding is structural: `^14C` consumes the
//   isotope and the element as one unit; a bare `^14` fails.
// - Hydrogen is special-cased: bare digits after H are subscripts
//   (H cannot ring-close), with a negative lookahead so `He`/`Ho`
//   still parse as full element symbols.
// - The root rule requires the entire input to be consumed.
//
// Actions return plain "capture" objects; src/transform.ts maps them
// onto the semantic model exactly as AsciiChem::Transform does.

Formula
  = _ nodes:Nodes _ !. { return { kind: "formula", nodes }; }

Nodes
  = head:Node rest:(_ n:Node { return n; })* { return [head, ...rest]; }

Node
  = RReactionCascade
  / RReaction
  / RElectronConfig
  / RCrystal
  / RSpectrum
  / RCalculation
  / RZMatrix
  / RMechanism
  / RAnnotatedMolecule
  / RMolecule
  / REmbeddedMath
  / RTextRun

// -- beyond-formulas constructs (raw captures; builders parse them) --

RCrystal
  = "crystal" name:CrystalName? params:CrystalParams? body:CrystalBody? {
      return { kind: "crystal", name, params, body };
    }

CrystalName   = "[" cs:[^\]]* "]" { return cs.join(""); }
CrystalParams = "(" cs:[^)]* ")" { return cs.join(""); }
CrystalBody   = "{" cs:[^}]* "}" { return cs.join(""); }

RSpectrum
  = "spectrum" type:SpectrumType? params:CrystalParams? body:CrystalBody? {
      return { kind: "spectrum", type, params, body };
    }

SpectrumType  = "[" cs:[^\]]* "]" { return cs.join(""); }

RCalculation
  = "calc" params:CrystalParams? body:CrystalBody? {
      return { kind: "calculation", params, body };
    }

RZMatrix
  = "zmatrix" body:CrystalBody? { return { kind: "zmatrix", body }; }

RMechanism
  = "mechanism" body:CrystalBody? { return { kind: "mechanism", body }; }

// -- annotated molecules -----------------------------------------------

RAnnotatedMolecule
  = molecule:RMolecule annotations:MoleculeAnnotation+ {
      return { kind: "annotated", molecule, annotations };
    }

MoleculeAnnotation
  = _? ann:(MetadataAnnotation / SimpleAnnotation) { return ann; }

MetadataAnnotation
  = "@meta(\"" key:[^"]* "\",\"" value:[^"]* "\")" {
      return { metaKey: key.join(""), metaValue: value.join("") };
    }

SimpleAnnotation
  = "@" type:AnnotationType "(\"" value:[^"]* "\")" {
      return { annType: type, annValue: value.join("") };
    }

AnnotationType
  = "name" / "title" / "formula" / "label" / "inchi" / "smiles"
  / "cas" / "iupac" / "cid" / "chebi"
  / PropertyName

PropertyName = $[a-z]+

// -- reactions ---------------------------------------------------------

RReactionCascade
  = first:RReaction tail:(arrow:Arrow _ products:Terms { return { arrow, products }; })+ {
      return { kind: "cascade", first, tail };
    }

RReaction
  = reactants:Terms arrow:Arrow _ products:Terms {
      return { kind: "reaction", reactants, arrow, products };
    }

Terms
  = head:RMolecule rest:(_ "+" _ m:RMolecule { return m; })* {
      return [head, ...rest];
    }

Arrow
  = _ kind:ArrowToken above:Condition? below:Condition? {
      return { kind, above, below };
    }

ArrowToken = "<=>" / "<->" / "->" / "<-"

Condition = "[" text:[^\]]* "]" { return text.join(""); }

// -- molecules ---------------------------------------------------------

RMolecule
  = stereo:StereoPrefix? coefficient:Coefficient? units:Units {
      return { kind: "molecule", stereo, coefficient, units };
    }

StereoPrefix = "(" stereo:StereoLetter ")" "-" { return stereo; }

StereoLetter
  = "alpha" / "beta" / "R" / "S" / "E" / "Z" / "α" / "β" / "a" / "b"

Units = (Unit / BondToken)+

Unit = PrefixedAtom / Group / HydrogenAtom / PlainAtom

// Hydrogen special case: bare digits after H are subscripts. The
// lookahead prevents stealing the H from two-letter symbols.
HydrogenAtom
  = lonePairs:LewisPrefix? "H" !Lower subscript:HSubscript?
    superscript:SuperscriptMarker? radicalElectrons:LewisRadicals?
    annotations:AtomAnnotations {
      return {
        kind: "atom", element: "H", isotope: null,
        subscript, superscript,
        lonePairs, radicalElectrons, ringClosures: null,
        ...annotations,
      };
    }

Lower = [a-z]

HSubscript
  = "_" value:SubscriptValue { return "_" + value; }
  / $[0-9]+

BondToken
  = "##"  { return { kind: "bond", bondKind: "quadruple" }; }
  / ">-" { return { kind: "bond", bondKind: "wedge" }; }
  / "-<" { return { kind: "bond", bondKind: "hash" }; }
  / "~>" { return { kind: "bond", bondKind: "dative" }; }
  / "~~" { return { kind: "bond", bondKind: "wavy" }; }
  / "#"  { return { kind: "bond", bondKind: "triple" }; }
  / "="  { return { kind: "bond", bondKind: "double" }; }
  / "-"  { return { kind: "bond", bondKind: "single" }; }

// A coefficient is leading digits immediately followed by an element
// symbol or an opening bracket (lookahead, not consumed).
Coefficient
  = digits:$[0-9]+ &([A-Z] [a-z]? / [\(\[\{]) { return digits; }

// -- atoms ---------------------------------------------------------------

PrefixedAtom
  = lonePairs:LewisPrefix? isotope:IsotopeMarker element:ElementSymbol
    suffix:AtomSuffix radicalElectrons:LewisRadicals? ringClosures:RingClosures?
    annotations:AtomAnnotations {
      return {
        kind: "atom", element, isotope, ...suffix,
        lonePairs, radicalElectrons, ringClosures, ...annotations,
      };
    }

PlainAtom
  = lonePairs:LewisPrefix? element:ElementSymbol
    suffix:AtomSuffix radicalElectrons:LewisRadicals? ringClosures:RingClosures?
    annotations:AtomAnnotations {
      return {
        kind: "atom", element, isotope: null, ...suffix,
        lonePairs, radicalElectrons, ringClosures, ...annotations,
      };
    }

AtomAnnotations
  = coordinate:CoordinateAnnotation? parity:ParityAnnotation?
    multiplicity:MultiplicityAnnotation? title:AtomTitleAnnotation?
    fractional:FractionalAnnotation? {
      return {
        x2: coordinate?.x2, y2: coordinate?.y2, z2: coordinate?.z2,
        atomParity: parity, spinMultiplicity: multiplicity,
        atomTitle: title,
        xFract: fractional?.x, yFract: fractional?.y, zFract: fractional?.z,
      };
    }

ParityAnnotation      = "@" parity:$[RS] { return parity; }
MultiplicityAnnotation = "@m(" digits:$[0-9]+ ")" { return digits; }
AtomTitleAnnotation   = "@t(\"" title:[^"]* "\")" { return title.join(""); }

CoordinateAnnotation
  = "@(" x:FloatNumber "," y:FloatNumber z:("," zz:FloatNumber { return zz; })? ")" {
      return { x2: x, y2: y, z2: z };
    }

FractionalAnnotation
  = "@f(" x:FloatNumber "," y:FloatNumber "," z:FloatNumber ")" {
      return { x, y, z };
    }

FloatNumber
  = $("-"? [0-9]+ ("." [0-9]*)?)

RingClosures = $[0-9]+

AtomSuffix
  = subscript:SubscriptMarker? superscript:SuperscriptMarker? {
      return { subscript, superscript };
    }

LewisPrefix    = $(":"+)
LewisRadicals  = $("."+)

// Markers keep their leading `^`/`_` in the capture (mirroring the
// reference captures); AtomBuilder strips them.
IsotopeMarker
  = marker:("^" / "_") digits:$[0-9]+ { return marker + digits; }

SubscriptMarker
  = "_" value:SubscriptValue { return "_" + value; }

SubscriptValue
  = Braced / $[0-9]+

SuperscriptMarker
  = "^" value:SuperscriptValue { return "^" + value; }

SuperscriptValue
  = OxidationState / Charge / BracedOrBare

Charge
  = digits:$[0-9]+ sign:$[+-] { return digits + sign; }
  / sign:$[+-] digits:$[0-9]* { return sign + digits; }
  / $[0-9]+

OxidationState = "(" numerals:$[IVXLCDM]+ ")" { return "(" + numerals + ")"; }

BracedOrBare
  = Braced / $[0-9a-zA-Z]+

Braced = "{" content:[^}]* "}" { return "{" + content.join("") + "}"; }

ElementSymbol = $([A-Z] [a-z]?)

// -- groups ---------------------------------------------------------------

Group
  = open:GroupOpen nodes:GroupNodes _close:GroupClose multiplicity:Multiplicity? {
      return { kind: "group", open, nodes, multiplicity };
    }

GroupNodes = GroupNode+

GroupNode
  = RReaction / RElectronConfig / RMolecule / REmbeddedMath / GroupTextRun

GroupTextRun = "\"" content:[^"]* "\"" { return { kind: "text", content: content.join("") }; }

GroupOpen  = $[\(\[\{]
GroupClose = $[\)\]\}]

Multiplicity = "_" digits:$[0-9]+ { return digits; }

// -- electron configuration -------------------------------------------

RElectronConfig
  = head:ECPair second:ECPair rest:ECPair* {
      return { kind: "electron-config", pairs: [head, second, ...rest] };
    }

ECPair
  = orbital:Orbital "^" occupancy:$[0-9]+ _ { return [orbital, occupancy]; }

Orbital = $([0-9]+ [spdfgh])

// -- embedded math and text --------------------------------------------

REmbeddedMath = "`" source:[^`]* "`" { return { kind: "math", source: source.join("") }; }

RTextRun = "\"" content:[^"]* "\"" { return { kind: "text", content: content.join("") }; }

// -- primitives --------------------------------------------------------

_ = [ \t\r\n\f\v]*
