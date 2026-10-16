# Trust Dependency Mapper

A blockchain security platform that answers:

> **Before you trust a smart-contract system, know what it trusts.**

The app accepts three analysis inputs:

1. **Contract address + network** — live on-chain analysis.
2. **GitHub repository URL** — public Solidity repository analysis.
3. **ZIP upload** — local Solidity project analysis.

It discovers dependencies from ABI/source/bytecode where available, classifies trust surfaces, builds an interactive dependency graph, performs blast-radius analysis, stores analysis history, produces evidence-backed findings, and compares two analyses.

## Important

This is a production-oriented starter, not a claim of formal security correctness. Results are heuristics and should be reviewed by an auditor. The UI labels findings as evidence-backed or heuristic.

### Extra features

- **Trust scorecard**: dependency categories, privileged controls, upgradeability, oracles, external calls.
- **Blast-radius simulator**: click a dependency and see reachable protocol components.
- **Upgrade diff**: compare two analyses and identify added/removed/changed trust dependencies.
- **Evidence explorer**: every discovered dependency can show its source/ABI/bytecode evidence.
- **Runtime watchlist**: re-check tracked contracts, compare dependency graph snapshots, retain immutable history, and expose check status, progress, retry attempts, and failures.
- **Organization workspaces**: signed user accounts, owner/admin/member roles, organization-scoped analyses and watchlists, and server-side quotas.
- **Plan enforcement**: free organizations receive 10 analyses per calendar month; team organizations receive 250 when a verified subscription webhook activates the plan.
- **Razorpay billing preview**: server-side subscription creation and raw-body HMAC-SHA256 webhook verification are available behind environment configuration. The browser checkout experience, merchant onboarding, lifecycle reconciliation, and full provider end-to-end validation must be completed before live billing is enabled. Paid plans must remain labeled preview until then.
- **Admin analytics**: anonymous usage counters, analysis success/failure, networks, input types, latency. No wallet/private-key data is collected.
- **Audit log**: analysis lifecycle logs for each run.

## Architecture

```text
React + Vite
   |
   | REST
   v
Node.js 26 + TypeScript + Express
   |
   +-- Analysis Engine
   |     +-- RPC reader (ethers)
   |     +-- Solidity parser (solc)
   |     +-- GitHub reader
   |     +-- ZIP extractor
   |     +-- Proxy / owner / role / oracle heuristics
   |     +-- Graph + blast radius
   |
   +-- SQLite persistence
   |
   +-- Analytics + history + compare + watchlist
```

## Run

Requirements: Node.js 26.8.2+ within the Node 26 line (the project uses Node.js built-in `node:sqlite`; no `better-sqlite3` or native `node-gyp` database dependency is required). The server also performs a startup version check.

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

In another terminal:

```bash
cd web
npm install
npm run dev
```

Open the Vite URL.

### Environment

`server/.env`:

```env
PORT=4000
DATABASE_PATH=./data/tdm.sqlite
CORS_ORIGIN=http://localhost:5173
RPC_ETHEREUM=https://eth.llamarpc.com
RPC_SEPOLIA=https://rpc.sepolia.org
RPC_ARBITRUM=https://arb1.arbitrum.io/rpc
RPC_BASE=https://mainnet.base.org
GITHUB_TOKEN=
MAX_ZIP_MB=20
ADMIN_TOKEN=change-me
```

Public RPC endpoints can rate-limit. For reliable production usage, use your own RPC provider.

## API

- `POST /api/analyze/address`
- `POST /api/analyze/github`
- `POST /api/analyze/zip`
- `GET /api/analyses`
- `GET /api/analyses/:id`
- `POST /api/compare`
- `POST /api/watchlist`
- `POST /api/accounts/register` and `POST /api/accounts/login`
- `POST /api/organizations` and `GET /api/organizations`
- `GET /api/organizations/members`, `POST /api/organizations/members`, `PATCH /api/organizations/members/:userId`, `DELETE /api/organizations/members/:userId`
- `GET /api/organizations/usage`
- `POST /api/billing/checkout` (owner-only Razorpay subscription creation; returns a subscription ID for Razorpay Checkout; disabled until server credentials and plan ID are configured)
- `POST /api/billing/webhook` (Razorpay signed webhook endpoint; disabled unless webhook secret configured)
- `GET /api/watchlist`
- `POST /api/watchlist/:id/check` — retry-backed runtime analysis, baseline comparison, and persisted snapshot
- `GET /api/watchlist/:id/status` — latest run status and progress
- `GET /api/watchlist/:id/snapshots?limit=20` — recent immutable snapshots with graph diffs
- `GET /api/admin/analytics`
- `GET /api/health`

