# ISS-5 Interface Contract — Pacman Movement, Input Validation & Death State

- **Acceptance Issue**: `#5` (`AT: Pacman movement and input validation`)
- **Implementation Issue**: `#4` (`Pacman movement, input and death state`)
- **Requirements Covered**: `REQ-001`, `REQ-002`, `REQ-004`, `REQ-005`, `REQ-006`, `REQ-007`
- **Maze Dependency**: `web/src/maze/classicMaze.ts` (`CLASSIC_MAZE`, `Direction`, `TilePosition`, `MazeDefinition`, `MazeCanvasContext`, `MazeRenderSummary`, `canMoveFromTile`, `resolveTileMovement`, `isTileTraversable`, `renderMazeToCanvas`)

---

## 1. Module & Export Contract (`web/src/game/pacmanEngine.ts`)

Create `web/src/game/pacmanEngine.ts` exporting deterministic, pure/isolated Pacman game state management, desktop arrow-key input handling, grid/wall collision enforcement, ghost collision death-state transitions, and `<canvas>` entity rendering.

*(Additional readonly fields or optional parameters on exported interfaces and functions are permitted for downstream issues `#6` and `#8` provided all `ISS-5` signatures and semantics remain backwards-compatible.)*

### 1.1 Types

```ts
import type {
  Direction,
  MazeCanvasContext,
  MazeDefinition,
  MazeRenderSummary,
  TilePosition,
} from '../maze/classicMaze.ts'

export type PacmanStatus = 'alive' | 'dead'

export type GhostMovementMode = 'stationary' | 'ai'

export interface PacmanState {
  readonly position: TilePosition
  readonly direction: Direction | null
  readonly status: PacmanStatus
}

export interface GhostInit {
  readonly id: string
  readonly position: TilePosition
  readonly direction?: Direction | null
}

export interface GhostState {
  readonly id: string
  readonly position: TilePosition
  readonly direction: Direction | null
}

export interface PacmanGameSnapshot {
  readonly levelId: string
  readonly tick: number
  readonly pacman: PacmanState
  readonly ghosts: readonly GhostState[]
  readonly isPacmanDead: boolean
  readonly deathCount: number
}

export interface PacmanGameOptions {
  readonly maze?: MazeDefinition
  readonly pacmanSpawn?: TilePosition
  readonly ghosts?: readonly GhostInit[]
  readonly ghostMovement?: GhostMovementMode
}

export interface KeyboardEventLike {
  readonly key?: unknown
  readonly ctrlKey?: unknown
  readonly altKey?: unknown
  readonly metaKey?: unknown
  preventDefault?: () => void
}

export interface KeyboardEventTargetLike {
  addEventListener(type: 'keydown', listener: (event: KeyboardEventLike) => void): void
  removeEventListener(type: 'keydown', listener: (event: KeyboardEventLike) => void): void
}

export interface GameRenderSummary extends MazeRenderSummary {
  readonly pacmanCenterPx: { readonly x: number; readonly y: number }
  readonly pacmanStatus: PacmanStatus
  readonly renderedGhostCount: number
}

export interface PacmanGameEngine {
  getMaze(): MazeDefinition
  getSnapshot(): PacmanGameSnapshot
  getPacmanPosition(): TilePosition
  handleKeyInput(input: unknown): boolean
  tick(): PacmanGameSnapshot
  reset(options?: PacmanGameOptions): PacmanGameSnapshot
}
```

### 1.2 Spawn Constants (`PACMAN_SPAWN_POSITION`, `DEFAULT_GHOST_SPAWNS`)

1. `export const PACMAN_SPAWN_POSITION: TilePosition` MUST equal frozen `{ row: 23, col: 13 }`, which is an open `'corridor'` tile in `CLASSIC_MAZE` (`isTileTraversable(CLASSIC_MAZE, 23, 13) === true`).
2. `export const DEFAULT_GHOST_SPAWNS: readonly GhostInit[]` MUST contain at least one ghost on a traversable tile in `CLASSIC_MAZE` (`isTileTraversable(CLASSIC_MAZE, ghost.position.row, ghost.position.col) === true`) with a non-empty `id` and Manhattan distance `>= 8` from `PACMAN_SPAWN_POSITION` (e.g. `{ id: 'blinky', position: { row: 11, col: 13 } }`).

### 1.3 Desktop Keyboard Input Validation (`mapKeyToDirection`, `attachKeyboardControls`) (`REQ-002`, `REQ-004`)

