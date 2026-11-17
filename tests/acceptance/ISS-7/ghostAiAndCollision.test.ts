import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

type Direction = 'up' | 'down' | 'left' | 'right'
type TileKind = 'wall' | 'corridor' | 'pellet' | 'power-pellet'
type PacmanStatus = 'alive' | 'dead'
type GhostMovementMode = 'stationary' | 'ai'

interface TilePosition {
  readonly row: number
  readonly col: number
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

interface PacmanState {
  readonly position: TilePosition
  readonly direction: Direction | null
  readonly status: PacmanStatus
}

interface GhostInit {
  readonly id: string
  readonly position: TilePosition
  readonly direction?: Direction | null
}

interface GhostState {
  readonly id: string
  readonly position: TilePosition
  readonly direction: Direction | null
}

interface PacmanGameSnapshot {
  readonly levelId: string
  readonly tick: number
  readonly pacman: PacmanState
  readonly ghosts: readonly GhostState[]
  readonly isPacmanDead: boolean
  readonly deathCount: number
}

interface PacmanGameOptions {
  readonly maze?: MazeDefinition
  readonly pacmanSpawn?: TilePosition
  readonly ghosts?: readonly GhostInit[]
  readonly ghostMovement?: GhostMovementMode
}

interface KeyboardEventLike {
  readonly key?: unknown
  readonly ctrlKey?: unknown
  readonly altKey?: unknown
  readonly metaKey?: unknown
  preventDefault?: () => void
}

interface GameRenderSummary extends MazeRenderSummary {
  readonly pacmanCenterPx: { readonly x: number; readonly y: number }
  readonly pacmanStatus: PacmanStatus
  readonly renderedGhostCount: number
}

interface PacmanGameEngine {
  getMaze(): MazeDefinition
  getSnapshot(): PacmanGameSnapshot
  getPacmanPosition(): TilePosition
  handleKeyInput(input: unknown): boolean
  tick(): PacmanGameSnapshot
  reset(options?: PacmanGameOptions): PacmanGameSnapshot
}

interface ClassicMazeModule {
  readonly CLASSIC_MAZE: MazeDefinition
  isWallTile(maze: MazeDefinition, row: number, col: number): boolean
  isTileTraversable(maze: MazeDefinition, row: number, col: number): boolean
  canMoveFromTile(maze: MazeDefinition, from: TilePosition, direction: Direction): boolean
  resolveTileMovement(maze: MazeDefinition, from: TilePosition, direction: Direction): TilePosition
}

interface PacmanEngineBaseModule {
  readonly PACMAN_SPAWN_POSITION: TilePosition
  readonly DEFAULT_GHOST_SPAWNS: readonly GhostInit[]
  checkGhostCollision(
    pacmanPos: TilePosition,
    ghostPositions: readonly TilePosition[],
    prevPacmanPos?: TilePosition,
    prevGhostPositions?: readonly TilePosition[],
  ): boolean
  createPacmanGame(options?: PacmanGameOptions): PacmanGameEngine
  renderGameToCanvas(
    ctx: unknown,
    snapshot: PacmanGameSnapshot,
    maze?: MazeDefinition,
  ): GameRenderSummary
}

interface GhostAiExports {
  readonly GHOST_DIRECTION_PRIORITY: readonly Direction[]
  chooseGhostDirection(
    maze: MazeDefinition,
    ghost: GhostState,
    targetPos: TilePosition,
  ): Direction | null
  stepGhostState(maze: MazeDefinition, ghost: GhostState, targetPos: TilePosition): GhostState
}

interface RecordedArc {
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly fillStyle: string
}

interface ViteServerLike {
  ssrLoadModule(url: string): Promise<Record<string, unknown>>
  close(): Promise<void>
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '..', '..', '..')
const webRoot = path.join(repoRoot, 'web')
const pacmanEngineFilePath = path.join(webRoot, 'src', 'game', 'pacmanEngine.ts')
const webRequire = createRequire(path.join(webRoot, 'package.json'))

const ALL_DIRECTIONS: readonly Direction[] = ['up', 'left', 'down', 'right']

let sharedVite: ViteServerLike | null = null

async function createViteInstance(): Promise<ViteServerLike> {
  const viteUrl = pathToFileURL(webRequire.resolve('vite')).href
  const vitePkg = (await import(viteUrl)) as {
    createServer(config: Record<string, unknown>): Promise<ViteServerLike>
  }

  return vitePkg.createServer({
    root: webRoot,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  })
}

async function getViteServer(): Promise<ViteServerLike> {
  if (sharedVite === null) {
    sharedVite = await createViteInstance()
  }
  return sharedVite
}

after(async () => {
  if (sharedVite !== null) {
    await sharedVite.close()
    sharedVite = null
  }
})

async function loadClassicMazeModule(viteInstance?: ViteServerLike): Promise<ClassicMazeModule> {
  const vite = viteInstance ?? (await getViteServer())
  const mod = await vite.ssrLoadModule('/src/maze/classicMaze.ts')
  assert.ok(mod.CLASSIC_MAZE && typeof mod.CLASSIC_MAZE === 'object', 'Expected CLASSIC_MAZE export')
  return mod as unknown as ClassicMazeModule
}

async function loadPacmanEngineModule(
  viteInstance?: ViteServerLike,
): Promise<PacmanEngineBaseModule & Record<string, unknown>> {
  assert.equal(
    fs.existsSync(pacmanEngineFilePath),
    true,
    'Expected web/src/game/pacmanEngine.ts to exist',
  )

  const vite = viteInstance ?? (await getViteServer())
  const mod = await vite.ssrLoadModule('/src/game/pacmanEngine.ts')

  assert.ok(mod.PACMAN_SPAWN_POSITION && typeof mod.PACMAN_SPAWN_POSITION === 'object')
  assert.ok(Array.isArray(mod.DEFAULT_GHOST_SPAWNS))
  assert.equal(typeof mod.checkGhostCollision, 'function')
  assert.equal(typeof mod.createPacmanGame, 'function')
  assert.equal(typeof mod.renderGameToCanvas, 'function')

  return mod as unknown as PacmanEngineBaseModule & Record<string, unknown>
}

function requireGhostAiExports(mod: Record<string, unknown>): GhostAiExports {
  assert.ok(
    Array.isArray(mod.GHOST_DIRECTION_PRIORITY),
    'Expected GHOST_DIRECTION_PRIORITY array export in web/src/game/pacmanEngine.ts per ISS-7 contract.md',
  )
  assert.equal(
    typeof mod.chooseGhostDirection,
    'function',
    'Expected chooseGhostDirection function export in web/src/game/pacmanEngine.ts per ISS-7 contract.md',
  )
  assert.equal(
    typeof mod.stepGhostState,
    'function',
    'Expected stepGhostState function export in web/src/game/pacmanEngine.ts per ISS-7 contract.md',
  )
  return mod as unknown as GhostAiExports
}

async function renderAppMarkup(
  props: Record<string, unknown> = {},
  viteInstance?: ViteServerLike,
): Promise<string> {
  const vite = viteInstance ?? (await getViteServer())
  const reactUrl = pathToFileURL(webRequire.resolve('react')).href
  const reactDomServerUrl = pathToFileURL(webRequire.resolve('react-dom/server')).href

  const reactPkg = (await import(reactUrl)) as {
    createElement(component: unknown, props?: Record<string, unknown>): unknown
  }
  const reactDomServerPkg = (await import(reactDomServerUrl)) as {
    renderToStaticMarkup(element: unknown): string
  }

  const appModule = await vite.ssrLoadModule('/src/App.tsx')
  assert.equal(typeof appModule.App, 'function', 'Expected /src/App.tsx to export App component')

  return reactDomServerPkg.renderToStaticMarkup(reactPkg.createElement(appModule.App, props))
}

function createRecordingCanvasContext() {
  const fillRects: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly fillStyle: string }[] = []
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
    clearRect(): void {},
    fillRect(x: number, y: number, w: number, h: number): void {
      fillRects.push({ x, y, w, h, fillStyle: String(currentFillStyle) })
    },
    beginPath(): void {
      pendingArcs = []
    },
    arc(x: number, y: number, radius: number): void {
      pendingArcs.push({ x, y, radius })
    },
    fill(): void {
      const style = String(currentFillStyle)
      for (const arc of pendingArcs) {
        filledArcs.push({ x: arc.x, y: arc.y, radius: arc.radius, fillStyle: style })
      }
    },
  }

  return { ctx, fillRects, filledArcs }
}