## Security notes

- ZIP extraction rejects path traversal.
- GitHub URLs are restricted to `github.com` public repositories.
- Request body and upload size limits are enforced.
- RPC calls use timeouts and bounded exponential backoff for transient failures.
- Runtime monitoring stores historical snapshots and explicitly reports failed or unavailable checks; it does not claim unsupported trace capabilities are available on every RPC provider.
- The service never asks for seed phrases or private keys.
- Admin analytics are protected by authenticated admin JWTs.
- Organization resources require a signed user token and organization membership; owner/admin/member roles are checked on the backend.
- Organization analyses and watchlists are scoped by organization ID; quota counters are incremented and checked server-side.
- Billing webhook processing is disabled until a secret is configured and rejects invalid signatures and duplicate event IDs.
- User identity is represented by an anonymous browser/session identifier.
### Security and data-integrity hardening

- Personal analyses and personal watchlists are scoped to the browser session that created them; organization-owned records require active membership in the selected organization.
- Analysis IDs cannot overwrite a record belonging to a different browser session or organization.
- Comparisons reject analyses from different workspace scopes.
- User access tokens expire after 15 minutes. Refresh tokens are stored as hashes, rotate on use, and cannot be replayed. Sign-out revokes the server-side session so already-issued access tokens stop authorizing requests.
- Authentication endpoints have a separate rate limit. Production startup requires a strong `ADMIN_JWT_SECRET`, a non-default `ADMIN_PASSWORD`, and an explicit `CORS_ORIGIN`.
- Organization quotas are reserved atomically and only after an analysis succeeds. Monitoring checks also count against organization quotas.
- Billing webhook duplicates are acknowledged only after the event has been marked processed; unprocessed events remain retryable.
- ZIP imports are bounded by upload size, entry count, per-file size, and total extracted content. Internal error details are kept in server logs rather than returned to clients.
- Existing watchlist rows without an owner are migrated to a non-user-visible legacy owner rather than exposed to every session. Recreate legacy personal watches after upgrading.

## v0.2 analysis-engine upgrades

### Deeper EVM tracing
For address analysis the engine attempts `debug_traceCall` with Geth-style `callTracer` for read-only public getters. If the configured RPC does not expose tracing, analysis continues and explicitly records that trace data may be unavailable.

### Proxy standards
Address analysis checks EIP-1967 implementation/admin/beacon storage slots and probes `proxiableUUID()`, `implementation()` and `beacon()` interfaces. Source analysis recognizes common OpenZeppelin upgrade patterns.

### Role enumeration
When `AccessControl`-compatible `DEFAULT_ADMIN_ROLE`, `getRoleMemberCount` and `getRoleMember` are exposed, the engine enumerates up to 100 members for the default admin role. It never assumes a role member without an RPC response.

### Oracle-provider identification
Source/ABI analysis identifies oracle integration patterns and labels evidence. The current engine intentionally avoids pretending that a keyword is proof of a specific provider; provider-specific adapters can be added once verified by ABI/address metadata.

### Multi-contract propagation
Runtime call addresses discovered by traces are added as graph dependencies and linked when they correspond to discovered targets. Blast radius is graph reachability, not a monetary-loss prediction.

### Production admin auth
Admin analytics now use short-lived HS256 JWT access tokens plus rotating, hashed refresh tokens stored server-side. Passwords are scrypt-hashed. Admin routes require an authenticated `admin` role. Set strong secrets in production and put the API behind HTTPS.

## Day 6: audit integrations and developer exports

### SARIF 2.1.0 export
Every stored analysis can be exported as SARIF for GitHub code-scanning-style workflows. The export preserves TDM finding IDs, severity levels, messages, confidence, analysis metadata, and source evidence locations when available.

