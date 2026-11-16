import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

type Direction = 'up' | 'down' | 'left' | 'right'
type TileKind = 'wall' | 'corridor' | 'pellet' | 'power-pellet'

interface TilePosition {
  readonly row: number
  readonly col: number
}

interface PelletSpawn extends TilePosition {
  readonly kind: 'pellet' | 'power-pellet'
}

interface MazeDefinition {
  readonly levelId: string
  readonly columns: number
  readonly rows: number
  readonly tileSizePx: number
  readonly grid: readonly (readonly TileKind[])[]
}

interface MazeRenderSummary {
  readonly width: number
  readonly height: number
  readonly renderedWallTileCount: number
  readonly renderedCorridorTileCount: number
  readonly renderedPelletCount: number
}

interface RecordedRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly fillStyle: string
}

interface RecordedArc {
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly fillStyle: string
}

interface ClassicMazeModule {
  readonly CLASSIC_MAZE: MazeDefinition
  getTileAt(maze: MazeDefinition, row: number, col: number): TileKind
  isWallTile(maze: MazeDefinition, row: number, col: number): boolean
  isTileTraversable(maze: MazeDefinition, row: number, col: number): boolean
  canMoveFromTile(maze: MazeDefinition, from: TilePosition, direction: Direction): boolean
  resolveTileMovement(maze: MazeDefinition, from: TilePosition, direction: Direction): TilePosition
  getPelletSpawnPositions(maze?: MazeDefinition): readonly PelletSpawn[]
  renderMazeToCanvas(ctx: unknown, maze?: MazeDefinition): MazeRenderSummary
}

interface DemoSeedMetadata {
  readonly levelId: string
  readonly columns: number
  readonly rows: number
  readonly tileSizePx: number
  readonly canvasWidth: number
  readonly canvasHeight: number
}

interface ViteServerLike {
  ssrLoadModule(url: string): Promise<Record<string, unknown>>
  close(): Promise<void>
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '..', '..', '..')
const webRoot = path.join(repoRoot, 'web')
const classicMazeFilePath = path.join(webRoot, 'src', 'maze', 'classicMaze.ts')
const webRequire = createRequire(path.join(webRoot, 'package.json'))

const VALID_TILE_KINDS = new Set<string>(['wall', 'corridor', 'pellet', 'power-pellet'])
const DIRECTIONS: readonly { readonly dir: Direction; readonly dRow: number; readonly dCol: number }[] = [
  { dir: 'up', dRow: -1, dCol: 0 },
  { dir: 'down', dRow: 1, dCol: 0 },
  { dir: 'left', dRow: 0, dCol: -1 },
  { dir: 'right', dRow: 0, dCol: 1 },
]

let sharedVite: ViteServerLike | null = null

async function getViteServer(): Promise<ViteServerLike> {
  if (sharedVite !== null) {
    return sharedVite
  }

  const viteUrl = pathToFileURL(webRequire.resolve('vite')).href
  const vitePkg = (await import(viteUrl)) as {
    createServer(config: Record<string, unknown>): Promise<ViteServerLike>
  }

  sharedVite = await vitePkg.createServer({
    root: webRoot,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  })

  return sharedVite
}

after(async () => {
  if (sharedVite !== null) {
    await sharedVite.close()
    sharedVite = null
  }
})

async function renderAppMarkup(): Promise<string> {
  const vite = await getViteServer()
  const reactUrl = pathToFileURL(webRequire.resolve('react')).href
  const reactDomServerUrl = pathToFileURL(webRequire.resolve('react-dom/server')).href

  const reactPkg = (await import(reactUrl)) as {
    createElement(component: unknown): unknown
  }
  const reactDomServerPkg = (await import(reactDomServerUrl)) as {
    renderToStaticMarkup(element: unknown): string
  }

  const appModule = await vite.ssrLoadModule('/src/App.tsx')
  assert.equal(typeof appModule.App, 'function', 'Expected /src/App.tsx to export App component')

  return reactDomServerPkg.renderToStaticMarkup(reactPkg.createElement(appModule.App))
}