1. `export function mapKeyToDirection(input: unknown): Direction | null`:
   - Accepts either a raw `string` key name or a `KeyboardEventLike` object `{ key, ctrlKey, altKey, metaKey }`.
   - When an object has `ctrlKey === true`, `altKey === true`, or `metaKey === true`, MUST return `null` so modified browser shortcuts are ignored.
   - Maps strictly the four case-sensitive desktop arrow key strings (`KeyboardEvent.key`):
     - `'ArrowUp'` → `'up'`
     - `'ArrowDown'` → `'down'`
     - `'ArrowLeft'` → `'left'`
     - `'ArrowRight'` → `'right'`
   - Returns `null` without throwing for **all** other inputs, including non-directional keys (`'Enter'`, `'Escape'`, `' '`, `'Tab'`, `'Shift'`, letters/WASD, digits, punctuation, function keys, lowercase `'arrowup'` / `'up'`), empty strings, `null`, `undefined`, numbers, booleans, arrays, and malformed objects.
2. `export function attachKeyboardControls(target: KeyboardEventTargetLike, game: PacmanGameEngine): () => void`:
   - Registers a `'keydown'` listener on `target`.
   - When `mapKeyToDirection(event)` is non-null, calls `event.preventDefault?.()` (preventing viewport arrow-key scrolling on desktop browsers) and forwards `event` to `game.handleKeyInput(event)`.
   - When `mapKeyToDirection(event)` is `null`, MUST NOT call `event.preventDefault?.()` and MUST leave `game` state unchanged.
   - Returns an idempotent `dispose()` cleanup function that removes the `'keydown'` listener from `target`.

### 1.4 Ghost Collision Helper (`checkGhostCollision`) (`REQ-002`)

Export `checkGhostCollision(pacmanPos: TilePosition, ghostPositions: readonly TilePosition[], prevPacmanPos?: TilePosition, prevGhostPositions?: readonly TilePosition[]): boolean`:

- Returns `true` when any ghost occupies the same tile as Pacman (`ghost.row === pacmanPos.row && ghost.col === pacmanPos.col`).
- When `prevPacmanPos` and `prevGhostPositions` are supplied, also returns `true` if any ghost `i` swapped tiles head-on with Pacman during the same tick (`prevPacmanPos.row === ghostPositions[i].row && prevPacmanPos.col === ghostPositions[i].col && prevGhostPositions[i].row === pacmanPos.row && prevGhostPositions[i].col === pacmanPos.col`).
- Otherwise returns `false`.

### 1.5 Deterministic Game Engine Factory (`createPacmanGame`) (`REQ-002`, `REQ-006`)

Export `createPacmanGame(options?: PacmanGameOptions): PacmanGameEngine`:

1. **Initialization & Spawn Validation**:
   - `maze` defaults to `CLASSIC_MAZE`.
   - `pacmanSpawn` defaults to `PACMAN_SPAWN_POSITION` when `maze === CLASSIC_MAZE` (and is required or must fall on a traversable tile for custom mazes).
   - `ghosts` defaults to `DEFAULT_GHOST_SPAWNS` when `options?.ghosts === undefined` and `maze === CLASSIC_MAZE`, and `[]` when `options?.ghosts === undefined` on a custom `maze`. When `options?.ghosts` is explicitly provided (including `[]`), those exact ghosts are used.
   - Throws an `Error` if `pacmanSpawn` is not traversable in `maze` (`!isTileTraversable(maze, pacmanSpawn.row, pacmanSpawn.col)`) or if any ghost has an empty `id` or non-traversable `position` in `maze`.
   - Initial `tick` is `0`, `pacman.direction` is `null`, and if `checkGhostCollision(pacmanSpawn, initialGhostPositions)` is `true`, Pacman starts with `status: 'dead'`, `isPacmanDead: true`, `deathCount: 1`; otherwise `status: 'alive'`, `isPacmanDead: false`, `deathCount: 0`.
2. **State Isolation & Encapsulation**:
   - Separate `createPacmanGame` instances share zero mutable state.
   - `getSnapshot()` and `getPacmanPosition()` return immutable/defensive copies so external mutations cannot corrupt internal engine state.
3. **Input Handling (`game.handleKeyInput(input)`)**:
   - Maps `input` via `mapKeyToDirection(input)`.
   - If `null` or if `pacman.status === 'dead'`, returns `false` without throwing and without modifying `tick`, `pacman.position`, `pacman.direction`, `pacman.status`, `isPacmanDead`, or `deathCount`.
   - If valid while `pacman.status === 'alive'`, sets `pacman.direction` to the mapped `Direction` without changing `pacman.position` or `tick` prior to `tick()`, and returns `true`.
