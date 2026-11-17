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
type GameStatus = 'playing' | 'won' | 'game-over'

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

interface PacmanGameOptions {
  readonly maze?: MazeDefinition
  readonly pacmanSpawn?: TilePosition
  readonly ghosts?: readonly GhostInit[]
  readonly ghostMovement?: GhostMovementMode
  readonly initialLives?: number
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
  respawn(): PacmanGameSnapshot
  reset(options?: PacmanGameOptions): PacmanGameSnapshot
}

interface ClassicMazeModule {
  readonly CLASSIC_MAZE: MazeDefinition
  isWallTile(maze: MazeDefinition, row: number, col: number): boolean
  isTileTraversable(maze: MazeDefinition, row: number, col: number): boolean
  canMoveFromTile(maze: MazeDefinition, from: TilePosition, direction: Direction): boolean
  resolveTileMovement(maze: MazeDefinition, from: TilePosition, direction: Direction): TilePosition
  getPelletSpawnPositions(maze?: MazeDefinition): readonly PelletSpawn[]
  renderMazeToCanvas(
    ctx: unknown,
    maze?: MazeDefinition,
    activePellets?: readonly PelletSpawn[],
  ): MazeRenderSummary
}

interface PacmanEngineBaseModule {
  readonly PACMAN_SPAWN_POSITION: TilePosition
  readonly DEFAULT_GHOST_SPAWNS: readonly GhostInit[]
  createPacmanGame(options?: PacmanGameOptions): PacmanGameEngine
  renderGameToCanvas(
    ctx: unknown,
    snapshot: PacmanGameSnapshot,
    maze?: MazeDefinition,
  ): GameRenderSummary
}