async function loadDemoSeed(): Promise<DemoSeedMetadata> {
  const vite = await getViteServer()
  const mod = await vite.ssrLoadModule('/src/seed/demoSeed.ts')
  assert.ok(mod.DEMO_SEED && typeof mod.DEMO_SEED === 'object', 'Expected DEMO_SEED export in /src/seed/demoSeed.ts')
  return mod.DEMO_SEED as DemoSeedMetadata
}

async function loadClassicMazeModule(): Promise<ClassicMazeModule> {
  assert.equal(
    fs.existsSync(classicMazeFilePath),
    true,
    'Expected web/src/maze/classicMaze.ts to exist per ISS-3 contract.md',
  )

  const vite = await getViteServer()
  const mod = await vite.ssrLoadModule('/src/maze/classicMaze.ts')

  assert.ok(
    mod.CLASSIC_MAZE && typeof mod.CLASSIC_MAZE === 'object',
    'Expected CLASSIC_MAZE object export in web/src/maze/classicMaze.ts',
  )
  assert.equal(typeof mod.getTileAt, 'function', 'Expected getTileAt function export')
  assert.equal(typeof mod.isWallTile, 'function', 'Expected isWallTile function export')
  assert.equal(typeof mod.isTileTraversable, 'function', 'Expected isTileTraversable function export')
  assert.equal(typeof mod.canMoveFromTile, 'function', 'Expected canMoveFromTile function export')
  assert.equal(typeof mod.resolveTileMovement, 'function', 'Expected resolveTileMovement function export')
  assert.equal(typeof mod.getPelletSpawnPositions, 'function', 'Expected getPelletSpawnPositions function export')
  assert.equal(typeof mod.renderMazeToCanvas, 'function', 'Expected renderMazeToCanvas function export')

  return mod as unknown as ClassicMazeModule
}

function createRecordingCanvasContext() {
  const clearRects: RecordedRect[] = []
  const fillRects: RecordedRect[] = []
  const filledArcs: RecordedArc[] = []
  let pendingArcs: { x: number; y: number; radius: number }[] = []
  let currentFillStyle: unknown = '#000000'

  const ctx = {
    get fillStyle(): unknown {
      return currentFillStyle
    },
    set fillStyle(value: unknown) {
      currentFillStyle = value
    },
    strokeStyle: '#000000' as unknown,
    lineWidth: 1,
    globalAlpha: 1,
    save(): void {},
    restore(): void {},
    clearRect(x: number, y: number, w: number, h: number): void {
      clearRects.push({ x, y, w, h, fillStyle: String(currentFillStyle) })
    },
    fillRect(x: number, y: number, w: number, h: number): void {
      fillRects.push({ x, y, w, h, fillStyle: String(currentFillStyle) })
    },
    strokeRect(): void {},
    beginPath(): void {
      pendingArcs = []
    },
    closePath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    arc(x: number, y: number, radius: number): void {
      pendingArcs.push({ x, y, radius })
    },
    fill(): void {
      const style = String(currentFillStyle)
      for (const arc of pendingArcs) {
        filledArcs.push({ x: arc.x, y: arc.y, radius: arc.radius, fillStyle: style })
      }
    },
    stroke(): void {},
  }

  return { ctx, clearRects, fillRects, filledArcs }
}

function collectSourceFiles(dirPath: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath))
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath)
    }
  }
  return results
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

