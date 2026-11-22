/**
 * Pure helpers for the Flux API: build request bodies, turn responses into text for the
 * model, and explain errors. No I/O here, so it can be tested without the network.
 *
 * Shapes follow the OpenAPI document at https://fluxsearch.io/api-reference/openapi.json.
 * Only the fields this server reads are typed.
 */

export const MAX_CHARS = 60000;
export const MAX_DOCUMENTS = 100;
export const MAX_QUERIES = 10;
const MAX_ALLOWED_DOMAINS = 10;
const MAX_BLOCKED_DOMAINS = 20;

// ---- Response types -------------------------------------------------------------------------

interface Annotation {
  type: string;
  text: string;
  canonical: string | null;
}
interface LineageResult {
  source_id: string;
  text: string;
  enriched_text: string;
  enrichment: string;
  score: number | null;
  /** Left out by the API when a passage names nothing. */
  annotations?: Annotation[];
}
interface LineageSource {
  id: string;
  url: string | null;
  published_at: string | null;
  input_tokens: number;
}
interface Selection {
  threshold: number | null;
  considered: number;
  returned: number;
  examined_tokens: number;
  enriched_results: number;
  retained_ratio: number;
}
interface LineageUsage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: string;
}
export interface LineageResponse {
  query: string | null;
  sources: LineageSource[];
  results: LineageResult[];
  selection: Selection;
  usage: LineageUsage;
}
interface DocumentError {
  document_index: number;
  code: string;
  message: string;
  url: string | null;
}
export interface LineageList {
  object: "list";
  data: (LineageResponse & { document_index?: number })[];
  usage?: LineageUsage;
  errors?: DocumentError[];
}

export interface FetchResponse {
  url: string;
  title: string;
  published_at: string | null;
  markdown: string;
  usage: { fetches: number; cost_usd: string };
}

export interface AccountResponse {
  balance: { usd: string; usd_ticks: number; input_tokens: number };
}

interface SearchResult {
  rank: number;
  url: string;
  title: string;
  published_at: string | null;
  snippet: string;
  enrichment: string;
  lineage: { results: LineageResult[]; selection: Selection } | null;
}
export interface SearchResponse {
  query: string;
  results: SearchResult[];
  answer: { text: string; url: string | null } | null;
  filters: { allowed_domains?: string[]; blocked_domains?: string[] } | null;
  related_queries: string[];
  usage: {
    searches: number;
    results_returned: number;
    results_enriched: number;
    cost_usd: string;
  };
}

// ---- Request bodies -------------------------------------------------------------------------

export type Built = { body: Record<string, unknown> } | { error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** `queries` as the API takes it: a list of up to ten. The older single `query` is one entry. */
function queryList(a: Record<string, unknown>, where: string): string[] | { error: string } | undefined {
  if (a.queries !== undefined) {
    if (!Array.isArray(a.queries) || a.queries.length === 0 || a.queries.some((q) => !nonEmpty(q))) {
      return { error: where + "queries must be a non-empty array of questions." };
    }
    if (a.queries.length > MAX_QUERIES) {
      return {
        error: where + "queries has " + a.queries.length + " questions; the limit is " + MAX_QUERIES + ".",
      };
    }
    return a.queries as string[];
  }
  return nonEmpty(a.query) ? [a.query] : undefined;
}

export function lineageBody(a: Record<string, unknown>): Built {
  const body: Record<string, unknown> = {};
  const queries = queryList(a, "");
  if (queries && !Array.isArray(queries)) return queries;
  if (queries) body.queries = queries;
  if (nonEmpty(a.published)) body.published = a.published;

  if (a.documents !== undefined) {
    if (!Array.isArray(a.documents) || a.documents.length === 0) {
      return { error: "documents must be a non-empty array of {text} or {url} objects." };
    }
    if (a.documents.length > MAX_DOCUMENTS) {
      return {
        error:
          "documents has " + a.documents.length + " entries; the limit is " +
          MAX_DOCUMENTS + " per call. Split it and call again.",
      };
    }
    for (const [i, d] of a.documents.entries()) {
      if (!isRecord(d) || (!nonEmpty(d.text) && !nonEmpty(d.url))) {
        return { error: "documents[" + i + "] needs a text or a url." };
      }
      if (typeof d.text === "string" && d.text.length > MAX_CHARS) {
        return { error: "documents[" + i + "].text is over " + MAX_CHARS + " characters." };
      }
      const own = queryList(d, "documents[" + i + "].");
      if (own && !Array.isArray(own)) return own;
    }
    body.documents = (a.documents as Record<string, unknown>[]).map((d) => {
      const own = queryList(d, "");
      const { query: _query, ...rest } = d;
      return Array.isArray(own) ? { ...rest, queries: own } : rest;
    });
    return { body };
  }

  const hasText = nonEmpty(a.text);
  const hasUrl = nonEmpty(a.url);
  if (hasText === hasUrl) {
    return { error: "Send exactly one of text or url (or documents for several)." };
  }
  if (hasText) {
    const text = a.text as string;
    if (text.length > MAX_CHARS) {
      return {
        error:
          "Document is " + text.length + " characters; the limit is " + MAX_CHARS +
          ". Split it and call again, or send documents.",
      };
    }
    body.text = text;
  } else {
    body.url = a.url;
  }
  return { body };
}

function domainList(v: unknown, name: string, max: number): string[] | { error: string } | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((d) => !nonEmpty(d))) {
    return { error: name + " must be an array of domain names." };
  }
  if (v.length > max) return { error: name + " takes at most " + max + " domains." };
  return v as string[];
}

