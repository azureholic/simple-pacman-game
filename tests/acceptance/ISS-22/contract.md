# ISS-22 Interface Contract — Pacman Blue Color Verification Across All Game States

- **Acceptance Issue**: `#22` (`AT: Verify Pacman color across all game states`)
- **Implementation Issue**: `#23` (`Update Pacman color to blue (#0000FF)`)
- **Feature Specification**: `docs/features/001-pacman-color-update.md` (`REQ-001`, `REQ-002`, `AC-001`–`AC-004`)
- **Upstream Contracts**: `tests/acceptance/ISS-3/contract.md`, `tests/acceptance/ISS-5/contract.md`, `tests/acceptance/ISS-7/contract.md`, `tests/acceptance/ISS-9/contract.md`

---

## 1. Canonical Pacman Color Constants (`web/src/game/pacmanEngine.ts`)

Export canonical Pacman color design tokens from `web/src/game/pacmanEngine.ts` while preserving 100% backwards compatibility with all `ISS-3`, `ISS-5`, `ISS-7`, and `ISS-9` exports, signatures, and gameplay invariants:

```ts
export const PACMAN_COLOR = '#0000FF'
export const PACMAN_ALIVE_COLOR = '#0000FF'
export const PACMAN_DEAD_COLOR = 'rgba(0, 0, 255, 0.6)'
```

1. `PACMAN_COLOR` MUST be exported as a `string` equal to `'#0000FF'` (`REQ-001` of `docs/features/001-pacman-color-update.md`).
2. `PACMAN_ALIVE_COLOR` MUST be exported as a `string` equal to `PACMAN_COLOR` (`'#0000FF'`).
3. `PACMAN_DEAD_COLOR` MUST be exported as a `string` representing `#0000FF` blue chromaticity (`R = 0`, `G = 0`, `B = 255`) with translucent alpha `0 < alpha < 1` (canonical value `'rgba(0, 0, 255, 0.6)'`, or equivalent `#0000FF`-derived translucent CSS canvas color such as `'#0000FF99'`) so that:
   - Pacman still appears blue (`rgb(0, 0, 255)`) when visible in mid-game life-lost (`pacman.status === 'dead'`, `lives > 0`) and terminal `'game-over'` (`pacman.status === 'dead'`, `lives === 0`) states (`REQ-001`, `AC-002`, `AC-003`), **and**
   - `PACMAN_DEAD_COLOR !== PACMAN_ALIVE_COLOR` holds strictly, preserving the locked `ISS-5` (`pacmanMovementAndInput.test.ts`) and `ISS-7` (`ghostAiAndCollision.test.ts`) distinct alive-vs-dead `fillStyle` contract.

---

## 2. Pacman Rendering Across All Defined Game States (`renderGameToCanvas` & `<App />`)

In `renderGameToCanvas(ctx, snapshot, maze = CLASSIC_MAZE)` and mounted `<App />`:

1. **Start Screen (`AC-001`, `REQ-001`)**:
   - On initial engine creation (`tick === 0`, `gameStatus === 'playing'`, `pacman.status === 'alive'`, `pacman.direction === null`, `pacman.position === PACMAN_SPAWN_POSITION`) and on initial `<App />` mount prior to user input or interval ticks, Pacman's circle at `pacmanCenterPx` MUST render with `ctx.fillStyle === PACMAN_ALIVE_COLOR` (`'#0000FF'`).