test('REQ-002_REQ-006_static_maze_renders_all_wall_tiles_on_canvas', async () => {
  const seed = await loadDemoSeed()
  const mazeMod = await loadClassicMazeModule()
  const { CLASSIC_MAZE, renderMazeToCanvas } = mazeMod

  assert.equal(CLASSIC_MAZE.levelId, seed.levelId)
  assert.equal(CLASSIC_MAZE.columns, seed.columns)
  assert.equal(CLASSIC_MAZE.rows, seed.rows)
  assert.equal(CLASSIC_MAZE.tileSizePx, seed.tileSizePx)
  assert.equal(CLASSIC_MAZE.grid.length, seed.rows)

  const expectedWalls = new Set<string>()
  let interiorWallCount = 0

  for (let row = 0; row < seed.rows; row += 1) {
    const gridRow = CLASSIC_MAZE.grid[row]
    assert.ok(Array.isArray(gridRow), `Expected row ${row} to be an array`)
    assert.equal(gridRow.length, seed.columns, `Expected row ${row} to contain ${seed.columns} tiles`)

    for (let col = 0; col < seed.columns; col += 1) {
      const tile: unknown = gridRow[col]
      assert.equal(
        typeof tile === 'string' && VALID_TILE_KINDS.has(tile),
        true,
        `Unexpected tile kind "${String(tile)}" at (${row}, ${col})`,
      )

      const isPerimeter = row === 0 || row === seed.rows - 1 || col === 0 || col === seed.columns - 1
      if (isPerimeter) {
        assert.equal(tile, 'wall', `Perimeter tile at (${row}, ${col}) must be a solid wall`)
      }

      if (tile === 'wall') {
        expectedWalls.add(`${row},${col}`)
        if (!isPerimeter) {
          interiorWallCount += 1
        }
      }
    }
  }

  assert.ok(interiorWallCount > 0, 'Expected classic maze to include interior wall obstacles inside the perimeter')

  const { ctx, fillRects } = createRecordingCanvasContext()
  const summary = renderMazeToCanvas(ctx, CLASSIC_MAZE)

  assert.equal(summary.width, seed.canvasWidth)
  assert.equal(summary.height, seed.canvasHeight)
  assert.equal(summary.renderedWallTileCount, expectedWalls.size)

  const fullCanvasBackgrounds = fillRects.filter(
    (r) => r.x === 0 && r.y === 0 && r.w === seed.canvasWidth && r.h === seed.canvasHeight,
  )
  const backgroundStyle = fullCanvasBackgrounds.length > 0 ? fullCanvasBackgrounds[0].fillStyle : null

  const tileFillRects = fillRects.filter(
    (r) => !(r.x === 0 && r.y === 0 && r.w === seed.canvasWidth && r.h === seed.canvasHeight),
  )

  const renderedWallCoords = new Set<string>()
  const tileSize = CLASSIC_MAZE.tileSizePx

  for (const rect of tileFillRects) {
    assert.ok(rect.w > 0 && rect.h > 0, 'Expected positive wall rectangle dimensions')
    const col = Math.floor(rect.x / tileSize)
    const row = Math.floor(rect.y / tileSize)

    assert.ok(
      row >= 0 && row < seed.rows && col >= 0 && col < seed.columns,
      `Wall fillRect (${rect.x}, ${rect.y}, ${rect.w}, ${rect.h}) fell outside canvas bounds`,
    )
    assert.ok(
      rect.x >= col * tileSize &&
        rect.y >= row * tileSize &&
        rect.x + rect.w <= (col + 1) * tileSize &&
        rect.y + rect.h <= (row + 1) * tileSize,
      `Wall fillRect (${rect.x}, ${rect.y}, ${rect.w}, ${rect.h}) overflowed tile (${row}, ${col})`,
    )
    if (backgroundStyle !== null) {
      assert.notEqual(
        rect.fillStyle,
        backgroundStyle,
        `Wall tile (${row}, ${col}) must render with a fillStyle distinct from the canvas background`,
      )
    }

    const key = `${row},${col}`
    assert.equal(
      expectedWalls.has(key),
      true,
      `fillRect drawn on non-wall corridor tile (${row}, ${col})`,
    )
    renderedWallCoords.add(key)
  }

  assert.equal(
    renderedWallCoords.size,
    expectedWalls.size,
    `Expected all ${expectedWalls.size} wall tiles to be rendered on canvas, got ${renderedWallCoords.size}`,
  )

  const html = await renderAppMarkup()
  assert.match(html, /data-testid="game-canvas"/)
  assert.match(html, new RegExp(`data-level-id="${seed.levelId}"`))
  assert.match(html, new RegExp(`data-maze-cols="${seed.columns}"`))
  assert.match(html, new RegExp(`data-maze-rows="${seed.rows}"`))
  assert.match(html, new RegExp(`data-wall-tiles="${expectedWalls.size}"`))
})

