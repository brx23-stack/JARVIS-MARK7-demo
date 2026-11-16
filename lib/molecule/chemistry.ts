import { ELEMENTS, type ElementData } from "@/lib/laboratory/elements";

// ═══════════════════════════════════════════════════════════════
// Pure data/logic for the orb's atom & molecule visualization.
// Ported from the original standalone MoleculeLab component so the
// same bonding/formula/template rules apply now that the visuals
// live inside orbScene.ts instead of a separate scene. Nothing in
// this file touches Three.js, the DOM, or React — it's safe to
// import from anywhere and easy to unit test.
// ═══════════════════════════════════════════════════════════════

export type LabAtom = {
  id: string;
  element: ElementData;
  position: [number, number, number];
  electronDelta?: number;
  protonDelta?: number;
  neutronDelta?: number;
};

export type Bond = { a: string; b: string; order: 1 | 2 | 3 };

export type MoleculeTemplate = {
  name: string;
  formula: string;
  note: string;
  atoms: Array<[string, number, number, number]>;
  bonds: Array<[number, number, 1 | 2 | 3]>;
};

export const TEMPLATES: MoleculeTemplate[] = [
  { name: "Water", formula: "H₂O", note: "Bent molecular geometry; simplified 3D visualization.", atoms: [["O", 0, 0, 0], ["H", -1.1, 0.55, 0], ["H", 1.1, 0.55, 0]], bonds: [[0, 1, 1], [0, 2, 1]] },
  { name: "Carbon dioxide", formula: "CO₂", note: "Linear geometry; C=O double bonds.", atoms: [["C", 0, 0, 0], ["O", -1.45, 0, 0], ["O", 1.45, 0, 0]], bonds: [[0, 1, 2], [0, 2, 2]] },
  { name: "Oxygen", formula: "O₂", note: "Diatomic molecule; O=O double bond.", atoms: [["O", -0.65, 0, 0], ["O", 0.65, 0, 0]], bonds: [[0, 1, 2]] },
  { name: "Methane", formula: "CH₄", note: "Tetrahedral geometry; simplified bond angles.", atoms: [["C", 0, 0, 0], ["H", 1.05, 1.05, 1.05], ["H", -1.05, -1.05, 1.05], ["H", -1.05, 1.05, -1.05], ["H", 1.05, -1.05, -1.05]], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]] },
  { name: "Ammonia", formula: "NH₃", note: "Trigonal-pyramidal geometry; simplified visualization.", atoms: [["N", 0, 0, 0], ["H", 1.0, 0.75, 0], ["H", -0.5, 0.75, 0.87], ["H", -0.5, 0.75, -0.87]], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]] },
  { name: "Aluminium oxide", formula: "Al₂O₃", note: "Ionic solid formula unit; this is a simplified cluster, not a molecular lattice.", atoms: [["Al", -0.95, 0, 0], ["Al", 0.95, 0, 0], ["O", 0, 1.15, 0], ["O", -0.1, -0.75, 1.0], ["O", -0.1, -0.75, -1.0]], bonds: [[0, 2, 1], [0, 3, 1], [1, 2, 1], [1, 3, 1], [1, 4, 1], [0, 4, 1]] },
];

const RADII: Record<string, number> = { H: .31, C: .76, N: .71, O: .66, F: .57, P: 1.07, S: 1.05, Cl: 1.02, Br: 1.20, I: 1.39, Na: 1.66, K: 2.03, Mg: 1.41, Ca: 1.76, Al: 1.21, Si: 1.11, Fe: 1.24, Cu: 1.32, Zn: 1.22 };

export function valenceLimit(e: ElementData) {
  const vals = e.valency.split(",").map(Number).filter(Boolean);
  return Math.max(1, Math.min(6, vals[vals.length - 1] || 1));
}

export function compatible(a: ElementData, b: ElementData) {
  if (a.symbol === b.symbol && ["He", "Ne", "Ar", "Kr", "Xe", "Rn", "Og"].includes(a.symbol)) return false;
  if (a.category === "noble-gas" || b.category === "noble-gas") return false;
  return true;
}

export function formulaOf(atoms: LabAtom[]) {
  const counts = new Map<string, number>();
  atoms.forEach((a) => counts.set(a.element.symbol, (counts.get(a.element.symbol) || 0) + 1));
  if (counts.size === 0) return "EMPTY";

  const preset = TEMPLATES.find((t) => {
    const templateCounts = new Map<string, number>();
    t.atoms.forEach(([sym]) => templateCounts.set(sym, (templateCounts.get(sym) || 0) + 1));
    if (templateCounts.size !== counts.size) return false;
    for (const [sym, n] of templateCounts) if (counts.get(sym) !== n) return false;
    return true;
  });
  if (preset) return preset.formula;

  const rank = (s: string) => (s === "C" ? 0 : s === "H" ? 1 : 2);
  return [...counts.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || (rank(a[0]) === 2 ? a[0].localeCompare(b[0]) : 0))
    .map(([s, n]) => `${s}${n > 1 ? n : ""}`)
    .join("");
}

