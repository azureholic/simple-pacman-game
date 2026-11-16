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

interface KeyboardEventTargetLike {
  addEventListener(type: 'keydown', listener: (event: KeyboardEventLike) => void): void
  removeEventListener(type: 'keydown', listener: (event: KeyboardEventLike) => void): void
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
  isTileTraversable(maze: MazeDefinition, row: number, col: number): boolean
  canMoveFromTile(maze: MazeDefinition, from: TilePosition, direction: Direction): boolean
  resolveTileMovement(maze: MazeDefinition, from: TilePosition, direction: Direction): TilePosition
}

interface PacmanEngineModule {
  readonly PACMAN_SPAWN_POSITION: TilePosition
  readonly DEFAULT_GHOST_SPAWNS: readonly GhostInit[]
  mapKeyToDirection(input: unknown): Direction | null
  attachKeyboardControls(target: KeyboardEventTargetLike, game: PacmanGameEngine): () => void
  checkGhostCollision(
    pacmanPos: TilePosition,
    ghostPositions: readonly TilePosition[],
    prevPacmanPos?: TilePosition,
    prevGhostPositions?: readonly TilePosition[],
  ): boolean
  createPacmanGame(options?: PacmanGameOptions): PacmanGameEngine
  renderGameToCanvas(ctx: unknown, snapshot: PacmanGameSnapshot, maze?: MazeDefinition): GameRenderSummary
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

interface ViteServerLike {
  ssrLoadModule(url: string): Promise<Record<string, unknown>>
  close(): Promise<void>
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '..', '..', '..')
const webRoot = path.join(repoRoot, 'web')
const pacmanEngineFilePath = path.join(webRoot, 'src', 'game', 'pacmanEngine.ts')
const webRequire = createRequire(path.join(webRoot, 'package.json'))

const DIRECTION_INPUTS: readonly {
  readonly key: string
  readonly dir: Direction
  readonly dRow: number
  readonly dCol: number
}[] = [
  { key: 'ArrowUp', dir: 'up', dRow: -1, dCol: 0 },
  { key: 'ArrowDown', dir: 'down', dRow: 1, dCol: 0 },
  { key: 'ArrowLeft', dir: 'left', dRow: 0, dCol: -1 },
  { key: 'ArrowRight', dir: 'right', dRow: 0, dCol: 1 },
]

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

async function loadPacmanEngineModule(viteInstance?: ViteServerLike): Promise<PacmanEngineModule> {
  assert.equal(
    fs.existsSync(pacmanEngineFilePath),
    true,
    'Expected web/src/game/pacmanEngine.ts to exist per ISS-5 contract.md',
  )

  const vite = viteInstance ?? (await getViteServer())
  const mod = await vite.ssrLoadModule('/src/game/pacmanEngine.ts')

  assert.ok(
    mod.PACMAN_SPAWN_POSITION && typeof mod.PACMAN_SPAWN_POSITION === 'object',
    'Expected PACMAN_SPAWN_POSITION export in web/src/game/pacmanEngine.ts',
  )
  assert.ok(
    Array.isArray(mod.DEFAULT_GHOST_SPAWNS),
    'Expected DEFAULT_GHOST_SPAWNS array export in web/src/game/pacmanEngine.ts',
  )
  assert.equal(typeof mod.mapKeyToDirection, 'function', 'Expected mapKeyToDirection function export')
  assert.equal(
    typeof mod.attachKeyboardControls,
    'function',
    'Expected attachKeyboardControls function export',
  )
  assert.equal(
    typeof mod.checkGhostCollision,
    'function',
    'Expected checkGhostCollision function export',
  )
  assert.equal(typeof mod.createPacmanGame, 'function', 'Expected createPacmanGame function export')
  assert.equal(
    typeof mod.renderGameToCanvas,
    'function',
    'Expected renderGameToCanvas function export',
  )

  return mod as unknown as PacmanEngineModule
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

function createMockKeyboardTarget() {
  const listeners = new Set<(event: KeyboardEventLike) => void>()

  const target: KeyboardEventTargetLike = {
    addEventListener(type, listener) {
      assert.equal(type, 'keydown')
      listeners.add(listener)
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'keydown')
      listeners.delete(listener)
    },
  }

  function dispatchKeyDown(
    key: unknown,
    modifiers: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {},
  ): { defaultPrevented: boolean } {
    let defaultPrevented = false
    const event: KeyboardEventLike = {
      key,
      ...modifiers,
      preventDefault() {
        defaultPrevented = true
      },
    }
    for (const listener of [...listeners]) {
      listener(event)
    }
    return { defaultPrevented }
  }

  return { target, listeners, dispatchKeyDown }
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

interface FakeElementLike {
  readonly tagName: string
  readonly childNodes: FakeElementLike[]
  getAttribute(name: string): string | null
}

async function withMountedApp(
  props: Record<string, unknown>,
  viteInstance: ViteServerLike | undefined,
  run: (harness: {
    readonly canvasRecording: ReturnType<typeof createRecordingCanvasContext>
    findCanvasElement(): FakeElementLike | null
    dispatchWindowKeyDown(
      key: unknown,
      modifiers?: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean },
    ): boolean
    advanceIntervalTick(): Promise<void>
    getActiveIntervalCount(): number
    getWindowKeydownListenerCount(): number
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

    get firstChild(): FakeDomNode | null {
      return this.childNodes[0] ?? null
    }

    get nextSibling(): FakeDomNode | null {
      if (!this.parentNode) {
        return null
      }
      const index = this.parentNode.childNodes.indexOf(this)
      return index >= 0 ? (this.parentNode.childNodes[index + 1] ?? null) : null
    }

    set className(value: string) {
      this.attributes.set('class', String(value))
    }

    get className(): string {
      return this.attributes.get('class') ?? ''
    }

    set id(value: string) {
      this.attributes.set('id', String(value))
    }

    get id(): string {
      return this.attributes.get('id') ?? ''
    }

    set width(value: number) {
      this.attributes.set('width', String(value))
    }

    get width(): number {
      return Number(this.attributes.get('width') ?? 0)
    }

    set height(value: number) {
      this.attributes.set('height', String(value))
    }

    get height(): number {
      return Number(this.attributes.get('height') ?? 0)
    }

    set textContent(value: string) {
      this.textValue = String(value)
      this.childNodes = []
    }

    get textContent(): string {
      if (this.nodeType === 3) {
        return this.textValue
      }
      return this.childNodes.map((child) => child.textContent).join('')
    }

    appendChild(child: FakeDomNode): FakeDomNode {
      if (child.parentNode) {
        child.parentNode.removeChild(child)
      }
      child.parentNode = this
      this.childNodes.push(child)
      return child
    }

    insertBefore(child: FakeDomNode, ref: FakeDomNode | null): FakeDomNode {
      if (child.parentNode) {
        child.parentNode.removeChild(child)
      }
      child.parentNode = this
      const index = ref ? this.childNodes.indexOf(ref) : -1
      if (index === -1) {
        this.childNodes.push(child)
      } else {
        this.childNodes.splice(index, 0, child)
      }
      return child
    }

    removeChild(child: FakeDomNode): FakeDomNode {
      const index = this.childNodes.indexOf(child)
      if (index >= 0) {
        this.childNodes.splice(index, 1)
        child.parentNode = null
      }
      return child
    }

    setAttribute(name: string, value: string): void {
      this.attributes.set(name, String(value))
    }

    removeAttribute(name: string): void {
      this.attributes.delete(name)
    }

    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null
    }

    addEventListener(): void {}
    removeEventListener(): void {}
    focus(): void {}
    blur(): void {}

    getContext(contextId: string): unknown {
      return contextId === '2d' ? canvasRecording.ctx : null
    }
  }

  const fakeDocument: DocOwner = {
    nodeType: 9,
    documentElement: null,
    body: null,
    defaultView: null,
    activeElement: null,
    createElement(tag: string) {
      return new FakeDomNode(tag, fakeDocument)
    },
    createElementNS(_ns: string, tag: string) {
      return new FakeDomNode(tag, fakeDocument)
    },
    createTextNode(text: string) {
      const node = new FakeDomNode('#text', fakeDocument)
      node.textContent = text
      return node
    },
    createComment(text: string) {
      const node = new FakeDomNode('#comment', fakeDocument)
      node.textContent = text
      return node
    },
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

  const fakeWindow = {
    document: fakeDocument,
    navigator: { userAgent: 'node-acceptance-harness' },
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
    globalRecord.window = fakeWindow
    globalRecord.document = fakeDocument
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
      dispatchWindowKeyDown(key, modifiers = {}) {
        let defaultPrevented = false
        const event: KeyboardEventLike = {
          key,
          ...modifiers,
          preventDefault() {
            defaultPrevented = true
          },
        }
        const handlers = windowListeners.get('keydown')
        if (handlers) {
          for (const handler of [...handlers]) {
            handler(event)
          }
        }
        return defaultPrevented
      },
      async advanceIntervalTick() {
        await ReactPkg.act(async () => {
          for (const cb of [...activeIntervals.values()]) {
            cb()
          }
        })
      },
      getActiveIntervalCount() {
        return activeIntervals.size
      },
      getWindowKeydownListenerCount() {
        return windowListeners.get('keydown')?.size ?? 0
      },
    })

    if (root !== null) {
      await ReactPkg.act(async () => {
        root!.unmount()
      })
      root = null
    }
    assert.equal(
      activeIntervals.size,
      0,
      'Expected App unmount to clear its setInterval game loop timer',
    )
    assert.equal(
      windowListeners.get('keydown')?.size ?? 0,
      0,
      'Expected App unmount to remove its window keydown listener',
    )
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

test('REQ-002_REQ-004_valid_arrow_key_inputs_move_pacman_in_all_four_directions_per_tick', async () => {
  const { CLASSIC_MAZE, isTileTraversable } = await loadClassicMazeModule()
  const {
    PACMAN_SPAWN_POSITION,
    DEFAULT_GHOST_SPAWNS,
    mapKeyToDirection,
    attachKeyboardControls,
    createPacmanGame,
    renderGameToCanvas,
  } = await loadPacmanEngineModule()

  assert.deepEqual(PACMAN_SPAWN_POSITION, { row: 23, col: 13 })
  assert.equal(isTileTraversable(CLASSIC_MAZE, PACMAN_SPAWN_POSITION.row, PACMAN_SPAWN_POSITION.col), true)
  assert.ok(DEFAULT_GHOST_SPAWNS.length >= 1, 'Expected at least one default ghost spawn')

  for (const ghost of DEFAULT_GHOST_SPAWNS) {
    assert.ok(ghost.id.trim().length > 0, 'Expected non-empty default ghost id')
    assert.equal(isTileTraversable(CLASSIC_MAZE, ghost.position.row, ghost.position.col), true)
    const manhattanDistance =
      Math.abs(ghost.position.row - PACMAN_SPAWN_POSITION.row) +
      Math.abs(ghost.position.col - PACMAN_SPAWN_POSITION.col)
    assert.ok(manhattanDistance >= 8, 'Expected default ghosts to spawn away from Pacman')
  }

  // Exercise each of the 4 cardinal directions independently from open 4-way intersection (5, 6)
  const intersectionOrigin: TilePosition = { row: 5, col: 6 }
  for (const { key, dir, dRow, dCol } of DIRECTION_INPUTS) {
    assert.equal(mapKeyToDirection(key), dir)
    assert.equal(mapKeyToDirection({ key }), dir)

    const game = createPacmanGame({
      maze: CLASSIC_MAZE,
      pacmanSpawn: intersectionOrigin,
      ghosts: [],
    })

    // Before input, ticks do not move Pacman
    const idleSnap = game.tick()
    assert.equal(idleSnap.tick, 1)
    assert.deepEqual(game.getPacmanPosition(), intersectionOrigin)
    assert.equal(idleSnap.pacman.direction, null)
    assert.equal(idleSnap.pacman.status, 'alive')

    // Valid input sets direction without mutating position prior to tick()
    const accepted = game.handleKeyInput(key)
    assert.equal(accepted, true)
    assert.deepEqual(game.getPacmanPosition(), intersectionOrigin)
    assert.equal(game.getSnapshot().pacman.direction, dir)
    assert.equal(game.getSnapshot().tick, 1)

    // Tick advances Pacman by exactly 1 tile in the requested direction
    const movedSnap = game.tick()
    const expectedPos: TilePosition = {
      row: intersectionOrigin.row + dRow,
      col: intersectionOrigin.col + dCol,
    }
    assert.equal(movedSnap.tick, 2)
    assert.deepEqual(movedSnap.pacman.position, expectedPos)
    assert.deepEqual(game.getPacmanPosition(), expectedPos)
    assert.equal(movedSnap.pacman.direction, dir)
    assert.equal(movedSnap.pacman.status, 'alive')
    assert.equal(movedSnap.isPacmanDead, false)
  }

  // Multi-tick continuous navigation & turns through CLASSIC_MAZE via desktop keyboard event target
  const navGame = createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [] })
  const keyboard = createMockKeyboardTarget()
  const detach = attachKeyboardControls(keyboard.target, navGame)
  assert.equal(keyboard.listeners.size, 1)

  // Spawn (23, 13) -> ArrowLeft -> (23, 12) on tick 1
  assert.equal(keyboard.dispatchKeyDown('ArrowLeft').defaultPrevented, true)
  assert.deepEqual(navGame.getPacmanPosition(), { row: 23, col: 13 })
  assert.deepEqual(navGame.tick().pacman.position, { row: 23, col: 12 })

  // ArrowUp -> (22, 12) -> (21, 12) -> (20, 12) across 3 consecutive ticks
  assert.equal(keyboard.dispatchKeyDown('ArrowUp').defaultPrevented, true)
  assert.deepEqual(navGame.tick().pacman.position, { row: 22, col: 12 })
  assert.deepEqual(navGame.tick().pacman.position, { row: 21, col: 12 })
  assert.deepEqual(navGame.tick().pacman.position, { row: 20, col: 12 })

  // ArrowDown -> reverses back to (21, 12) -> (22, 12) -> (23, 12)
  assert.equal(keyboard.dispatchKeyDown('ArrowDown').defaultPrevented, true)
  assert.deepEqual(navGame.tick().pacman.position, { row: 21, col: 12 })
  assert.deepEqual(navGame.tick().pacman.position, { row: 22, col: 12 })
  assert.deepEqual(navGame.tick().pacman.position, { row: 23, col: 12 })

  // ArrowRight -> (23, 13) -> (23, 14) -> (23, 15) across 3 consecutive ticks
  assert.equal(keyboard.dispatchKeyDown('ArrowRight').defaultPrevented, true)
  assert.deepEqual(navGame.tick().pacman.position, { row: 23, col: 13 })
  assert.deepEqual(navGame.tick().pacman.position, { row: 23, col: 14 })
  const finalSnap = navGame.tick()
  assert.deepEqual(finalSnap.pacman.position, { row: 23, col: 15 })

  // Detaching keyboard listener stops forwarding subsequent keydown events
  detach()
  assert.equal(keyboard.listeners.size, 0)
  assert.equal(keyboard.dispatchKeyDown('ArrowUp').defaultPrevented, false)
  assert.equal(navGame.getSnapshot().pacman.direction, 'right')

  // Verify canvas rendering and <App /> reflect initial and updated Pacman positions
  const { ctx, fillRects, filledArcs } = createRecordingCanvasContext()
  const renderSummary = renderGameToCanvas(ctx, finalSnap, CLASSIC_MAZE)
  assert.equal(renderSummary.width, 560)
  assert.equal(renderSummary.height, 620)
  assert.deepEqual(renderSummary.pacmanCenterPx, { x: 15 * 20 + 10, y: 23 * 20 + 10 })
  assert.equal(renderSummary.pacmanStatus, 'alive')

  const fullCanvasBgs = fillRects.filter(
    (r) => r.x === 0 && r.y === 0 && r.w === 560 && r.h === 620,
  )
  assert.ok(fullCanvasBgs.length >= 1, 'Expected renderGameToCanvas to paint full-canvas background')
  const bgStyle = fullCanvasBgs[0].fillStyle
  const pacmanArc = filledArcs.find(
    (arc) =>
      arc.x === renderSummary.pacmanCenterPx.x &&
      arc.y === renderSummary.pacmanCenterPx.y &&
      arc.radius > CLASSIC_MAZE.tileSizePx * 0.3 &&
      arc.radius < CLASSIC_MAZE.tileSizePx * 0.5,
  )
  assert.ok(pacmanArc, 'Expected Pacman entity arc to be drawn at updated tile center')
  assert.notEqual(pacmanArc.fillStyle, bgStyle, 'Expected Pacman fillStyle to contrast with background')

  const defaultHtml = await renderAppMarkup()
  assert.match(defaultHtml, /data-testid="game-canvas"/)
  assert.match(defaultHtml, /data-pacman-row="23"/)
  assert.match(defaultHtml, /data-pacman-col="13"/)
  assert.match(defaultHtml, /data-pacman-status="alive"/)

  const movedHtml = await renderAppMarkup({ game: navGame })
  assert.match(movedHtml, /data-pacman-row="23"/)
  assert.match(movedHtml, /data-pacman-col="15"/)
  assert.match(movedHtml, /data-pacman-status="alive"/)

  // Verify mounted <App /> runs useEffect drawing, window keydown controls, and interval ticks
  const mountedGame = createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [] })
  await withMountedApp({ game: mountedGame }, undefined, async (mounted) => {
    const canvas = mounted.findCanvasElement()
    assert.ok(canvas, 'Expected mounted <App /> to render a <canvas> element')
    assert.equal(canvas.getAttribute('data-pacman-row'), '23')
    assert.equal(canvas.getAttribute('data-pacman-col'), '13')
    assert.equal(canvas.getAttribute('data-pacman-status'), 'alive')
    assert.ok(mounted.getWindowKeydownListenerCount() >= 1, 'Expected window keydown listener on mount')
    assert.ok(mounted.getActiveIntervalCount() >= 1, 'Expected active tick interval on mount')
    assert.ok(
      mounted.canvasRecording.fillRects.length > 0,
      'Expected mounted <App /> useEffect to draw initial maze and Pacman frame onto canvas',
    )

    assert.equal(mounted.dispatchWindowKeyDown('ArrowLeft'), true)
    assert.equal(mounted.dispatchWindowKeyDown('Enter'), false)
    await mounted.advanceIntervalTick()

    assert.equal(canvas.getAttribute('data-pacman-row'), '23')
    assert.equal(canvas.getAttribute('data-pacman-col'), '12')
    assert.ok(
      mounted.canvasRecording.filledArcs.some(
        (arc) =>
          arc.x === 12 * 20 + 10 &&
          arc.y === 23 * 20 + 10 &&
          arc.radius > CLASSIC_MAZE.tileSizePx * 0.3 &&
          arc.radius < CLASSIC_MAZE.tileSizePx * 0.5,
      ),
      'Expected mounted <App /> to redraw Pacman at (23, 12) after interval tick',
    )
  })
})

