---
name: flux-codex
description: Search the web, fetch pages and read documents, files or links with Flux. Use when a user asks for current information with sources, or for the passages in an article, report, transcript or URL that answer a question, with people, places, organisations and dates spelled out, and the Flux MCP tools are available.
---

# Flux for Codex

Use the tools from the `flux` MCP server. Do not replace them with a guess or your own summary: the passage selection and the resolved names and dates are the point of the integration.

- `search` finds pages and returns ranked results. Pages Flux reads come back with the passages that answer the query.
- `lineage` reads one document or link and returns only the passages that answer your questions, with context written in.
- `fetch` returns one web page whole, as clean markdown.
- `account` shows the balance. It is free.

## Check the tools

If the tools are unavailable, say that the Flux MCP server is not connected and stop. For a local Codex client, suggest registering it:

```bash
codex mcp add flux --env FLUX_API_KEY=user_sk_YOUR_KEY -- npx -y github:Flux-Search/flux-MCP
```

The key begins with `user_sk_` or `org_sk_` and is created at https://app.fluxsearch.io/keys. Do not ask the user to paste the key into the conversation.

If the server starts with `FLUX_API_KEY is not set`, register the key again. In PowerShell, this keeps it out of the shell history:

```powershell
$key = Read-Host "Flux API key"
codex mcp remove flux
codex mcp add flux --env "FLUX_API_KEY=$key" -- npx -y github:Flux-Search/flux-MCP
Remove-Variable key
```

`--env` stores the key in Codex's local configuration, so never commit or share that file. `codex mcp list` only confirms the server is configured; use `codex mcp get flux`, then start a new session after changing the registration.

For Codex Cloud, use a project-scoped `.codex/config.toml` and supply `FLUX_API_KEY` as a Cloud environment secret:

```toml
[mcp_servers.flux]
command = "npx"
args = ["-y", "github:Flux-Search/flux-MCP"]
env_vars = ["FLUX_API_KEY"]
tool_timeout_sec = 150
startup_timeout_sec = 30
```

`env_vars` forwards an existing variable; it does not create one. `Enabled` with `Auth unsupported` is expected, because the server takes an API key from the environment and does not implement OAuth.

## Pick the tool and the input

- To find something, or answer a question about the current world: `search`.
- For a link or a document the user gave you: `lineage`.
- For the whole page, unfiltered: `fetch`. For a long page and a specific question, `lineage` returns less to read.
- Before a job of many documents or questions: `account`.
- For a local file, read it and pass its contents as `text`.
- For a URL, pass it as `url`. Flux fetches the page itself, so do not retrieve it first. If the site refuses, the call fails and is not charged; report that instead of analysing a stub.

Put the questions for `lineage` in `queries`, up to 10. Each is a full pass and is billed as one, so ask only what the user needs. Without questions, every passage comes back and the result is longer than the input, which is expected when the user wants every person, place or date.

Pass `published` (an ISO date) with pasted text when you know it, so relative dates such as "last April" resolve to the right year.

For many documents, send `documents` (up to 100) in one call. Documents that could not be read are listed under "Not read" and cost nothing; report them.

For `search`, `enrich: 0` returns links without reading pages and is the fastest. Use `allowed_domains` or `blocked_domains` when the user names sites to trust or avoid.

## Read and report the result

Each passage is its text with context written in, such as `She [Jane Doe] said prices rose [Apr 2025]`. Use it as grounded context in later prompts. The mentions under it show what a passage names; point out arrows such as `she -> Jane Doe`, which show a vague mention resolved to a name or date. Do not claim more certainty than the result supports. Relevance scores are only comparable within one document. Cite the source URL and date.

Relay every warning:

- "only the first N of M tokens were read": the end of the document was not examined;
- "search ran in degraded mode": ranking or coverage may be reduced;
- a result marked "not read" has no passages; a `pending` one ran out of time and a retry may read it;
- a fetched page "cut at 100000 characters": the rest was not returned.

## Cost

Every result ends with its cost. `lineage` is billed by the tokens it reads, once per question. `search` and `fetch` are flat prices. `account` is free, and errors are never charged. Prices are at https://fluxsearch.io/pricing.

## Errors

- `insufficient_credits` (402): the balance is too low. Stop, tell the user to add credit at https://app.fluxsearch.io, and do not retry.
- `rate_limited` (429): wait the stated seconds and retry once.
- `unauthorized` (401): the key is wrong or revoked.
- `bad_request` (400): fix the request; sending it unchanged fails the same way.
- `fetch_failed` (502): the site refused or the page had no text; try another source.
- `upstream_error`, `not_configured`, `search_unavailable`: try again once.

## Limits

- 60,000 characters of `text` per document. Split longer ones at logical boundaries, or use `documents`.
- 10 questions per document, 100 documents per call. `search` returns at most 20 results.
- If a call times out, retry once. If it keeps happening, raise the Codex `tool_timeout_sec` and `FLUX_TIMEOUT_MS`.

## Example workflow

For "what is the latest UK inflation figure, and who says so?":

1. Call `search` with the question.
2. Answer from the direct answer and the passages from pages that were read.
3. Give the figure with its source link and publication date.
4. Offer a `lineage` call on the source page's `url` if the user wants the detail.