interface ScoringAndLivesExports {
  readonly PELLET_SCORE: number
  readonly POWER_PELLET_SCORE: number
  readonly INITIAL_LIVES: number
  getPelletScore(kind: PelletSpawn['kind']): number
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

const DIRECTION_STEPS: readonly {
  readonly dir: Direction
  readonly key: string
  readonly dRow: number
  readonly dCol: number
}[] = [
  { dir: 'up', key: 'ArrowUp', dRow: -1, dCol: 0 },
  { dir: 'down', key: 'ArrowDown', dRow: 1, dCol: 0 },
  { dir: 'left', key: 'ArrowLeft', dRow: 0, dCol: -1 },
  { dir: 'right', key: 'ArrowRight', dRow: 0, dCol: 1 },
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
  assert.equal(typeof mod.getPelletSpawnPositions, 'function', 'Expected getPelletSpawnPositions export')
  assert.equal(typeof mod.renderMazeToCanvas, 'function', 'Expected renderMazeToCanvas export')
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
  assert.equal(typeof mod.createPacmanGame, 'function')
  assert.equal(typeof mod.renderGameToCanvas, 'function')

  return mod as unknown as PacmanEngineBaseModule & Record<string, unknown>
}

function requireScoringAndLivesExports(mod: Record<string, unknown>): ScoringAndLivesExports {
  assert.equal(
    typeof mod.PELLET_SCORE,
    'number',
    'Expected PELLET_SCORE numeric constant export in web/src/game/pacmanEngine.ts per ISS-9 contract.md',
  )
  assert.equal(
    typeof mod.POWER_PELLET_SCORE,
    'number',
    'Expected POWER_PELLET_SCORE numeric constant export in web/src/game/pacmanEngine.ts per ISS-9 contract.md',
  )
  assert.equal(
    typeof mod.INITIAL_LIVES,
    'number',
    'Expected INITIAL_LIVES numeric constant export in web/src/game/pacmanEngine.ts per ISS-9 contract.md',
  )
  assert.equal(
    typeof mod.getPelletScore,
    'function',
    'Expected getPelletScore function export in web/src/game/pacmanEngine.ts per ISS-9 contract.md',
  )
  return mod as unknown as ScoringAndLivesExports
}

function assertIss9SnapshotContract(rawSnapshot: unknown): asserts rawSnapshot is PacmanGameSnapshot {
  assert.ok(rawSnapshot !== null && typeof rawSnapshot === 'object', 'Expected snapshot object')
  const snap = rawSnapshot as Record<string, unknown>
  assert.equal(typeof snap.score, 'number', 'Expected snapshot.score number per ISS-9 contract.md')
  assert.equal(typeof snap.lives, 'number', 'Expected snapshot.lives number per ISS-9 contract.md')
  assert.equal(
    typeof snap.initialLives,
    'number',
    'Expected snapshot.initialLives number per ISS-9 contract.md',
  )
  assert.ok(Array.isArray(snap.pellets), 'Expected snapshot.pellets array per ISS-9 contract.md')
  assert.equal(
    typeof snap.totalPelletCount,
    'number',
    'Expected snapshot.totalPelletCount number per ISS-9 contract.md',
  )
  assert.equal(
    typeof snap.remainingPelletCount,
    'number',
    'Expected snapshot.remainingPelletCount number per ISS-9 contract.md',
  )
  assert.ok(
    snap.gameStatus === 'playing' || snap.gameStatus === 'won' || snap.gameStatus === 'game-over',
    `Expected snapshot.gameStatus to be 'playing' | 'won' | 'game-over', got ${String(snap.gameStatus)}`,
  )
  assert.equal(
    typeof snap.isGameOver,
    'boolean',
    'Expected snapshot.isGameOver boolean per ISS-9 contract.md',
  )
  assert.equal(typeof snap.isWin, 'boolean', 'Expected snapshot.isWin boolean per ISS-9 contract.md')
}

function assertRespawnMethod(game: unknown): asserts game is PacmanGameEngine {
  assert.ok(game !== null && typeof game === 'object', 'Expected PacmanGameEngine instance')
  assert.equal(
    typeof (game as Record<string, unknown>).respawn,
    'function',
    'Expected game.respawn() method on PacmanGameEngine per ISS-9 contract.md',
  )
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
    clearRect(x: number, y: number, w: number, h: number): void {
      clearRects.push({ x, y, w, h, fillStyle: String(currentFillStyle) })
    },
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

  return { ctx, clearRects, fillRects, filledArcs }
}

interface FakeElementLike {
  readonly tagName: string
  readonly childNodes: FakeElementLike[]
  readonly textContent: string
  getAttribute(name: string): string | null
}

async function withMountedApp(
  props: Record<string, unknown>,
  viteInstance: ViteServerLike | undefined,
  onSendBeacon: ((url: string) => void) | undefined,
  run: (harness: {
    readonly canvasRecording: ReturnType<typeof createRecordingCanvasContext>
    findCanvasElement(): FakeElementLike | null
    findByTestId(testId: string): FakeElementLike | null
    dispatchWindowKeyDown(
      key: unknown,
      modifiers?: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean },
    ): boolean
    clickByTestId(testId: string): Promise<void>
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

  type DomEventListener = (event: Record<string, unknown>) => void

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
    readonly listeners = new Map<string, Set<DomEventListener>>()
    readonly style: Record<string, string> = {}
    disabled = false
    type = ''
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
      if (!this.parentNode) return null
      const idx = this.parentNode.childNodes.indexOf(this)
      return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null
    }
    set className(v: string) {
      this.attributes.set('class', String(v))
    }
    get className(): string {
      return this.attributes.get('class') ?? ''
    }
    set id(v: string) {
      this.attributes.set('id', String(v))
    }
    get id(): string {
      return this.attributes.get('id') ?? ''
    }
    set width(v: number) {
      this.attributes.set('width', String(v))
    }
    get width(): number {
      return Number(this.attributes.get('width') ?? 0)
    }
    set height(v: number) {
      this.attributes.set('height', String(v))
    }
    get height(): number {
      return Number(this.attributes.get('height') ?? 0)
    }
    set nodeValue(v: string | null) {
      this.textValue = v === null ? '' : String(v)
    }
    get nodeValue(): string | null {
      return this.nodeType === 3 || this.nodeType === 8 ? this.textValue : null
    }
    set textContent(v: string | null) {
      this.textValue = v === null ? '' : String(v)
      for (const child of this.childNodes) {
        child.parentNode = null
      }
      this.childNodes = []
    }
    get textContent(): string {
      if (this.nodeType === 3 || this.nodeType === 8) {
        return this.textValue
      }
      if (this.childNodes.length === 0) {
        return this.textValue
      }
      return this.childNodes.map((c) => c.textContent).join('')
    }

    appendChild(child: FakeDomNode): FakeDomNode {
      if (child.parentNode) child.parentNode.removeChild(child)
      if (this.nodeType === 1) this.textValue = ''
      child.parentNode = this
      this.childNodes.push(child)
      return child
    }

    insertBefore(child: FakeDomNode, ref: FakeDomNode | null): FakeDomNode {
      if (child.parentNode) child.parentNode.removeChild(child)
      if (this.nodeType === 1) this.textValue = ''
      child.parentNode = this
      const idx = ref ? this.childNodes.indexOf(ref) : -1
      if (idx === -1) this.childNodes.push(child)
      else this.childNodes.splice(idx, 0, child)
      return child
    }

    removeChild(child: FakeDomNode): FakeDomNode {
      const idx = this.childNodes.indexOf(child)
      if (idx >= 0) {
        this.childNodes.splice(idx, 1)
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
    addEventListener(
      type: string,
      listener: DomEventListener,
      options?: boolean | { capture?: boolean },
    ): void {
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
      const key = `${type}:${capture}`
      if (!this.listeners.has(key)) {
        this.listeners.set(key, new Set())
      }
      this.listeners.get(key)!.add(listener)
    }
    removeEventListener(
      type: string,
      listener: DomEventListener,
      options?: boolean | { capture?: boolean },
    ): void {
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
      this.listeners.get(`${type}:${capture}`)?.delete(listener)
    }
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

  function findNodeByTestId(node: FakeDomNode, testId: string): FakeDomNode | null {
    if (node.getAttribute('data-testid') === testId) {
      return node
    }
    for (const child of node.childNodes) {
      const found = findNodeByTestId(child, testId)
      if (found) {
        return found
      }
    }
    return null
  }

  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: fakeWindow,
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: fakeDocument,
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: fakeNavigator,
    })
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
      findByTestId(testId: string) {
        return findNodeByTestId(container, testId)
      },
      dispatchWindowKeyDown(
        key: unknown,
        modifiers: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {},
      ) {
        let defaultPrevented = false
        const event: KeyboardEventLike = {
          key,
          ...modifiers,
          preventDefault() {
            defaultPrevented = true
          },
        }
        for (const listener of [...(windowListeners.get('keydown') ?? [])]) {
          listener(event)
        }
        return defaultPrevented
      },
      async clickByTestId(testId: string) {
        const target = findNodeByTestId(container, testId)
        assert.ok(target, `Expected mounted <App /> element with data-testid="${testId}"`)

        const propagationPath: FakeDomNode[] = []
        for (let cur: FakeDomNode | null = target; cur !== null; cur = cur.parentNode) {
          propagationPath.push(cur)
        }

        let propagationStopped = false
        const clickEvent: Record<string, unknown> = {
          type: 'click',
          bubbles: true,
          cancelable: true,
          target,
          srcElement: target,
          currentTarget: null,
          eventPhase: 0,
          button: 0,
          detail: 1,
          defaultPrevented: false,
          preventDefault() {
            clickEvent.defaultPrevented = true
          },
          stopPropagation() {
            propagationStopped = true
          },
        }

        await ReactPkg.act(async () => {
          for (let i = propagationPath.length - 1; i >= 0 && !propagationStopped; i -= 1) {
            const current = propagationPath[i]
            clickEvent.currentTarget = current
            clickEvent.eventPhase = current === target ? 2 : 1
            for (const fn of [...(current.listeners.get('click:true') ?? [])]) {
              fn(clickEvent)
            }
          }

          for (let i = 0; i < propagationPath.length && !propagationStopped; i += 1) {
            const current = propagationPath[i]
            clickEvent.currentTarget = current
            clickEvent.eventPhase = current === target ? 2 : 3
            for (const fn of [...(current.listeners.get('click:false') ?? [])]) {
              fn(clickEvent)
            }
          }
        })
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
    assert.equal(
      windowListeners.get('keydown')?.size ?? 0,
      0,
      'Expected App unmount to remove keydown listener',
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

function findShortestKeyPath(
  maze: MazeDefinition,
  canMoveFromTile: (m: MazeDefinition, from: TilePosition, dir: Direction) => boolean,
  resolveTileMovement: (m: MazeDefinition, from: TilePosition, dir: Direction) => TilePosition,
  start: TilePosition,
  goal: TilePosition,
): string[] {
  if (start.row === goal.row && start.col === goal.col) {
    return []
  }

  const startKey = `${start.row},${start.col}`
  const goalKey = `${goal.row},${goal.col}`
  const visited = new Set<string>([startKey])
  const parent = new Map<string, { readonly prevKey: string; readonly keyInput: string }>()
  const queue: TilePosition[] = [start]

  while (queue.length > 0) {
    const current = queue.shift()!
    const currentKey = `${current.row},${current.col}`

    for (const step of DIRECTION_STEPS) {
      if (!canMoveFromTile(maze, current, step.dir)) {
        continue
      }
      const next = resolveTileMovement(maze, current, step.dir)
      const nextKey = `${next.row},${next.col}`
      if (visited.has(nextKey)) {
        continue
      }

      visited.add(nextKey)
      parent.set(nextKey, { prevKey: currentKey, keyInput: step.key })
      if (nextKey === goalKey) {
        const reversedKeys: string[] = []
        let cursor = goalKey
        while (cursor !== startKey) {
          const edge = parent.get(cursor)!
          reversedKeys.push(edge.keyInput)
          cursor = edge.prevKey
        }
        return reversedKeys.reverse()
      }
      queue.push(next)
    }
  }

  throw new Error(`No navigable path from (${start.row}, ${start.col}) to (${goal.row}, ${goal.col})`)
}

test('REQ-002_REQ-006_collecting_pellets_and_power_pellets_removes_them_and_increments_score_in_engine_canvas_and_ui', async () => {
  const { CLASSIC_MAZE, isWallTile, isTileTraversable, getPelletSpawnPositions, renderMazeToCanvas } =
    await loadClassicMazeModule()
  const engineMod = await loadPacmanEngineModule()
  const { PELLET_SCORE, POWER_PELLET_SCORE, getPelletScore } =
    requireScoringAndLivesExports(engineMod)

  assert.equal(PELLET_SCORE, 10)
  assert.equal(POWER_PELLET_SCORE, 50)
  assert.equal(getPelletScore('pellet'), 10)
  assert.equal(getPelletScore('power-pellet'), 50)

  // 1. Initial pellet spawns on CLASSIC_MAZE match valid traversable tiles and start uncollected at score 0
  const expectedClassicSpawns = getPelletSpawnPositions(CLASSIC_MAZE)
  assert.equal(expectedClassicSpawns.length, 244)

  const classicGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    ghosts: [],
  })
  const initialSnap = classicGame.getSnapshot()
  assertIss9SnapshotContract(initialSnap)

  assert.equal(initialSnap.score, 0)
  assert.equal(initialSnap.totalPelletCount, expectedClassicSpawns.length)
  assert.equal(initialSnap.remainingPelletCount, expectedClassicSpawns.length)
  assert.deepEqual(initialSnap.pellets, expectedClassicSpawns)
  assert.equal(initialSnap.gameStatus, 'playing')
  assert.equal(initialSnap.isWin, false)
  assert.equal(initialSnap.isGameOver, false)

  for (const pellet of initialSnap.pellets) {
    assert.equal(isWallTile(CLASSIC_MAZE, pellet.row, pellet.col), false)
    assert.equal(isTileTraversable(CLASSIC_MAZE, pellet.row, pellet.col), true)
  }

  // 2. Idle tick on empty corridor spawn (23, 13) and wall-blocked ticks do not consume pellets or award points
  const idleCorridorSnap = classicGame.tick()
  assertIss9SnapshotContract(idleCorridorSnap)
  assert.equal(idleCorridorSnap.score, 0)
  assert.equal(idleCorridorSnap.remainingPelletCount, 244)

  assert.equal(classicGame.handleKeyInput('ArrowUp'), true) // (22, 13) is a wall
  const blockedWallSnap = classicGame.tick()
  assert.deepEqual(blockedWallSnap.pacman.position, { row: 23, col: 13 })
  assert.equal(blockedWallSnap.score, 0)
  assert.equal(blockedWallSnap.remainingPelletCount, 244)

  // 3. Moving left from (23, 13) -> (23, 12) consumes standard pellet (+10) and removes it from snapshot.pellets
  assert.equal(classicGame.handleKeyInput('ArrowLeft'), true)
  const firstPelletSnap = classicGame.tick()
  assert.deepEqual(firstPelletSnap.pacman.position, { row: 23, col: 12 })
  assert.equal(firstPelletSnap.score, PELLET_SCORE)
  assert.equal(firstPelletSnap.totalPelletCount, 244)
  assert.equal(firstPelletSnap.remainingPelletCount, 243)
  assert.equal(
    firstPelletSnap.pellets.some((p) => p.row === 23 && p.col === 12),
    false,
    'Expected consumed pellet at (23, 12) to be removed from snapshot.pellets',
  )

  // Continue left to (23, 11) (+10 => 20), then reverse right over cleared (23, 12) (+0 => 20)
  const secondPelletSnap = classicGame.tick()
  assert.deepEqual(secondPelletSnap.pacman.position, { row: 23, col: 11 })
  assert.equal(secondPelletSnap.score, PELLET_SCORE * 2)
  assert.equal(secondPelletSnap.remainingPelletCount, 242)

  assert.equal(classicGame.handleKeyInput('ArrowRight'), true)
  const revisitClearedSnap = classicGame.tick()
  assert.deepEqual(revisitClearedSnap.pacman.position, { row: 23, col: 12 })
  assert.equal(
    revisitClearedSnap.score,
    PELLET_SCORE * 2,
    'Re-entering an already-cleared pellet tile must not award duplicate score',
  )
  assert.equal(revisitClearedSnap.remainingPelletCount, 242)

  // 4. Power-pellet at (23, 1) awards POWER_PELLET_SCORE (+50) and is removed on consumption
  const powerGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 23, col: 2 },
    ghosts: [],
  })
  assert.equal(powerGame.handleKeyInput('ArrowLeft'), true)
  const powerSnap = powerGame.tick()
  assertIss9SnapshotContract(powerSnap)
  assert.deepEqual(powerSnap.pacman.position, { row: 23, col: 1 })
  assert.equal(powerSnap.score, POWER_PELLET_SCORE)
  assert.equal(powerSnap.remainingPelletCount, 243)
  assert.equal(
    powerSnap.pellets.some((p) => p.row === 23 && p.col === 1),
    false,
    'Expected consumed power-pellet at (23, 1) to be removed from snapshot.pellets',
  )

