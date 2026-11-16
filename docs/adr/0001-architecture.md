# ADR-0001: Architecture Overview

## Decision
The Simple Pacman game will be implemented as a client-side React Single Page Application (SPA) using the provided `dotnet-react` template. However, due to the requirement of running entirely in the browser with no custom backend services, the .NET backend project will not be utilised for any game logic and will be excluded from the runtime scope of the game. 

## Services
- **Frontend (React + TypeScript):** The entire game will be rendered and executed within the browser. All game state, collision detection, movement and win/lose conditions will be handled client side.
- **Hosting:** The application will be built and exported as static assets (`npm run build`) and deployed via a static hosting provider. No server compute is required.

## Data Model
- **Game State:** In-memory state managed via React hooks/context (e.g. `gameState`, `levelGrid`, `pacmanPosition`, `ghostPositions`, `score`, `lives`, `isGameOver`, `hasWon`). No persisted storage.
- **Level Data:** The classic Pacman maze will be defined as a static JSON or TypeScript constant (2D grid) within the frontend codebase to allow for deterministic rendering and collision checks.

## Synthetic Seed Strategy
- **Demo Seed:** A single, hardcoded classic maze level will be loaded on initial render. No runtime generation or external seed files are required. This satisfies the clarification of "classic maze" with no persistence.

## Preview Readiness
- **Build Output:** Production build will output static HTML, CSS and JS with no environment variables required to run the game.
- **Desktop Only:** Styling and canvas/grid rendering will be targeted towards desktop browser viewports, in line with the clarification of desktop only support.
- **Zero Backend Dependency:** Health probes for a backend are not required for the game to function. Any default template backend health endpoints will not be relied upon for gameplay.

## Constraints
- No server-side persistence (global leaderboards or database).
- No external authenticated APIs.
- No sound effects or music.
- No localStorage usage.
- Must remain functional with no custom backend services.