test('REQ-006_wall_tiles_and_bounds_block_movement_from_all_directions', async () => {
  const { CLASSIC_MAZE, getTileAt, isWallTile, isTileTraversable, canMoveFromTile, resolveTileMovement } =
    await loadClassicMazeModule()

  let wallCount = 0
  let blockedCorridorToWallAttempts = 0

  for (let row = 0; row < CLASSIC_MAZE.rows; row += 1) {
    for (let col = 0; col < CLASSIC_MAZE.columns; col += 1) {
      const kind = CLASSIC_MAZE.grid[row][col]
      if (kind !== 'wall') {
        continue
      }

      wallCount += 1
      assert.equal(getTileAt(CLASSIC_MAZE, row, col), 'wall')
      assert.equal(isWallTile(CLASSIC_MAZE, row, col), true)
      assert.equal(isTileTraversable(CLASSIC_MAZE, row, col), false)

      for (const { dir, dRow, dCol } of DIRECTIONS) {
        const neighborOrigin: TilePosition = { row: row - dRow, col: col - dCol }
        assert.equal(
          canMoveFromTile(CLASSIC_MAZE, neighborOrigin, dir),
          false,
          `Expected wall at (${row}, ${col}) to block ${dir} movement from (${neighborOrigin.row}, ${neighborOrigin.col})`,
        )
        assert.deepEqual(
          resolveTileMovement(CLASSIC_MAZE, neighborOrigin, dir),
          neighborOrigin,
          `Expected resolveTileMovement into wall (${row}, ${col}) to return unchanged origin`,
        )

        if (isTileTraversable(CLASSIC_MAZE, neighborOrigin.row, neighborOrigin.col)) {
          blockedCorridorToWallAttempts += 1
        }
      }
    }
  }

  assert.ok(wallCount > 0, 'Expected static maze to contain wall tiles')
  assert.ok(blockedCorridorToWallAttempts > 0, 'Expected corridor-to-wall movement attempts to be exercised')

  const outOfBoundsCoords: readonly TilePosition[] = [
    { row: -1, col: 0 },
    { row: 0, col: -1 },
    { row: CLASSIC_MAZE.rows, col: 0 },
    { row: 0, col: CLASSIC_MAZE.columns },
    { row: -5, col: 99 },
  ]

  for (const pos of outOfBoundsCoords) {
    assert.equal(getTileAt(CLASSIC_MAZE, pos.row, pos.col), 'wall')
    assert.equal(isWallTile(CLASSIC_MAZE, pos.row, pos.col), true)
    assert.equal(isTileTraversable(CLASSIC_MAZE, pos.row, pos.col), false)
  }
})