- `GET /api/analyses/:id/report.sarif` — returns a downloadable SARIF 2.1.0 document.
- The Security report UI includes **Export SARIF**.

### Slither JSON import
TDM can normalize Slither detector JSON into its existing finding/evidence model without replacing native TDM findings. Run Slither in your Solidity project environment, for example:

```bash
slither . --json slither.json
```

Then send the JSON object to `POST /api/analyses/:id/import/slither` with the same authorization and organization headers used to read the analysis. This merges detector findings and retains source file/line evidence when the Slither output provides it. Import is an explicit workflow; TDM does not install or execute Slither on uploaded projects.

Example request:

```bash
curl -X POST "$TDM_API/api/analyses/ANALYSIS_ID/import/slither" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TDM_USER_TOKEN" \
  --data-binary @slither.json
```

### Trace and source-matching boundaries
Runtime trace data remains RPC-provider-dependent. TDM reports whether trace output was actually observed and records the number of supported getter probes attempted, rather than treating missing trace output as proof that no external calls exist. Address analyses also include the deployed bytecode keccak256 hash and observed block number as a reproducible code fingerprint; this is not by itself a source-verification proof. Source locations imported from third-party tools are evidence references, not proof that a finding is exploitable. Review imported findings against the exact source revision and deployed bytecode before acting on them.

## Deployment operations

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the supported Node/npm versions, production startup, health/readiness checks, environment variable inventory, SQLite persistence and backup guidance, HTTPS/CORS/secrets, logging/monitoring, and staging RPC/rate-limit verification. GitHub Actions runs on pull requests; repository branch protection must mark the CI check as required to block merges when checks fail.

## Test

```bash
cd server
npm install
npm test
```

The self-test compiles a Solidity fixture and checks owner/oracle/upgrade/delegatecall discovery and analysis logging.

## Evidence interpretation

- **Observed facts** should be tied to direct RPC/storage/ABI/compiler evidence (for example, an observed block number or a populated EIP-1967 slot).
- **Heuristic candidates** include source keyword/pattern matches and bytecode opcode presence. These are leads for review, not proof that a provider is integrated, a proxy is active, or an exploit is reachable.
- **Missing evidence is not evidence of absence.** A failed or unsupported RPC trace must not be interpreted as proof that no external calls exist.
- Address analyses report the observed block and deployed bytecode keccak256 fingerprint when available. A hash is a reproducible fingerprint, not verified-source equivalence.
- GitHub analysis currently reads the repository's default branch/archive but does not pin the result to an immutable commit SHA. Treat the analyzed source revision as unverified until revision capture is implemented.
- Reports disclose these boundaries and the available trace metadata instead of implying unsupported capabilities.

## Limitations

- No static analyzer can prove protocol security.
- `debug_traceCall` support depends on the RPC provider.
- Provider identification should be treated as evidence-backed only when ABI/source/address metadata establishes it.
- Public RPCs are not suitable for high-volume production without rate limits and monitoring.
- Anonymous analytics intentionally avoid collecting wallet private keys, seed phrases, or unnecessary personal data.


## End-to-end and API integration tests

Backend integration tests start an isolated API process with a temporary SQLite database and exercise account registration/login, organization membership, access isolation, address/GitHub/ZIP analysis paths, report JSON and SARIF, watchlist ownership, comparisons, refresh-token replay, logout, malformed ZIPs, and authentication rate limits.

```bash
cd server
npm ci
npm run build
npm test
npm run test:integration
```

Browser journeys use Playwright and Chromium to cover registration, organization/member management, Solidity ZIP analysis, report exports, print-to-PDF invocation, watchlist creation, comparisons, invalid input feedback, and persisted history after reload.

```bash
cd web
npm ci
npx playwright install chromium
npm run test:e2e
npm run build
```

The browser tests start the API on port 4400 and Vite on port 4173, using a dedicated local test database. The PDF workflow invokes the browser's Print / Save PDF feature; an actual PDF file is produced by the browser print dialog rather than a server-side PDF endpoint. GitHub analysis depends on public GitHub availability and rate limits, and address/watch checks depend on RPC configuration. Tests assert safe handling when these providers are unavailable; configure test RPC URLs and a GitHub token if deterministic live-provider success is required.