  // Reversing back onto (23, 2) consumes its standard pellet (+10 => 60), then re-entering (23, 1) adds +0
  assert.equal(powerGame.handleKeyInput('ArrowRight'), true)
  const mixedScoreSnap = powerGame.tick()
  assert.equal(mixedScoreSnap.score, POWER_PELLET_SCORE + PELLET_SCORE)
  assert.equal(mixedScoreSnap.remainingPelletCount, 242)

  assert.equal(powerGame.handleKeyInput('ArrowLeft'), true)
  const revisitPowerSnap = powerGame.tick()
  assert.equal(revisitPowerSnap.score, POWER_PELLET_SCORE + PELLET_SCORE)
  assert.equal(revisitPowerSnap.remainingPelletCount, 242)

  // 5. Canvas rendering removes consumed pellets while keeping uncollected pellets and static CLASSIC_MAZE intact
  const tileSize = CLASSIC_MAZE.tileSizePx
  const maxPelletRadius = tileSize * 0.32 // pellet=0.125*tile, power-pellet=0.3*tile; entities > 0.3*tile

  const staticMazeCanvas = createRecordingCanvasContext()
  const staticSummary = renderMazeToCanvas(staticMazeCanvas.ctx, CLASSIC_MAZE)
  assert.equal(staticSummary.renderedPelletCount, 244, 'Static CLASSIC_MAZE must remain unmutated')