2. **Active Gameplay & All Movement / Pellet Animations (`AC-002`, `REQ-001`, `REQ-002`)**:
   - Throughout active gameplay (`gameStatus === 'playing'`), Pacman MUST render in blue across every defined runtime state and tick frame:
     - Idle ticks (`pacman.direction === null`, `pacman.status === 'alive'`) -> `PACMAN_ALIVE_COLOR` (`'#0000FF'`).
     - Directional movement across all four cardinal headings (`'up'`, `'down'`, `'left'`, `'right'`) and wall-blocked ticks -> `PACMAN_ALIVE_COLOR` (`'#0000FF'`).
     - Standard `'pellet'` collection (`+10` points) and `'power-pellet'` collection (`+50` points) as well as subsequent post-power-pellet ticks -> `PACMAN_ALIVE_COLOR` (`'#0000FF'`).
     - Simultaneous AI ghost chase ticks (`ghostMovement: 'ai'`) and `<App />` interval frames while `pacman.status === 'alive'` -> `PACMAN_ALIVE_COLOR` (`'#0000FF'`).
     - Mid-game life-lost / dying state (`pacman.status === 'dead'`, `lives > 0`, `gameStatus === 'playing'`, awaiting `respawn()`) -> `PACMAN_DEAD_COLOR` (`rgb(0, 0, 255)` translucent blue, distinct from `PACMAN_ALIVE_COLOR`).

3. **End-of-Game & Restart States (`AC-003`, `REQ-001`)**:
   - **Win end-of-game state** (`gameStatus === 'won'`, `isWin === true`, `pacman.status === 'alive'`) and post-win ticks -> `PACMAN_ALIVE_COLOR` (`'#0000FF'`).
   - **Game-over end-of-game state** (`gameStatus === 'game-over'`, `isGameOver === true`, `lives === 0`, `pacman.status === 'dead'`), including multi-life exhaustion, spawn-overlap instant game-over (`initialLives: 1`), and post-game-over ticks -> `PACMAN_DEAD_COLOR` (`rgb(0, 0, 255)` translucent blue).
   - **Next-life continuation (`respawn`)**: Calling `game.respawn()` or clicking `<button data-testid="respawn-button">` revives Pacman (`pacman.status === 'alive'`) and renders Pacman in `PACMAN_ALIVE_COLOR` (`'#0000FF'`).
   - **Full restart (`reset`)**: Calling `game.reset()` or clicking `<button data-testid="restart-button">` from start/active play, mid-game death, `'won'`, or `'game-over'` restores `pacman.status === 'alive'` and renders Pacman in `PACMAN_ALIVE_COLOR` (`'#0000FF'`).

---

## 3. Non-Pacman Visual Isolation & Runtime Invariants (`AC-004`, `REQ-002`)

1. **No Unintended Color Changes (`AC-004`)**:
   - **Ghosts** (`web/src/game/pacmanEngine.ts`): Must retain exact existing `fillStyle` values — `blinky`: `'#ef4444'`, `pinky`: `'#f472b6'`, `inky`: `'#38bdf8'`, `clyde`: `'#fb923c'`, and fallback/custom ghost IDs: `'#ef4444'`.
   - **Pellets & Power-Pellets** (`web/src/maze/classicMaze.ts`): Must retain exact existing `fillStyle` values — standard `'pellet'`: `'#fde68a'`, `'power-pellet'`: `'#fde047'`.
   - **Maze Canvas** (`web/src/maze/classicMaze.ts`): Must retain exact existing `fillStyle` values — full-canvas background: `'#020617'`, wall tiles: `'#1d4ed8'`.
   - **UI & Stylesheet** (`web/src/App.tsx`, `web/src/styles.css`): Must retain existing HUD/stage markup, `data-*` attributes, accessible labels (`aria-label` starting with `"Simple Pacman placeholder game canvas"` and `"Static SPA · Ready"`), and CSS colors in `web/src/styles.css` with zero unintended `#0000FF` overrides on UI rules.

2. **Gameplay Mechanics & Ephemeral Client-Side Runtime (`REQ-002`)**:
   - Do not alter collision detection, ghost AI routing, pellet scoring, life tracking, or deterministic replay (`Math.random()` must never be called).
   - Make zero network, storage, or audio API calls, and do not introduce forbidden identifier tokens (`fetch(`, `XMLHttpRequest`, `localStorage`, `sessionStorage`, `AudioContext`) anywhere in `web/src/**` (including comments, per `web/tests/appBoot.test.ts`).

3. **Acceptance Manifest**:
   - Remove `"ISS-22"` from `tests/acceptance/pending.json` once Issue `#23` satisfies all tests in `tests/acceptance/ISS-22/pacmanColorAcrossGameStates.test.ts`.