export function searchBody(a: Record<string, unknown>): Built {
  if (!nonEmpty(a.query)) return { error: "query is required and must not be empty." };
  const body: Record<string, unknown> = { query: a.query };
  if (typeof a.max_results === "number") body.max_results = a.max_results;
  if (typeof a.enrich === "number") {
    if (!Number.isInteger(a.enrich) || a.enrich < 0) {
      return { error: "enrich must be a whole number, 0 or more." };
    }
    body.enrich = a.enrich;
  }

  const allowed = domainList(a.allowed_domains, "allowed_domains", MAX_ALLOWED_DOMAINS);
  const blocked = domainList(a.blocked_domains, "blocked_domains", MAX_BLOCKED_DOMAINS);
  for (const l of [allowed, blocked]) if (l && !Array.isArray(l)) return l;
  const filters: Record<string, unknown> = {};
  if (allowed) filters.allowed_domains = allowed;
  if (blocked) filters.blocked_domains = blocked;
  if (Object.keys(filters).length > 0) body.filters = filters;
  return { body };
}

// ---- Rendering ------------------------------------------------------------------------------

const pct = (ratio: number) => Math.round(ratio * 100) + "%";

/** A cost as people read it: "$0.0042", "$1.20". The API sends ten decimal places. */
export function money(costUsd: string): string {
  const n = Number(costUsd);
  if (!Number.isFinite(n)) return "$" + costUsd;
  if (n === 0) return "$0";
  return "$" + (n >= 0.01 ? n.toFixed(2) : n.toPrecision(2).replace(/0+$/, ""));
}

/** The distinct things a passage mentions, with any resolution shown as `she -> Jane Doe`. */
function mentions(annotations: Annotation[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of annotations) {
    const resolved = a.canonical && a.canonical.toLowerCase() !== a.text.toLowerCase();
    const label = resolved ? a.text + " -> " + a.canonical : a.text;
    const key = a.type + "|" + label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a.type + ": " + label);
  }
  return out;
}

function passage(r: LineageResult, n: number, indent = ""): string[] {
  const score = r.score !== null ? " [relevance " + r.score.toFixed(2) + "]" : "";
  const lines = [indent + n + "." + score, indent + r.enriched_text];
  const m = mentions(r.annotations ?? []);
  if (m.length > 0) lines.push(indent + "  (" + m.join("; ") + ")");
  return lines;
}

function renderOneLineage(r: LineageResponse): string {
  const out: string[] = [];
  const s = r.selection;
  const u = r.usage;

  out.push(r.query ? 'Lineage for: "' + r.query + '"' : "Lineage (no question: whole document)");
  for (const src of r.sources) {
    out.push(
      "Source " + src.id + ": " + (src.url ?? "text you sent") +
        (src.published_at ? ", published " + src.published_at : "") +
        ", " + src.input_tokens + " tokens",
    );
  }

  out.push(
    s.threshold === null
      ? "Returned all " + s.returned + " passages (no question, so nothing was filtered)."
      : "Kept " + s.returned + " of " + s.considered + " passages that answer the question.",
  );
  if (s.examined_tokens < u.input_tokens) {
    out.push(
      "\nWARNING: only the first " + s.examined_tokens + " of " + u.input_tokens +
        " tokens were read. The end of the document was not examined.",
    );
  }

  out.push("\n=== Passages (" + r.results.length + ") ===");
  r.results.forEach((p, i) => {
    out.push("");
    out.push(...passage(p, i + 1));
  });

  out.push(
    "\nContext added to " + s.enriched_results + " of " + s.returned + " passages. " +
      "Output is " + pct(s.retained_ratio) + " of the input size. " +
      "Cost " + money(u.cost_usd) + " (" + u.input_tokens + " tokens read).",
  );
  return out.join("\n");
}

export function renderLineage(r: LineageResponse | LineageList): string {
  if ("object" in r && r.object === "list") {
    const out = r.data.map(
      (d, i) =>
        "##### Pass " + (i + 1) + " of " + r.data.length +
        (d.document_index !== undefined ? " (document " + d.document_index + ")" : "") +
        " #####\n" + renderOneLineage(d),
    );
    const errors = r.errors ?? [];
    if (errors.length > 0) {
      out.push(
        "##### Not read (" + errors.length + ", not charged) #####\n" +
          errors
            .map((e) => "document " + e.document_index + (e.url ? " " + e.url : "") + ": " + e.code + ", " + e.message)
            .join("\n"),
      );
    }
    if (r.usage) out.push("Total cost " + money(r.usage.cost_usd) + " for " + r.data.length + " passes.");
    return out.join("\n\n");
  }
  return renderOneLineage(r as LineageResponse);
}