4. **Per-Tick Update (`game.tick()`)**:
   - Increments `tick` by `1`.
   - If `pacman.status === 'dead'`, leaves `pacman.position` unchanged, keeps `pacman.status === 'dead'` and `isPacmanDead === true`, does not increment `deathCount`, and returns the new snapshot.
   - Resolves Pacman movement deterministically using `maze`:
     - If `pacman.direction === null`, `pacman.position` is unchanged.
     - Otherwise computes `resolveTileMovement(maze, pacman.position, pacman.direction)`:
       - Advances 1 tile in `pacman.direction` when `canMoveFromTile(maze, pacman.position, pacman.direction)` is `true`.
       - Leaves `pacman.position` unchanged when blocked by an interior wall, perimeter wall, or grid boundary (`row < 0`, `row >= maze.rows`, `col < 0`, `col >= maze.columns`).
   - When `ghostMovement === 'stationary'`, ghosts remain at their current positions across `tick()` (ensuring deterministic collision tests remain stable after Ghost AI is introduced in `#6`).
   - Evaluates `checkGhostCollision` after entity positions update for the tick. Upon collision, sets `pacman.status = 'dead'`, `pacman.direction = null`, `isPacmanDead = true`, and increments `deathCount` by `1`.
5. **Reset (`game.reset(options?)`)**:
   - Reinitializes the engine (using `options` if provided, or the original creation options otherwise) back to `tick = 0` and returns the fresh snapshot.

### 1.6 Canvas Game Renderer (`renderGameToCanvas`) (`REQ-002`, `REQ-006`)

Export `renderGameToCanvas(ctx: MazeCanvasContext, snapshot: PacmanGameSnapshot, maze?: MazeDefinition): GameRenderSummary`:

1. Defaults `maze` to `CLASSIC_MAZE` and delegates first to `renderMazeToCanvas(ctx, maze)` so the full canvas background, all wall tiles, and pellet spawns render identically to `ISS-3`.
2. Renders each ghost in `snapshot.ghosts` centered at `(ghost.position.col * tileSizePx + tileSizePx / 2, ghost.position.row * tileSizePx + tileSizePx / 2)` via `ctx.beginPath()`, `ctx.arc(...)`, and `ctx.fill()`.
3. Renders Pacman centered at `(cx, cy) = (pacman.position.col * tileSizePx + tileSizePx / 2, pacman.position.row * tileSizePx + tileSizePx / 2)` via `ctx.beginPath()`, `ctx.arc(cx, cy, radius, ...)` with `tileSizePx * 0.3 < radius < tileSizePx * 0.5` and `ctx.fill()`, using distinct `fillStyle` values for `pacman.status === 'alive'` versus `pacman.status === 'dead'`.
4. Returns `{ ...mazeSummary, pacmanCenterPx: { x: cx, y: cy }, pacmanStatus: snapshot.pacman.status, renderedGhostCount: snapshot.ghosts.length }`.

---

## 2. React `<App />` Integration (`web/src/App.tsx`)

1. Accept optional props `{ readonly game?: PacmanGameEngine; readonly tickIntervalMs?: number }`, defaulting `game` to a fresh `createPacmanGame()` instance and `tickIntervalMs` to a positive desktop cadence (e.g. `150`) when omitted.
2. Preserve all `ISS-3` `<canvas data-testid="game-canvas" ... />` attributes (`width`, `height`, `role="img"`, `aria-label`, `data-level-id`, `data-maze-cols`, `data-maze-rows`, `data-wall-tiles`, `data-corridor-tiles`, `data-pellet-spawns`) and expose Pacman state attributes derived from the current snapshot:
   - `data-pacman-row={snapshot.pacman.position.row}` (`"23"` initially on default game)
   - `data-pacman-col={snapshot.pacman.position.col}` (`"13"` initially on default game)
   - `data-pacman-status={snapshot.pacman.status}` (`"alive"` initially on default game)
3. On mount (`useEffect`), render the initial frame via `renderGameToCanvas(ctx, game.getSnapshot(), game.getMaze())`, bind desktop arrow-key controls via `attachKeyboardControls(window, game)`, start a `setInterval` timer (`tickIntervalMs`) that advances `game.tick()`, updates the rendered `<canvas>` attributes and frame via `renderGameToCanvas(ctx, nextSnapshot, game.getMaze())`, and clean up both the keyboard listener and `clearInterval` timer on unmount.
4. **Client-side ephemeral runtime (`REQ-001`, `REQ-005`, `REQ-007`)**:
   - Make zero network calls (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`).
   - Access zero browser persistence APIs (`localStorage`, `sessionStorage`, `indexedDB`).
   - Instantiate zero browser audio APIs (`AudioContext`, `webkitAudioContext`, `Audio`).
5. Remove `"ISS-5"` from `tests/acceptance/pending.json` once Issue `#4` satisfies all tests in `tests/acceptance/ISS-5/pacmanMovementAndInput.test.ts`.
