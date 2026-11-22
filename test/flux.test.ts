import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_CHARS,
  apiErrorText,
  lineageBody,
  money,
  renderAccount,
  renderLineage,
  renderSearch,
  searchBody,
} from "../src/flux.js";

const selection = {
  threshold: 0.5,
  considered: 8,
  returned: 1,
  examined_tokens: 400,
  enriched_results: 1,
  retained_ratio: 0.12,
};
const passageResult = {
  source_id: "s1",
  text: "She said prices rose.",
  enriched_text: "She [Jane Doe] said prices rose [Apr 2025].",
  enrichment: "inline",
  score: 0.91,
  annotations: [
    { type: "person", text: "She", canonical: "Jane Doe" },
    { type: "time", text: "Apr", canonical: "2025-04" },
  ],
};

test("lineage: needs exactly one of text, url or documents", () => {
  assert.ok("error" in lineageBody({}));
  assert.ok("error" in lineageBody({ text: "a", url: "https://x.test" }));
  assert.deepEqual(lineageBody({ url: "https://x.test", query: "why?" }), {
    body: { queries: ["why?"], url: "https://x.test" },
  });
  assert.ok("error" in lineageBody({ text: "x".repeat(MAX_CHARS + 1) }));
  assert.ok("error" in lineageBody({ documents: [{}] }));
  assert.ok("body" in lineageBody({ documents: [{ text: "a" }, { url: "https://x.test" }] }));
});

test("search: query required, filters are nested", () => {
  assert.ok("error" in searchBody({ query: "  " }));
  assert.ok("error" in searchBody({ query: "q", enrich: -1 }));
  assert.deepEqual(
    searchBody({ query: "q", max_results: 5, enrich: 0, blocked_domains: ["a.test"] }),
    { body: { query: "q", max_results: 5, enrich: 0, filters: { blocked_domains: ["a.test"] } } },
  );
});

test("errors: a 402 tells the agent to stop and says nothing was charged", () => {
  const text = apiErrorText(402, { error: { code: "insufficient_credits", message: "low" } }, null);
  assert.match(text, /insufficient_credits \(HTTP 402\)/);
  assert.match(text, /Do not retry/);
  assert.match(text, /Nothing was charged/);
});

test("errors: 429 passes on Retry-After, 401 points at FLUX_API_KEY, unknown codes are not promised free", () => {
  assert.match(apiErrorText(429, { error: { code: "rate_limited", message: "x" } }, "12"), /12 seconds/);
  assert.match(apiErrorText(401, { error: { code: "unauthorized", message: "x" } }, null), /FLUX_API_KEY/);
  assert.doesNotMatch(apiErrorText(500, "oops", null), /Nothing was charged/);
});

test("lineage render: shows context added, resolutions and a truncation warning", () => {
  const text = renderLineage({
    query: "why did prices rise?",
    sources: [{ id: "s1", url: "https://x.test/a", published_at: null, input_tokens: 900 }],
    results: [passageResult],
    selection,
    usage: { input_tokens: 900, output_tokens: 108, cost_usd: "0.0000900000" },
  });
  assert.match(text, /She \[Jane Doe\] said prices rose/);
  assert.match(text, /She -> Jane Doe/);
  assert.match(text, /only the first 400 of 900 tokens/);
  assert.match(text, /Kept 1 of 8 passages/);
});

test("lineage render: a batch is labelled per document", () => {
  const one = {
    query: null,
    sources: [],
    results: [],
    selection: { ...selection, threshold: null, returned: 0 },
    usage: { input_tokens: 10, output_tokens: 0, cost_usd: "0" },
  };
  const text = renderLineage({ object: "list", data: [one, one] });
  assert.match(text, /Pass 1 of 2/);
  assert.match(text, /Pass 2 of 2/);
});

test("search render: answer, passages, unread results and degraded mode", () => {
  const text = renderSearch(
    {
      query: "uk inflation",
      answer: { text: "3.1%", url: "https://ons.test" },
      filters: { blocked_domains: ["spam.test"] },
      related_queries: ["uk cpi forecast"],
      results: [
        {
          rank: 1, url: "https://a.test", title: "A", published_at: "2026-10-01",
          snippet: "snip", enrichment: "inline",
          lineage: { results: [passageResult], selection },
        },
        {
          rank: 2, url: "https://b.test", title: "B", published_at: null,
          snippet: "", enrichment: "pending", lineage: null,
        },
      ],
      usage: { searches: 1, results_returned: 2, results_enriched: 1, cost_usd: "0.005" },
    },
    "fallback",
  );
  assert.match(text, /degraded "fallback" mode/);
  assert.match(text, /Direct answer: 3.1%/);
  assert.match(text, /She \[Jane Doe\]/);
  assert.match(text, /asking again may read it/);
  assert.match(text, /Related searches: uk cpi forecast/);
});

test("lineage: queries as a list, the single query as one entry, per-document queries", () => {
  assert.deepEqual(lineageBody({ text: "t", queries: ["a", "b"], published: "2026-03-14" }), {
    body: { queries: ["a", "b"], published: "2026-03-14", text: "t" },
  });
  assert.ok("error" in lineageBody({ text: "t", queries: [] }));
  assert.ok("error" in lineageBody({ text: "t", queries: Array.from({ length: 11 }, (_, i) => "q" + i) }));
  assert.deepEqual(
    lineageBody({ queries: ["shared"], documents: [{ url: "https://a.test" }, { text: "b", query: "own" }] }),
    { body: { queries: ["shared"], documents: [{ url: "https://a.test" }, { text: "b", queries: ["own"] }] } },
  );
});

test("a list response shows unread documents, uncharged, and the total", () => {
  const pass = {
    query: "q", document_index: 0, sources: [], results: [], selection: { ...selection, returned: 0 },
    usage: { input_tokens: 10, output_tokens: 0, cost_usd: "0.0000100000" },
  };
  const text = renderLineage({
    object: "list",
    data: [pass],
    usage: { input_tokens: 10, output_tokens: 0, cost_usd: "0.0000100000" },
    errors: [{ document_index: 1, code: "fetch_failed", message: "The site blocked automated access.", url: "https://b.test" }],
  });
  assert.match(text, /Not read \(1, not charged\)/);
  assert.match(text, /document 1 https:\/\/b.test: fetch_failed/);
  assert.match(text, /Total cost \$0\.00001 for 1 passes/);
});

test("money reads as people write it", () => {
  assert.equal(money("0.0042060000"), "$0.0042");
  assert.equal(money("1.2000000000"), "$1.20");
  assert.equal(money("0"), "$0");
  assert.match(renderAccount({ balance: { usd: "4.5000000000", usd_ticks: 45000000000, input_tokens: 9000000 } }), /\$4\.50.*9,000,000 tokens/);
});

test("lineage render: a passage with no annotations key renders", () => {
  const { annotations: _gone, ...bare } = passageResult;
  const text = renderLineage({
    query: "why did prices rise?",
    sources: [{ id: "s1", url: "https://x.test/a", published_at: null, input_tokens: 900 }],
    results: [bare],
    selection,
    usage: { input_tokens: 900, output_tokens: 108, cost_usd: "0.0000900000" },
  });
  assert.match(text, /She \[Jane Doe\] said prices rose/);
});