interface FakeElementLike {
  readonly tagName: string
  readonly childNodes: FakeElementLike[]
  getAttribute(name: string): string | null
}

async function withMountedApp(
  props: Record<string, unknown>,
  viteInstance: ViteServerLike | undefined,
  onSendBeacon: ((url: string) => void) | undefined,
  run: (harness: {
    readonly canvasRecording: ReturnType<typeof createRecordingCanvasContext>
    findCanvasElement(): FakeElementLike | null
    advanceIntervalTick(): Promise<void>
  }) => Promise<void>,
): Promise<void> {
  const vite = viteInstance ?? (await getViteServer())
  const reactUrl = pathToFileURL(webRequire.resolve('react')).href
  const reactDomClientUrl = pathToFileURL(webRequire.resolve('react-dom/client')).href

  const ReactPkg = (await import(reactUrl)) as {
    createElement(component: unknown, props?: Record<string, unknown>): unknown
    act(callback: () => void | Promise<void>): Promise<void>
  }
  const ReactDOMClientPkg = (await import(reactDomClientUrl)) as {
    createRoot(container: unknown): {
      render(element: unknown): void
      unmount(): void
    }
  }

  const appModule = await vite.ssrLoadModule('/src/App.tsx')
  assert.equal(typeof appModule.App, 'function', 'Expected /src/App.tsx to export App component')

  const canvasRecording = createRecordingCanvasContext()
  const windowListeners = new Map<string, Set<(event: KeyboardEventLike) => void>>()
  const activeIntervals = new Map<number, () => void>()
  let nextIntervalId = 1

  interface DocOwner {
    nodeType: number
    documentElement: FakeDomNode | null
    body: FakeDomNode | null
    defaultView: unknown
    activeElement: unknown
    createElement(tag: string): FakeDomNode
    createElementNS(_ns: string, tag: string): FakeDomNode
    createTextNode(text: string): FakeDomNode
    createComment(text: string): FakeDomNode
    addEventListener(): void
    removeEventListener(): void
  }

  class FakeDomNode implements FakeElementLike {
    readonly nodeType: number
    readonly tagName: string
    readonly nodeName: string
    readonly namespaceURI = 'http://www.w3.org/1999/xhtml'
    readonly ownerDocument: DocOwner
    parentNode: FakeDomNode | null = null
    childNodes: FakeDomNode[] = []
    readonly attributes = new Map<string, string>()
    readonly style: Record<string, string> = {}
    private textValue = ''

    constructor(tagName: string, ownerDoc: DocOwner) {
      this.nodeType = tagName === '#text' ? 3 : tagName === '#comment' ? 8 : 1
      this.tagName = tagName.toUpperCase()
      this.nodeName = this.tagName
      this.ownerDocument = ownerDoc
    }

    get firstChild(): FakeDomNode | null { return this.childNodes[0] ?? null }
    get nextSibling(): FakeDomNode | null {
      if (!this.parentNode) return null
      const idx = this.parentNode.childNodes.indexOf(this)
      return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null
    }
    set className(v: string) { this.attributes.set('class', String(v)) }
    get className(): string { return this.attributes.get('class') ?? '' }
    set id(v: string) { this.attributes.set('id', String(v)) }
    get id(): string { return this.attributes.get('id') ?? '' }
    set width(v: number) { this.attributes.set('width', String(v)) }
    get width(): number { return Number(this.attributes.get('width') ?? 0) }
    set height(v: number) { this.attributes.set('height', String(v)) }
    get height(): number { return Number(this.attributes.get('height') ?? 0) }
    set textContent(v: string) { this.textValue = String(v); this.childNodes = [] }
    get textContent(): string {
      return this.nodeType === 3 ? this.textValue : this.childNodes.map((c) => c.textContent).join('')
    }

    appendChild(child: FakeDomNode): FakeDomNode {
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
      this.childNodes.push(child)
      return child
    }

    insertBefore(child: FakeDomNode, ref: FakeDomNode | null): FakeDomNode {
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
      const idx = ref ? this.childNodes.indexOf(ref) : -1
      if (idx === -1) this.childNodes.push(child)
      else this.childNodes.splice(idx, 0, child)
      return child
    }

    removeChild(child: FakeDomNode): FakeDomNode {
      const idx = this.childNodes.indexOf(child)
      if (idx >= 0) { this.childNodes.splice(idx, 1); child.parentNode = null }
      return child
    }

    setAttribute(name: string, value: string): void { this.attributes.set(name, String(value)) }
    removeAttribute(name: string): void { this.attributes.delete(name) }
    getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
    addEventListener(): void {}
    removeEventListener(): void {}
    focus(): void {}
    blur(): void {}
    getContext(contextId: string): unknown { return contextId === '2d' ? canvasRecording.ctx : null }
  }

  const fakeDocument: DocOwner = {
    nodeType: 9,
    documentElement: null,
    body: null,
    defaultView: null,
    activeElement: null,
    createElement: (tag: string) => new FakeDomNode(tag, fakeDocument),
    createElementNS: (_ns: string, tag: string) => new FakeDomNode(tag, fakeDocument),
    createTextNode(text: string) {
      const node = new FakeDomNode('#text', fakeDocument)
      node.textContent = text
      return node
    },
    createComment: (_text: string) => new FakeDomNode('#comment', fakeDocument),
    addEventListener() {},
    removeEventListener() {},
  }

  fakeDocument.documentElement = new FakeDomNode('html', fakeDocument)
  fakeDocument.body = new FakeDomNode('body', fakeDocument)
  fakeDocument.documentElement.appendChild(fakeDocument.body)

  const fakeSetInterval = (callback: (...args: unknown[]) => void): number => {
    const id = nextIntervalId
    nextIntervalId += 1
    activeIntervals.set(id, () => callback())
    return id
  }

  const fakeClearInterval = (id: unknown): void => {
    activeIntervals.delete(Number(id))
  }

  const fakeNavigator = {
    userAgent: 'node-acceptance-harness',
    sendBeacon(url: unknown): boolean {
      onSendBeacon?.(String(url))
      return false
    },
  }

  const fakeWindow = {
    document: fakeDocument,
    navigator: fakeNavigator,
    HTMLElement: FakeDomNode,
    HTMLIFrameElement: class {},
    Node: FakeDomNode,
    setInterval: fakeSetInterval,
    clearInterval: fakeClearInterval,
    addEventListener(type: string, listener: (event: KeyboardEventLike) => void) {
      if (!windowListeners.has(type)) {
        windowListeners.set(type, new Set())
      }
      windowListeners.get(type)!.add(listener)
    },
    removeEventListener(type: string, listener: (event: KeyboardEventLike) => void) {
      windowListeners.get(type)?.delete(listener)
    },
  }
  fakeDocument.defaultView = fakeWindow

  const globalRecord = globalThis as Record<string, unknown>
  const savedKeys = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLIFrameElement',
    'Node',
    'IS_REACT_ACT_ENVIRONMENT',
    'setInterval',
    'clearInterval',
  ] as const
  const savedDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const key of savedKeys) {
    savedDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  }

  const container = fakeDocument.createElement('div')
  fakeDocument.body.appendChild(container)
  let root: { render(element: unknown): void; unmount(): void } | null = null

  function findByTag(node: FakeDomNode, tagUpper: string): FakeDomNode | null {
    if (node.tagName === tagUpper) {
      return node
    }
    for (const child of node.childNodes) {
      const found = findByTag(child, tagUpper)
      if (found) {
        return found
      }
    }
    return null
  }

  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: fakeWindow })
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: fakeDocument })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: fakeNavigator })
    globalRecord.HTMLElement = FakeDomNode
    globalRecord.HTMLIFrameElement = fakeWindow.HTMLIFrameElement
    globalRecord.Node = FakeDomNode
    globalRecord.IS_REACT_ACT_ENVIRONMENT = true
    globalRecord.setInterval = fakeSetInterval
    globalRecord.clearInterval = fakeClearInterval

    await ReactPkg.act(async () => {
      root = ReactDOMClientPkg.createRoot(container)
      root.render(ReactPkg.createElement(appModule.App, props))
    })

    await run({
      canvasRecording,
      findCanvasElement() {
        return findByTag(container, 'CANVAS')
      },
      async advanceIntervalTick() {
        await ReactPkg.act(async () => {
          for (const cb of [...activeIntervals.values()]) {
            cb()
          }
        })
      },
    })

    if (root !== null) {
      await ReactPkg.act(async () => {
        root!.unmount()
      })
      root = null
    }
    assert.equal(activeIntervals.size, 0, 'Expected App unmount to clear setInterval')
    assert.equal(windowListeners.get('keydown')?.size ?? 0, 0, 'Expected App unmount to remove keydown listener')
  } finally {
    if (root !== null) {
      try {
        await ReactPkg.act(async () => {
          root!.unmount()
        })
      } catch {
        // Ignore secondary unmount errors while restoring globals
      }
    }
    for (const key of savedKeys) {
      const descriptor = savedDescriptors.get(key)
      if (descriptor === undefined) {
        delete globalRecord[key]
      } else {
        Object.defineProperty(globalThis, key, descriptor)
      }
    }
  }
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

