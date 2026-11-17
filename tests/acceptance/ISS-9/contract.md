# ISS-9 Interface Contract — Pellets, Scoring, Lives & End States

- **Acceptance Issue**: `#9` (`AT: Pellets, scoring, lives and end states`)
- **Implementation Issue**: `#8` (`Pellets, scoring, lives, win and lose conditions`)
- **Requirements Covered**: `REQ-001`, `REQ-002`, `REQ-004`, `REQ-005`, `REQ-006`, `REQ-007`
- **Upstream Contracts**: `tests/acceptance/ISS-3/contract.md`, `tests/acceptance/ISS-5/contract.md`, `tests/acceptance/ISS-7/contract.md`

---

## 1. Maze Canvas Active-Pellet Extension (`web/src/maze/classicMaze.ts`)

Preserve all `ISS-3` exports and default behavior in `web/src/maze/classicMaze.ts`, and allow `renderMazeToCanvas` to accept an optional `activePellets` list for live gameplay rendering:

```ts
export function renderMazeToCanvas(
  ctx: MazeCanvasContext,
  maze?: MazeDefinition,
  activePellets?: readonly PelletSpawn[],
): MazeRenderSummary
```

1. When `activePellets` is omitted (`undefined`), `renderMazeToCanvas` behaves identically to `ISS-3`, drawing every `'pellet'` and `'power-pellet'` tile in `maze` and returning `renderedPelletCount === getPelletSpawnPositions(maze).length`.
2. When `activePellets` is provided, `renderMazeToCanvas` clears/fills the full canvas background, renders every `'wall'` tile, counts all traversable corridor tiles identically to `ISS-3`, and draws pellet/power-pellet circles (`'pellet'` or `'power-pellet'` radius and fill color at tile center) **only** for the entries in `activePellets`, returning `renderedPelletCount === activePellets.length`.

---

## 2. Game Engine Contract (`web/src/game/pacmanEngine.ts`)

Extend `web/src/game/pacmanEngine.ts` with deterministic pellet consumption, real-time scoring, life tracking, next-life respawn, and win / game-over end states while preserving 100% backwards compatibility with all `ISS-3`, `ISS-5`, and `ISS-7` exports, signatures, and invariants.

### 2.1 Scoring & Lives Constants and Helpers (`REQ-002`, `REQ-006`)

```ts
import type { PelletSpawn } from '../maze/classicMaze.ts'

export type GameStatus = 'playing' | 'won' | 'game-over'

export const PELLET_SCORE = 10
export const POWER_PELLET_SCORE = 50
export const INITIAL_LIVES = 3

export function getPelletScore(kind: PelletSpawn['kind']): number
```

1. `PELLET_SCORE` MUST equal `10` (points awarded for consuming a standard `'pellet'`).
2. `POWER_PELLET_SCORE` MUST equal `50` (points awarded for consuming a `'power-pellet'`).
3. `INITIAL_LIVES` MUST equal `3` (default starting lives for a new game).
4. `getPelletScore(kind)` is a pure synchronous function returning `PELLET_SCORE` (`10`) for `'pellet'` and `POWER_PELLET_SCORE` (`50`) for `'power-pellet'`.

### 2.2 Extended Options, Snapshot & Engine Interfaces

```ts
export interface PacmanGameOptions {
  readonly maze?: MazeDefinition
  readonly pacmanSpawn?: TilePosition
  readonly ghosts?: readonly GhostInit[]
  readonly ghostMovement?: GhostMovementMode
  readonly initialLives?: number
}

export interface PacmanGameSnapshot {
  readonly levelId: string
  readonly tick: number
  readonly pacman: PacmanState
  readonly ghosts: readonly GhostState[]
  readonly isPacmanDead: boolean
  readonly deathCount: number
  readonly score: number
  readonly lives: number
  readonly initialLives: number
  readonly pellets: readonly PelletSpawn[]
  readonly totalPelletCount: number
  readonly remainingPelletCount: number
  readonly gameStatus: GameStatus
  readonly isGameOver: boolean
  readonly isWin: boolean
}

export interface PacmanGameEngine {
  getMaze(): MazeDefinition
  getSnapshot(): PacmanGameSnapshot
  getPacmanPosition(): TilePosition
  handleKeyInput(input: unknown): boolean
  tick(): PacmanGameSnapshot
  respawn(): PacmanGameSnapshot
  reset(options?: PacmanGameOptions): PacmanGameSnapshot
}
```