  const liveCanvas = createRecordingCanvasContext()
  const liveSummary = engineMod.renderGameToCanvas(
    liveCanvas.ctx,
    revisitClearedSnap,
    CLASSIC_MAZE,
  )
  assert.equal(
    liveSummary.renderedPelletCount,
    242,
    'Expected renderGameToCanvas to render only remaining uncollected pellets',
  )

  // Vacated tile (23, 11) was consumed and currently has neither Pacman (at 23, 12) nor any ghost
  const vacatedTileArcs = liveCanvas.filledArcs.filter(
    (arc) => arc.x === 11 * tileSize + tileSize / 2 && arc.y === 23 * tileSize + tileSize / 2,
  )
  assert.equal(
    vacatedTileArcs.length,
    0,
    'Expected consumed pellet at vacated tile (23, 11) not to be drawn on canvas',
  )
  // Uncollected neighbor (23, 10) must still render a pellet-sized arc
  assert.ok(
    liveCanvas.filledArcs.some(
      (arc) =>
        arc.x === 10 * tileSize + tileSize / 2 &&
        arc.y === 23 * tileSize + tileSize / 2 &&
        arc.radius > 0 &&
        arc.radius <= maxPelletRadius,
    ),
    'Expected uncollected pellet at (23, 10) to remain rendered on canvas',
  )

  // 6. <App /> SSR markup and mounted real-time HUD reflect pellet consumption and score updates
  const defaultHtml = await renderAppMarkup()
  assert.match(defaultHtml, /data-testid="score-display"/)
  assert.match(defaultHtml, /data-score="0"/)
  assert.match(defaultHtml, /data-testid="pellets-display"/)
  assert.match(defaultHtml, /data-remaining-pellets="244"/)
  assert.match(defaultHtml, /data-pellet-spawns="244"/)

  const uiGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 23, col: 3 },
    ghosts: [],
  })
  await withMountedApp({ game: uiGame }, undefined, undefined, async (mounted) => {
    const canvas = mounted.findCanvasElement()
    const scoreEl = mounted.findByTestId('score-display')
    const pelletsEl = mounted.findByTestId('pellets-display')
    assert.ok(canvas, 'Expected <canvas> in mounted <App />')
    assert.ok(scoreEl, 'Expected data-testid="score-display" in mounted <App />')
    assert.ok(pelletsEl, 'Expected data-testid="pellets-display" in mounted <App />')

    assert.equal(scoreEl.getAttribute('data-score'), '0')
    assert.match(scoreEl.textContent, /\b0\b/)
    assert.equal(pelletsEl.getAttribute('data-remaining-pellets'), '244')
    assert.match(pelletsEl.textContent, /\b244\b/)
    assert.equal(canvas.getAttribute('data-score'), '0')
    assert.equal(canvas.getAttribute('data-remaining-pellets'), '244')

    // Move left from (23, 3) -> (23, 2) standard pellet (+10), then -> (23, 1) power-pellet (+50 => 60)
    assert.equal(mounted.dispatchWindowKeyDown('ArrowLeft'), true)
    await mounted.advanceIntervalTick()

    assert.equal(scoreEl.getAttribute('data-score'), '10')
    assert.match(scoreEl.textContent, /\b10\b/)
    assert.equal(pelletsEl.getAttribute('data-remaining-pellets'), '243')
    assert.match(pelletsEl.textContent, /\b243\b/)
    assert.equal(canvas.getAttribute('data-score'), '10')
    assert.equal(canvas.getAttribute('data-remaining-pellets'), '243')
    assert.equal(canvas.getAttribute('data-pellet-spawns'), '244')

    await mounted.advanceIntervalTick()
    assert.equal(scoreEl.getAttribute('data-score'), '60')
    assert.match(scoreEl.textContent, /\b60\b/)
    assert.equal(pelletsEl.getAttribute('data-remaining-pellets'), '242')
    assert.match(pelletsEl.textContent, /\b242\b/)
    assert.equal(canvas.getAttribute('data-score'), '60')
    assert.equal(canvas.getAttribute('data-remaining-pellets'), '242')
  })
})