test('REQ-002_invalid_and_non_directional_inputs_are_ignored_without_crash_or_state_change', async () => {
  const { CLASSIC_MAZE } = await loadClassicMazeModule()
  const { mapKeyToDirection, attachKeyboardControls, createPacmanGame } =
    await loadPacmanEngineModule()

  const invalidInputs: readonly unknown[] = [
    '',
    ' ',
    'Spacebar',
    'Enter',
    'Escape',
    'Tab',
    'Shift',
    'Control',
    'Alt',
    'Meta',
    'Backspace',
    'Delete',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'F1',
    'w',
    'a',
    's',
    'd',
    'W',
    'A',
    'S',
    'D',
    'up',
    'down',
    'left',
    'right',
    'arrowup',
    'ARROWUP',
    'ArrowUpLeft',
    '1',
    '0',
    '?',
    null,
    undefined,
    0,
    42,
    Number.NaN,
    true,
    false,
    [],
    {},
    { key: null },
    { key: undefined },
    { key: 123 },
    { key: {} },
    { key: 'Enter' },
    { key: 'ArrowUp', ctrlKey: true },
    { key: 'ArrowDown', altKey: true },
    { key: 'ArrowLeft', metaKey: true },
  ]

  // 1. Stationary game at spawn remains completely unchanged across all invalid inputs
  const idleGame = createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [] })
  const beforeIdleSnap = idleGame.getSnapshot()

  for (const badInput of invalidInputs) {
    assert.equal(
      mapKeyToDirection(badInput),
      null,
      `Expected mapKeyToDirection(${ JSON.stringify(badInput) }) to return null`,
    )
    assert.equal(
      idleGame.handleKeyInput(badInput),
      false,
      `Expected handleKeyInput(${ JSON.stringify(badInput) }) to return false`,
    )
    assert.deepEqual(idleGame.getSnapshot(), beforeIdleSnap)
  }

  const afterTickIdle = idleGame.tick()
  assert.deepEqual(afterTickIdle.pacman.position, beforeIdleSnap.pacman.position)
  assert.equal(afterTickIdle.pacman.direction, null)
  assert.equal(afterTickIdle.pacman.status, 'alive')

  // 2. Actively moving Pacman keeps its current valid heading and does not preventDefault on non-arrow keys
  const movingGame = createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 1, col: 1 },
    ghosts: [],
  })
  const keyboard = createMockKeyboardTarget()
  const detach = attachKeyboardControls(keyboard.target, movingGame)

  assert.equal(keyboard.dispatchKeyDown('ArrowRight').defaultPrevented, true)
  assert.deepEqual(movingGame.tick().pacman.position, { row: 1, col: 2 })

  for (const nonArrowKey of ['Enter', 'Escape', ' ', 'Tab', 'w', 'x', '1', '']) {
    const dispatched = keyboard.dispatchKeyDown(nonArrowKey)
    assert.equal(
      dispatched.defaultPrevented,
      false,
      `Expected non-directional key "${nonArrowKey}" not to call preventDefault()`,
    )
  }
  assert.equal(
    keyboard.dispatchKeyDown('ArrowUp', { ctrlKey: true }).defaultPrevented,
    false,
    'Expected Ctrl+ArrowUp browser shortcut not to call preventDefault()',
  )

  for (const badInput of invalidInputs) {
    assert.equal(movingGame.handleKeyInput(badInput), false)
  }

  assert.equal(movingGame.getSnapshot().pacman.direction, 'right')
  assert.deepEqual(movingGame.tick().pacman.position, { row: 1, col: 3 })

  detach()
})

