import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import {
  CLASSIC_MAZE,
  canMoveFromTile,
  createMazeFromSeed,
  getPelletSpawnPositions,
  getTileAt,
  isTileTraversable,
  isWallTile,
  renderMazeToCanvas,
  resolveTileMovement,
  type Direction,
  type MazeCanvasContext,
  type MazeDefinition,
  type TilePosition,
} from '../src/maze/classicMaze.ts'
import { DEMO_SEED, type DemoSeedMetadata } from '../src/seed/demoSeed.ts'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(currentDir, '..')

function createMockCanvasContext() {
  const clearRectCalls: { x: number; y: number; w: number; h: number }[] = []
  const fillRectCalls: { x: number; y: number; w: number; h: number; fillStyle: string }[] = []
  const filledArcs: { x: number; y: number; radius: number; fillStyle: string }[] = []
  let activeArc: { x: number; y: number; radius: number } | null = null
  let fillStyle: string | CanvasGradient | CanvasPattern = '#000000'

  const ctx: MazeCanvasContext = {
    get fillStyle() {
      return fillStyle
    },
    set fillStyle(next) {
      fillStyle = next
    },
    clearRect(x, y, w, h) {
      clearRectCalls.push({ x, y, w, h })
    },
    fillRect(x, y, w, h) {
      fillRectCalls.push({ x, y, w, h, fillStyle: String(fillStyle) })
    },
    beginPath() {
      activeArc = null
    },
    arc(x, y, radius) {
      activeArc = { x, y, radius }
    },
    fill() {
      if (activeArc !== null) {
        filledArcs.push({ ...activeArc, fillStyle: String(fillStyle) })
      }
    },
  }

  return { ctx, clearRectCalls, fillRectCalls, filledArcs }
}

test('CLASSIC_MAZE parses DEMO_SEED into an immutable, symmetric 28x31 connected grid', () => {
  assert.equal(CLASSIC_MAZE.levelId, DEMO_SEED.levelId)
  assert.equal(CLASSIC_MAZE.columns, 28)
  assert.equal(CLASSIC_MAZE.rows, 31)
  assert.equal(CLASSIC_MAZE.tileSizePx, 20)
  assert.equal(Object.isFrozen(CLASSIC_MAZE), true)
  assert.equal(Object.isFrozen(CLASSIC_MAZE.grid), true)

  const traversablePositions: TilePosition[] = []
  for (let row = 0; row < CLASSIC_MAZE.rows; row += 1) {
    assert.equal(Object.isFrozen(CLASSIC_MAZE.grid[row]), true)
    assert.equal(CLASSIC_MAZE.grid[row].length, CLASSIC_MAZE.columns)

    for (let col = 0; col < CLASSIC_MAZE.columns; col += 1) {
      const tile = getTileAt(CLASSIC_MAZE, row, col)
      const mirroredTile = getTileAt(CLASSIC_MAZE, row, CLASSIC_MAZE.columns - 1 - col)
      assert.equal(tile, mirroredTile, `Expected horizontal symmetry at (${row}, ${col})`)

      if (row === 0 || row === CLASSIC_MAZE.rows - 1 || col === 0 || col === CLASSIC_MAZE.columns - 1) {
        assert.equal(tile, 'wall')
      }

      if (tile !== 'wall') {
        traversablePositions.push({ row, col })
      }
    }
  }

  const spawns = getPelletSpawnPositions()
  const standardPellets = spawns.filter((s) => s.kind === 'pellet')
  const powerPellets = spawns.filter((s) => s.kind === 'power-pellet')
  assert.equal(standardPellets.length, 240)
  assert.equal(powerPellets.length, 4)

  const directions: readonly Direction[] = ['up', 'down', 'left', 'right']
  const visited = new Set<string>()
  const queue: TilePosition[] = [traversablePositions[0]]
  visited.add(`${traversablePositions[0].row},${traversablePositions[0].col}`)

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const dir of directions) {
      if (!canMoveFromTile(CLASSIC_MAZE, current, dir)) {
        continue
      }
      const next = resolveTileMovement(CLASSIC_MAZE, current, dir)
      const key = `${next.row},${next.col}`
      if (!visited.has(key)) {
        visited.add(key)
        queue.push(next)
      }
    }
  }

  assert.equal(
    visited.size,
    traversablePositions.length,
    'Expected every traversable tile in CLASSIC_MAZE to form a single connected component',
  )
})

