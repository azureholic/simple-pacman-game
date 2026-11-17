# ISS-7 Interface Contract — Ghost AI & Collision Validation

- **Acceptance Issue**: `#7` (`AT: Ghost AI and collision validation`)
- **Implementation Issue**: `#6` (`Ghost AI and entity collision`)
- **Requirements Covered**: `REQ-001`, `REQ-002`, `REQ-005`, `REQ-006`, `REQ-007`
- **Upstream Contracts**: `tests/acceptance/ISS-3/contract.md`, `tests/acceptance/ISS-5/contract.md`

---

## 1. Module & Export Contract (`web/src/game/pacmanEngine.ts`)

Extend `web/src/game/pacmanEngine.ts` with deterministic, client-side classic Ghost AI pathing and entity collision resolution while preserving 100% backwards compatibility with all `ISS-3` and `ISS-5` types, constants, and functions.

*(Additional readonly fields or optional parameters on exported interfaces and functions remain permitted for downstream issue `#8` provided all `ISS-3`, `ISS-5`, and `ISS-7` signatures and semantics remain backwards-compatible.)*

### 1.1 Ghost AI Exports (`GHOST_DIRECTION_PRIORITY`, `chooseGhostDirection`, `stepGhostState`)

```ts
import type { Direction, MazeDefinition, TilePosition } from '../maze/classicMaze.ts'
import type { GhostState } from './pacmanEngine.ts'

export const GHOST_DIRECTION_PRIORITY: readonly Direction[]

export function chooseGhostDirection(
  maze: MazeDefinition,
  ghost: GhostState,
  targetPos: TilePosition,
): Direction | null

export function stepGhostState(
  maze: MazeDefinition,
  ghost: GhostState,
  targetPos: TilePosition,
): GhostState
```

1. **`GHOST_DIRECTION_PRIORITY`**:
   - Must equal frozen `['up', 'left', 'down', 'right']` (classic arcade direction tie-breaker order).

2. **`chooseGhostDirection(maze, ghost, targetPos)` (`REQ-001`, `REQ-002`, `REQ-006`)**:
   - Pure, synchronous, deterministic client-side function. Must **never** invoke `Math.random()` or any network, storage, or audio API.
   - If `!isTileTraversable(maze, ghost.position.row, ghost.position.col)` (wall or out-of-bounds origin), returns `null`.
   - Collects all traversable cardinal directions from `ghost.position` in priority order:
     `validDirs = GHOST_DIRECTION_PRIORITY.filter((dir) => canMoveFromTile(maze, ghost.position, dir))`.
   - If `validDirs.length === 0` (completely walled-in pocket), returns `null`.
   - **Classic non-reverse rule**:
     - Let `opposite` map `'up' <-> 'down'` and `'left' <-> 'right'`.
     - When `ghost.direction !== null` and `validDirs.length > 1`, exclude `opposite[ghost.direction]` so ghosts do not reverse mid-corridor when another open path exists.
     - When `ghost.direction === null` or `validDirs.length === 1` (dead end), retain `validDirs` so ghosts cleanly reverse out of dead ends.
   - **Deterministic chase selection**:
     - For each candidate `dir`, let `nextPos = resolveTileMovement(maze, ghost.position, dir)`.
     - Select the candidate `dir` that minimizes, in order:
       1. **BFS shortest-path distance** in `maze` via 4-directional traversable tiles from `nextPos` to `targetPos` (`0` when `nextPos.row === targetPos.row && nextPos.col === targetPos.col`; `Number.POSITIVE_INFINITY` when `targetPos` is non-traversable or unreachable in `maze`),
       2. **Manhattan distance** `Math.abs(nextPos.row - targetPos.row) + Math.abs(nextPos.col - targetPos.col)`,
       3. **`GHOST_DIRECTION_PRIORITY`** order (`'up'`, `'left'`, `'down'`, `'right'`).

3. **`stepGhostState(maze, ghost, targetPos)` (`REQ-002`, `REQ-006`)**:
   - Pure function that does not mutate its `ghost` input and returns a deeply frozen `GhostState` (`Object.freeze({ id: ghost.id, position: Object.freeze({ row, col }), direction })`).
   - Evaluates `nextDirection = chooseGhostDirection(maze, ghost, targetPos)`:
     - When `nextDirection === null`, returns `{ id: ghost.id, position: { row: ghost.position.row, col: ghost.position.col }, direction: null }`.
     - Otherwise computes `nextPos = resolveTileMovement(maze, ghost.position, nextDirection)` and returns `{ id: ghost.id, position: nextPos, direction: nextDirection }`.
   - Guarantees that any ghost on a traversable tile moves at most `1` cardinal tile per tick (`|dRow| + |dCol| <= 1`), never moves diagonally, never enters a `'wall'` tile, and never steps outside `0 <= row < maze.rows` and `0 <= col < maze.columns`.