### 2.3 Initialization, Pellet Consumption, Lives, Respawn & End States (`createPacmanGame`)

1. **Initialization & Validation (`createPacmanGame(options)` / `game.reset(options)`)**:
   - Preserves all `ISS-5` and `ISS-7` validation rules (`pacmanSpawn`, `ghosts`, `ghostMovement`).
   - `initialLives` defaults to `INITIAL_LIVES` (`3`) when `options?.initialLives === undefined`.
   - Throws an `Error` on `createPacmanGame(options)` and `game.reset(options)` if `options?.initialLives !== undefined` and (`!Number.isInteger(options.initialLives)` or `options.initialLives < 1`), without mutating or corrupting existing engine state when `reset` throws.
   - Initializes active `pellets` from `getPelletSpawnPositions(maze)` in row-major order (`totalPelletCount = pellets.length`, `remainingPelletCount = pellets.length`) and `score = 0`.
   - When `pacmanSpawn` does **not** overlap any initial ghost position:
     - `pacman.status = 'alive'`, `isPacmanDead = false`, `deathCount = 0`, `lives = initialLives`, `gameStatus = 'playing'`, `isGameOver = false`, `isWin = false`.
   - When `pacmanSpawn` overlaps an initial ghost position (`checkGhostCollision` is `true` at spawn):
     - `pacman.status = 'dead'`, `isPacmanDead = true`, `deathCount = 1`, `lives = Math.max(0, initialLives - 1)`, `gameStatus = lives === 0 ? 'game-over' : 'playing'`, `isGameOver = lives === 0`, `isWin = false`.
   - Note: Synthetic mazes with `totalPelletCount === 0` (no `'pellet'` or `'power-pellet'` tiles in `maze.grid`) start in `gameStatus = 'playing'` (unless `lives === 0`) and never auto-transition to `'won'`.

2. **Input Handling (`game.handleKeyInput(input)`)**:
   - Maps `input` via `mapKeyToDirection(input)`.
   - Returns `false` without throwing and without modifying any engine state when `mappedDirection === null`, `pacman.status === 'dead'`, or `gameStatus !== 'playing'` (`'won'` or `'game-over'`).
   - When `pacman.status === 'alive'` and `gameStatus === 'playing'`, sets `pacman.direction = mappedDirection` without advancing `tick` or `pacman.position`, and returns `true`.