test('Collision helpers handle bounds, non-integers, walls, and directional steps deterministically', () => {
  assert.equal(getTileAt(CLASSIC_MAZE, 0, 0), 'wall')
  assert.equal(getTileAt(CLASSIC_MAZE, 1, 1), 'pellet')
  assert.equal(getTileAt(CLASSIC_MAZE, 3, 1), 'power-pellet')
  assert.equal(getTileAt(CLASSIC_MAZE, 23, 13), 'corridor')

  for (const [row, col] of [
    [-1, 1],
    [1, -1],
    [31, 1],
    [1, 28],
    [1.5, 1],
    [1, 2.25],
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
  ] as const) {
    assert.equal(getTileAt(CLASSIC_MAZE, row, col), 'wall')
    assert.equal(isWallTile(CLASSIC_MAZE, row, col), true)
    assert.equal(isTileTraversable(CLASSIC_MAZE, row, col), false)
  }

  // (1, 1) has walls up (0, 1) and left (1, 0), and pellets right (1, 2) and down (2, 1)
  const topLeftCorner: TilePosition = { row: 1, col: 1 }
  assert.equal(canMoveFromTile(CLASSIC_MAZE, topLeftCorner, 'up'), false)
  assert.equal(canMoveFromTile(CLASSIC_MAZE, topLeftCorner, 'left'), false)
  assert.equal(canMoveFromTile(CLASSIC_MAZE, topLeftCorner, 'right'), true)
  assert.equal(canMoveFromTile(CLASSIC_MAZE, topLeftCorner, 'down'), true)

  assert.deepEqual(resolveTileMovement(CLASSIC_MAZE, topLeftCorner, 'up'), topLeftCorner)
  assert.deepEqual(resolveTileMovement(CLASSIC_MAZE, topLeftCorner, 'left'), topLeftCorner)
  assert.deepEqual(resolveTileMovement(CLASSIC_MAZE, topLeftCorner, 'right'), { row: 1, col: 2 })
  assert.deepEqual(resolveTileMovement(CLASSIC_MAZE, topLeftCorner, 'down'), { row: 2, col: 1 })

  // Movement from a wall tile is always rejected even when adjacent to a corridor
  const perimeterWall: TilePosition = { row: 0, col: 1 }
  assert.equal(canMoveFromTile(CLASSIC_MAZE, perimeterWall, 'down'), false)
  assert.deepEqual(resolveTileMovement(CLASSIC_MAZE, perimeterWall, 'down'), perimeterWall)
})

test('createMazeFromSeed validates dimensions and tile symbols', () => {
  const invalidRowsSeed: DemoSeedMetadata = {
    ...DEMO_SEED,
    rows: 2,
    columns: 3,
    layout: ['###'],
  }
  assert.throws(() => createMazeFromSeed(invalidRowsSeed), /Expected 2 maze rows/)

  const invalidColsSeed: DemoSeedMetadata = {
    ...DEMO_SEED,
    rows: 2,
    columns: 3,
    layout: ['###', '##'],
  }
  assert.throws(() => createMazeFromSeed(invalidColsSeed), /Expected 3 columns/)

  const invalidSymbolSeed: DemoSeedMetadata = {
    ...DEMO_SEED,
    rows: 3,
    columns: 3,
    layout: ['###', '#X#', '###'],
  }
  assert.throws(() => createMazeFromSeed(invalidSymbolSeed), /Unsupported maze tile symbol/)
})

test('renderMazeToCanvas renders background, wall blocks, pellets, and power pellets accurately', () => {
  const miniMaze: MazeDefinition = {
    levelId: 'mini-test',
    columns: 5,
    rows: 3,
    tileSizePx: 20,
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'pellet', 'corridor', 'power-pellet', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall'],
    ],
  }

  const { ctx, clearRectCalls, fillRectCalls, filledArcs } = createMockCanvasContext()
  const summary = renderMazeToCanvas(ctx, miniMaze)

  assert.deepEqual(summary, {
    width: 100,
    height: 60,
    renderedWallTileCount: 12,
    renderedCorridorTileCount: 3,
    renderedPelletCount: 2,
  })
  assert.deepEqual(clearRectCalls, [{ x: 0, y: 0, w: 100, h: 60 }])
  assert.equal(fillRectCalls.length, 1 + 12)
  assert.equal(filledArcs.length, 2)
  assert.equal(filledArcs[0].x, 30)
  assert.equal(filledArcs[0].y, 30)
  assert.equal(filledArcs[1].x, 70)
  assert.equal(filledArcs[1].y, 30)
  assert.ok(filledArcs[1].radius > filledArcs[0].radius)

  const defaultCtx = createMockCanvasContext()
  const defaultSummary = renderMazeToCanvas(defaultCtx.ctx)
  assert.equal(defaultSummary.width, 560)
  assert.equal(defaultSummary.height, 620)
  assert.equal(defaultSummary.renderedPelletCount, 244)
})

test('App renders game canvas with classic maze metadata attributes', async () => {
  const vite = await createServer({
    root: webRoot,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  })

  try {
    const mod = await vite.ssrLoadModule('/src/App.tsx')
    const html = renderToStaticMarkup(createElement(mod.App))

    const defaultCtx = createMockCanvasContext()
    const summary = renderMazeToCanvas(defaultCtx.ctx, CLASSIC_MAZE)

    assert.match(html, /data-level-id="classic-maze-seed"/)
    assert.match(html, /data-maze-cols="28"/)
    assert.match(html, /data-maze-rows="31"/)
    assert.match(html, new RegExp(`data-wall-tiles="${summary.renderedWallTileCount}"`))
    assert.match(html, new RegExp(`data-corridor-tiles="${summary.renderedCorridorTileCount}"`))
    assert.match(html, new RegExp(`data-pellet-spawns="${summary.renderedPelletCount}"`))
  } finally {
    await vite.close()
  }
})
