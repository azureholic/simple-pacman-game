import { DEMO_SEED, type DemoSeedMetadata } from '../seed/demoSeed.ts'

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

const CANVAS_BACKGROUND_COLOR = '#020617'
const WALL_TILE_COLOR = '#1d4ed8'
const PELLET_COLOR = '#fde68a'
const POWER_PELLET_COLOR = '#fde047'

function parseSeedChar(symbol: string, row: number, col: number): TileKind {
  switch (symbol) {
    case '#':
      return 'wall'
    case ' ':
      return 'corridor'
    case '.':
      return 'pellet'
    case 'o':
      return 'power-pellet'
    default:
      throw new Error(`Unsupported maze tile symbol "${symbol}" at (${row}, ${col})`)
  }
}

export function createMazeFromSeed(seed: DemoSeedMetadata): MazeDefinition {
  if (seed.layout.length !== seed.rows) {
    throw new Error(`Expected ${seed.rows} maze rows in seed, received ${seed.layout.length}`)
  }

  const parsedRows: (readonly TileKind[])[] = []
  for (let row = 0; row < seed.rows; row += 1) {
    const line = seed.layout[row]
    if (line.length !== seed.columns) {
      throw new Error(`Expected ${seed.columns} columns at row ${row}, received ${line.length}`)
    }

    const tiles: TileKind[] = []
    for (let col = 0; col < seed.columns; col += 1) {
      tiles.push(parseSeedChar(line[col], row, col))
    }
    parsedRows.push(Object.freeze(tiles))
  }

  return Object.freeze({
    levelId: seed.levelId,
    columns: seed.columns,
    rows: seed.rows,
    tileSizePx: seed.tileSizePx,
    grid: Object.freeze(parsedRows),
  })
}

export const CLASSIC_MAZE: MazeDefinition = createMazeFromSeed(DEMO_SEED)

export function getTileAt(maze: MazeDefinition, row: number, col: number): TileKind {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= maze.rows ||
    col < 0 ||
    col >= maze.columns
  ) {
    return 'wall'
  }

  const gridRow = maze.grid[row]
  if (!gridRow || col >= gridRow.length) {
    return 'wall'
  }

  return gridRow[col]
}

export function isWallTile(maze: MazeDefinition, row: number, col: number): boolean {
  return getTileAt(maze, row, col) === 'wall'
}

export function isTileTraversable(maze: MazeDefinition, row: number, col: number): boolean {
  const tile = getTileAt(maze, row, col)
  return tile === 'corridor' || tile === 'pellet' || tile === 'power-pellet'
}

function stepPosition(from: TilePosition, direction: Direction): TilePosition {
  switch (direction) {
    case 'up':
      return { row: from.row - 1, col: from.col }
    case 'down':
      return { row: from.row + 1, col: from.col }
    case 'left':
      return { row: from.row, col: from.col - 1 }
    case 'right':
      return { row: from.row, col: from.col + 1 }
  }
}

export function canMoveFromTile(
  maze: MazeDefinition,
  from: TilePosition,
  direction: Direction,
): boolean {
  if (!isTileTraversable(maze, from.row, from.col)) {
    return false
  }

  const target = stepPosition(from, direction)
  return isTileTraversable(maze, target.row, target.col)
}

export function resolveTileMovement(
  maze: MazeDefinition,
  from: TilePosition,
  direction: Direction,
): TilePosition {
  if (canMoveFromTile(maze, from, direction)) {
    return stepPosition(from, direction)
  }

  return { row: from.row, col: from.col }
}

export function getPelletSpawnPositions(
  maze: MazeDefinition = CLASSIC_MAZE,
): readonly PelletSpawn[] {
  const spawns: PelletSpawn[] = []

  for (let row = 0; row < maze.rows; row += 1) {
    for (let col = 0; col < maze.columns; col += 1) {
      const tile = getTileAt(maze, row, col)
      if (tile === 'pellet' || tile === 'power-pellet') {
        spawns.push({ row, col, kind: tile })
      }
    }
  }

  return spawns
}

export function renderMazeToCanvas(
  ctx: MazeCanvasContext,
  maze: MazeDefinition = CLASSIC_MAZE,
): MazeRenderSummary {
  const tileSize = maze.tileSizePx
  const width = maze.columns * tileSize
  const height = maze.rows * tileSize

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = CANVAS_BACKGROUND_COLOR
  ctx.fillRect(0, 0, width, height)

  const wallInset = tileSize > 2 ? 1 : 0
  const wallExtent = tileSize - wallInset * 2
  const pelletRadius = tileSize * 0.125
  const powerPelletRadius = tileSize * 0.3

  let renderedWallTileCount = 0
  let renderedCorridorTileCount = 0
  let renderedPelletCount = 0

  for (let row = 0; row < maze.rows; row += 1) {
    for (let col = 0; col < maze.columns; col += 1) {
      const tile = getTileAt(maze, row, col)
      const tileX = col * tileSize
      const tileY = row * tileSize

      if (tile === 'wall') {
        ctx.fillStyle = WALL_TILE_COLOR
        ctx.fillRect(tileX + wallInset, tileY + wallInset, wallExtent, wallExtent)
        renderedWallTileCount += 1
        continue
      }

      renderedCorridorTileCount += 1

      if (tile === 'pellet' || tile === 'power-pellet') {
        const centerX = tileX + tileSize / 2
        const centerY = tileY + tileSize / 2
        const radius = tile === 'power-pellet' ? powerPelletRadius : pelletRadius

        ctx.fillStyle = tile === 'power-pellet' ? POWER_PELLET_COLOR : PELLET_COLOR
        ctx.beginPath()
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
        ctx.fill()
        renderedPelletCount += 1
      }
    }
  }

  return {
    width,
    height,
    renderedWallTileCount,
    renderedCorridorTileCount,
    renderedPelletCount,
  }
}