3. **Per-Tick Update (`game.tick()`) (`REQ-002`, `REQ-006`)**:
   - Increments `tick` by `1`.
   - If `pacman.status === 'dead'` or `gameStatus !== 'playing'` (`'won'` or `'game-over'`) prior to the tick:
     - Leaves `pacman.position`, `pacman.direction`, `pacman.status`, `ghosts`, `pellets`, `score`, `lives`, `deathCount`, and `gameStatus` unchanged, and returns the frozen snapshot (preserving `ISS-5` and `ISS-7` post-death tick invariants).
   - Records `prevPacmanPos` and `prevGhostPositions` at the start of the tick.
   - Updates `pacman.position` via `resolveTileMovement(maze, prevPacmanPos, pacman.direction)` when `pacman.direction !== null`.
   - Updates `ghosts` via `stepGhostState(maze, ghost, prevPacmanPos)` when `ghostMovement === 'ai'`.
   - Evaluates `checkGhostCollision(pacman.position, currentGhostPositions, prevPacmanPos, prevGhostPositions)`:
     - When collision occurs:
       - Sets `pacman.status = 'dead'`, `pacman.direction = null`, `isPacmanDead = true`.
       - Increments `deathCount` by `1`.
       - Decrements `lives` by `1` (`lives = Math.max(0, lives - 1)`).
       - Transitions `gameStatus` to `'game-over'` (`isGameOver = true`, `isWin = false`) when `lives === 0`; keeps `gameStatus = 'playing'` (`isGameOver = false`, `isWin = false`) when `lives > 0`.
       - Does **not** consume any pellet on the fatal collision tile, and returns the frozen snapshot.
   - Otherwise (Pacman is `'alive'` and no ghost collision occurred on this tick):
     - Checks whether an uncollected pellet in `pellets` occupies `pacman.position`:
       - When present:
         - Removes that pellet from `pellets` (`remainingPelletCount` decreases by `1`).
         - Increments `score` by `getPelletScore(pellet.kind)` (`10` for `'pellet'`, `50` for `'power-pellet'`).
         - Re-entering a cleared tile on later ticks awards `0` points and leaves `remainingPelletCount` unchanged.
         - When `totalPelletCount > 0 && pellets.length === 0`, transitions `gameStatus` to `'won'` (`isWin = true`, `isGameOver = false`) and sets `pacman.direction = null`.
     - Returns the frozen snapshot.

4. **Next-Life Continuation (`game.respawn()`) (`REQ-002`)**:
   - When `pacman.status === 'dead'`, `lives > 0`, and `gameStatus === 'playing'`:
     - Restores `pacman.position` to the configured `pacmanSpawn`, `pacman.direction = null`, and `ghosts` to their configured initial spawns and initial directions (`DEFAULT_GHOST_SPAWNS` or `options.ghosts`).
     - Preserves `tick`, `score`, `lives`, `initialLives`, `deathCount`, and remaining uncollected `pellets` (`remainingPelletCount`).
     - Evaluates `checkGhostCollision` at the restored spawn positions: if no ghost overlaps `pacmanSpawn`, sets `pacman.status = 'alive'` (`isPacmanDead = false`, `gameStatus = 'playing'`); if an initial ghost overlaps `pacmanSpawn`, applies collision death (`pacman.status = 'dead'`, `deathCount += 1`, `lives = Math.max(0, lives - 1)`, `gameStatus = lives === 0 ? 'game-over' : 'playing'`).
     - Returns the frozen snapshot.
   - In all other states (`pacman.status === 'alive'`, `lives === 0`, `gameStatus === 'game-over'`, or `gameStatus === 'won'`), `game.respawn()` is a safe no-op returning the current frozen snapshot without modifying any state.

5. **Full Reset (`game.reset(options?)`) & Snapshot Immutability**:
   - `game.reset(options?)` reinitializes the engine (using `options` when provided, or the defensively cloned creation options otherwise) back to `tick = 0`, `score = 0`, `lives = effectiveInitialLives`, `deathCount` (`0`, or `1` on spawn overlap), full `pellets` (`remainingPelletCount = totalPelletCount`), and initial `gameStatus`.
   - `getSnapshot()` returns deeply frozen `snapshot`, `snapshot.pacman`, `snapshot.pacman.position`, `snapshot.ghosts` (and each `GhostState` + `position`), and `snapshot.pellets` (and each `PelletSpawn`) so external mutation attempts cannot alter internal engine state.

### 2.4 Canvas Game Renderer (`renderGameToCanvas`) (`REQ-002`, `REQ-006`)

`renderGameToCanvas(ctx, snapshot, maze = CLASSIC_MAZE)`:
- Delegates maze rendering to `renderMazeToCanvas(ctx, maze, Array.isArray(snapshot.pellets) ? snapshot.pellets : undefined)` so consumed pellets are no longer drawn on `<canvas>` and `summary.renderedPelletCount` equals `snapshot.pellets.length` when `snapshot.pellets` is present.
- Preserves ghost and Pacman (`'alive'` vs `'dead'`) entity rendering and `GameRenderSummary` fields from `ISS-5` and `ISS-7`.

