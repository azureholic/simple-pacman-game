# simple-pacman-game

Browser-only Simple Pacman game built as a standalone React + TypeScript + Vite Single Page Application (SPA) with zero custom backend dependencies for gameplay (`REQ-001`, `ADR-0001`).

## Prerequisites

- **Node.js** 22+ and **npm** 10+
- **.NET SDK** 11.0 (used by `./scripts/quality` and the preview static-file container host)

## Frontend Static Build & Local Development (`web/`)

The game runs 100% client-side in desktop browsers and compiles to deployable static HTML, CSS, and JS assets in `web/dist/`:

```bash
cd web
npm ci
npm run build      # Runs TypeScript typecheck + Vite static production build -> web/dist/
npm test           # Runs frontend unit/smoke tests
npm run dev        # Starts Vite dev server
npm run preview    # Serves static web/dist/ bundle locally with no backend
```

## Unified Quality Gate (`./scripts/quality`)

The repository quality gate builds the static React SPA, checks formatting/types, and runs all tests:

```bash
./scripts/quality
```