test('REQ-002_REQ-006_attempting_to_move_into_walls_results_in_no_position_change', async () => {
  const { CLASSIC_MAZE, isTileTraversable, canMoveFromTile } = await loadClassicMazeModule()
  const { createPacmanGame } = await loadPacmanEngineModule()

  // 1. From default spawn (23, 13), Up (22, 13) and Down (24, 13) are solid interior walls
  const spawnGame = createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [] })
  for (const blockedKey of ['ArrowUp', 'ArrowDown'] as const) {
    assert.equal(spawnGame.handleKeyInput(blockedKey), true)
    for (let step = 0; step < 3; step += 1) {
      const snap = spawnGame.tick()
      assert.deepEqual(
        snap.pacman.position,
        { row: 23, col: 13 },
        `Expected ${blockedKey} from spawn (23, 13) to remain blocked by wall on step ${step + 1}`,
      )
      assert.equal(snap.pacman.status, 'alive')
    }
  }

  // 2. Corridor head-on wall stop: moving left along row 23 from (23, 8) stops cleanly at (23, 6) before wall (23, 5)
  const corridorGame = createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 23, col: 8 },
    ghosts: [],
  })
  assert.equal(corridorGame.handleKeyInput('ArrowLeft'), true)
  assert.deepEqual(corridorGame.tick().pacman.position, { row: 23, col: 7 })
  assert.deepEqual(corridorGame.tick().pacman.position, { row: 23, col: 6 })
  assert.deepEqual(corridorGame.tick().pacman.position, { row: 23, col: 6 })
  assert.deepEqual(corridorGame.tick().pacman.position, { row: 23, col: 6 })

  // 3. Turning into an adjacent wall mid-corridor stops immediately with zero position change
  const turnIntoWallGame = createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 1, col: 1 },
    ghosts: [],
  })
  assert.equal(turnIntoWallGame.handleKeyInput('ArrowRight'), true)
  assert.deepEqual(turnIntoWallGame.tick().pacman.position, { row: 1, col: 2 })
  assert.equal(turnIntoWallGame.handleKeyInput('ArrowUp'), true)
  assert.deepEqual(turnIntoWallGame.tick().pacman.position, { row: 1, col: 2 })
  assert.deepEqual(turnIntoWallGame.tick().pacman.position, { row: 1, col: 2 })

  // 4. Exhaustively verify every corridor-to-wall direction across the entire 28x31 CLASSIC_MAZE
  const blockedCountsByDir: Record<Direction, number> = {
    up: 0,
    down: 0,
    left: 0,
    right: 0,
  }

  for (let row = 0; row < CLASSIC_MAZE.rows; row += 1) {
    for (let col = 0; col < CLASSIC_MAZE.columns; col += 1) {
      if (!isTileTraversable(CLASSIC_MAZE, row, col)) {
        continue
      }

      const origin: TilePosition = { row, col }
      for (const { key, dir } of DIRECTION_INPUTS) {
        if (canMoveFromTile(CLASSIC_MAZE, origin, dir)) {
          continue
        }

        blockedCountsByDir[dir] += 1
        const game = createPacmanGame({
          maze: CLASSIC_MAZE,
          pacmanSpawn: origin,
          ghosts: [],
        })
        assert.equal(game.handleKeyInput(key), true)
        const afterFirstTick = game.tick()
        assert.deepEqual(
          afterFirstTick.pacman.position,
          origin,
          `Pacman at (${row}, ${col}) must not move ${dir} into wall`,
        )
        const afterSecondTick = game.tick()
        assert.deepEqual(afterSecondTick.pacman.position, origin)
      }
    }
  }

  for (const { dir } of DIRECTION_INPUTS) {
    assert.ok(blockedCountsByDir[dir] > 0, `Expected wall-blocked attempts in direction ${dir}`)
  }
})