const NOT_READ: Record<string, string> = {
  skipped: "not read (a PDF, an unreachable page, or past the number of pages asked for)",
  pending: "not read yet (ran out of time; asking again may read it)",
};

export function renderSearch(r: SearchResponse, mode: string | null): string {
  const out: string[] = [];
  out.push('Search: "' + r.query + '" - ' + r.results.length + " results");

  if (mode) {
    out.push(
      '\nWARNING: search ran in degraded "' + mode + '" mode, so ranking or coverage may be reduced.',
    );
  }
  if (r.filters) {
    const f = r.filters;
    const parts: string[] = [];
    if (f.allowed_domains?.length) parts.push("only " + f.allowed_domains.join(", "));
    if (f.blocked_domains?.length) parts.push("never " + f.blocked_domains.join(", "));
    if (parts.length > 0) out.push("Filters: " + parts.join("; "));
  }
  if (r.answer) {
    out.push("\nDirect answer: " + r.answer.text + (r.answer.url ? " (" + r.answer.url + ")" : ""));
  }

  for (const res of r.results) {
    out.push(
      "\n" + res.rank + ". " + (res.title || res.url) + "\n   " + res.url +
        (res.published_at ? " (published " + res.published_at + ")" : ""),
    );
    if (res.snippet) out.push("   " + res.snippet);
    if (res.lineage && res.lineage.results.length > 0) {
      out.push("   Passages read from this page:");
      res.lineage.results.forEach((p, i) => out.push(...passage(p, i + 1, "   ")));
    } else if (NOT_READ[res.enrichment]) {
      out.push("   [" + NOT_READ[res.enrichment] + "]");
    }
  }

  if (r.related_queries.length > 0) out.push("\nRelated searches: " + r.related_queries.join("; "));
  const u = r.usage;
  out.push(
    "\n" + u.searches + " search billed, " + u.results_enriched + " of " + u.results_returned +
      " results read. Cost " + money(u.cost_usd) + ".",
  );
  return out.join("\n");
}

/** Pages longer than this come back cut, with a note, so one fetch cannot flood the context. */
export const MAX_FETCH_CHARS = 100000;

export function renderFetch(r: FetchResponse): string {
  const cut = r.markdown.length > MAX_FETCH_CHARS;
  return [
    (r.title || r.url) + "\n" + r.url + (r.published_at ? " (published " + r.published_at + ")" : ""),
    "",
    cut ? r.markdown.slice(0, MAX_FETCH_CHARS) : r.markdown,
    "",
    (cut
      ? "[Cut at " + MAX_FETCH_CHARS + " of " + r.markdown.length + " characters. Use lineage with a question to read the rest selectively.]\n"
      : "") + "Cost " + money(r.usage.cost_usd) + ".",
  ].join("\n");
}

export function renderAccount(r: AccountResponse): string {
  const b = r.balance;
  return (
    "Balance $" + Number(b.usd).toFixed(2) + ", enough for about " +
    b.input_tokens.toLocaleString("en-US") + " tokens of Lineage input."
  );
}

// ---- Errors ---------------------------------------------------------------------------------

const HINTS: Record<string, string> = {
  unauthorized:
    "Check FLUX_API_KEY. Keys start with user_sk_ or org_sk_ and are created at " +
    "https://app.fluxsearch.io/keys. The key may have been revoked.",
  insufficient_credits:
    "The Flux account balance is too low for this request. Do not retry: tell the user to " +
    "add credit at https://app.fluxsearch.io, then try again.",
  bad_request: "Fix the request; sending it unchanged fails the same way.",
  fetch_failed:
    "The site refused automated access or the page had no readable text. Try another source.",
  idempotency_in_progress: "The same request is still running. Wait a moment and retry.",
  not_found: "That resource does not exist.",
  upstream_error: "A problem on the Flux side. Try again shortly.",
  search_unavailable: "The search index is unavailable. Try again shortly.",
  not_configured: "The service is not available right now. Try again shortly.",
};

/** Explain a non-2xx response. Every documented error is unbilled, and the text says so. */
export function apiErrorText(status: number, body: unknown, retryAfter: string | null): string {
  const err = isRecord(body) && isRecord(body.error) ? body.error : null;
  const code = typeof err?.code === "string" ? err.code : "http_" + status;
  const message = typeof err?.message === "string" ? err.message : "HTTP " + status;

  let hint = HINTS[code] ?? "";
  if (code === "rate_limited") {
    hint = "Too many requests. Wait" + (retryAfter ? " " + retryAfter + " seconds" : " a moment") + " and retry.";
  }
  // The API documents every one of its error codes as unbilled; an unknown code is not promised.
  const unbilled = code in HINTS || code === "rate_limited";
  return (
    "Flux API error " + code + " (HTTP " + status + "): " + message +
    (hint ? "\n" + hint : "") + (unbilled ? "\nNothing was charged for this request." : "")
  );
}