function manhattanDistance(a: TilePosition, b: TilePosition): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col)
}

test('REQ-002_REQ-006_ghost_ai_moves_along_corridors_and_never_enters_walls_or_leaves_grid_bounds', async () => {
  const { CLASSIC_MAZE, isWallTile, isTileTraversable, canMoveFromTile } =
    await loadClassicMazeModule()
  const engineMod = await loadPacmanEngineModule()
  const { GHOST_DIRECTION_PRIORITY, chooseGhostDirection, stepGhostState } =
    requireGhostAiExports(engineMod)

  assert.deepEqual(GHOST_DIRECTION_PRIORITY, ['up', 'left', 'down', 'right'])
  assert.equal(Object.isFrozen(GHOST_DIRECTION_PRIORITY), true)

  // 1. Exhaustively validate every wall, out-of-bounds, and traversable tile across CLASSIC_MAZE
  const headingVariants: readonly (Direction | null)[] = [null, 'up', 'left', 'down', 'right']
  let verifiedTraversableStates = 0
  let verifiedWallStates = 0

  for (let row = -1; row <= CLASSIC_MAZE.rows; row += 1) {
    for (let col = -1; col <= CLASSIC_MAZE.columns; col += 1) {
      const traversable = isTileTraversable(CLASSIC_MAZE, row, col)
      for (const dir of headingVariants) {
        const inputGhost: GhostState = {
          id: 'probe',
          position: { row, col },
          direction: dir,
        }

        const chosen = chooseGhostDirection(
          CLASSIC_MAZE,
          inputGhost,
          engineMod.PACMAN_SPAWN_POSITION,
        )
        const stepped = stepGhostState(
          CLASSIC_MAZE,
          inputGhost,
          engineMod.PACMAN_SPAWN_POSITION,
        )

        // Input object must never be mutated
        assert.deepEqual(inputGhost.position, { row, col })
        assert.equal(inputGhost.direction, dir)
        assert.equal(Object.isFrozen(stepped), true)
        assert.equal(Object.isFrozen(stepped.position), true)

        if (!traversable) {
          verifiedWallStates += 1
          assert.equal(
            chosen,
            null,
            `Expected wall/out-of-bounds ghost at (${row}, ${col}) with heading ${String(dir)} to choose null`,
          )
          assert.deepEqual(stepped.position, { row, col })
          assert.equal(stepped.direction, null)
        } else {
          verifiedTraversableStates += 1
          assert.ok(
            chosen !== null && ALL_DIRECTIONS.includes(chosen),
            `Expected traversable ghost at (${row}, ${col}) to choose a valid cardinal direction`,
          )
          assert.equal(
            canMoveFromTile(CLASSIC_MAZE, { row, col }, chosen),
            true,
            `Chosen ghost direction "${chosen}" from (${row}, ${col}) must not enter a wall`,
          )
          assert.equal(isWallTile(CLASSIC_MAZE, stepped.position.row, stepped.position.col), false)
          assert.equal(
            isTileTraversable(CLASSIC_MAZE, stepped.position.row, stepped.position.col),
            true,
          )
          assert.equal(
            manhattanDistance({ row, col }, stepped.position),
            1,
            `Expected single-tile cardinal step from (${row}, ${col}), got (${stepped.position.row}, ${stepped.position.col})`,
          )
          assert.equal(stepped.direction, chosen)
        }
      }
    }
  }

  assert.ok(verifiedWallStates > 0 && verifiedTraversableStates > 0)

  // 2. Non-reverse mid-corridor rule, GHOST_DIRECTION_PRIORITY tie-breaking, dead-end reversal, and 1x1 pocket
  const tieBreakMaze: MazeDefinition = {
    levelId: 'symmetric-tie-break',
    columns: 5,
    rows: 5,
    tileSizePx: 20,
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'corridor', 'corridor', 'corridor', 'wall'],
      ['wall', 'corridor', 'corridor', 'corridor', 'wall'],
      ['wall', 'corridor', 'corridor', 'corridor', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall'],
    ],
  }
  assert.equal(
    chooseGhostDirection(
      tieBreakMaze,
      { id: 'tie-up-left', position: { row: 2, col: 2 }, direction: null },
      { row: 1, col: 1 },
    ),
    'up',
    'Expected equal-distance tie between up and left to resolve to "up" per GHOST_DIRECTION_PRIORITY',
  )
  assert.equal(
    chooseGhostDirection(
      tieBreakMaze,
      { id: 'tie-left-down', position: { row: 2, col: 2 }, direction: null },
      { row: 3, col: 1 },
    ),
    'left',
    'Expected equal-distance tie between left and down to resolve to "left" per GHOST_DIRECTION_PRIORITY',
  )
  assert.equal(
    chooseGhostDirection(
      tieBreakMaze,
      { id: 'tie-down-right', position: { row: 2, col: 2 }, direction: null },
      { row: 3, col: 3 },
    ),
    'down',
    'Expected equal-distance tie between down and right to resolve to "down" per GHOST_DIRECTION_PRIORITY',
  )

  const midCorridorGhost: GhostState = {
    id: 'runner',
    position: { row: 5, col: 3 },
    direction: 'right',
  }
  assert.equal(
    chooseGhostDirection(CLASSIC_MAZE, midCorridorGhost, { row: 5, col: 1 }),
    'right',
    'Expected ghost moving right in an open corridor not to reverse mid-corridor when forward tile is open',
  )

  const deadEndMaze: MazeDefinition = {
    levelId: 'dead-end-corridor',
    columns: 5,
    rows: 3,
    tileSizePx: 20,
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'corridor', 'corridor', 'corridor', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall'],
    ],
  }
  const intoDeadEnd = stepGhostState(
    deadEndMaze,
    { id: 'patrol', position: { row: 1, col: 2 }, direction: 'right' },
    { row: 1, col: 1 },
  )
  assert.deepEqual(intoDeadEnd.position, { row: 1, col: 3 })
  assert.equal(intoDeadEnd.direction, 'right')

  const outOfDeadEnd = stepGhostState(deadEndMaze, intoDeadEnd, { row: 1, col: 1 })
  assert.deepEqual(outOfDeadEnd.position, { row: 1, col: 2 })
  assert.equal(outOfDeadEnd.direction, 'left')

  const pocketMaze: MazeDefinition = {
    levelId: 'enclosed-pocket',
    columns: 3,
    rows: 3,
    tileSizePx: 20,
    grid: [
      ['wall', 'wall', 'wall'],
      ['wall', 'corridor', 'wall'],
      ['wall', 'wall', 'wall'],
    ],
  }
  assert.equal(
    chooseGhostDirection(
      pocketMaze,
      { id: 'trapped', position: { row: 1, col: 1 }, direction: 'up' },
      { row: 1, col: 1 },
    ),
    null,
  )
  const trappedStep = stepGhostState(
    pocketMaze,
    { id: 'trapped', position: { row: 1, col: 1 }, direction: 'up' },
    { row: 1, col: 1 },
  )
  assert.deepEqual(trappedStep.position, { row: 1, col: 1 })
  assert.equal(trappedStep.direction, null)

  // 3. Open-edge custom grid clamps ghosts inside 0..rows-1 and 0..columns-1
  const openEdgeMaze: MazeDefinition = {
    levelId: 'open-edge-ghost-bounds',
    columns: 3,
    rows: 3,
    tileSizePx: 20,
    grid: [
      ['wall', 'corridor', 'wall'],
      ['corridor', 'corridor', 'corridor'],
      ['wall', 'corridor', 'wall'],
    ],
  }
  const edgeSpawns: readonly { readonly pos: TilePosition; readonly heading: Direction }[] = [
    { pos: { row: 0, col: 1 }, heading: 'up' },
    { pos: { row: 2, col: 1 }, heading: 'down' },
    { pos: { row: 1, col: 0 }, heading: 'left' },
    { pos: { row: 1, col: 2 }, heading: 'right' },
  ]
  for (const { pos, heading } of edgeSpawns) {
    const stepped = stepGhostState(
      openEdgeMaze,
      { id: 'edge-ghost', position: pos, direction: heading },
      pos,
    )
    assert.ok(
      stepped.position.row >= 0 &&
        stepped.position.row < openEdgeMaze.rows &&
        stepped.position.col >= 0 &&
        stepped.position.col < openEdgeMaze.columns,
      `Expected ghost at open edge (${pos.row}, ${pos.col}) to stay within grid bounds`,
    )
    assert.deepEqual(stepped.position, { row: 1, col: 1 })
  }

  // 4. Solid wall barrier between compartments prevents ghosts from crossing into Pacman's room
  const splitMaze: MazeDefinition = {
    levelId: 'walled-compartments',
    columns: 5,
    rows: 5,
    tileSizePx: 20,
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'corridor', 'corridor', 'corridor', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'corridor', 'corridor', 'corridor', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall'],
    ],
  }
  const walledGame = engineMod.createPacmanGame({
    maze: splitMaze,
    pacmanSpawn: { row: 3, col: 2 },
    ghosts: [{ id: 'caged', position: { row: 1, col: 1 } }],
  })
  const visitedCols = new Set<number>()
  for (let tick = 0; tick < 10; tick += 1) {
    const snap = walledGame.tick()
    const caged = snap.ghosts[0]
    visitedCols.add(caged.position.col)
    assert.equal(caged.position.row, 1, 'Ghost must remain in upper corridor and never cross solid wall row 2')
    assert.equal(isWallTile(splitMaze, caged.position.row, caged.position.col), false)
    assert.equal(snap.pacman.status, 'alive')
    assert.equal(snap.deathCount, 0)
  }
  assert.deepEqual([...visitedCols].sort(), [1, 2, 3], 'Ghost should patrol across its traversable corridor')

  // 5. Default CLASSIC_MAZE game moves all 4 DEFAULT_GHOST_SPAWNS around interior walls (1 tile/tick)
  const classicGame = engineMod.createPacmanGame()
  let prevGhosts = classicGame.getSnapshot().ghosts
  assert.equal(prevGhosts.length, engineMod.DEFAULT_GHOST_SPAWNS.length)

  for (let step = 1; step <= 20; step += 1) {
    const snap = classicGame.tick()
    for (let i = 0; i < snap.ghosts.length; i += 1) {
      const prev = prevGhosts[i]
      const curr = snap.ghosts[i]
      assert.equal(isWallTile(CLASSIC_MAZE, curr.position.row, curr.position.col), false)
      assert.equal(isTileTraversable(CLASSIC_MAZE, curr.position.row, curr.position.col), true)
      assert.equal(
        manhattanDistance(prev.position, curr.position),
        1,
        `Expected ghost "${curr.id}" to move exactly 1 cardinal tile on tick ${step}`,
      )
    }
    prevGhosts = snap.ghosts
    if (snap.isPacmanDead) {
      break
    }
  }
  assert.equal(
    classicGame.getSnapshot().isPacmanDead,
    true,
    'Expected default AI ghosts navigating around CLASSIC_MAZE walls to reach idle Pacman within 20 ticks',
  )
})