---

## 3. React `<App />` Desktop HUD & End-State UI (`web/src/App.tsx`)

1. Preserve all existing `appBoot.test.ts`, `ISS-3`, `ISS-5`, and `ISS-7` markup and `<canvas data-testid="game-canvas" ... />` attributes (`aria-label` starting with `"Simple Pacman placeholder game canvas"`, `"Static SPA · Ready"`, static `data-pellet-spawns={mazeMetrics.pelletSpawnCount}`, `data-pacman-row`, `data-pacman-col`, `data-pacman-status`, `data-ghost-count`).
2. Expose live game state attributes on `<canvas data-testid="game-canvas" ... />`:
   - `data-score={snapshot.score}` (`"0"` initially on default game)
   - `data-lives={snapshot.lives}` (`"3"` initially on default game)
   - `data-remaining-pellets={snapshot.remainingPelletCount}` (`"244"` initially on default `CLASSIC_MAZE` game)
   - `data-game-status={snapshot.gameStatus}` (`"playing"` | `"won"` | `"game-over"`)
3. Render a minimal desktop HUD inside `<App />` (`REQ-002`, `REQ-004`, `REQ-006`) kept in sync with `snapshot` across initial render, interval ticks, and button actions:
   - Score counter element with `data-testid="score-display"` and `data-score={snapshot.score}` whose visible text includes `String(snapshot.score)` (e.g. `Score: 0`).
   - Life counter element with `data-testid="lives-display"` and `data-lives={snapshot.lives}` whose visible text includes `String(snapshot.lives)` (e.g. `Lives: 3`).
   - Remaining pellets counter element with `data-testid="pellets-display"` and `data-remaining-pellets={snapshot.remainingPelletCount}` whose visible text includes `String(snapshot.remainingPelletCount)` (e.g. `Pellets: 244`).
   - Game status element with `data-testid="game-status"` and `data-game-status={snapshot.gameStatus}`:
     - When `snapshot.gameStatus === 'won'`, visible text matches `/you win|victory|level cleared|won/i`.
     - When `snapshot.gameStatus === 'game-over'`, visible text matches `/game over/i`.
     - When `snapshot.gameStatus === 'playing'`, visible text reflects active play or life lost (and does **not** match `/game over/i` or `/you win|victory|level cleared/i`).
   - Desktop action buttons (`<button type="button">`):
     - When `snapshot.gameStatus === 'playing' && snapshot.pacman.status === 'dead' && snapshot.lives > 0`, render `<button type="button" data-testid="respawn-button">` whose `onClick` calls `activeGame.respawn()`, updates React state, and redraws `<canvas>` via `renderGameToCanvas` (omit when not awaiting respawn).
     - Render `<button type="button" data-testid="restart-button">` whose `onClick` calls `activeGame.reset()`, updates React state, and redraws `<canvas>` via `renderGameToCanvas`.
4. **Client-side ephemeral runtime (`REQ-001`, `REQ-005`, `REQ-007`)**:
   - Make zero network calls (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`).
   - Access zero browser persistence APIs (`localStorage`, `sessionStorage`, `indexedDB`).
   - Instantiate zero browser audio APIs (`AudioContext`, `webkitAudioContext`, `Audio`).
   - Do not include forbidden identifier tokens (`fetch(`, `XMLHttpRequest`, `localStorage`, `sessionStorage`, `AudioContext`) anywhere in `web/src/**` (including comments, per `web/tests/appBoot.test.ts`).
5. Remove `"ISS-9"` from `tests/acceptance/pending.json` once Issue `#8` satisfies all tests in `tests/acceptance/ISS-9/pelletsScoringLivesAndEndStates.test.ts`.
