// JARVIS local memory graph.
//
// The graph gives semantic memory structure: entities become nodes and facts
// become typed edges. It supports entity aliases, multi-hop retrieval,
// duplicate-node merging, and deterministic contradiction resolution.
// This is local memory; it does not retrain the underlying LLM.

import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const GRAPH_FILE = path.join(DATA_DIR, "memory-graph.json");

export type MemoryNode = {
  id: string;
  label: string;
  type: "person" | "project" | "feature" | "preference" | "topic" | "concept" | "entity";
  aliases: string[];
  createdAt: string;
  updatedAt: string;
};

export type MemoryEdge = {
  id: string;
  from: string;
  relation: string;
  to: string;
  confidence: number;
  status: "active" | "superseded" | "uncertain";
  sourceMemoryId?: string;
  createdAt: string;
  updatedAt: string;
  supersedes?: string[];
};

type GraphFile = { nodes: MemoryNode[]; edges: MemoryEdge[] };
let writeQueue: Promise<unknown> = Promise.resolve();

async function readGraph(): Promise<GraphFile> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(GRAPH_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) return parsed;
  } catch { /* start empty */ }
  return { nodes: [], edges: [] };
}

async function writeGraph(graph: GraphFile): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const tmp = `${GRAPH_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(graph, null, 2), "utf8");
    await fs.rename(tmp, GRAPH_FILE);
  });
  await writeQueue;
}

function clean(value: string, max = 160): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function normalize(value: string): string {
  return clean(value, 160).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, "-");
}

function nodeId(label: string, type: MemoryNode["type"]): string {
  return `node-${type}-${slug(label) || Math.random().toString(36).slice(2, 8)}`;
}

function edgeId(from: string, relation: string, to: string): string {
  return `edge-${slug(from)}-${slug(relation)}-${slug(to)}`;
}

const EXCLUSIVE_RELATIONS = new Set([
  "HAS_NAME",
  "PREFERS",
  "DISLIKES",
  "PRIMARY_MODEL",
  "PRIMARY_LANGUAGE",
  "CURRENT_PROJECT",
]);

function relationKey(relation: string): string {
  return clean(relation, 80).toUpperCase().replace(/\s+/g, "_");
}

export type GraphCandidate = {
  subject: string;
  subjectType?: MemoryNode["type"];
  relation: string;
  object: string;
  objectType?: MemoryNode["type"];
  confidence?: number;
  memoryId?: string;
  explicitCorrection?: boolean;
};

function resolveNode(graph: GraphFile, label: string, type: MemoryNode["type"], now: string): MemoryNode {
  const wanted = normalize(label);
  let node = graph.nodes.find(n => n.type === type && (
    normalize(n.label) === wanted || n.aliases.some(a => normalize(a) === wanted)
  ));

  // A short exact label can resolve to a unique node of another type. This is
  // useful when a model first learned "JARVIS" as an entity and later as a project.
  if (!node) {
    const crossType = graph.nodes.filter(n => normalize(n.label) === wanted || n.aliases.some(a => normalize(a) === wanted));
    if (crossType.length === 1) node = crossType[0];
  }

  if (!node) {
    node = { id: nodeId(label, type), label, type, aliases: [], createdAt: now, updatedAt: now };
    graph.nodes.push(node);
  } else {
    node.updatedAt = now;
    if (node.label !== label && !node.aliases.includes(label)) node.aliases.push(label);
    node.aliases = node.aliases.slice(-20);
  }
  return node;
}

function markContradiction(graph: GraphFile, newer: MemoryEdge, old: MemoryEdge, explicit: boolean, now: string): void {
  const shouldSupersede = explicit ||
    newer.confidence >= old.confidence + 0.05 ||
    EXCLUSIVE_RELATIONS.has(newer.relation);

  if (shouldSupersede) {
    old.status = "superseded";
    old.updatedAt = now;
    old.supersedes = [...(old.supersedes ?? []), newer.id].slice(-12);
    newer.supersedes = [...(newer.supersedes ?? []), old.id].slice(-12);
  } else {
    old.status = "uncertain";
    old.updatedAt = now;
  }
}

export async function upsertRelation(candidate: GraphCandidate): Promise<MemoryEdge | null> {
  const subject = clean(candidate.subject);
  const object = clean(candidate.object);
  const relation = relationKey(candidate.relation);
  if (subject.length < 2 || object.length < 1 || !relation) return null;

  const graph = await readGraph();
  const now = new Date().toISOString();
  const confidence = Math.max(0, Math.min(1, Number(candidate.confidence ?? 0.7)));
  const from = resolveNode(graph, subject, candidate.subjectType ?? "entity", now);
  const to = resolveNode(graph, object, candidate.objectType ?? "entity", now);
  const id = edgeId(from.id, relation, to.id);
  const existing = graph.edges.find(e => e.id === id);

  if (existing) {
    existing.confidence = Math.max(existing.confidence, confidence);
    existing.status = "active";
    existing.updatedAt = now;
    if (candidate.memoryId) existing.sourceMemoryId = candidate.memoryId;
    await writeGraph(graph);
    return existing;
  }

  const edge: MemoryEdge = {
    id,
    from: from.id,
    relation,
    to: to.id,
    confidence,
    status: "active",
    sourceMemoryId: candidate.memoryId,
    createdAt: now,
    updatedAt: now,
  };

  // Only relations declared exclusive are automatically single-valued. This
  // prevents a new project from accidentally deleting older valid projects.
  const competing = graph.edges.filter(e =>
    e.from === from.id && e.relation === relation && e.to !== to.id && e.status === "active"
  );

  for (const old of competing) markContradiction(graph, edge, old, Boolean(candidate.explicitCorrection), now);

  // If there is an uncertain competitor, keep the new fact uncertain until
  // later evidence makes one side clearly stronger.
  const uncertainCompetitor = graph.edges.some(e =>
    e.from === from.id && e.relation === relation && e.to !== to.id && e.status === "uncertain"
  );
  if (uncertainCompetitor && !EXCLUSIVE_RELATIONS.has(relation) && !candidate.explicitCorrection) {
    edge.status = "uncertain";
  }

  graph.edges.push(edge);
  await writeGraph(graph);
  return edge;
}

export async function supersedeRelation(memoryId: string, replacementMemoryId?: string): Promise<number> {
  const graph = await readGraph();
  let changed = 0;
  const now = new Date().toISOString();
  for (const edge of graph.edges) {
    if (edge.sourceMemoryId === memoryId && edge.status !== "superseded") {
      edge.status = "superseded";
      edge.updatedAt = now;
      if (replacementMemoryId) edge.supersedes = [...(edge.supersedes ?? []), replacementMemoryId].slice(-12);
      changed++;
    }
  }
  if (changed) await writeGraph(graph);
  return changed;
}

/** Merge two duplicate entities while preserving all edges and aliases. */
export async function mergeNodes(sourceId: string, targetId: string): Promise<boolean> {
  if (sourceId === targetId) return false;
  const graph = await readGraph();
  const source = graph.nodes.find(n => n.id === sourceId);
  const target = graph.nodes.find(n => n.id === targetId);
  if (!source || !target) return false;
  const now = new Date().toISOString();

  target.aliases = [...new Set([
    ...target.aliases,
    source.label,
    ...source.aliases,
  ])].filter(a => normalize(a) !== normalize(target.label)).slice(-30);
  target.updatedAt = now;

  for (const edge of graph.edges) {
    if (edge.from === sourceId) edge.from = targetId;
    if (edge.to === sourceId) edge.to = targetId;
  }

  // Re-key and collapse duplicate edges after the merge.
  const deduped = new Map<string, MemoryEdge>();
  for (const edge of graph.edges) {
    edge.id = edgeId(edge.from, edge.relation, edge.to);
    const existing = deduped.get(edge.id);
    if (!existing || edge.confidence > existing.confidence) deduped.set(edge.id, edge);
  }
  graph.edges = [...deduped.values()];
  graph.nodes = graph.nodes.filter(n => n.id !== sourceId);
  await writeGraph(graph);
  return true;
}

/** Merge nodes that are exact normalized duplicates or aliases. */
export async function mergeDuplicateNodes(): Promise<number> {
  const graph = await readGraph();
  const groups = new Map<string, MemoryNode[]>();
  for (const node of graph.nodes) {
    const key = `${node.type}:${normalize(node.label)}`;
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }
  let merged = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [target, ...rest] = group.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const source of rest) {
      // Inline merge so we do one final disk write below.
      target.aliases = [...new Set([...target.aliases, source.label, ...source.aliases])]
        .filter(a => normalize(a) !== normalize(target.label)).slice(-30);
      for (const edge of graph.edges) {
        if (edge.from === source.id) edge.from = target.id;
        if (edge.to === source.id) edge.to = target.id;
      }
      graph.nodes = graph.nodes.filter(n => n.id !== source.id);
      merged++;
    }
  }
  if (merged) {
    const deduped = new Map<string, MemoryEdge>();
    for (const edge of graph.edges) {
      edge.id = edgeId(edge.from, edge.relation, edge.to);
      const existing = deduped.get(edge.id);
      if (!existing || edge.confidence > existing.confidence) deduped.set(edge.id, edge);
    }
    graph.edges = [...deduped.values()];
    await writeGraph(graph);
  }
  return merged;
}

function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(/\s+/).filter(t => t.length >= 2));
}

function nodeScore(node: MemoryNode, terms: Set<string>): number {
  const nodeTerms = tokenSet(`${node.label} ${node.aliases.join(" ")}`);
  let score = 0;
  for (const term of terms) if (nodeTerms.has(term)) score += 2;
  if (normalize(node.label) === [...terms].join(" ")) score += 5;
  return score;
}

/**
 * Retrieve a connected subgraph up to `depth` hops from query matches.
 * This is what lets JARVIS reason across separate memories:
 * Rajdeep -> WORKS_ON -> JARVIS MARK 7 -> HAS_FEATURE -> Orb.
 */
export async function searchGraph(query: string, limit = 24, depth = 3): Promise<{ nodes: MemoryNode[]; edges: MemoryEdge[] }> {
  const graph = await readGraph();
  const terms = tokenSet(query);
  if (!terms.size) return { nodes: [], edges: [] };

  const scored = graph.nodes
    .map(node => ({ node, score: nodeScore(node, terms) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (!scored.length) return { nodes: [], edges: [] };

  const selected = new Set(scored.map(x => x.node.id));
  const distance = new Map<string, number>(scored.map(x => [x.node.id, 0]));
  const edges: MemoryEdge[] = [];
  let frontier = [...selected];

  for (let hop = 0; hop < Math.max(1, Math.min(depth, 5)); hop++) {
    const frontierSet = new Set(frontier);
    const next: string[] = [];
    for (const edge of graph.edges) {
      if (edge.status === "superseded") continue;
      const touches = frontierSet.has(edge.from) || frontierSet.has(edge.to);
      if (!touches) continue;
      if (!edges.some(e => e.id === edge.id)) edges.push(edge);

      const neighbors = frontierSet.has(edge.from) ? [edge.to] : [edge.from];
      for (const neighbor of neighbors) {
        if (!selected.has(neighbor)) {
          selected.add(neighbor);
          distance.set(neighbor, hop + 1);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }

  const byDistance = (id: string) => distance.get(id) ?? 99;
  const nodes = graph.nodes
    .filter(n => selected.has(n.id))
    .sort((a, b) => byDistance(a.id) - byDistance(b.id))
    .slice(0, limit + 60);

  // Keep graph context bounded. Prefer active/high-confidence/short-hop edges.
  edges.sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.confidence - a.confidence);
  return { nodes, edges: edges.slice(0, limit * 5) };
}

export async function renderGraphContext(query: string, depth = 3): Promise<string> {
  const graph = await searchGraph(query, 16, depth);
  if (!graph.nodes.length) return "";
  const byId = new Map(graph.nodes.map(n => [n.id, n.label]));
  const lines = graph.edges.map(e => {
    const from = byId.get(e.from) ?? e.from;
    const to = byId.get(e.to) ?? e.to;
    return `- ${from} --${e.relation}--> ${to} [${e.status}; confidence ${e.confidence.toFixed(2)}]`;
  });
  return lines.length
    ? `Connected local knowledge graph (up to ${depth} hops):\n${lines.join("\n")}`
    : `Related entities: ${graph.nodes.map(n => n.label).join(", ")}`;
}

export async function graphStats() {
  const graph = await readGraph();
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    activeEdges: graph.edges.filter(e => e.status === "active").length,
    uncertainEdges: graph.edges.filter(e => e.status === "uncertain").length,
    supersededEdges: graph.edges.filter(e => e.status === "superseded").length,
    file: GRAPH_FILE,
  };
}

export async function exportGraph() {
  return readGraph();
}
