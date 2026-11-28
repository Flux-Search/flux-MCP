---
name: flux
description: Search the web, fetch pages and read documents or links with Flux. Use when the user wants current information with sources, or gives you an article, report, transcript or URL and wants the passages that answer a question, with people, places, organisations and dates spelled out, or grounded context to reuse in a prompt.
---

# Flux

Four tools from the `flux` MCP server:

- `search` finds pages on the web and returns ranked results. Pages Flux reads come back with the passages that answer the query.
- `lineage` reads a document or link you already have and returns only the passages that answer your questions. People, places, organisations and dates are written in where a passage needs them.
- `fetch` returns one web page whole, as clean markdown.
- `account` shows the balance. It is free.

## Before anything: are the tools there?

If the tools are not available, the MCP server is not connected. Do not work around it by guessing at the answer or summarising the page yourself: the passage selection and the resolved names and dates are what the user asked for.

Tell the user, and give them this:

> The Flux tools aren't connected. To install them, run this in a terminal (it asks for your Flux API key without showing it):
>
> ```bash
> printf 'Flux API key: '; stty -echo; read -r FLUX_KEY; stty echo; echo
> claude plugin marketplace add Flux-Search/flux-MCP
> claude plugin install flux@flux-search --config "flux_api_key=$FLUX_KEY"
> unset FLUX_KEY
> ```
>
> If the plugin is already installed but shows as failed, the key is missing, and the same commands set it. Then start a new session: MCP servers load when a session begins, so they will not appear in this one. `claude mcp list` should show `plugin:flux:flux` as connected.

They create a key at https://app.fluxsearch.io/keys. It starts with `user_sk_` or `org_sk_`. Never ask them to paste the key into the conversation.

## Which tool

| The user wants | Use |
|---|---|
| To find something, or the current state of the world | `search` |
| Answers from a link or document they gave you | `lineage` with `url` or `text` |
| A page worth reading in full that a search turned up | `lineage` with its `url` and a question |
| The whole page, unfiltered, such as to quote or convert it | `fetch` |
| To know their balance, or you are about to run a large job | `account` |

Prefer `lineage` over `fetch` for long pages when the user has a question: it returns only what answers it, which is shorter for you to read.

## Links go straight in

Pass the address as `url`. Flux fetches and reads the page itself, so do not fetch it first. If the site refuses, the call fails, nothing is charged, and you should tell the user rather than analyse a stub.

For a local file, read it and pass its contents as `text`.

## Asking lineage the right questions

Put the questions in `queries`, up to 10. Each question is a full pass over the document and is billed as one, so ask what the user needs, not every question you can think of. A single question can go in `query`.

With questions, only the passages that answer them come back, so the output is shorter than the input. Without any, every passage comes back and the output is longer than the input. That is expected; use it for "who does this mention" or "list every date".

If you know when a pasted text was published, pass it as `published` (an ISO date such as `2026-03-14`). Without it, Flux cannot tell which year "last April" means. A `url` usually carries its own date.

For several documents, send `documents` (up to 100) in one call instead of many calls. Top-level `queries` apply to every document unless one has its own. Documents that could not be read are listed under "Not read" and cost nothing; tell the user which ones.

## Search options

- `enrich: 0` returns links without reading any pages. It is the fastest; use it when the user wants links, not answers.
- Leave `enrich` out when the user wants the answer itself.
- `allowed_domains` (up to 10) and `blocked_domains` (up to 20) when the user names sites to trust or avoid.
- `max_results` is 1 to 20, default 10.
- `questions` (up to 9) when the user needs the same facts from every page, such as a CEO and an address for each company. Each page answers from its own text, or says the answer is not there. Use it to build a table across results.

## Reading the result

Each passage is its text with context written in, for example `She [Jane Doe] said prices rose [Apr 2025]`. This is the version to reuse as grounded context in a later prompt. The line under it lists what the passage mentions. An arrow (`she -> Jane Doe`) means a vague mention was matched to a full name or a date, which is often the most useful part, so point it out.

A relevance score is only comparable within one document.

Cite the source URL and publication date when you answer from a result.

## Warnings to pass on

- "Only the first N of M tokens were read": the end of the document was not examined. Say so, and if it matters, split the document and call again.
- "Search ran in degraded mode": ranking or coverage may be reduced. Say so.
- A search result marked "not read" is a link with no passages. A `pending` one ran out of time; asking again may read it.
- A fetched page "cut at 100000 characters": the rest was not returned. Use `lineage` with a question to read the rest selectively.

## What things cost

Every result ends with its cost.

- `lineage` is billed by the tokens it reads, once per question. Five questions over one document cost five passes.
- `search` is a flat price per search.
- `fetch` is a flat price per page.
- `account` is free.
- Errors are never charged.

Before a job of many documents or questions, call `account` and tell the user roughly what it will use. Current prices are at https://fluxsearch.io/pricing.

## Errors

| Error | What to do |
|---|---|
| `insufficient_credits` (402) | The balance is too low. Stop and tell the user to add credit at https://app.fluxsearch.io. Do not retry. |
| `rate_limited` (429) | Wait the number of seconds in the message, then retry once. |
| `unauthorized` (401) | The key is wrong or revoked. |
| `bad_request` (400) | Fix the request. Sending it unchanged fails the same way. |
| `fetch_failed` (502) | The site refused or the page had no text. Try another source. |
| `upstream_error`, `not_configured`, `search_unavailable` | A problem on the Flux side. Try again once. |

## Limits

- 60,000 characters of `text` per document. Split longer ones at section breaks, or use `documents`.
- 10 questions per document, 100 documents per call.
- `search` returns at most 20 results.

## Worked example

The user asks "what is the latest UK inflation figure, and who says so?"

1. This is about the world, not a document: call `search` with the question.
2. Answer from the direct answer, if there is one, and the passages from pages that were read.
3. Give the figure with its source link and publication date.
4. If the user wants the detail behind it, call `lineage` on that page's `url` with a question such as "what drove the change?".