test('REQ-001_REQ-002_ghost_and_pacman_collisions_trigger_death_outcome_across_all_encounter_types', async () => {
  const { CLASSIC_MAZE } = await loadClassicMazeModule()
  const engineMod = await loadPacmanEngineModule()

  // 1. AI ghost approaches and catches stationary Pacman from all 4 cardinal directions (as non-zero-index ghost)
  const pacmanOrigin: TilePosition = { row: 5, col: 6 }
  const cardinalApproaches: readonly {
    readonly ghostStart: TilePosition
    readonly midTile: TilePosition
    readonly expectedDir: Direction
  }[] = [
    { ghostStart: { row: 3, col: 6 }, midTile: { row: 4, col: 6 }, expectedDir: 'down' },
    { ghostStart: { row: 7, col: 6 }, midTile: { row: 6, col: 6 }, expectedDir: 'up' },
    { ghostStart: { row: 5, col: 4 }, midTile: { row: 5, col: 5 }, expectedDir: 'right' },
    { ghostStart: { row: 5, col: 8 }, midTile: { row: 5, col: 7 }, expectedDir: 'left' },
  ]

  for (const { ghostStart, midTile, expectedDir } of cardinalApproaches) {
    const game = engineMod.createPacmanGame({
      maze: CLASSIC_MAZE,
      pacmanSpawn: pacmanOrigin,
      ghosts: [
        { id: 'distant-scout', position: { row: 29, col: 1 } },
        { id: 'hunter', position: ghostStart },
      ],
    })

    const tick1 = game.tick()
    assert.equal(tick1.pacman.status, 'alive')
    assert.equal(tick1.isPacmanDead, false)
    assert.equal(tick1.deathCount, 0)
    assert.notDeepEqual(
      tick1.ghosts[0].position,
      { row: 29, col: 1 },
      'Expected every ghost in the array to advance under AI mode',
    )
    assert.deepEqual(tick1.ghosts[1].position, midTile)
    assert.equal(tick1.ghosts[1].direction, expectedDir)

    const tick2 = game.tick()
    assert.deepEqual(tick2.ghosts[1].position, pacmanOrigin)
    assert.equal(tick2.pacman.status, 'dead')
    assert.equal(tick2.pacman.direction, null)
    assert.equal(tick2.isPacmanDead, true)
    assert.equal(tick2.deathCount, 1)

    // Once dead, inputs are rejected and neither Pacman nor ghosts move or re-increment deathCount
    const frozenGhostPositions = tick2.ghosts.map((g) => ({ ...g.position }))
    assert.equal(game.handleKeyInput('ArrowLeft'), false)
    const tick3 = game.tick()
    assert.equal(tick3.tick, 3)
    assert.deepEqual(tick3.pacman.position, pacmanOrigin)
    assert.deepEqual(
      tick3.ghosts.map((g) => g.position),
      frozenGhostPositions,
    )
    assert.equal(tick3.deathCount, 1)

    // reset() restores live state and original ghost spawns
    const afterReset = game.reset()
    assert.equal(afterReset.tick, 0)
    assert.equal(afterReset.pacman.status, 'alive')
    assert.equal(afterReset.isPacmanDead, false)
    assert.equal(afterReset.deathCount, 0)
    assert.deepEqual(afterReset.ghosts[1].position, ghostStart)
    assert.equal(afterReset.ghosts[1].direction, null)
  }

  // 2. Moving Pacman + moving AI ghost converging onto the same tile triggers death
  const convergeGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 5, col: 5 },
    ghosts: [{ id: 'blinky', position: { row: 5, col: 7 } }],
  })
  assert.equal(convergeGame.handleKeyInput('ArrowRight'), true)
  const convergeSnap = convergeGame.tick()
  assert.deepEqual(convergeSnap.pacman.position, { row: 5, col: 6 })
  assert.deepEqual(convergeSnap.ghosts[0].position, { row: 5, col: 6 })
  assert.equal(convergeSnap.pacman.status, 'dead')
  assert.equal(convergeSnap.isPacmanDead, true)
  assert.equal(convergeSnap.deathCount, 1)

  // 3. Moving Pacman + moving AI ghost crossing head-on (adjacent tile swap) triggers death
  const headOnSwapGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 5, col: 6 },
    ghosts: [{ id: 'blinky', position: { row: 5, col: 7 } }],
  })
  assert.equal(headOnSwapGame.handleKeyInput('ArrowRight'), true)
  const swapSnap = headOnSwapGame.tick()
  assert.deepEqual(swapSnap.pacman.position, { row: 5, col: 7 })
  assert.deepEqual(swapSnap.ghosts[0].position, { row: 5, col: 6 })
  assert.equal(swapSnap.pacman.status, 'dead')
  assert.equal(swapSnap.pacman.direction, null)
  assert.equal(swapSnap.isPacmanDead, true)
  assert.equal(swapSnap.deathCount, 1)

  // 4. Moving Pacman retreating away from pursuing AI ghost maintains 1-tile gap without false collision
  const retreatGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 5, col: 6 },
    ghosts: [{ id: 'blinky', position: { row: 5, col: 7 } }],
  })
  assert.equal(retreatGame.handleKeyInput('ArrowLeft'), true)
  const retreatSnap = retreatGame.tick()
  assert.deepEqual(retreatSnap.pacman.position, { row: 5, col: 5 })
  assert.deepEqual(retreatSnap.ghosts[0].position, { row: 5, col: 6 })
  assert.equal(retreatSnap.pacman.status, 'alive')
  assert.equal(retreatSnap.isPacmanDead, false)
  assert.equal(retreatSnap.deathCount, 0)

  // 5. Explicit stationary mode remains unchanged and invalid ghostMovement options throw
  const stationaryGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 5, col: 6 },
    ghosts: [{ id: 'statue', position: { row: 5, col: 8 } }],
    ghostMovement: 'stationary',
  })
  assert.deepEqual(stationaryGame.tick().ghosts[0].position, { row: 5, col: 8 })
  assert.throws(
    () => engineMod.createPacmanGame({ maze: CLASSIC_MAZE, ghostMovement: 'random' as never }),
    Error,
    'Expected unsupported ghostMovement mode to throw Error',
  )
  assert.throws(
    () => stationaryGame.reset({ maze: CLASSIC_MAZE, ghostMovement: 'random' as never }),
    Error,
    'Expected reset() with unsupported ghostMovement mode to throw without corrupting state',
  )
  assert.deepEqual(stationaryGame.getSnapshot().ghosts[0].position, { row: 5, col: 8 })

  // 6. Canvas rendering (with isolated dead-Pacman check) and mounted <App /> interval progression
  const retreatCanvas = createRecordingCanvasContext()
  const retreatRender = engineMod.renderGameToCanvas(retreatCanvas.ctx, retreatSnap, CLASSIC_MAZE)
  assert.equal(retreatRender.renderedGhostCount, 1)
  assert.ok(
    retreatCanvas.filledArcs.some(
      (arc) => arc.x === 6 * 20 + 10 && arc.y === 5 * 20 + 10 && arc.radius > 0,
    ),
    'Expected renderGameToCanvas to draw AI ghost at updated tile (5, 6)',
  )

  const aliveOnlyCanvas = createRecordingCanvasContext()
  engineMod.renderGameToCanvas(
    aliveOnlyCanvas.ctx,
    { ...retreatSnap, ghosts: [] },
    CLASSIC_MAZE,
  )
  const alivePacmanArc = aliveOnlyCanvas.filledArcs
    .filter(
      (arc) =>
        arc.x === 5 * 20 + 10 &&
        arc.y === 5 * 20 + 10 &&
        arc.radius > CLASSIC_MAZE.tileSizePx * 0.3 &&
        arc.radius < CLASSIC_MAZE.tileSizePx * 0.5,
    )
    .at(-1)
  assert.ok(alivePacmanArc, 'Expected alive Pacman arc on canvas')

  const deadOnlyCanvas = createRecordingCanvasContext()
  const deadRender = engineMod.renderGameToCanvas(
    deadOnlyCanvas.ctx,
    { ...convergeSnap, ghosts: [] },
    CLASSIC_MAZE,
  )
  assert.equal(deadRender.pacmanStatus, 'dead')
  assert.equal(deadRender.renderedGhostCount, 0)
  const deadPacmanArc = deadOnlyCanvas.filledArcs
    .filter(
      (arc) =>
        arc.x === 6 * 20 + 10 &&
        arc.y === 5 * 20 + 10 &&
        arc.radius > CLASSIC_MAZE.tileSizePx * 0.3 &&
        arc.radius < CLASSIC_MAZE.tileSizePx * 0.5,
    )
    .at(-1)
  assert.ok(deadPacmanArc, 'Expected dead Pacman arc on canvas when isolated from ghosts')
  assert.notEqual(deadPacmanArc.fillStyle, alivePacmanArc.fillStyle)

  const defaultMarkup = await renderAppMarkup()
  assert.match(defaultMarkup, /data-ghost-count="4"/)

  const mountedAiGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 5, col: 6 },
    ghosts: [{ id: 'blinky', position: { row: 5, col: 8 } }],
  })
  await withMountedApp({ game: mountedAiGame }, undefined, undefined, async (mounted) => {
    const canvas = mounted.findCanvasElement()
    assert.ok(canvas)
    assert.equal(canvas.getAttribute('data-ghost-count'), '1')
    assert.equal(canvas.getAttribute('data-pacman-status'), 'alive')

    // Tick 1: Blinky moves from (5, 8) to (5, 7) and is redrawn at pixel center (150, 110)
    mounted.canvasRecording.filledArcs.length = 0
    await mounted.advanceIntervalTick()
    assert.equal(canvas.getAttribute('data-pacman-status'), 'alive')
    assert.ok(
      mounted.canvasRecording.filledArcs.some(
        (arc) => arc.x === 7 * 20 + 10 && arc.y === 5 * 20 + 10 && arc.radius > 0,
      ),
      'Expected mounted <App /> to redraw moving AI ghost at (5, 7) on interval tick 1',
    )

    // Tick 2: Blinky steps onto Pacman at (5, 6), transitioning canvas status to dead
    await mounted.advanceIntervalTick()
    assert.equal(canvas.getAttribute('data-pacman-status'), 'dead')
  })

  // Default <App /> (omitting game prop) runs live Ghost AI across interval ticks until collision
  await withMountedApp({}, undefined, undefined, async (defaultMounted) => {
    const canvas = defaultMounted.findCanvasElement()
    assert.ok(canvas)
    assert.equal(canvas.getAttribute('data-ghost-count'), '4')
    assert.equal(canvas.getAttribute('data-pacman-status'), 'alive')
    assert.ok(defaultMounted.canvasRecording.fillRects.length > 0)

    for (let step = 0; step < 20; step += 1) {
      await defaultMounted.advanceIntervalTick()
      if (canvas.getAttribute('data-pacman-status') === 'dead') {
        break
      }
    }
    assert.equal(
      canvas.getAttribute('data-pacman-status'),
      'dead',
      'Expected default mounted <App /> to advance AI ghosts across ticks until idle Pacman dies',
    )
  })
})