test('REQ-002_REQ-006_grid_boundary_cases_and_invalid_spawns_are_enforced', async () => {
  const { CLASSIC_MAZE } = await loadClassicMazeModule()
  const { createPacmanGame } = await loadPacmanEngineModule()

  // 1. All four interior perimeter corners and side alcoves of CLASSIC_MAZE
  const perimeterCases: readonly {
    readonly origin: TilePosition
    readonly blockedKeys: readonly string[]
    readonly allowedKey: string
    readonly expectedNext: TilePosition
  }[] = [
    {
      origin: { row: 1, col: 1 },
      blockedKeys: ['ArrowUp', 'ArrowLeft'],
      allowedKey: 'ArrowRight',
      expectedNext: { row: 1, col: 2 },
    },
    {
      origin: { row: 1, col: 26 },
      blockedKeys: ['ArrowUp', 'ArrowRight'],
      allowedKey: 'ArrowLeft',
      expectedNext: { row: 1, col: 25 },
    },
    {
      origin: { row: 29, col: 1 },
      blockedKeys: ['ArrowDown', 'ArrowLeft'],
      allowedKey: 'ArrowRight',
      expectedNext: { row: 29, col: 2 },
    },
    {
      origin: { row: 29, col: 26 },
      blockedKeys: ['ArrowDown', 'ArrowRight'],
      allowedKey: 'ArrowLeft',
      expectedNext: { row: 29, col: 25 },
    },
    {
      origin: { row: 14, col: 1 },
      blockedKeys: ['ArrowLeft', 'ArrowUp', 'ArrowDown'],
      allowedKey: 'ArrowRight',
      expectedNext: { row: 14, col: 2 },
    },
    {
      origin: { row: 14, col: 26 },
      blockedKeys: ['ArrowRight', 'ArrowUp', 'ArrowDown'],
      allowedKey: 'ArrowLeft',
      expectedNext: { row: 14, col: 25 },
    },
  ]

  for (const testCase of perimeterCases) {
    const game = createPacmanGame({
      maze: CLASSIC_MAZE,
      pacmanSpawn: testCase.origin,
      ghosts: [],
    })
    for (const blockedKey of testCase.blockedKeys) {
      game.handleKeyInput(blockedKey)
      assert.deepEqual(game.tick().pacman.position, testCase.origin)
    }
    game.handleKeyInput(testCase.allowedKey)
    assert.deepEqual(game.tick().pacman.position, testCase.expectedNext)
  }

  // 2. Open-edge custom MazeDefinition: corridor/pellet tiles directly on row=0, row=rows-1, col=0, col=columns-1
  const openEdgeMaze: MazeDefinition = {
    levelId: 'open-edge-boundary-test',
    columns: 3,
    rows: 3,
    tileSizePx: 20,
    grid: [
      ['wall', 'pellet', 'wall'],
      ['pellet', 'corridor', 'pellet'],
      ['wall', 'pellet', 'wall'],
    ],
  }

  const edgeAttempts: readonly {
    readonly edgeSpawn: TilePosition
    readonly offGridKey: string
    readonly inwardKey: string
  }[] = [
    { edgeSpawn: { row: 0, col: 1 }, offGridKey: 'ArrowUp', inwardKey: 'ArrowDown' },
    { edgeSpawn: { row: 2, col: 1 }, offGridKey: 'ArrowDown', inwardKey: 'ArrowUp' },
    { edgeSpawn: { row: 1, col: 0 }, offGridKey: 'ArrowLeft', inwardKey: 'ArrowRight' },
    { edgeSpawn: { row: 1, col: 2 }, offGridKey: 'ArrowRight', inwardKey: 'ArrowLeft' },
  ]

  for (const { edgeSpawn, offGridKey, inwardKey } of edgeAttempts) {
    const edgeGame = createPacmanGame({
      maze: openEdgeMaze,
      pacmanSpawn: edgeSpawn,
    })
    assert.deepEqual(edgeGame.getSnapshot().ghosts, [])
    edgeGame.handleKeyInput(offGridKey)
    const blockedEdgeSnap = edgeGame.tick()
    assert.deepEqual(
      blockedEdgeSnap.pacman.position,
      edgeSpawn,
      `Expected ${offGridKey} at grid edge (${edgeSpawn.row}, ${edgeSpawn.col}) not to step out of bounds`,
    )
    assert.ok(
      blockedEdgeSnap.pacman.position.row >= 0 &&
        blockedEdgeSnap.pacman.position.row < openEdgeMaze.rows &&
        blockedEdgeSnap.pacman.position.col >= 0 &&
        blockedEdgeSnap.pacman.position.col < openEdgeMaze.columns,
    )

    edgeGame.handleKeyInput(inwardKey)
    assert.deepEqual(edgeGame.tick().pacman.position, { row: 1, col: 1 })
  }

  // 3. Invalid Pacman and ghost spawns (wall tiles, out-of-bounds, non-integers) are rejected
  const invalidPositions: readonly TilePosition[] = [
    { row: 0, col: 0 }, // perimeter wall
    { row: 22, col: 13 }, // interior wall
    { row: -1, col: 13 },
    { row: 23, col: -1 },
    { row: CLASSIC_MAZE.rows, col: 13 },
    { row: 23, col: CLASSIC_MAZE.columns },
    { row: 1.5, col: 1 },
    { row: Number.NaN, col: 1 },
  ]

  for (const badPos of invalidPositions) {
    assert.throws(
      () => createPacmanGame({ maze: CLASSIC_MAZE, pacmanSpawn: badPos, ghosts: [] }),
      Error,
      `Expected invalid pacmanSpawn (${badPos.row}, ${badPos.col}) to throw`,
    )
    assert.throws(
      () =>
        createPacmanGame({
          maze: CLASSIC_MAZE,
          pacmanSpawn: { row: 23, col: 13 },
          ghosts: [{ id: 'invalid-ghost', position: badPos }],
        }),
      Error,
      `Expected invalid ghost spawn (${badPos.row}, ${badPos.col}) to throw`,
    )
  }

  assert.throws(
    () =>
      createPacmanGame({
        maze: CLASSIC_MAZE,
        pacmanSpawn: { row: 23, col: 13 },
        ghosts: [{ id: '   ', position: { row: 11, col: 13 } }],
      }),
    Error,
    'Expected empty ghost id to throw',
  )

  const validGame = createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [] })
  assert.throws(
    () => validGame.reset({ maze: CLASSIC_MAZE, pacmanSpawn: { row: 0, col: 0 }, ghosts: [] }),
    Error,
    'Expected game.reset() with wall pacmanSpawn to throw',
  )
})

