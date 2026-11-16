# ISS-3 Interface Contract — Classic Maze Rendering & Collision Validation

- **Acceptance Issue**: `#3` (`AT: Maze rendering and collision validation`)
- **Implementation Issue**: `#2` (`Maze rendering and collision grid`)
- **Requirements Covered**: `REQ-001`, `REQ-002`, `REQ-006`, `REQ-007`
- **Synthetic Seed Source**: `web/src/seed/demoSeed.ts` (`DEMO_SEED`)

---

## 1. Module & Export Contract (`web/src/maze/classicMaze.ts`)

Create `web/src/maze/classicMaze.ts` exporting the static classic maze definition, collision/movement helpers, pellet spawn query, and 2D `<canvas>` renderer derived from `DEMO_SEED`.

### 1.1 Types

```ts
export type Direction = 'up' | 'down' | 'left' | 'right'

export type TileKind = 'wall' | 'corridor' | 'pellet' | 'power-pellet'

export interface TilePosition {
  readonly row: number
  readonly col: number
}

export interface PelletSpawn extends TilePosition {
  readonly kind: 'pellet' | 'power-pellet'
}

export interface MazeDefinition {
  readonly levelId: string
  readonly columns: number
  readonly rows: number
  readonly tileSizePx: number
  readonly grid: readonly (readonly TileKind[])[]
}

export interface MazeRenderSummary {
  readonly width: number
  readonly height: number
  readonly renderedWallTileCount: number
  readonly renderedCorridorTileCount: number
  readonly renderedPelletCount: number
}

export interface MazeCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  clearRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void
  fill(fillRule?: CanvasFillRule): void
}
```

### 1.2 Static Maze Constant (`CLASSIC_MAZE`)

`export const CLASSIC_MAZE: MazeDefinition` MUST satisfy:

1. **Seed alignment**:
   - `CLASSIC_MAZE.levelId === DEMO_SEED.levelId` (`'classic-maze-seed'`)
   - `CLASSIC_MAZE.columns === DEMO_SEED.columns` (`28`)
   - `CLASSIC_MAZE.rows === DEMO_SEED.rows` (`31`)
   - `CLASSIC_MAZE.tileSizePx === DEMO_SEED.tileSizePx` (`20`)
2. **Grid dimensions & immutability**:
   - `CLASSIC_MAZE.grid.length === 31`
   - Every row `CLASSIC_MAZE.grid[row]` has `length === 28`
   - Every cell is `'wall' | 'corridor' | 'pellet' | 'power-pellet'`
3. **Classic walls, corridors, and pellet spawns (`REQ-006`)**:
   - Outer perimeter cells (`row === 0`, `row === rows - 1`, `col === 0`, `col === columns - 1`) MUST all be `'wall'`.
   - Interior cells (`1 <= row < rows - 1`, `1 <= col < columns - 1`) MUST include both interior `'wall'` obstacles and navigable corridor tiles (`'corridor' | 'pellet' | 'power-pellet'`).
   - At least one `'pellet'` spawn tile MUST exist (`getPelletSpawnPositions(CLASSIC_MAZE).length > 0`).
   - Every pellet spawn (`'pellet'` or `'power-pellet'`) MUST belong to a single 4-directionally connected component of traversable corridor tiles (`'corridor' | 'pellet' | 'power-pellet'`), ensuring no pellet is walled off.

### 1.3 Collision & Pellet Spawn Functions (`REQ-006`)

Export the following pure, deterministic functions from `web/src/maze/classicMaze.ts`:

- `getTileAt(maze: MazeDefinition, row: number, col: number): TileKind`
  - Returns `maze.grid[row][col]` when `row` and `col` are integers within `0 <= row < maze.rows` and `0 <= col < maze.columns`.
  - Returns `'wall'` for out-of-bounds or non-integer coordinates.
- `isWallTile(maze: MazeDefinition, row: number, col: number): boolean`
  - Returns `true` iff `getTileAt(maze, row, col) === 'wall'`.
- `isTileTraversable(maze: MazeDefinition, row: number, col: number): boolean`
  - Returns `true` iff `getTileAt(maze, row, col)` is `'corridor'`, `'pellet'`, or `'power-pellet'` (and `false` for `'wall'` or out-of-bounds).