test('REQ-002_player_lives_decrement_on_death_support_respawn_and_transition_to_game_over_at_zero_lives', async () => {
  const { CLASSIC_MAZE } = await loadClassicMazeModule()
  const engineMod = await loadPacmanEngineModule()
  const { INITIAL_LIVES, PELLET_SCORE } = requireScoringAndLivesExports(engineMod)

  assert.equal(INITIAL_LIVES, 3)

  // 1. Validate initialLives defaults and rejection of invalid non-positive or non-integer values
  const defaultLivesGame = engineMod.createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [] })
  const defaultSnap = defaultLivesGame.getSnapshot()
  assertIss9SnapshotContract(defaultSnap)
  assertRespawnMethod(defaultLivesGame)
  assert.equal(defaultSnap.lives, 3)
  assert.equal(defaultSnap.initialLives, 3)
  assert.equal(defaultSnap.gameStatus, 'playing')
  assert.equal(defaultSnap.isGameOver, false)

  for (const invalidLives of [0, -1, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => engineMod.createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [], initialLives: invalidLives }),
      Error,
      `Expected initialLives=${String(invalidLives)} to throw Error`,
    )
    assert.throws(
      () => defaultLivesGame.reset({ maze: CLASSIC_MAZE, ghosts: [], initialLives: invalidLives }),
      Error,
      `Expected reset() with initialLives=${String(invalidLives)} to throw without corrupting state`,
    )
  }
  assert.equal(defaultLivesGame.getSnapshot().lives, 3)

  // Calling respawn() while alive is a safe no-op
  defaultLivesGame.handleKeyInput('ArrowLeft')
  defaultLivesGame.tick()
  const beforeNoopRespawn = defaultLivesGame.getSnapshot()
  const afterNoopRespawn = defaultLivesGame.respawn()
  assert.deepEqual(afterNoopRespawn, beforeNoopRespawn)

  // 2. Full 3-life progression: 3 -> 2 -> 1 -> 0 (game-over), preserving score and consumed pellets across respawns
  const lifeCycleGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 23, col: 13 },
    ghosts: [{ id: 'blinky', position: { row: 23, col: 10 } }],
    ghostMovement: 'stationary',
  })
  assertRespawnMethod(lifeCycleGame)

  // Life 1: collect (23, 12) (+10) and (23, 11) (+10 => 20), then collide with Blinky on pellet tile (23, 10)
  assert.equal(lifeCycleGame.handleKeyInput('ArrowLeft'), true)
  const step1 = lifeCycleGame.tick() // (23, 12)
  assert.equal(step1.score, PELLET_SCORE)
  assert.equal(step1.lives, 3)

  const step2 = lifeCycleGame.tick() // (23, 11)
  assert.equal(step2.score, PELLET_SCORE * 2)
  assert.equal(step2.remainingPelletCount, 242)

  const death1 = lifeCycleGame.tick() // (23, 10) -> fatal collision with Blinky
  assert.deepEqual(death1.pacman.position, { row: 23, col: 10 })
  assert.equal(death1.pacman.status, 'dead')
  assert.equal(death1.isPacmanDead, true)
  assert.equal(death1.deathCount, 1)
  assert.equal(death1.lives, 2)
  assert.equal(
    death1.score,
    PELLET_SCORE * 2,
    'Fatal collision tile must not award pellet points when Pacman dies on entry',
  )
  assert.equal(death1.remainingPelletCount, 242)
  assert.equal(death1.gameStatus, 'playing', 'Game must remain in playing status while lives > 0')
  assert.equal(death1.isGameOver, false)
  assert.equal(death1.isWin, false)

  // Post-death tick while dead preserves ISS-5/ISS-7 invariants and does NOT double-decrement lives
  assert.equal(lifeCycleGame.handleKeyInput('ArrowRight'), false)
  const deadHoldTick = lifeCycleGame.tick()
  assert.equal(deadHoldTick.pacman.status, 'dead')
  assert.equal(deadHoldTick.lives, 2)
  assert.equal(deadHoldTick.deathCount, 1)
  assert.equal(deadHoldTick.gameStatus, 'playing')

  // Respawn into Life 2: restores Pacman to (23, 13) & ghosts to initial spawns while keeping score=20, lives=2, pellets=242
  const respawn1 = lifeCycleGame.respawn()
  assert.equal(respawn1.pacman.status, 'alive')
  assert.equal(respawn1.pacman.direction, null)
  assert.equal(respawn1.isPacmanDead, false)
  assert.deepEqual(respawn1.pacman.position, { row: 23, col: 13 })
  assert.deepEqual(respawn1.ghosts[0].position, { row: 23, col: 10 })
  assert.equal(respawn1.lives, 2)
  assert.equal(respawn1.deathCount, 1)
  assert.equal(respawn1.score, PELLET_SCORE * 2)
  assert.equal(respawn1.remainingPelletCount, 242)
  assert.equal(respawn1.gameStatus, 'playing')

  // Life 2: collect pellet to the right at (23, 15) (+10 => 30), then walk left into Blinky -> lives=1
  assert.equal(lifeCycleGame.handleKeyInput('ArrowRight'), true)
  lifeCycleGame.tick() // (23, 14) corridor
  const rightPellet = lifeCycleGame.tick() // (23, 15) pellet
  assert.equal(rightPellet.score, PELLET_SCORE * 3)
  assert.equal(rightPellet.remainingPelletCount, 241)

  assert.equal(lifeCycleGame.handleKeyInput('ArrowLeft'), true)
  for (let i = 0; i < 5; i += 1) {
    lifeCycleGame.tick()
  }
  const death2 = lifeCycleGame.getSnapshot()
  assert.deepEqual(death2.pacman.position, { row: 23, col: 10 })
  assert.equal(death2.pacman.status, 'dead')
  assert.equal(death2.deathCount, 2)
  assert.equal(death2.lives, 1)
  assert.equal(death2.score, PELLET_SCORE * 3)
  assert.equal(death2.gameStatus, 'playing')
  assert.equal(death2.isGameOver, false)

  // Respawn into Life 3 (final life, lives=1), then collide with Blinky -> lives=0 & game-over
  const respawn2 = lifeCycleGame.respawn()
  assert.equal(respawn2.pacman.status, 'alive')
  assert.equal(respawn2.lives, 1)
  assert.equal(respawn2.gameStatus, 'playing')

  assert.equal(lifeCycleGame.handleKeyInput('ArrowLeft'), true)
  lifeCycleGame.tick() // (23, 12)
  lifeCycleGame.tick() // (23, 11)
  const gameOverSnap = lifeCycleGame.tick() // (23, 10) -> final death
  assert.equal(gameOverSnap.pacman.status, 'dead')
  assert.equal(gameOverSnap.isPacmanDead, true)
  assert.equal(gameOverSnap.deathCount, 3)
  assert.equal(gameOverSnap.lives, 0)
  assert.equal(gameOverSnap.gameStatus, 'game-over')
  assert.equal(gameOverSnap.isGameOver, true)
  assert.equal(gameOverSnap.isWin, false)

  // At 0 lives (game-over), respawn(), handleKeyInput(), and tick() cannot revive or move entities
  const blockedRespawn = lifeCycleGame.respawn()
  assert.equal(blockedRespawn.lives, 0)
  assert.equal(blockedRespawn.pacman.status, 'dead')
  assert.equal(blockedRespawn.gameStatus, 'game-over')
  assert.equal(blockedRespawn.isGameOver, true)
  assert.equal(lifeCycleGame.handleKeyInput('ArrowRight'), false)

  const postGameOverTick = lifeCycleGame.tick()
  assert.equal(postGameOverTick.lives, 0)
  assert.equal(postGameOverTick.deathCount, 3)
  assert.equal(postGameOverTick.gameStatus, 'game-over')
  assert.equal(postGameOverTick.isGameOver, true)

  // reset() restores full lives, score=0, all 244 pellets, and playing state
  const afterReset = lifeCycleGame.reset()
  assert.equal(afterReset.tick, 0)
  assert.equal(afterReset.lives, 3)
  assert.equal(afterReset.deathCount, 0)
  assert.equal(afterReset.score, 0)
  assert.equal(afterReset.remainingPelletCount, 244)
  assert.equal(afterReset.pacman.status, 'alive')
  assert.equal(afterReset.gameStatus, 'playing')
  assert.equal(afterReset.isGameOver, false)

  // Spawn overlap with initialLives=1 immediately enters game-over at tick 0
  const instantGameOver = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 23, col: 13 },
    ghosts: [{ id: 'blinky', position: { row: 23, col: 13 } }],
    initialLives: 1,
  })
  const instantSnap = instantGameOver.getSnapshot()
  assertIss9SnapshotContract(instantSnap)
  assert.equal(instantSnap.lives, 0)
  assert.equal(instantSnap.deathCount, 1)
  assert.equal(instantSnap.gameStatus, 'game-over')
  assert.equal(instantSnap.isGameOver, true)

  // 3. Mounted <App /> life counter, respawn button, game-over banner, and restart button transitions
  const uiLivesGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 5, col: 6 },
    ghosts: [{ id: 'blinky', position: { row: 5, col: 7 } }],
    initialLives: 2,
  })
  await withMountedApp({ game: uiLivesGame }, undefined, undefined, async (mounted) => {
    const canvas = mounted.findCanvasElement()
    const livesEl = mounted.findByTestId('lives-display')
    const statusEl = mounted.findByTestId('game-status')
    assert.ok(canvas)
    assert.ok(livesEl, 'Expected data-testid="lives-display" in mounted <App />')
    assert.ok(statusEl, 'Expected data-testid="game-status" in mounted <App />')

    assert.equal(livesEl.getAttribute('data-lives'), '2')
    assert.match(livesEl.textContent, /\b2\b/)
    assert.equal(statusEl.getAttribute('data-game-status'), 'playing')
    assert.doesNotMatch(statusEl.textContent, /game over/i)
    assert.equal(mounted.findByTestId('respawn-button'), null)

    // Tick 1: AI Blinky steps onto (5, 6) -> lives drops 2 -> 1, respawn-button appears
    await mounted.advanceIntervalTick()
    assert.equal(livesEl.getAttribute('data-lives'), '1')
    assert.match(livesEl.textContent, /\b1\b/)
    assert.equal(canvas.getAttribute('data-lives'), '1')
    assert.equal(canvas.getAttribute('data-pacman-status'), 'dead')
    assert.equal(statusEl.getAttribute('data-game-status'), 'playing')
    assert.ok(
      mounted.findByTestId('respawn-button'),
      'Expected data-testid="respawn-button" when Pacman is dead with remaining lives > 0',
    )

    // Click respawn-button -> Pacman revives at (5, 6), Blinky resets to (5, 7), respawn-button disappears
    await mounted.clickByTestId('respawn-button')
    assert.equal(canvas.getAttribute('data-pacman-status'), 'alive')
    assert.equal(livesEl.getAttribute('data-lives'), '1')
    assert.equal(mounted.findByTestId('respawn-button'), null)

    // Next tick: Blinky catches Pacman again -> lives drops 1 -> 0, game-over reached, respawn-button absent
    await mounted.advanceIntervalTick()
    assert.equal(livesEl.getAttribute('data-lives'), '0')
    assert.match(livesEl.textContent, /\b0\b/)
    assert.equal(canvas.getAttribute('data-lives'), '0')
    assert.equal(canvas.getAttribute('data-game-status'), 'game-over')
    assert.equal(statusEl.getAttribute('data-game-status'), 'game-over')
    assert.match(statusEl.textContent, /game over/i)
    assert.equal(
      mounted.findByTestId('respawn-button'),
      null,
      'Expected respawn-button not to be rendered once game-over is reached at 0 lives',
    )

    // Click restart-button -> restores lives=2, status='playing', Pacman='alive'
    await mounted.clickByTestId('restart-button')
    assert.equal(livesEl.getAttribute('data-lives'), '2')
    assert.equal(canvas.getAttribute('data-game-status'), 'playing')
    assert.equal(canvas.getAttribute('data-pacman-status'), 'alive')
    assert.doesNotMatch(statusEl.textContent, /game over/i)
  })
})