test('REQ-001_REQ-005_REQ-007_ghost_ai_is_deterministic_isolated_and_runs_offline_without_network_storage_or_audio', async () => {
  const { CLASSIC_MAZE } = await loadClassicMazeModule()
  const engineMod = await loadPacmanEngineModule()

  // 1. Deterministic replayability across independent instances and reset() with Math.random trapped
  const originalMathRandom = Math.random
  let randomCallCount = 0
  Math.random = () => {
    randomCallCount += 1
    return 0.5
  }

  try {
    const scriptedKeysByTick = new Map<number, string>([
      [0, 'ArrowLeft'],
      [3, 'ArrowUp'],
      [6, 'ArrowRight'],
      [10, 'ArrowDown'],
    ])

    const collectTrajectory = (game: PacmanGameEngine): PacmanGameSnapshot[] => {
      const frames: PacmanGameSnapshot[] = []
      for (let t = 0; t < 16; t += 1) {
        const key = scriptedKeysByTick.get(t)
        if (key !== undefined) {
          game.handleKeyInput(key)
        }
        frames.push(game.tick())
      }
      return frames
    }

    const gameA = engineMod.createPacmanGame({ maze: CLASSIC_MAZE })
    const gameB = engineMod.createPacmanGame({ maze: CLASSIC_MAZE })

    const trajectoryA = collectTrajectory(gameA)
    const trajectoryB = collectTrajectory(gameB)
    gameA.reset()
    const trajectoryAReplay = collectTrajectory(gameA)

    assert.equal(randomCallCount, 0, 'Expected deterministic Ghost AI never to call Math.random()')
    assert.deepEqual(trajectoryA, trajectoryB)
    assert.deepEqual(trajectoryA, trajectoryAReplay)

    const distinctBlinkyTiles = new Set(
      trajectoryA.map((snap) => `${snap.ghosts[0].position.row},${snap.ghosts[0].position.col}`),
    )
    assert.ok(
      distinctBlinkyTiles.size > 5,
      'Expected deterministic Ghost AI to traverse multiple tiles across 16 ticks',
    )
  } finally {
    Math.random = originalMathRandom
  }

  // 2. Separate mutation checks on snapshot.ghosts and nested GhostState fields
  const isolatedGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 23, col: 13 },
    ghosts: [{ id: 'blinky', position: { row: 11, col: 13 }, direction: 'left' }],
  })
  const snapRef = isolatedGame.getSnapshot() as unknown as {
    ghosts: { id: string; position: { row: number; col: number }; direction: string | null }[]
  }

  try {
    snapRef.ghosts.push({ id: 'injected', position: { row: 1, col: 1 }, direction: null })
  } catch {
    // Frozen array rejection is expected
  }
  try {
    snapRef.ghosts[0].id = 'corrupted'
  } catch {
    // Frozen GhostState rejection is expected
  }
  try {
    snapRef.ghosts[0].direction = 'down'
  } catch {
    // Frozen GhostState rejection is expected
  }
  try {
    snapRef.ghosts[0].position.row = 999
  } catch {
    // Frozen position rejection is expected
  }

  const freshSnap = isolatedGame.getSnapshot()
  assert.equal(freshSnap.ghosts.length, 1)
  assert.equal(freshSnap.ghosts[0].id, 'blinky')
  assert.equal(freshSnap.ghosts[0].direction, 'left')
  assert.deepEqual(freshSnap.ghosts[0].position, { row: 11, col: 13 })

  // 3. Fresh Vite module graph under active network, storage, and audio traps
  const sideEffectEvents: string[] = []
  const globalRecord = globalThis as Record<string, unknown>
  const trackedGlobals = [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'AudioContext',
    'webkitAudioContext',
    'Audio',
  ] as const

  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const key of trackedGlobals) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  }

  const createTrapProxy = (label: string) =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          sideEffectEvents.push(`${label}.${String(prop)}`)
          return () => null
        },
        set(_target, prop) {
          sideEffectEvents.push(`${label}.${String(prop)}=`)
          return true
        },
      },
    )

  let freshVite: ViteServerLike | null = null

  try {
    globalRecord.fetch = async (input: unknown) => {
      sideEffectEvents.push(`fetch:${String(input)}`)
      throw new Error('Unexpected fetch during Ghost AI simulation')
    }
    globalRecord.XMLHttpRequest = class {
      constructor() {
        sideEffectEvents.push('XMLHttpRequest')
      }
    }
    globalRecord.WebSocket = class {
      constructor(url: string) {
        sideEffectEvents.push(`WebSocket:${url}`)
      }
    }
    globalRecord.EventSource = class {
      constructor(url: string) {
        sideEffectEvents.push(`EventSource:${url}`)
      }
    }
    globalRecord.AudioContext = class {
      constructor() {
        sideEffectEvents.push('AudioContext')
      }
    }
    globalRecord.webkitAudioContext = class {
      constructor() {
        sideEffectEvents.push('webkitAudioContext')
      }
    }
    globalRecord.Audio = class {
      constructor(src?: string) {
        sideEffectEvents.push(`Audio:${src ?? ''}`)
      }
    }

    for (const storageKey of ['localStorage', 'sessionStorage', 'indexedDB'] as const) {
      const trap = createTrapProxy(storageKey)
      Object.defineProperty(globalThis, storageKey, {
        configurable: true,
        enumerable: true,
        get() {
          sideEffectEvents.push(storageKey)
          return trap
        },
      })
    }

    freshVite = await createViteInstance()
    const freshMazeMod = await loadClassicMazeModule(freshVite)
    const freshEngineMod = await loadPacmanEngineModule(freshVite)

    const offlineGame = freshEngineMod.createPacmanGame({
      maze: freshMazeMod.CLASSIC_MAZE,
      pacmanSpawn: { row: 5, col: 6 },
      ghosts: [{ id: 'blinky', position: { row: 5, col: 8 } }],
    })
    offlineGame.tick()
    const offlineDeadSnap = offlineGame.tick()
    assert.equal(offlineDeadSnap.isPacmanDead, true)

    const { ctx } = createRecordingCanvasContext()
    freshEngineMod.renderGameToCanvas(ctx, offlineDeadSnap, freshMazeMod.CLASSIC_MAZE)
    const html = await renderAppMarkup({ game: offlineGame }, freshVite)
    assert.match(html, /data-pacman-status="dead"/)

    const mountedOfflineGame = freshEngineMod.createPacmanGame({
      maze: freshMazeMod.CLASSIC_MAZE,
      pacmanSpawn: { row: 5, col: 6 },
      ghosts: [{ id: 'blinky', position: { row: 5, col: 7 } }],
    })
    await withMountedApp(
      { game: mountedOfflineGame },
      freshVite,
      (url) => sideEffectEvents.push(`sendBeacon:${url}`),
      async (mounted) => {
        await mounted.advanceIntervalTick()
        const canvas = mounted.findCanvasElement()
        assert.ok(canvas)
        assert.equal(canvas.getAttribute('data-pacman-status'), 'dead')
      },
    )

    assert.deepEqual(
      sideEffectEvents,
      [],
      'Expected zero network, storage, or audio accesses during Ghost AI module load, pathing, and collision',
    )
  } finally {
    if (freshVite !== null) {
      await freshVite.close()
    }
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
  assert.ok(sourceFiles.length > 0)

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
    assert.doesNotMatch(code, /\bAudioContext\b/, `Disallowed AudioContext usage in ${relPath}`)
    assert.doesNotMatch(code, /\bwebkitAudioContext\b/, `Disallowed webkitAudioContext usage in ${relPath}`)
    assert.doesNotMatch(code, /\bnew\s+Audio\s*\(/, `Disallowed HTMLAudioElement construction in ${relPath}`)
  }
})
