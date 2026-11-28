# Flux MCP

Flux for Claude, Codex, Cursor and any other MCP client. It gives your assistant four tools:

- `search` searches the web and returns ranked results. Pages Flux reads come back with the passages that answer the query.
- `lineage` reads a document or a web page and returns only the passages that answer your questions. People, places, organisations and dates are written into each passage where it needs them, such as the name behind "she" or the exact month behind "last April".
- `fetch` returns one web page whole, as clean markdown with its title and published date.
- `account` shows your balance. It is free.

The Claude Code plugin also installs a skill that teaches Claude when to use each tool and how to report what comes back.

## What you need

- A Flux API key. It starts with `user_sk_` (personal) or `org_sk_` (workspace). Create one at [app.fluxsearch.io/keys](https://app.fluxsearch.io/keys).
- Node.js 18 or newer, for every client except Claude Desktop. Check with `node --version`, and install it from [nodejs.org](https://nodejs.org) if that fails.

Nothing is cloned or built. Each install below takes a few commands, and starting a new session loads it.

## Install

### Claude Code

This installs the tools and the skill. Run these in a terminal. They work the same for the CLI, the desktop app and the IDE extensions:

```bash
printf 'Flux API key: '; stty -echo; read -r FLUX_KEY; stty echo; echo
claude plugin marketplace add Flux-Search/flux-MCP
claude plugin install flux@flux-search --config "flux_api_key=$FLUX_KEY"
unset FLUX_KEY
```

The first line asks for the key without showing it or saving it in your shell history (it works in zsh, bash and sh). Claude Code keeps the key in your system's credential store, not in a settings file.

Then start a new Claude Code session, because MCP servers only load when a session starts. Check that it worked:

```bash
claude mcp list
```

`plugin:flux:flux` should say `✔ Connected`.

If you install without `--config`, the plugin is installed but has no key, and the server shows as failed. Run the `install` line again with `--config`; it sets the key on an existing install. Inside a terminal Claude Code session, `/plugin install flux@flux-search` asks for the key instead, and `/plugin configure flux@flux-search` changes it later.

For the tools without the skill:

```bash
claude mcp add flux --env FLUX_API_KEY=user_sk_... -- npx -y github:Flux-Search/flux-MCP
```

### Claude Desktop

Download `flux.mcpb` from the [latest release](https://github.com/Flux-Search/flux-MCP/releases/latest) and open it, or drag it onto Settings, Extensions. Claude Desktop asks for your Flux API key and runs the server itself, so Node.js is not needed.

### Codex CLI and IDE

```bash
codex mcp add flux --env FLUX_API_KEY=user_sk_... -- npx -y github:Flux-Search/flux-MCP
```

To keep the key out of your shell history in Windows PowerShell:

```powershell
$key = Read-Host "Flux API key"
codex mcp add flux --env "FLUX_API_KEY=$key" -- npx -y github:Flux-Search/flux-MCP
Remove-Variable key
```

The skill for Codex:

```bash
npx skills add https://github.com/Flux-Search/flux-MCP/tree/main/codex --skill flux-codex --agent codex --global
```

Check it with `codex mcp get flux`, or `/mcp` inside Codex. Codex lists the server as `Auth unsupported`, which is expected: the key is passed as an environment variable, not through OAuth. `--env` saves the key in Codex's local config, so do not commit or share that file.

### Codex Cloud

Add this to the project's `.codex/config.toml`, and store `FLUX_API_KEY` as a Cloud environment secret. Never put the key itself in the file.

```toml
[mcp_servers.flux]
command = "npx"
args = ["-y", "github:Flux-Search/flux-MCP"]
env_vars = ["FLUX_API_KEY"]
tool_timeout_sec = 150
startup_timeout_sec = 30
```

### Cursor and other MCP clients

Any client that starts a server with a command works the same way. For Cursor, add this under `mcpServers` in `~/.cursor/mcp.json`:

```json
{
  "flux": {
    "command": "npx",
    "args": ["-y", "github:Flux-Search/flux-MCP"],
    "env": { "FLUX_API_KEY": "user_sk_..." }
  }
}
```

### Updating

Update the Claude Code plugin with `claude plugin marketplace update flux-search` and then `claude plugin update flux@flux-search`, and start a new session. Claude Desktop updates when you install a newer `flux.mcpb`. `npx -y github:Flux-Search/flux-MCP` fetches the latest version each time your client starts it; add a tag such as `#v0.5.0` to the end to pin one.

## Using it

Ask in plain language:

- "Search for the latest UK inflation figure and tell me where it comes from."
- "Read https://example.com/article and tell me why prices rose."
- "Use lineage on this report and list everyone it mentions", then paste the text.
- "What's my Flux balance?"

[examples/](examples/) has three short articles with prompts to try.

### `lineage`

Send `text` or `url`, and your questions in `queries`.

| Argument | |
|---|---|
| `text` | The document, up to 60,000 characters. |
| `url` | A page for Flux to fetch and read. If the site refuses, you get an error and are not charged. |
| `queries` | Up to 10 questions. Each is a full pass over the document and is billed as one. Leave it out to get every passage, which is longer than the input. |
| `query` | One question. The same as `queries` with one entry. |
| `published` | When a pasted text was published, as an ISO date. It lets "last April" resolve to the right year. |
| `documents` | Up to 100 documents in one call, each with its own `text` or `url`, and optionally its own `queries` and `published`. Documents that cannot be read are listed and not charged. |

### `search`

| Argument | |
|---|---|
| `query` | What to search for. Required. |
| `max_results` | 1 to 20, default 10. |
| `enrich` | How many results Flux reads for passages. The default is all of them. `0` returns results without reading any pages, which is fastest. |
| `allowed_domains` | Only return pages from these sites, up to 10. |
| `blocked_domains` | Never return pages from these sites, up to 20. |
| `questions` | Up to 9 questions asked of every page read, such as "Who is the chief executive?". Each page answers from its own text or says the answer is not there. Billed per question per page read. |

### `fetch`

| Argument | |
|---|---|
| `url` | A public http or https address. Required. |

Pages longer than 100,000 characters are cut, with a note saying so.

### `account`

No arguments. Returns your balance and roughly how many tokens of Lineage input it covers.

### What comes back

Passages, each with a relevance score. The text is the passage with its context written in, ready to paste into another prompt:

> She [Jane Doe] said the ministry raised fuel prices on Tuesday [Jul 28, 2026].

Under each passage, what it mentions, such as `person: She -> Jane Doe`. An arrow means a vague mention was matched to a full name or a date.

Search results also carry a direct answer when the index has one, related searches, and a note for any page Flux could not read.

Every call ends with its cost in dollars.

## Pricing

Lineage is billed by the tokens it reads, once per question: five questions over one document are five passes. Search and fetch are a flat price each. The account tool is free, and errors are never charged. Current prices are at [fluxsearch.io/pricing](https://fluxsearch.io/pricing).

## Good to know

- Read any WARNING line. Lineage warns when only the start of a long document was read. Search warns when the index ran in a reduced mode.
- A document can be up to 60,000 characters, about 9,000 words. Split longer ones, or use `documents`.
- A `402` error means the balance is too low. Add credit at [app.fluxsearch.io](https://app.fluxsearch.io).

## Troubleshooting

| What you see | What to do |
|---|---|
| The tools do not appear | Start a new session, then check `claude mcp list` or `codex mcp get flux`. |
| `FLUX_API_KEY is not set`, or `flux` shows as failed in `/mcp` | The server started without a key. For the Claude Code plugin, run `claude plugin install flux@flux-search --config "flux_api_key=..."` and start a new session. Otherwise register it again with `--env FLUX_API_KEY=...`, or add the Cloud secret. |
| `Auth unsupported` in Codex | Expected. See the Codex section. |
| `unauthorized` | The key is wrong or has been revoked. It starts with `user_sk_` or `org_sk_`. |
| `insufficient_credits` | The balance is too low. Add credit and try again. |
| `rate_limited` | Too many calls. Wait for the number of seconds in the message. |
| `fetch_failed` | The site refused automated access or the page had no text. Nothing was charged. |
| It times out | Try again, or raise `FLUX_TIMEOUT_MS`. |

## Settings

| Variable | Default | |
|---|---|---|
| `FLUX_API_KEY` | none | Required. |
| `FLUX_API_BASE_URL` | `https://fluxsearch.io` | Only set this to use a different deployment. |
| `FLUX_TIMEOUT_MS` | `120000` | How long to wait for an answer, in milliseconds. |

## The API behind it

The tools call the Flux REST API. To call it directly, see the [API reference](https://fluxsearch.io/api-reference) and the [getting started guide](https://fluxsearch.io/docs/getting-started). The API also has OpenAI-compatible endpoints, so the OpenAI SDK works with a changed base URL.

## Maintainers

`bundle/index.js` is committed so that installing needs no toolchain, and CI fails if it does not match the source. The source is `src/index.ts` (the server) and `src/flux.ts` (request building, formatting and error text). After changing them, rebuild and commit the bundle:

```bash
npm install
npm test
npm run bundle
```

Bump the version in `package.json`, `src/index.ts`, `.claude-plugin/plugin.json` and `manifest.json` together. Pushing a `v*` tag runs the tests, builds `flux.mcpb` and attaches it to a GitHub release.

`npm run build` only type-checks. The API is described by [fluxsearch.io/api-reference/openapi.json](https://fluxsearch.io/api-reference/openapi.json).

## License

MIT. See [LICENSE](LICENSE).