test('REQ-002_REQ-006_collecting_all_pellets_transitions_game_to_win_state_and_halts_further_play', async () => {
  const { CLASSIC_MAZE, canMoveFromTile, resolveTileMovement } = await loadClassicMazeModule()
  const engineMod = await loadPacmanEngineModule()
  const { PELLET_SCORE, POWER_PELLET_SCORE } = requireScoringAndLivesExports(engineMod)

  // 1. Compact multi-pellet level (2 standard pellets + 1 power-pellet + AI ghost) transitions to 'won' on final pellet
  const compactWinMaze: MazeDefinition = {
    levelId: 'compact-win-stage',
    columns: 6,
    rows: 5,
    tileSizePx: 20,
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'corridor', 'pellet', 'pellet', 'power-pellet', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'corridor', 'corridor', 'corridor', 'corridor', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
    ],
  }

  const winGame = engineMod.createPacmanGame({
    maze: compactWinMaze,
    pacmanSpawn: { row: 1, col: 1 },
    ghosts: [{ id: 'patrol', position: { row: 3, col: 1 } }],
  })

  const startSnap = winGame.getSnapshot()
  assertIss9SnapshotContract(startSnap)
  assert.equal(startSnap.totalPelletCount, 3)
  assert.equal(startSnap.remainingPelletCount, 3)
  assert.equal(startSnap.score, 0)
  assert.equal(startSnap.gameStatus, 'playing')
  assert.equal(startSnap.isWin, false)

  assert.equal(winGame.handleKeyInput('ArrowRight'), true)
  const afterPellet1 = winGame.tick() // (1, 2) -> +10
  assert.equal(afterPellet1.score, PELLET_SCORE)
  assert.equal(afterPellet1.remainingPelletCount, 2)
  assert.equal(afterPellet1.gameStatus, 'playing')
  assert.equal(afterPellet1.isWin, false)

  const afterPellet2 = winGame.tick() // (1, 3) -> +10 => 20
  assert.equal(afterPellet2.score, PELLET_SCORE * 2)
  assert.equal(afterPellet2.remainingPelletCount, 1)
  assert.equal(afterPellet2.gameStatus, 'playing')
  assert.equal(afterPellet2.isWin, false)

  const winSnap = winGame.tick() // (1, 4) -> +50 => 70, last pellet cleared!
  assert.deepEqual(winSnap.pacman.position, { row: 1, col: 4 })
  assert.equal(winSnap.score, PELLET_SCORE * 2 + POWER_PELLET_SCORE)
  assert.equal(winSnap.remainingPelletCount, 0)
  assert.equal(winSnap.pellets.length, 0)
  assert.equal(winSnap.pacman.status, 'alive')
  assert.equal(winSnap.pacman.direction, null)
  assert.equal(winSnap.gameStatus, 'won')
  assert.equal(winSnap.isWin, true)
  assert.equal(winSnap.isGameOver, false)

  // Once won, further inputs, ticks, and respawn() leave positions, ghosts, score, and win state frozen
  const ghostPosAtWin = { ...winSnap.ghosts[0].position }
  assert.equal(winGame.handleKeyInput('ArrowLeft'), false)
  const postWinTick = winGame.tick()
  assert.equal(postWinTick.tick, winSnap.tick + 1)
  assert.deepEqual(postWinTick.pacman.position, { row: 1, col: 4 })
  assert.deepEqual(postWinTick.ghosts[0].position, ghostPosAtWin)
  assert.equal(postWinTick.score, 70)
  assert.equal(postWinTick.gameStatus, 'won')
  assert.equal(postWinTick.isWin, true)
  assert.deepEqual(winGame.respawn(), postWinTick)

  const winCanvas = createRecordingCanvasContext()
  const winRenderSummary = engineMod.renderGameToCanvas(winCanvas.ctx, winSnap, compactWinMaze)
  assert.equal(winRenderSummary.renderedPelletCount, 0)

  // 2. Zero-pellet corridor-only custom maze remains in 'playing' state and never falsely auto-wins
  const corridorOnlyMaze: MazeDefinition = {
    levelId: 'corridor-only-stage',
    columns: 4,
    rows: 3,
    tileSizePx: 20,
    grid: [
      ['wall', 'wall', 'wall', 'wall'],
      ['wall', 'corridor', 'corridor', 'wall'],
      ['wall', 'wall', 'wall', 'wall'],
    ],
  }
  const zeroPelletGame = engineMod.createPacmanGame({
    maze: corridorOnlyMaze,
    pacmanSpawn: { row: 1, col: 1 },
  })
  assert.equal(zeroPelletGame.getSnapshot().totalPelletCount, 0)
  assert.equal(zeroPelletGame.getSnapshot().gameStatus, 'playing')
  assert.equal(zeroPelletGame.getSnapshot().isWin, false)
  zeroPelletGame.handleKeyInput('ArrowRight')
  const zeroPelletTick = zeroPelletGame.tick()
  assert.deepEqual(zeroPelletTick.pacman.position, { row: 1, col: 2 })
  assert.equal(zeroPelletTick.gameStatus, 'playing')
  assert.equal(zeroPelletTick.isWin, false)

  // 3. Full 244-pellet sweep of CLASSIC_MAZE awards exact 2,600 points and transitions to 'won'
  const fullClassicSweep = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    ghosts: [],
  })
  while (fullClassicSweep.getSnapshot().remainingPelletCount > 0) {
    const currentSnap = fullClassicSweep.getSnapshot()
    assert.equal(currentSnap.gameStatus, 'playing')
    assert.equal(currentSnap.isWin, false)

    const currentPos = currentSnap.pacman.position
    let nearestTarget = currentSnap.pellets[0]
    let bestManhattan =
      Math.abs(nearestTarget.row - currentPos.row) + Math.abs(nearestTarget.col - currentPos.col)
    for (let i = 1; i < currentSnap.pellets.length; i += 1) {
      const candidate = currentSnap.pellets[i]
      const dist = Math.abs(candidate.row - currentPos.row) + Math.abs(candidate.col - currentPos.col)
      if (dist < bestManhattan) {
        nearestTarget = candidate
        bestManhattan = dist
      }
    }

    const keys = findShortestKeyPath(
      CLASSIC_MAZE,
      canMoveFromTile,
      resolveTileMovement,
      currentPos,
      nearestTarget,
    )
    assert.ok(keys.length > 0, 'Expected non-empty path to uncollected pellet in CLASSIC_MAZE')
    for (const key of keys) {
      assert.equal(fullClassicSweep.handleKeyInput(key), true)
      fullClassicSweep.tick()
      if (fullClassicSweep.getSnapshot().remainingPelletCount === 0) {
        break
      }
    }
  }

  const classicWinSnap = fullClassicSweep.getSnapshot()
  assert.equal(classicWinSnap.totalPelletCount, 244)
  assert.equal(classicWinSnap.remainingPelletCount, 0)
  assert.equal(classicWinSnap.score, 240 * PELLET_SCORE + 4 * POWER_PELLET_SCORE)
  assert.equal(classicWinSnap.gameStatus, 'won')
  assert.equal(classicWinSnap.isWin, true)
  assert.equal(classicWinSnap.isGameOver, false)

  // 4. Mounted <App /> transitions HUD and canvas attributes to win state on clearing final pellet
  const uiWinGame = engineMod.createPacmanGame({
    maze: compactWinMaze,
    pacmanSpawn: { row: 1, col: 1 },
    ghosts: [],
  })
  await withMountedApp({ game: uiWinGame }, undefined, undefined, async (mounted) => {
    const canvas = mounted.findCanvasElement()
    const statusEl = mounted.findByTestId('game-status')
    const scoreEl = mounted.findByTestId('score-display')
    const pelletsEl = mounted.findByTestId('pellets-display')
    assert.ok(canvas && statusEl && scoreEl && pelletsEl)

    assert.equal(statusEl.getAttribute('data-game-status'), 'playing')
    assert.equal(mounted.dispatchWindowKeyDown('ArrowRight'), true)

    await mounted.advanceIntervalTick()
    assert.equal(statusEl.getAttribute('data-game-status'), 'playing')
    assert.equal(pelletsEl.getAttribute('data-remaining-pellets'), '2')

    await mounted.advanceIntervalTick()
    assert.equal(statusEl.getAttribute('data-game-status'), 'playing')
    assert.equal(pelletsEl.getAttribute('data-remaining-pellets'), '1')

    await mounted.advanceIntervalTick()
    assert.equal(canvas.getAttribute('data-game-status'), 'won')
    assert.equal(canvas.getAttribute('data-remaining-pellets'), '0')
    assert.equal(canvas.getAttribute('data-score'), '70')
    assert.equal(statusEl.getAttribute('data-game-status'), 'won')
    assert.match(statusEl.textContent, /you win|victory|level cleared|won/i)
    assert.equal(scoreEl.getAttribute('data-score'), '70')
    assert.equal(pelletsEl.getAttribute('data-remaining-pellets'), '0')

    // Restart button resets won game back to playing with all 3 pellets restored and score 0
    await mounted.clickByTestId('restart-button')
    assert.equal(statusEl.getAttribute('data-game-status'), 'playing')
    assert.equal(scoreEl.getAttribute('data-score'), '0')
    assert.equal(pelletsEl.getAttribute('data-remaining-pellets'), '3')
  })
})