test('REQ-002_collision_between_pacman_and_ghost_triggers_death_state', async () => {
  const { CLASSIC_MAZE } = await loadClassicMazeModule()
  const { checkGhostCollision, createPacmanGame, renderGameToCanvas } =
    await loadPacmanEngineModule()

  // 1. Pure collision helper covers same-tile occupancy, multi-ghost arrays, head-on tile swap, and non-overlapping safety
  assert.equal(checkGhostCollision({ row: 5, col: 6 }, [{ row: 5, col: 6 }]), true)
  assert.equal(
    checkGhostCollision({ row: 5, col: 6 }, [{ row: 1, col: 1 }, { row: 5, col: 6 }]),
    true,
    'Expected collision detection to check all ghosts, not only index 0',
  )
  assert.equal(checkGhostCollision({ row: 5, col: 6 }, [{ row: 5, col: 7 }]), false)
  assert.equal(
    checkGhostCollision(
      { row: 5, col: 7 },
      [{ row: 1, col: 1 }, { row: 5, col: 6 }],
      { row: 5, col: 6 },
      [{ row: 1, col: 1 }, { row: 5, col: 7 }],
    ),
    true,
    'Expected head-on tile swap between Pacman and any ghost to count as collision',
  )

  // 2. Stepping into a ghost from all 4 cardinal directions transitions Pacman to dead state
  const ghostCenter: TilePosition = { row: 5, col: 6 }
  const approachCases: readonly {
    readonly start: TilePosition
    readonly key: string
  }[] = [
    { start: { row: 6, col: 6 }, key: 'ArrowUp' },
    { start: { row: 4, col: 6 }, key: 'ArrowDown' },
    { start: { row: 5, col: 7 }, key: 'ArrowLeft' },
    { start: { row: 5, col: 5 }, key: 'ArrowRight' },
  ]

  for (const { start, key } of approachCases) {
    const game = createPacmanGame({
      maze: CLASSIC_MAZE,
      pacmanSpawn: start,
      ghosts: [
        { id: 'decoy', position: { row: 1, col: 1 } },
        { id: 'blinky', position: ghostCenter },
      ],
      ghostMovement: 'stationary',
    })

    const initial = game.getSnapshot()
    assert.equal(initial.pacman.status, 'alive')
    assert.equal(initial.isPacmanDead, false)
    assert.equal(initial.deathCount, 0)

    assert.equal(game.handleKeyInput(key), true)
    const collisionSnap = game.tick()
    assert.deepEqual(collisionSnap.pacman.position, ghostCenter)
    assert.equal(collisionSnap.pacman.status, 'dead')
    assert.equal(collisionSnap.pacman.direction, null)
    assert.equal(collisionSnap.isPacmanDead, true)
    assert.equal(collisionSnap.deathCount, 1)

    // While dead, further arrow inputs and ticks do not move Pacman or double-increment deathCount
    assert.equal(game.handleKeyInput('ArrowUp'), false)
    assert.equal(game.handleKeyInput('ArrowLeft'), false)
    const postDeathTick = game.tick()
    assert.deepEqual(postDeathTick.pacman.position, ghostCenter)
    assert.equal(postDeathTick.pacman.status, 'dead')
    assert.equal(postDeathTick.isPacmanDead, true)
    assert.equal(postDeathTick.deathCount, 1)

    // reset() cleanly restores alive state at initial spawn
    const resetSnap = game.reset()
    assert.equal(resetSnap.tick, 0)
    assert.deepEqual(resetSnap.pacman.position, start)
    assert.equal(resetSnap.pacman.status, 'alive')
    assert.equal(resetSnap.isPacmanDead, false)
    assert.equal(resetSnap.deathCount, 0)
  }

  // 3. Blocked wall move near ghosts does NOT trigger false-positive death
  const wallSeparatedGame = createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 23, col: 13 },
    ghosts: [
      { id: 'across-wall', position: { row: 17, col: 13 } },
      { id: 'adjacent-corridor', position: { row: 23, col: 14 } },
    ],
    ghostMovement: 'stationary',
  })
  wallSeparatedGame.handleKeyInput('ArrowUp')
  const safeSnap = wallSeparatedGame.tick()
  assert.deepEqual(safeSnap.pacman.position, { row: 23, col: 13 })
  assert.equal(safeSnap.pacman.status, 'alive')
  assert.equal(safeSnap.isPacmanDead, false)
  assert.equal(safeSnap.deathCount, 0)

  // 4. Spawn overlap immediately sets dead state; canvas and <App /> render ghosts and distinguish alive vs dead
  const aliveCtx = createRecordingCanvasContext()
  const aliveRender = renderGameToCanvas(aliveCtx.ctx, safeSnap, CLASSIC_MAZE)
  assert.equal(aliveRender.renderedGhostCount, 2)
  for (const ghostPos of [
    { row: 17, col: 13 },
    { row: 23, col: 14 },
  ]) {
    assert.ok(
      aliveCtx.filledArcs.some(
        (arc) =>
          arc.x === ghostPos.col * CLASSIC_MAZE.tileSizePx + CLASSIC_MAZE.tileSizePx / 2 &&
          arc.y === ghostPos.row * CLASSIC_MAZE.tileSizePx + CLASSIC_MAZE.tileSizePx / 2 &&
          arc.radius > 0,
      ),
      `Expected ghost arc to be rendered at tile (${ghostPos.row}, ${ghostPos.col})`,
    )
  }
  const alivePacmanArc = aliveCtx.filledArcs
    .filter(
      (arc) =>
        arc.x === aliveRender.pacmanCenterPx.x &&
        arc.y === aliveRender.pacmanCenterPx.y &&
        arc.radius > CLASSIC_MAZE.tileSizePx * 0.3 &&
        arc.radius < CLASSIC_MAZE.tileSizePx * 0.5,
    )
    .at(-1)
  assert.ok(alivePacmanArc, 'Expected alive Pacman arc on canvas')

  const overlapDeadGame = createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 23, col: 13 },
    ghosts: [{ id: 'blinky', position: { row: 23, col: 13 } }],
    ghostMovement: 'stationary',
  })
  const deadSnap = overlapDeadGame.getSnapshot()
  assert.equal(deadSnap.pacman.status, 'dead')
  assert.equal(deadSnap.isPacmanDead, true)
  assert.equal(deadSnap.deathCount, 1)

  const deadCtx = createRecordingCanvasContext()
  const deadRender = renderGameToCanvas(deadCtx.ctx, deadSnap, CLASSIC_MAZE)
  assert.equal(deadRender.pacmanStatus, 'dead')
  assert.equal(deadRender.renderedGhostCount, 1)
  const deadPacmanArc = deadCtx.filledArcs
    .filter(
      (arc) =>
        arc.x === deadRender.pacmanCenterPx.x &&
        arc.y === deadRender.pacmanCenterPx.y &&
        arc.radius > CLASSIC_MAZE.tileSizePx * 0.3 &&
        arc.radius < CLASSIC_MAZE.tileSizePx * 0.5,
    )
    .at(-1)
  assert.ok(deadPacmanArc, 'Expected dead Pacman arc on canvas')
  assert.notEqual(
    deadPacmanArc.fillStyle,
    alivePacmanArc.fillStyle,
    'Expected dead Pacman arc to render with a distinct fillStyle from alive state',
  )

  const deadHtml = await renderAppMarkup({ game: overlapDeadGame })
  assert.match(deadHtml, /data-pacman-status="dead"/)
})