test('REQ-006_corridor_tiles_are_traversable_and_pellet_spawns_exist', async () => {
  const {
    CLASSIC_MAZE,
    isWallTile,
    isTileTraversable,
    canMoveFromTile,
    resolveTileMovement,
    getPelletSpawnPositions,
    renderMazeToCanvas,
  } = await loadClassicMazeModule()

  const expectedPellets: PelletSpawn[] = []
  let corridorTileCount = 0
  let validCorridorMoves = 0

  for (let row = 0; row < CLASSIC_MAZE.rows; row += 1) {
    for (let col = 0; col < CLASSIC_MAZE.columns; col += 1) {
      const tile = CLASSIC_MAZE.grid[row][col]
      if (tile === 'wall') {
        continue
      }

      corridorTileCount += 1
      assert.equal(isWallTile(CLASSIC_MAZE, row, col), false, `Corridor tile (${row}, ${col}) must not be a wall`)
      assert.equal(isTileTraversable(CLASSIC_MAZE, row, col), true, `Corridor tile (${row}, ${col}) must be traversable`)

      if (tile === 'pellet' || tile === 'power-pellet') {
        expectedPellets.push({ row, col, kind: tile })
      }

      for (const { dir, dRow, dCol } of DIRECTIONS) {
        const target: TilePosition = { row: row + dRow, col: col + dCol }
        if (isTileTraversable(CLASSIC_MAZE, target.row, target.col)) {
          validCorridorMoves += 1
          assert.equal(
            canMoveFromTile(CLASSIC_MAZE, { row, col }, dir),
            true,
            `Expected corridor step ${dir} from (${row}, ${col}) to (${target.row}, ${target.col}) to be allowed`,
          )
          assert.deepEqual(resolveTileMovement(CLASSIC_MAZE, { row, col }, dir), target)
        }
      }
    }
  }

  assert.ok(corridorTileCount > 0, 'Expected navigable corridor tiles in CLASSIC_MAZE')
  assert.ok(validCorridorMoves > 0, 'Expected connected corridor transitions in CLASSIC_MAZE')
  assert.ok(expectedPellets.length > 0, 'Expected pellet spawn positions in CLASSIC_MAZE')
  assert.ok(
    expectedPellets.some((p) => p.kind === 'pellet'),
    'Expected standard pellet spawn positions in CLASSIC_MAZE',
  )

  const pelletSpawns = getPelletSpawnPositions(CLASSIC_MAZE)
  const defaultPelletSpawns = getPelletSpawnPositions()
  assert.deepEqual(pelletSpawns, expectedPellets)
  assert.deepEqual(defaultPelletSpawns, expectedPellets)

  for (const spawn of pelletSpawns) {
    assert.equal(isWallTile(CLASSIC_MAZE, spawn.row, spawn.col), false)
    assert.equal(isTileTraversable(CLASSIC_MAZE, spawn.row, spawn.col), true)
  }

  // Verify all pellet spawns belong to a single traversable corridor component
  const visited = new Set<string>()
  const start = pelletSpawns[0]
  const queue: TilePosition[] = [{ row: start.row, col: start.col }]
  visited.add(`${start.row},${start.col}`)

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const { dir } of DIRECTIONS) {
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

  for (const spawn of pelletSpawns) {
    assert.equal(
      visited.has(`${spawn.row},${spawn.col}`),
      true,
      `Pellet spawn at (${spawn.row}, ${spawn.col}) must be reachable via navigable corridors`,
    )
  }

  const { ctx, filledArcs } = createRecordingCanvasContext()
  const summary = renderMazeToCanvas(ctx, CLASSIC_MAZE)
  assert.equal(summary.renderedCorridorTileCount, corridorTileCount)
  assert.equal(summary.renderedPelletCount, pelletSpawns.length)

  const tileSize = CLASSIC_MAZE.tileSizePx
  const renderedPelletCenters = new Set(
    filledArcs
      .filter((arc) => arc.radius > 0 && arc.radius < tileSize / 2)
      .map((arc) => `${arc.x},${arc.y}`),
  )

  for (const spawn of pelletSpawns) {
    const expectedCenterKey = `${spawn.col * tileSize + tileSize / 2},${spawn.row * tileSize + tileSize / 2}`
    assert.equal(
      renderedPelletCenters.has(expectedCenterKey),
      true,
      `Expected pellet at (${spawn.row}, ${spawn.col}) to be rendered at canvas center (${expectedCenterKey})`,
    )
  }

  const html = await renderAppMarkup()
  assert.match(html, new RegExp(`data-corridor-tiles="${corridorTileCount}"`))
  assert.match(html, new RegExp(`data-pellet-spawns="${pelletSpawns.length}"`))
})