### 1.2 Game Engine Ghost AI & Entity Collision (`createPacmanGame`) (`REQ-001`, `REQ-002`, `REQ-006`)

1. **Movement Mode Default & Validation**:
   - `options?.ghostMovement` defaults to `'ai'` when omitted (`options?.ghostMovement ?? 'ai'`).
   - When `options?.ghostMovement === 'stationary'`, ghosts remain at their current positions and directions across `tick()` (preserving all `ISS-5` stationary collision behavior).
   - Throws an `Error` on `createPacmanGame(options)` and `game.reset(options)` if `options?.ghostMovement` is provided and is neither `'ai'` nor `'stationary'` (without corrupting existing engine state on a failed `reset`).

2. **Simultaneous Per-Tick Update & Collision Resolution (`game.tick()`)**:
   - Increments `tick` by `1`.
   - If `pacman.status === 'dead'` prior to the tick, leaves `pacman.position`, `pacman.direction`, `ghosts`, and `deathCount` unchanged and returns the frozen snapshot.
   - Records `prevPacmanPos` and `prevGhostPositions` at the start of the tick before moving any entity.
   - Updates `pacman.position` via `resolveTileMovement(maze, prevPacmanPos, pacman.direction)` when `pacman.direction !== null`.
   - When `ghostMovement === 'ai'`, updates **every** ghost in `ghosts` via `stepGhostState(maze, ghost, prevPacmanPos)` (targeting `prevPacmanPos` — Pacman's position at the start of the tick — so simultaneous corridor movement and head-on adjacent tile swaps resolve deterministically).
   - Evaluates `checkGhostCollision(pacman.position, currentGhostPositions, prevPacmanPos, prevGhostPositions)`:
     - Triggers when any ghost occupies `pacman.position` after the tick (ghost steps onto stationary Pacman, Pacman steps onto ghost, or moving Pacman and moving ghost land on the same tile) **or** when Pacman and any ghost swap tiles head-on during the tick.
     - Upon collision, transitions `pacman.status = 'dead'`, `pacman.direction = null`, `isPacmanDead = true`, and increments `deathCount` by `1`.

3. **Determinism, Snapshot Isolation & Reset**:
   - Separate `createPacmanGame` instances share zero mutable state.
   - `getSnapshot()` returns frozen `snapshot`, `snapshot.ghosts`, each `GhostState`, and each `GhostState.position` so caller mutation attempts cannot alter internal ghost state.
   - Running identical options and key inputs across separate `createPacmanGame` instances or after `game.reset()` produces identical tick-by-tick `ghosts` positions, directions, and collision outcomes.

---

## 2. React `<App />` Integration (`web/src/App.tsx`)

1. When `game` prop is omitted, `<App />` initializes `createPacmanGame()` (running `ghostMovement: 'ai'` with `DEFAULT_GHOST_SPAWNS` on `CLASSIC_MAZE`).
2. Preserve all `ISS-3` and `ISS-5` `<canvas data-testid="game-canvas" ... />` attributes and additionally expose:
   - `data-ghost-count={snapshot.ghosts.length}` (`"4"` on the default `CLASSIC_MAZE` game)
3. On each interval tick (`tickIntervalMs`), `<App />` advances `game.tick()`, updates `data-pacman-row`, `data-pacman-col`, `data-pacman-status`, and `data-ghost-count`, and redraws the maze, moving ghosts, and Pacman (alive or dead) onto `<canvas>` via `renderGameToCanvas`.
4. **Client-side ephemeral runtime (`REQ-001`, `REQ-005`, `REQ-007`)**:
   - Make zero network calls (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`).
   - Access zero browser persistence APIs (`localStorage`, `sessionStorage`, `indexedDB`).
   - Instantiate zero browser audio APIs (`AudioContext`, `webkitAudioContext`, `Audio`).
5. Remove `"ISS-7"` from `tests/acceptance/pending.json` once Issue `#6` satisfies all tests in `tests/acceptance/ISS-7/ghostAiAndCollision.test.ts`.