- `canMoveFromTile(maze: MazeDefinition, from: TilePosition, direction: Direction): boolean`
  - Evaluates a single-tile step from `from` in `direction`:
    - `'up'`: `{ row: from.row - 1, col: from.col }`
    - `'down'`: `{ row: from.row + 1, col: from.col }`
    - `'left'`: `{ row: from.row, col: from.col - 1 }`
    - `'right'`: `{ row: from.row, col: from.col + 1 }`
  - Returns `true` iff both `isTileTraversable(maze, from.row, from.col)` and `isTileTraversable(maze, target.row, target.col)` are `true`.
- `resolveTileMovement(maze: MazeDefinition, from: TilePosition, direction: Direction): TilePosition`
  - Returns the adjacent `{ row, col }` when `canMoveFromTile(maze, from, direction)` is `true`.
  - Otherwise blocks movement and returns `{ row: from.row, col: from.col }`.
- `getPelletSpawnPositions(maze?: MazeDefinition): readonly PelletSpawn[]`
  - Defaults `maze` to `CLASSIC_MAZE` when omitted.
  - Scans `maze.grid` in row-major order (`row = 0..maze.rows - 1`, `col = 0..maze.columns - 1`) and returns `{ row, col, kind }` for every `'pellet'` and `'power-pellet'` tile.

### 1.4 HTML5 2D Canvas Renderer (`REQ-002`, `REQ-006`)

Export `renderMazeToCanvas(ctx: MazeCanvasContext, maze?: MazeDefinition): MazeRenderSummary` (optional trailing parameters with backwards-compatible defaults are permitted for downstream issues):

1. Defaults `maze` to `CLASSIC_MAZE` and computes `width = maze.columns * maze.tileSizePx` (`560`) and `height = maze.rows * maze.tileSizePx` (`620`).
2. Clears/fills the full `[0, 0, width, height]` background (`ctx.clearRect(0, 0, width, height)` followed by `ctx.fillRect(0, 0, width, height)` using a dark canvas background `fillStyle`, e.g. `'#020617'`).
3. Renders **every** `'wall'` tile `(row, col)` via `ctx.fillRect(x, y, w, h)` inside `[col * tileSizePx, row * tileSizePx, tileSizePx, tileSizePx]` (`x >= col * tileSizePx`, `y >= row * tileSizePx`, `x + w <= (col + 1) * tileSizePx`, `y + h <= (row + 1) * tileSizePx`, `w > 0`, `h > 0`) with a wall `fillStyle` distinct from the canvas background `fillStyle` (e.g. `'#1d4ed8'`). Do not draw `fillRect` calls inside traversable corridor cells.
4. Renders **every** pellet spawn (`'pellet'` or `'power-pellet'`) at `(row, col)` as a circle centered at `(col * tileSizePx + tileSizePx / 2, row * tileSizePx + tileSizePx / 2)` via `ctx.beginPath()`, `ctx.arc(cx, cy, radius, 0, Math.PI * 2)` (`0 < radius < tileSizePx / 2`), and `ctx.fill()`.
5. Returns `{ width, height, renderedWallTileCount, renderedCorridorTileCount, renderedPelletCount }` matching the exact wall, traversable corridor, and pellet spawn counts of `maze`.

---

## 2. React `<App />` Integration (`web/src/App.tsx`)

1. Render `<canvas data-testid="game-canvas" width={560} height={620} role="img" ... />` with deterministic attributes derived from `CLASSIC_MAZE`:
   - `data-level-id={CLASSIC_MAZE.levelId}` (`"classic-maze-seed"`)
   - `data-maze-cols={CLASSIC_MAZE.columns}` (`"28"`)
   - `data-maze-rows={CLASSIC_MAZE.rows}` (`"31"`)
   - `data-wall-tiles={wallTileCount}`
   - `data-corridor-tiles={corridorTileCount}`
   - `data-pellet-spawns={pelletSpawnCount}`
2. On mount (`useEffect`), acquire the `<canvas>` 2D context and invoke `renderMazeToCanvas(ctx, CLASSIC_MAZE)`.
3. **Client-side ephemeral runtime (`REQ-001`, `REQ-007`)**:
   - Make zero network calls (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`) during module load or render.
   - Access zero browser persistence APIs (`localStorage`, `sessionStorage`, `indexedDB`) during module load or render.
4. Remove `"ISS-3"` from `tests/acceptance/pending.json` once Issue `#2` satisfies all tests in `tests/acceptance/ISS-3/mazeRenderingAndCollision.test.ts`.