test('REQ-001_REQ-007_render_makes_no_network_calls_and_accesses_no_local_storage', async () => {
  const networkEvents: string[] = []
  const storageEvents: string[] = []

  const globalRecord = globalThis as Record<string, unknown>
  const trackedGlobals = [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'localStorage',
    'sessionStorage',
    'indexedDB',
  ] as const

  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const key of trackedGlobals) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  }

  const createStorageTrap = (storageName: string) =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          storageEvents.push(`${storageName}.${String(prop)}`)
          return () => null
        },
        set(_target, prop) {
          storageEvents.push(`${storageName}.${String(prop)}=`)
          return true
        },
      },
    )

  const localStorageProxy = createStorageTrap('localStorage')
  const sessionStorageProxy = createStorageTrap('sessionStorage')

  try {
    globalRecord.fetch = async (input: unknown) => {
      networkEvents.push(`fetch:${String(input)}`)
      throw new Error('Unexpected network fetch during static maze render')
    }

    globalRecord.XMLHttpRequest = class MockXMLHttpRequest {
      constructor() {
        networkEvents.push('XMLHttpRequest:construct')
      }
      open(_method: string, url: string): void {
        networkEvents.push(`XMLHttpRequest:open:${url}`)
      }
      send(): void {
        networkEvents.push('XMLHttpRequest:send')
      }
    }

    globalRecord.WebSocket = class MockWebSocket {
      constructor(url: string) {
        networkEvents.push(`WebSocket:${url}`)
      }
    }

    globalRecord.EventSource = class MockEventSource {
      constructor(url: string) {
        networkEvents.push(`EventSource:${url}`)
      }
    }

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      enumerable: true,
      get() {
        storageEvents.push('localStorage')
        return localStorageProxy
      },
    })

    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      enumerable: true,
      get() {
        storageEvents.push('sessionStorage')
        return sessionStorageProxy
      },
    })

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      enumerable: true,
      get() {
        storageEvents.push('indexedDB')
        return undefined
      },
    })

    const mazeMod = await loadClassicMazeModule()
    const html = await renderAppMarkup()
    const { ctx } = createRecordingCanvasContext()
    const summary = mazeMod.renderMazeToCanvas(ctx, mazeMod.CLASSIC_MAZE)

    assert.deepEqual(networkEvents, [], 'Expected zero network calls during maze module load and render')
    assert.deepEqual(storageEvents, [], 'Expected zero browser storage accesses during maze module load and render')

    assert.match(html, /data-level-id="classic-maze-seed"/)
    assert.ok(summary.renderedWallTileCount > 0, 'Expected maze walls to render without network or storage access')
    assert.ok(summary.renderedPelletCount > 0, 'Expected pellet spawns to render without network or storage access')
  } finally {
    for (const key of trackedGlobals) {
      const descriptor = originalDescriptors.get(key)
      if (descriptor === undefined) {
        delete globalRecord[key]
      } else {
        Object.defineProperty(globalThis, key, descriptor)
      }
    }
  }

  const sourceFiles = collectSourceFiles(path.join(webRoot, 'src'))
  assert.ok(sourceFiles.length > 0, 'Expected frontend TypeScript source files under web/src')

  for (const filePath of sourceFiles) {
    const code = stripComments(fs.readFileSync(filePath, 'utf8'))
    const relPath = path.relative(repoRoot, filePath)
    assert.doesNotMatch(code, /\bfetch\s*\(/, `Disallowed fetch() call in ${relPath}`)
    assert.doesNotMatch(code, /\bXMLHttpRequest\b/, `Disallowed XMLHttpRequest usage in ${relPath}`)
    assert.doesNotMatch(code, /\bWebSocket\b/, `Disallowed WebSocket usage in ${relPath}`)
    assert.doesNotMatch(code, /\bEventSource\b/, `Disallowed EventSource usage in ${relPath}`)
    assert.doesNotMatch(code, /\bsendBeacon\s*\(/, `Disallowed navigator.sendBeacon() call in ${relPath}`)
    assert.doesNotMatch(code, /\blocalStorage\b/, `Disallowed localStorage access in ${relPath}`)
    assert.doesNotMatch(code, /\bsessionStorage\b/, `Disallowed sessionStorage access in ${relPath}`)
    assert.doesNotMatch(code, /\bindexedDB\b/, `Disallowed indexedDB access in ${relPath}`)
  }
})
