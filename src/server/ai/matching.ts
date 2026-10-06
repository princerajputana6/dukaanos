/**
 * Name matching used by the entity resolver. Pure & deterministic.
 * Signals: exact name → alias → token coverage (prefix / phonetic) → trigram similarity.
 */
import { normalizeText, osaDistance, phoneticKey, trigramSimilarity } from "@/lib/text";

export interface MatchCandidate<T> {
  value: T;
  name: string;
  aliases: string[];
  /** Tie-breaker only (e.g. recent sales); never turns an ambiguous match into a guess. */
  popularity?: number;
}

export interface Scored<T> {
  value: T;
  name: string;
  score: number;
  via: "exact" | "alias" | "tokens" | "fuzzy";
}

function tokenScore(qt: string, nt: string): number {
  if (qt === nt) return 1;
  if (/^\d/.test(qt) || /^\d/.test(nt)) return 0; // sizes must match exactly
  if (qt.length >= 3 && nt.startsWith(qt)) return 0.9;
  const pq = phoneticKey(qt);
  if (pq.length >= 2 && pq === phoneticKey(nt)) return 0.85;
  // Typos: one edit for 4+ letters, two for 8+ ("spirte" → "sprite").
  if (qt.length >= 4 && nt.length >= 4) {
    const dist = osaDistance(qt, nt);
    if (dist === 1 || (dist === 2 && qt.length >= 8)) return 0.82;
  }
  const tri = trigramSimilarity(qt, nt);
  return tri >= 0.55 ? tri * 0.8 : 0;
}

/** Scores how well `query` matches a single name, 0..1. */
export function scoreName(query: string, name: string): number {
  const q = normalizeText(query);
  const n = normalizeText(name);
  if (!q || !n) return 0;
  if (q === n) return 1;
  const qTokens = q.split(" ");
  const nTokens = n.split(" ");
  const used = new Set<number>();
  let qSum = 0;
  for (const qt of qTokens) {
    let best = 0;
    let bestIdx = -1;
    nTokens.forEach((nt, idx) => {
      if (used.has(idx)) return;
      const s = tokenScore(qt, nt);
      if (s > best) {
        best = s;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0 && best > 0) used.add(bestIdx);
    qSum += best;
  }
  const qCoverage = qSum / qTokens.length;
  // Unmatched *size/number* tokens in the name don't count against a match on the base
  // name (so "Coke" still matches "Coke 500ml"), but other extra words do a little.
  const nameWords = nTokens.filter((t) => !/^\d/.test(t) && !["ml", "l", "g", "kg", "gm", "pcs"].includes(t));
  const nameWordsMatched = nameWords.filter((t) => [...used].some((i) => nTokens[i] === t)).length;
  const nCoverage = nameWords.length ? nameWordsMatched / nameWords.length : 1;
  const tokens = Math.min(0.96, 0.8 * qCoverage + 0.16 * nCoverage);
  const fuzzy = trigramSimilarity(q, n) * 0.85;
  return Math.max(tokens, fuzzy);
}

export function rankCandidates<T>(query: string, candidates: MatchCandidate<T>[]): Scored<T>[] {
  const qn = normalizeText(query);
  const out: Scored<T>[] = [];
  for (const c of candidates) {
    let score = scoreName(query, c.name);
    let via: Scored<T>["via"] = score === 1 ? "exact" : score >= 0.8 ? "tokens" : "fuzzy";
    for (const a of c.aliases) {
      if (normalizeText(a) === qn && score < 0.97) {
        score = 0.97;
        via = "alias";
      } else {
        const s = scoreName(query, a) * 0.95;
        if (s > score) {
          score = s;
          via = "alias";
        }
      }
    }
    if (score > 0.3) out.push({ value: c.value, name: c.name, score, via });
  }
  const pop = new Map(candidates.map((c) => [c.value, c.popularity ?? 0]));
  return out.sort((a, b) => b.score - a.score || (pop.get(b.value) ?? 0) - (pop.get(a.value) ?? 0) || a.name.localeCompare(b.name));
}

export type Resolution<T> =
  | { status: "resolved"; match: Scored<T> }
  | { status: "ambiguous"; options: Scored<T>[] }
  | { status: "not_found"; suggestions: Scored<T>[] };

export const RESOLVE_THRESHOLD = 0.72;
const AMBIGUITY_MARGIN = 0.05;

/**
 * Decides whether a query identifies exactly one candidate. Two candidates scoring within
 * the ambiguity margin are ALWAYS returned as options — the system never guesses.
 */
export function resolveOne<T>(query: string, candidates: MatchCandidate<T>[]): Resolution<T> {
  const ranked = rankCandidates(query, candidates);
  const top = ranked[0];
  if (!top || top.score < RESOLVE_THRESHOLD) {
    return { status: "not_found", suggestions: ranked.filter((r) => r.score >= 0.45).slice(0, 4) };
  }
  const close = ranked.filter((r) => r.score >= top.score - AMBIGUITY_MARGIN);
  if (close.length > 1 && top.score < 1) return { status: "ambiguous", options: ranked.filter((r) => r.score >= top.score - 0.12).slice(0, 5) };
  if (close.length > 1 && top.score === 1 && close.filter((c) => c.score === 1).length > 1) {
    return { status: "ambiguous", options: close.slice(0, 5) };
  }
  return { status: "resolved", match: top };
}