export function inferBonds(atoms: LabAtom[]): Bond[] {
  const candidates: Array<{ a: string; b: string; d: number }> = [];
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i], b = atoms[j];
      if (!compatible(a.element, b.element)) continue;
      const threshold = (RADII[a.element.symbol] || 1.15) + (RADII[b.element.symbol] || 1.15);
      const d = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
      if (d < Math.max(1.0, threshold * 1.25)) candidates.push({ a: a.id, b: b.id, d });
    }
  }
  candidates.sort((x, y) => x.d - y.d);
  const degree = new Map<string, number>();
  const bonds: Bond[] = [];
  for (const c of candidates) {
    const da = degree.get(c.a) || 0, db = degree.get(c.b) || 0;
    const ea = atoms.find((x) => x.id === c.a)!.element, eb = atoms.find((x) => x.id === c.b)!.element;
    if (da < valenceLimit(ea) && db < valenceLimit(eb)) {
      bonds.push({ a: c.a, b: c.b, order: 1 });
      degree.set(c.a, da + 1);
      degree.set(c.b, db + 1);
    }
  }
  return bonds;
}

export function findTemplate(raw: string): MoleculeTemplate | undefined {
  const templatesByName = [...TEMPLATES].sort((a, b) => b.name.length - a.name.length);
  return templatesByName.find((t) => raw.includes(t.name.toLowerCase()) || raw.includes(t.formula.toLowerCase()));
}

export function findElement(raw: string): ElementData | undefined {
  return ELEMENTS.find((e) => new RegExp(`\\b${e.name.toLowerCase()}\\b|\\b${e.symbol.toLowerCase()}\\b`).test(raw));
}

export function normalizeVoice(text: string) {
  return text.toLowerCase().replace(/[?!.]/g, " ").replace(/\s+/g, " ").trim();
}

// ═══════════════════════════════════════════════════════════════
// Multi-alternative + fuzzy voice resolution.
//
// The browser's speech recognizer returns several ranked guesses per
// utterance (see `maxAlternatives` in lib/voice/speechRecognition.ts).
// "Jarvis" and element/molecule names are uncommon words, so the correct
// guess is sometimes NOT the browser's top pick. resolveBestTranscript()
// tries the other guesses - and, failing an exact match, a small
// edit-distance-tolerant fuzzy match - before giving up and using the
// plain top guess exactly as before this existed.
// ═══════════════════════════════════════════════════════════════

// Same trigger-verb list the caller (JarvisOrb) uses to decide whether an
// utterance is attempting a molecule/atom command at all. Used here purely
// as a guard: only bother looking past the top transcript for sentences
// that already read like a command, so an ordinary conversational sentence
// that happens to fuzzy-resemble an element name in some other alternative
// never gets silently swapped out from under it.
const ACTION_VERBS =
  /\b(?:add|remove|delete|take|subtract|create|build|load|make|construct|break|separate|split|rearrange|reorganize|scatter|validate|check|select|choose|inspect|show|open|launch|start|switch)\b/i;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// A word counts as a fuzzy match if it's close enough, scaled to the
// target's length so short words still require a near-exact hit (this is
// what keeps e.g. "tin" from fuzzy-matching too eagerly).
function fuzzyWordMatch(word: string, target: string): boolean {
  if (word.length < 3 || target.length < 3) return word === target;
  const distance = levenshtein(word, target);
  const tolerance = target.length <= 5 ? 1 : target.length <= 9 ? 2 : 3;
  return distance <= tolerance;
}

function fuzzyFindElement(raw: string): ElementData | undefined {
  const words = raw.split(/\s+/).filter(Boolean);
  return ELEMENTS.find((e) => words.some((w) => fuzzyWordMatch(w, e.name.toLowerCase())));
}

function fuzzyFindTemplate(raw: string): MoleculeTemplate | undefined {
  const words = raw.split(/\s+/).filter(Boolean);
  const templatesByName = [...TEMPLATES].sort((a, b) => b.name.length - a.name.length);
  return templatesByName.find((t) => {
    const nameWords = t.name.toLowerCase().split(/\s+/);
    return nameWords.every((nw) => words.some((w) => fuzzyWordMatch(w, nw)));
  });
}

/**
 * Given every alternative transcript the recognizer offered for one
 * utterance (ranked best-first, top guess at index 0), returns whichever
 * one actually names a known element or molecule - checking exact matches
 * first, then a fuzzy fallback - so a mangled top guess doesn't lose a
 * correctly-heard lower-ranked alternative. Falls back to the unmodified
 * top alternative if the top guess already resolves cleanly, or if nothing
 * in any alternative resolves to anything chemistry-related at all - so
 * every other kind of voice command is completely unaffected by this.
 */
export function resolveBestTranscript(alternatives: string[]): string {
  const candidates = alternatives.filter(Boolean);
  if (candidates.length === 0) return "";

  const top = candidates[0];
  const topRaw = normalizeVoice(top);
  if (findTemplate(topRaw) || findElement(topRaw)) return top;
  if (!ACTION_VERBS.test(topRaw)) return top;

  for (const alt of candidates.slice(1)) {
    const raw = normalizeVoice(alt);
    if (findTemplate(raw) || findElement(raw)) return alt;
  }
  for (const alt of candidates) {
    const raw = normalizeVoice(alt);
    if (fuzzyFindTemplate(raw) || fuzzyFindElement(raw)) return alt;
  }
  return top;
}