test('REQ-002_engine_instances_and_snapshots_are_isolated_between_runs', async () => {
  const { CLASSIC_MAZE } = await loadClassicMazeModule()
  const { createPacmanGame } = await loadPacmanEngineModule()

  const gameA = createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [] })
  const gameB = createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [] })

  gameA.handleKeyInput('ArrowLeft')
  gameA.tick()

  assert.deepEqual(gameA.getPacmanPosition(), { row: 23, col: 12 })
  assert.deepEqual(gameB.getPacmanPosition(), { row: 23, col: 13 })
  assert.equal(gameB.getSnapshot().tick, 0)
  assert.equal(gameB.getSnapshot().pacman.direction, null)

  // Attempting to mutate returned position/snapshot objects must not corrupt internal engine state
  const posRef = gameB.getPacmanPosition() as { row: number; col: number }
  const snapRef = gameB.getSnapshot() as {
    tick: number
    pacman: { position: { row: number; col: number }; status: string }
  }

  try {
    posRef.row = 999
  } catch {
    // Frozen object rejection is expected and valid
  }
  try {
    snapRef.tick = 999
    snapRef.pacman.position.col = 999
    snapRef.pacman.status = 'dead'
  } catch {
    // Frozen object rejection is expected and valid
  }

  assert.deepEqual(gameB.getPacmanPosition(), { row: 23, col: 13 })
  assert.equal(gameB.getSnapshot().tick, 0)
  assert.equal(gameB.getSnapshot().pacman.status, 'alive')
})