test('REQ-001_REQ-007_pellets_scoring_lives_and_end_states_run_deterministically_with_zero_storage_or_network_requests', async () => {
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

  const originalMathRandom = Math.random
  let randomCalls = 0

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
      throw new Error('Unexpected fetch during gameplay actions')
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
    requireScoringAndLivesExports(freshEngineMod)

    const miniStage: MazeDefinition = {
      levelId: 'offline-e2e-stage',
      columns: 5,
      rows: 3,
      tileSizePx: 20,
      grid: [
        ['wall', 'wall', 'wall', 'wall', 'wall'],
        ['wall', 'corridor', 'pellet', 'power-pellet', 'wall'],
        ['wall', 'wall', 'wall', 'wall', 'wall'],
      ],
    }

    // Exercise deterministic pellet collection, death/respawn/game-over, and win state with Math.random trapped
    Math.random = () => {
      randomCalls += 1
      return 0.5
    }
    let wonSnap!: PacmanGameSnapshot
    let offlineWinGame!: PacmanGameEngine
    try {
      offlineWinGame = freshEngineMod.createPacmanGame({
        maze: miniStage,
        pacmanSpawn: { row: 1, col: 1 },
        ghosts: [],
      })
      assertRespawnMethod(offlineWinGame)

      const frozenCheck = offlineWinGame.getSnapshot()
      assertIss9SnapshotContract(frozenCheck)
      assert.equal(Object.isFrozen(frozenCheck), true)
      assert.equal(Object.isFrozen(frozenCheck.pellets), true)
      assert.equal(Object.isFrozen(frozenCheck.pellets[0]), true)

      try {
        ;(frozenCheck.pellets as PelletSpawn[]).pop()
      } catch {
        // Expected frozen array rejection
      }
      assert.equal(offlineWinGame.getSnapshot().remainingPelletCount, 2)

      offlineWinGame.handleKeyInput('ArrowRight')
      offlineWinGame.tick()
      wonSnap = offlineWinGame.tick()
      assert.equal(wonSnap.gameStatus, 'won')
      assert.equal(wonSnap.score, 60)

      const replayGame = freshEngineMod.createPacmanGame({
        maze: miniStage,
        pacmanSpawn: { row: 1, col: 1 },
        ghosts: [],
      })
      replayGame.handleKeyInput('ArrowRight')
      replayGame.tick()
      assert.deepEqual(replayGame.tick(), wonSnap)

      const { ctx } = createRecordingCanvasContext()
      freshEngineMod.renderGameToCanvas(ctx, wonSnap, miniStage)
      assert.equal(randomCalls, 0, 'Expected zero Math.random() calls during deterministic gameplay')
    } finally {
      Math.random = originalMathRandom
    }

    const ssrWinHtml = await renderAppMarkup({ game: offlineWinGame }, freshVite)
    assert.match(ssrWinHtml, /data-game-status="won"/)

    // Exercise mounted <App /> death, respawn, game-over, and restart under active traps
    const offlineDeathGame = freshEngineMod.createPacmanGame({
      maze: freshMazeMod.CLASSIC_MAZE,
      pacmanSpawn: { row: 5, col: 6 },
      ghosts: [{ id: 'blinky', position: { row: 5, col: 7 } }],
      initialLives: 2,
    })
    await withMountedApp(
      { game: offlineDeathGame },
      freshVite,
      (url) => sideEffectEvents.push(`sendBeacon:${url}`),
      async (mounted) => {
        await mounted.advanceIntervalTick() // life 2 -> 1
        await mounted.clickByTestId('respawn-button')
        await mounted.advanceIntervalTick() // life 1 -> 0 (game-over)
        const statusEl = mounted.findByTestId('game-status')
        assert.ok(statusEl)
        assert.equal(statusEl.getAttribute('data-game-status'), 'game-over')
        await mounted.clickByTestId('restart-button')
        assert.equal(statusEl.getAttribute('data-game-status'), 'playing')
      },
    )

    assert.deepEqual(
      sideEffectEvents,
      [],
      'Expected zero network, storage, or audio accesses during pellet, score, life, win, and game-over actions',
    )
  } finally {
    Math.random = originalMathRandom
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
    const rawSource = fs.readFileSync(filePath, 'utf8')
    const code = stripComments(rawSource)
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
