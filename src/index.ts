#!/usr/bin/env node
/** MCP server for the Flux API: Lineage, Search, Fetch and Account. Refuses to start without FLUX_API_KEY. */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  MAX_CHARS,
  MAX_DOCUMENTS,
  MAX_QUERIES,
  apiErrorText,
  lineageBody,
  renderAccount,
  renderFetch,
  renderLineage,
  renderSearch,
  searchBody,
  type Built,
} from "./flux.js";

const VERSION = "0.5.0"; // keep in step with package.json
const API_URL = (process.env.FLUX_API_BASE_URL ?? "https://fluxsearch.io").replace(/\/+$/, "");
const API_KEY = process.env.FLUX_API_KEY ?? "";
const TIMEOUT_MS = Number(process.env.FLUX_TIMEOUT_MS ?? "120000");

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const reply = (text: string, isError = false): Text => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError } : {}),
});

/** Call /api/v1/<path>: POST with a body, GET without. Resolves with the rendered text; throws a
 *  readable Error on failure. */
async function call(
  path: string,
  body: Record<string, unknown> | null,
  render: (json: any, headers: Headers) => string,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(API_URL + "/api/v1" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + API_KEY,
        "User-Agent": "flux-mcp/" + VERSION,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(
        "Flux did not respond within " + Math.round(TIMEOUT_MS / 1000) +
          "s. Try again, or raise FLUX_TIMEOUT_MS if it keeps happening.",
      );
    }
    throw new Error("Could not reach Flux at " + API_URL + ": " + String(e));
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Unexpected response from Flux (HTTP " + res.status + "): " + raw.slice(0, 300));
  }
  if (!res.ok) throw new Error(apiErrorText(res.status, json, res.headers.get("Retry-After")));
  return render(json, res.headers);
}

async function run(
  built: Built | { body: null },
  path: string,
  render: (json: any, headers: Headers) => string,
): Promise<Text> {
  if ("error" in built) return reply(built.error, true);
  try {
    return reply(await call(path, built.body, render));
  } catch (e) {
    return reply(e instanceof Error ? e.message : String(e), true);
  }
}

const TOOLS = [
  {
    name: "lineage",
    description:
      "Read a document or a web page and return only the passages that answer your questions, " +
      "with the people, places, organisations and dates written in where a passage needs them " +
      "(the name behind 'she', an exact date for 'last April'). Send text or a url, and the " +
      "questions in queries. Each question is a separate pass and is billed as one. Without " +
      "queries, every passage comes back, which is larger than the input. Use it to turn a long " +
      "source into grounded context.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The document to read, up to " + MAX_CHARS + " characters. Use this or url.",
        },
        url: {
          type: "string",
          description:
            "A page for Flux to fetch and read instead of text. If the site refuses, you get a " +
            "bad_request error and are not charged.",
        },
        queries: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_QUERIES,
          description:
            "The questions the passages should answer, up to " + MAX_QUERIES + ". Each is a full " +
            "pass and billed as one, so ask only what you need. Omit to get the whole document.",
        },
        query: {
          type: "string",
          description: "One question. Same as queries with a single entry.",
        },
        published: {
          type: "string",
          description:
            "When the text was published, as an ISO date (2026-03-14). Lets relative dates such " +
            "as 'last April' resolve to the right year. Not needed for a url that states its date.",
        },
        documents: {
          type: "array",
          maxItems: MAX_DOCUMENTS,
          description:
            "Several documents in one call, each with its own text or url. Use instead of " +
            "text/url. Top-level queries apply to every document unless a document has its own. " +
            "Documents that cannot be read are listed and not charged.",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              url: { type: "string" },
              queries: { type: "array", items: { type: "string" }, maxItems: MAX_QUERIES },
              published: { type: "string" },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "search",
    description:
      "Search the web and get ranked results. Pages Flux reads come back with the passages that " +
      "answer the query, with people, places, organisations and dates written in. Results it " +
      "could not read are listed with the reason. Use it to find sources; use lineage to read a " +
      "specific document or link you already have.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for." },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "Most results to return (default 10). Out-of-range values are moved inside.",
        },
        enrich: {
          type: "integer",
          minimum: 0,
          description:
            "How many results to read for passages, up to max_results (default: all). 0 returns " +
            "results without reading any pages, which is fastest.",
        },
        allowed_domains: {
          type: "array",
          items: { type: "string" },
          maxItems: 10,
          description: "Only return pages from these sites (up to 10).",
        },
        blocked_domains: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
          description: "Never return pages from these sites (up to 20).",
        },
        questions: {
          type: "array",
          items: { type: "string" },
          maxItems: 9,
          description:
            "Questions to ask every page read, such as \"Who is the chief executive?\" (up to 9). " +
            "Each page answers from its own text, or says the answer is not there. They change how " +
            "pages are read, not which are found. Billed per question per page read.",
        },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "fetch",
    description:
      "Fetch one web page and return it whole as clean markdown, with its title and published " +
      "date. Use it when you need the full page; use lineage when you only need the parts that " +
      "answer a question, which is cheaper on long pages.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "A public http or https address." } },
      required: ["url"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "account",
    description:
      "Show the Flux account balance, and roughly how many tokens of Lineage input it covers. " +
      "Free. Check it before a large job.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
] as const;

async function main(): Promise<void> {
  if (!API_KEY) {
    process.stderr.write(
      "\nflux-mcp: FLUX_API_KEY is not set.\n\n" +
        "Create a key at https://app.fluxsearch.io/keys. If you installed with\n" +
        "claude mcp add, re-run that command including:\n" +
        "  --env FLUX_API_KEY=user_sk_...\n\n",
    );
    process.exit(1);
  }

  const server = new Server({ name: "flux", version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const a = (req.params.arguments ?? {}) as Record<string, unknown>;
    switch (req.params.name) {
      case "lineage":
        return run(lineageBody(a), "/lineage", renderLineage);
      case "search":
        return run(searchBody(a), "/search", (json, headers) =>
          renderSearch(json, headers.get("X-Flux-Search-Mode")),
        );
      case "fetch":
        return run(
          typeof a.url === "string" && /^https?:\/\//i.test(a.url)
            ? { body: { url: a.url } }
            : { error: "url must be an http or https address." },
          "/fetch",
          renderFetch,
        );
      case "account":
        return run({ body: null }, "/account", renderAccount);
      default:
        return reply("Unknown tool: " + req.params.name, true);
    }
  });

  await server.connect(new StdioServerTransport());
  process.stderr.write("flux-mcp ready (api: " + API_URL + ")\n");
}

main().catch((e) => {
  process.stderr.write("flux-mcp failed to start: " + String(e) + "\n");
  process.exit(1);
});