test('REQ-001_REQ-005_REQ-007_movement_and_death_execute_client_side_with_no_network_storage_or_audio', async () => {
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
      throw new Error('Unexpected fetch during Pacman simulation')
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

    // Use a fresh Vite server so module initialization runs directly under the active traps
    freshVite = await createViteInstance()
    const { CLASSIC_MAZE } = await loadClassicMazeModule(freshVite)
    const engineMod = await loadPacmanEngineModule(freshVite)

    const game = engineMod.createPacmanGame({
      maze: CLASSIC_MAZE,
      pacmanSpawn: { row: 5, col: 5 },
      ghosts: [{ id: 'blinky', position: { row: 5, col: 7 } }],
      ghostMovement: 'stationary',
    })

    game.handleKeyInput('ArrowRight')
    game.tick() // (5, 6)
    game.handleKeyInput('Enter') // ignored invalid input
    const deadSnap = game.tick() // (5, 7) -> collides with ghost -> dead
    assert.equal(deadSnap.isPacmanDead, true)

    const { ctx } = createRecordingCanvasContext()
    engineMod.renderGameToCanvas(ctx, deadSnap, CLASSIC_MAZE)
    const html = await renderAppMarkup({ game }, freshVite)
    assert.match(html, /data-pacman-status="dead"/)

    const mountedSimGame = engineMod.createPacmanGame({
      maze: CLASSIC_MAZE,
      pacmanSpawn: { row: 5, col: 6 },
      ghosts: [{ id: 'blinky', position: { row: 5, col: 7 } }],
      ghostMovement: 'stationary',
    })
    await withMountedApp({ game: mountedSimGame }, freshVite, async (mounted) => {
      mounted.dispatchWindowKeyDown('ArrowRight')
      await mounted.advanceIntervalTick()
      const canvas = mounted.findCanvasElement()
      assert.ok(canvas)
      assert.equal(canvas.getAttribute('data-pacman-status'), 'dead')
    })

    assert.deepEqual(
      sideEffectEvents,
      [],
      'Expected zero network, storage, or audio API accesses during module load, input, tick, death, and mounted render',
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
    assert.doesNotMatch(code, /\bAudioContext\b/, `Disallowed AudioContext usage in ${relPath}`)
    assert.doesNotMatch(code, /\bwebkitAudioContext\b/, `Disallowed webkitAudioContext usage in ${relPath}`)
    assert.doesNotMatch(code, /\bnew\s+Audio\s*\(/, `Disallowed HTMLAudioElement construction in ${relPath}`)
  }
})
