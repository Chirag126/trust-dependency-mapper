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
- **Policy watchlist**: save critical dependency fingerprints and re-run analysis to detect trust changes.
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
- `GET /api/watchlist`
- `POST /api/watchlist/:id/check`
- `GET /api/admin/analytics`
- `GET /api/health`

## Security notes

- ZIP extraction rejects path traversal.
- GitHub URLs are restricted to `github.com` public repositories.
- Request body and upload size limits are enforced.
- RPC calls use timeouts.
- The service never asks for seed phrases or private keys.
- Admin analytics are protected by `ADMIN_TOKEN`.
- User identity is represented by an anonymous browser/session identifier.
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

## Test

```bash
cd server
npm install
npm test
```

The self-test compiles a Solidity fixture and checks owner/oracle/upgrade/delegatecall discovery and analysis logging.

## Limitations

- No static analyzer can prove protocol security.
- `debug_traceCall` support depends on the RPC provider.
- Provider identification should be treated as evidence-backed only when ABI/source/address metadata establishes it.
- Public RPCs are not suitable for high-volume production without rate limits and monitoring.
- Anonymous analytics intentionally avoid collecting wallet private keys, seed phrases, or unnecessary personal data.
