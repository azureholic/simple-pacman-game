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
  readonly CANVAS_BACKGROUND_COLOR?: string
  readonly WALL_TILE_COLOR?: string
  readonly PELLET_COLOR?: string
  readonly POWER_PELLET_COLOR?: string
  isWallTile(maze: MazeDefinition, row: number, col: number): boolean
  isTileTraversable(maze: MazeDefinition, row: number, col: number): boolean
  getPelletSpawnPositions(maze?: MazeDefinition): readonly PelletSpawn[]
  renderMazeToCanvas(
    ctx: unknown,
    maze?: MazeDefinition,
    activePellets?: readonly PelletSpawn[],
  ): MazeRenderSummary
}

interface PacmanEngineModule {
  readonly PACMAN_SPAWN_POSITION: TilePosition
  readonly DEFAULT_GHOST_SPAWNS: readonly GhostInit[]
  readonly PELLET_SCORE: number
  readonly POWER_PELLET_SCORE: number
  readonly INITIAL_LIVES: number
  readonly PACMAN_COLOR?: unknown
  readonly PACMAN_ALIVE_COLOR?: unknown
  readonly PACMAN_DEAD_COLOR?: unknown
  readonly DEFAULT_GHOST_COLOR?: unknown
  readonly GHOST_COLORS_BY_ID?: Readonly<Record<string, string>>
  createPacmanGame(options?: PacmanGameOptions): PacmanGameEngine
  renderGameToCanvas(
    ctx: unknown,
    snapshot: PacmanGameSnapshot,
    maze?: MazeDefinition,
  ): GameRenderSummary
}

interface PacmanColorTokens {
  readonly pacmanColor: string
  readonly pacmanAliveColor: string
  readonly pacmanDeadColor: string
}

interface ParsedRgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
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
const stylesCssFilePath = path.join(webRoot, 'src', 'styles.css')
const webRequire = createRequire(path.join(webRoot, 'package.json'))

/**
 * Canonical design token baseline defined by `docs/features/001-pacman-color-update.md`
 * (`REQ-001`) and existing maze/entity/UI modules (`AC-004`).
 */
const SPEC_PACMAN_BLUE_HEX = '#0000FF'

const CANONICAL_NON_PACMAN_TOKENS = Object.freeze({
  canvasBackground: '#020617',
  mazeWall: '#1d4ed8',
  pellet: '#fde68a',
  powerPellet: '#fde047',
  defaultGhost: '#ef4444',
  ghostsById: Object.freeze({
    blinky: '#ef4444',
    pinky: '#f472b6',
    inky: '#38bdf8',
    clyde: '#fb923c',
  }),
  uiCss: Object.freeze({
    appShellBg: '#0f172a',
    appShellBorder: '#38bdf8',
    appTitleColor: '#fde047',
    statusBadgeBg: '#1e293b',
    statusBadgeBorder: '#38bdf8',
    statusBadgeColor: '#e0f2fe',
    hudBarBg: '#1e293b',
    hudBarBorder: '#334155',
    hudStatColor: '#f8fafc',
    hudStatusColor: '#e2e8f0',
    hudStatusWonColor: '#4ade80',
    hudStatusGameOverColor: '#f87171',
    hudButtonBg: '#0f172a',
    hudButtonBorder: '#475569',
    hudButtonColor: '#f8fafc',
    hudButtonPrimaryBorder: '#fde047',
    hudButtonPrimaryBg: '#ca8a04',
    hudButtonPrimaryColor: '#020617',
    gameCanvasBg: '#020617',
    gameCanvasBorder: '#1d4ed8',
    stageCaptionColor: '#cbd5e1',
  }),
})

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
  assert.equal(typeof mod.renderMazeToCanvas, 'function', 'Expected renderMazeToCanvas export')
  return mod as unknown as ClassicMazeModule
}

async function loadPacmanEngineModule(viteInstance?: ViteServerLike): Promise<PacmanEngineModule> {
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

  return mod as unknown as PacmanEngineModule
}

function normalizeColorToken(color: string): string {
  return color.trim().toUpperCase()
}

function parseCssRgba(rawColor: string): ParsedRgba | null {
  const trimmed = rawColor.trim()

  const hex6 = /^#([0-9a-fA-F]{6})$/.exec(trimmed)
  if (hex6) {
    const hex = hex6[1]
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: 1,
    }
  }

  const hex8 = /^#([0-9a-fA-F]{8})$/.exec(trimmed)
  if (hex8) {
    const hex = hex8[1]
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: Number.parseInt(hex.slice(6, 8), 16) / 255,
    }
  }

  const hex3 = /^#([0-9a-fA-F]{3})$/.exec(trimmed)
  if (hex3) {
    const [rHex, gHex, bHex] = hex3[1].split('')
    return {
      r: Number.parseInt(rHex + rHex, 16),
      g: Number.parseInt(gHex + gHex, 16),
      b: Number.parseInt(bHex + bHex, 16),
      a: 1,
    }
  }

  const rgbaMatch =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+|1\.0+))?\s*\)$/i.exec(
      trimmed,
    )
  if (rgbaMatch) {
    const r = Number(rgbaMatch[1])
    const g = Number(rgbaMatch[2])
    const b = Number(rgbaMatch[3])
    const a = rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : 1
    if (r <= 255 && g <= 255 && b <= 255 && a >= 0 && a <= 1) {
      return { r, g, b, a }
    }
  }

  return null
}

function assertCanonicalPacmanColorExports(mod: PacmanEngineModule): PacmanColorTokens {
  assert.equal(
    typeof mod.PACMAN_COLOR,
    'string',
    'Expected PACMAN_COLOR string constant export in web/src/game/pacmanEngine.ts per ISS-22 contract.md',
  )
  assert.equal(
    typeof mod.PACMAN_ALIVE_COLOR,
    'string',
    'Expected PACMAN_ALIVE_COLOR string constant export in web/src/game/pacmanEngine.ts per ISS-22 contract.md',
  )
  assert.equal(
    typeof mod.PACMAN_DEAD_COLOR,
    'string',
    'Expected PACMAN_DEAD_COLOR string constant export in web/src/game/pacmanEngine.ts per ISS-22 contract.md',
  )

  const pacmanColor = mod.PACMAN_COLOR as string
  const pacmanAliveColor = mod.PACMAN_ALIVE_COLOR as string
  const pacmanDeadColor = mod.PACMAN_DEAD_COLOR as string

  assert.equal(
    normalizeColorToken(pacmanColor),
    SPEC_PACMAN_BLUE_HEX,
    `Expected PACMAN_COLOR to match canonical feature spec blue ${SPEC_PACMAN_BLUE_HEX}, got ${pacmanColor}`,
  )
  assert.equal(
    pacmanAliveColor,
    pacmanColor,
    'Expected PACMAN_ALIVE_COLOR to match PACMAN_COLOR',
  )
  assert.notEqual(
    pacmanDeadColor,
    pacmanAliveColor,
    'Expected PACMAN_DEAD_COLOR to remain distinct from PACMAN_ALIVE_COLOR per locked ISS-5/ISS-7 contracts',
  )

  const parsedAlive = parseCssRgba(pacmanAliveColor)
  assert.ok(parsedAlive, `Expected PACMAN_ALIVE_COLOR "${pacmanAliveColor}" to be a valid CSS color`)
  assert.deepEqual(parsedAlive, { r: 0, g: 0, b: 255, a: 1 })

  const parsedDead = parseCssRgba(pacmanDeadColor)
  assert.ok(parsedDead, `Expected PACMAN_DEAD_COLOR "${pacmanDeadColor}" to be a valid CSS color`)
  assert.equal(
    parsedDead.r === 0 && parsedDead.g === 0 && parsedDead.b === 255,
    true,
    `Expected PACMAN_DEAD_COLOR "${pacmanDeadColor}" to preserve pure #0000FF RGB (0, 0, 255) chromaticity`,
  )
  assert.equal(
    parsedDead.a > 0 && parsedDead.a < 1,
    true,
    `Expected PACMAN_DEAD_COLOR "${pacmanDeadColor}" to use translucent alpha (0 < alpha < 1) for dead/game-over visibility`,
  )

  return { pacmanColor, pacmanAliveColor, pacmanDeadColor }
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

  function resetRecording(): void {
    clearRects.length = 0
    fillRects.length = 0
    filledArcs.length = 0
    pendingArcs = []
  }

  return { ctx, clearRects, fillRects, filledArcs, resetRecording }
}

function extractPacmanArc(
  filledArcs: readonly RecordedArc[],
  snapshot: PacmanGameSnapshot,
  tileSizePx: number,
): RecordedArc {
  const expectedX = snapshot.pacman.position.col * tileSizePx + tileSizePx / 2
  const expectedY = snapshot.pacman.position.row * tileSizePx + tileSizePx / 2
  const matching = filledArcs.filter(
    (arc) =>
      arc.x === expectedX &&
      arc.y === expectedY &&
      arc.radius > tileSizePx * 0.4 &&
      arc.radius < tileSizePx * 0.5,
  )
  assert.ok(
    matching.length >= 1,
    `Expected Pacman arc at (${expectedX}, ${expectedY}) for tile (${snapshot.pacman.position.row}, ${snapshot.pacman.position.col})`,
  )
  return matching[matching.length - 1]
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

function extractCssRuleBody(cssSource: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(cssSource)
  assert.ok(match, `Expected CSS rule "${selector}" in web/src/styles.css`)
  return match[1]
}

test('AC-001_REQ-001_pacman_renders_blue_on_start_screen_in_engine_and_mounted_app', async () => {
  const { CLASSIC_MAZE } = await loadClassicMazeModule()
  const engineMod = await loadPacmanEngineModule()

  // 1. Default start-screen game snapshot prior to any input or tick
  const defaultStartGame = engineMod.createPacmanGame()
  const startSnap = defaultStartGame.getSnapshot()
  assert.equal(startSnap.tick, 0)
  assert.equal(startSnap.gameStatus, 'playing')
  assert.equal(startSnap.pacman.status, 'alive')
  assert.equal(startSnap.pacman.direction, null)
  assert.deepEqual(startSnap.pacman.position, engineMod.PACMAN_SPAWN_POSITION)

  const startCanvas = createRecordingCanvasContext()
  const startSummary = engineMod.renderGameToCanvas(startCanvas.ctx, startSnap, CLASSIC_MAZE)
  assert.equal(startSummary.pacmanStatus, 'alive')
  assert.deepEqual(startSummary.pacmanCenterPx, {
    x: engineMod.PACMAN_SPAWN_POSITION.col * CLASSIC_MAZE.tileSizePx + CLASSIC_MAZE.tileSizePx / 2,
    y: engineMod.PACMAN_SPAWN_POSITION.row * CLASSIC_MAZE.tileSizePx + CLASSIC_MAZE.tileSizePx / 2,
  })
  const standaloneStartArc = extractPacmanArc(
    startCanvas.filledArcs,
    startSnap,
    CLASSIC_MAZE.tileSizePx,
  )

  // 2. Mounted <App /> start screen (no props -> creates default game and draws initial frame in useEffect)
  let mountedStartArc!: RecordedArc
  await withMountedApp({}, undefined, undefined, async (mounted) => {
    const canvas = mounted.findCanvasElement()
    const statusEl = mounted.findByTestId('game-status')
    assert.ok(canvas, 'Expected <canvas> on start screen')
    assert.ok(statusEl, 'Expected game-status HUD element on start screen')
    assert.equal(canvas.getAttribute('data-pacman-row'), String(engineMod.PACMAN_SPAWN_POSITION.row))
    assert.equal(canvas.getAttribute('data-pacman-col'), String(engineMod.PACMAN_SPAWN_POSITION.col))
    assert.equal(canvas.getAttribute('data-pacman-status'), 'alive')
    assert.equal(canvas.getAttribute('data-game-status'), 'playing')
    assert.equal(statusEl.getAttribute('data-game-status'), 'playing')

    mountedStartArc = extractPacmanArc(
      mounted.canvasRecording.filledArcs,
      startSnap,
      CLASSIC_MAZE.tileSizePx,
    )
  })

  // 3. Assert canonical exported Pacman color tokens and start-screen Pacman fillStyle
  const { pacmanAliveColor } = assertCanonicalPacmanColorExports(engineMod)
  assert.equal(
    standaloneStartArc.fillStyle,
    pacmanAliveColor,
    'Expected Pacman on standalone start screen to render in canonical PACMAN_ALIVE_COLOR (#0000FF)',
  )
  assert.equal(
    mountedStartArc.fillStyle,
    pacmanAliveColor,
    'Expected Pacman on mounted <App /> start screen to render in canonical PACMAN_ALIVE_COLOR (#0000FF)',
  )
})

test('AC-002_REQ-001_REQ-002_pacman_renders_blue_throughout_active_gameplay_animations_power_pellets_and_dying_state', async () => {
  const { CLASSIC_MAZE } = await loadClassicMazeModule()
  const engineMod = await loadPacmanEngineModule()
  const tileSize = CLASSIC_MAZE.tileSizePx

  // 1. Exercise idle, wall-blocked, and all four directional movement states ('left', 'up', 'down', 'right')
  const gameplayGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    ghosts: [],
  })

  const recordedAliveFrames: { readonly label: string; readonly arc: RecordedArc }[] = []
  const recordAliveFrame = (label: string, snap: PacmanGameSnapshot) => {
    assert.equal(snap.gameStatus, 'playing', `Expected playing gameStatus during ${label}`)
    assert.equal(snap.pacman.status, 'alive', `Expected alive Pacman during ${label}`)
    const rec = createRecordingCanvasContext()
    engineMod.renderGameToCanvas(rec.ctx, snap, CLASSIC_MAZE)
    recordedAliveFrames.push({
      label,
      arc: extractPacmanArc(rec.filledArcs, snap, tileSize),
    })
  }

  recordAliveFrame('idle-tick-1', gameplayGame.tick())

  assert.equal(gameplayGame.handleKeyInput('ArrowUp'), true) // blocked by wall at (22, 13)
  recordAliveFrame('wall-blocked-up', gameplayGame.tick())

  assert.equal(gameplayGame.handleKeyInput('ArrowLeft'), true) // (23, 12) standard pellet (+10)
  const leftPelletSnap = gameplayGame.tick()
  assert.equal(leftPelletSnap.pacman.direction, 'left')
  assert.equal(leftPelletSnap.score, engineMod.PELLET_SCORE)
  recordAliveFrame('moving-left-pellet-collection', leftPelletSnap)

  assert.equal(gameplayGame.handleKeyInput('ArrowUp'), true) // (22, 12) -> (21, 12)
  const upSnap1 = gameplayGame.tick()
  assert.equal(upSnap1.pacman.direction, 'up')
  recordAliveFrame('moving-up-frame-1', upSnap1)
  recordAliveFrame('moving-up-frame-2', gameplayGame.tick())

  assert.equal(gameplayGame.handleKeyInput('ArrowDown'), true) // (22, 12) -> (23, 12)
  const downSnap1 = gameplayGame.tick()
  assert.equal(downSnap1.pacman.direction, 'down')
  recordAliveFrame('moving-down-frame-1', downSnap1)
  recordAliveFrame('moving-down-frame-2', gameplayGame.tick())

  assert.equal(gameplayGame.handleKeyInput('ArrowRight'), true) // (23, 13) -> (23, 14) -> (23, 15)
  const rightSnap1 = gameplayGame.tick()
  assert.equal(rightSnap1.pacman.direction, 'right')
  recordAliveFrame('moving-right-corridor', rightSnap1)
  recordAliveFrame('moving-right-frame-2', gameplayGame.tick())
  recordAliveFrame('moving-right-pellet', gameplayGame.tick())

  // 2. Exercise power-pellet consumption ('power-pellet' at (23, 1)) and subsequent powered-up gameplay ticks
  const powerPelletGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 23, col: 2 },
    ghosts: [],
  })
  assert.equal(powerPelletGame.handleKeyInput('ArrowLeft'), true)
  const powerPelletSnap = powerPelletGame.tick() // consumes power-pellet at (23, 1) (+50)
  assert.deepEqual(powerPelletSnap.pacman.position, { row: 23, col: 1 })
  assert.equal(powerPelletSnap.score, engineMod.POWER_PELLET_SCORE)
  recordAliveFrame('power-pellet-consumed', powerPelletSnap)

  assert.equal(powerPelletGame.handleKeyInput('ArrowUp'), true)
  recordAliveFrame('post-power-pellet-up-tick-1', powerPelletGame.tick())
  recordAliveFrame('post-power-pellet-up-tick-2', powerPelletGame.tick())

  // 3. Exercise active mounted <App /> gameplay with live AI ghosts and keyboard + interval animation frames
  const liveAiAppGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
  })
  await withMountedApp({ game: liveAiAppGame }, undefined, undefined, async (mounted) => {
    assert.equal(mounted.dispatchWindowKeyDown('ArrowLeft'), true)
    for (let step = 1; step <= 4; step += 1) {
      mounted.canvasRecording.resetRecording()
      await mounted.advanceIntervalTick()
      const currentSnap = liveAiAppGame.getSnapshot()
      assert.equal(currentSnap.pacman.status, 'alive')
      recordedAliveFrames.push({
        label: `mounted-ai-tick-${step}`,
        arc: extractPacmanArc(mounted.canvasRecording.filledArcs, currentSnap, tileSize),
      })
    }
  })

  // 4. Exercise mid-game dying / life-lost state (pacman.status === 'dead', lives > 0, gameStatus === 'playing')
  const midGameDeathEngine = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 5, col: 5 },
    ghosts: [{ id: 'blinky', position: { row: 5, col: 6 } }],
    ghostMovement: 'stationary',
    initialLives: 3,
  })
  assert.equal(midGameDeathEngine.handleKeyInput('ArrowRight'), true)
  const midGameDeadSnap = midGameDeathEngine.tick()
  assert.equal(midGameDeadSnap.pacman.status, 'dead')
  assert.equal(midGameDeadSnap.lives, 2)
  assert.equal(midGameDeadSnap.gameStatus, 'playing')

  const isolatedMidDeadCanvas = createRecordingCanvasContext()
  engineMod.renderGameToCanvas(
    isolatedMidDeadCanvas.ctx,
    { ...midGameDeadSnap, ghosts: [] },
    CLASSIC_MAZE,
  )
  const midGameDeadArc = extractPacmanArc(
    isolatedMidDeadCanvas.filledArcs,
    midGameDeadSnap,
    tileSize,
  )

  // 5. Assert all active gameplay alive frames use PACMAN_ALIVE_COLOR (#0000FF) and dying frame uses blue PACMAN_DEAD_COLOR
  const { pacmanAliveColor, pacmanDeadColor } = assertCanonicalPacmanColorExports(engineMod)

  for (const frame of recordedAliveFrames) {
    assert.equal(
      frame.arc.fillStyle,
      pacmanAliveColor,
      `Expected Pacman in active gameplay state "${frame.label}" to render in PACMAN_ALIVE_COLOR (${pacmanAliveColor}), got ${frame.arc.fillStyle}`,
    )
  }

  assert.equal(
    midGameDeadArc.fillStyle,
    pacmanDeadColor,
    'Expected Pacman in mid-game life-lost (dead) state to render in canonical blue PACMAN_DEAD_COLOR',
  )
})

test('AC-003_REQ-001_pacman_renders_blue_in_win_game_over_respawn_and_restart_states', async () => {
  const { CLASSIC_MAZE } = await loadClassicMazeModule()
  const engineMod = await loadPacmanEngineModule()

  const endStateMaze: MazeDefinition = {
    levelId: 'color-end-state-stage',
    columns: 6,
    rows: 5,
    tileSizePx: 20,
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'corridor', 'pellet', 'power-pellet', 'corridor', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'corridor', 'corridor', 'corridor', 'corridor', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
    ],
  }
  const tileSize = endStateMaze.tileSizePx

  // 1. Win end-of-game state, post-win tick, and restart from win in mounted <App />
  const winGame = engineMod.createPacmanGame({
    maze: endStateMaze,
    pacmanSpawn: { row: 1, col: 1 },
    ghosts: [{ id: 'patrol', position: { row: 3, col: 4 } }],
    ghostMovement: 'stationary',
  })

  let wonArc!: RecordedArc
  let postWinTickArc!: RecordedArc
  let restartedFromWinArc!: RecordedArc

  await withMountedApp({ game: winGame }, undefined, undefined, async (mounted) => {
    assert.equal(mounted.dispatchWindowKeyDown('ArrowRight'), true)
    await mounted.advanceIntervalTick() // (1, 2) pellet

    mounted.canvasRecording.resetRecording()
    await mounted.advanceIntervalTick() // (1, 3) power-pellet -> 'won'
    const winSnap = winGame.getSnapshot()
    assert.equal(winSnap.gameStatus, 'won')
    assert.equal(winSnap.isWin, true)
    assert.equal(winSnap.pacman.status, 'alive')
    wonArc = extractPacmanArc(mounted.canvasRecording.filledArcs, winSnap, tileSize)

    // Post-win interval tick keeps Pacman rendered in win state
    mounted.canvasRecording.resetRecording()
    await mounted.advanceIntervalTick()
    const postWinSnap = winGame.getSnapshot()
    assert.equal(postWinSnap.gameStatus, 'won')
    postWinTickArc = extractPacmanArc(mounted.canvasRecording.filledArcs, postWinSnap, tileSize)

    // Clicking Restart Game from 'won' resets game and redraws Pacman on start tile
    mounted.canvasRecording.resetRecording()
    await mounted.clickByTestId('restart-button')
    const resetSnap = winGame.getSnapshot()
    assert.equal(resetSnap.gameStatus, 'playing')
    assert.equal(resetSnap.pacman.status, 'alive')
    assert.equal(resetSnap.tick, 0)
    restartedFromWinArc = extractPacmanArc(mounted.canvasRecording.filledArcs, resetSnap, tileSize)
  })

  // 2. Life-lost respawn continuation, terminal 'game-over' end-of-game state, post-game-over tick, and restart from game-over
  const loseLifecycleGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 5, col: 6 },
    ghosts: [{ id: 'blinky', position: { row: 5, col: 7 } }],
    initialLives: 2,
  })

  let respawnedArc!: RecordedArc
  let gameOverAppArc!: RecordedArc
  let postGameOverTickArc!: RecordedArc
  let restartedFromGameOverArc!: RecordedArc

  await withMountedApp({ game: loseLifecycleGame }, undefined, undefined, async (mounted) => {
    // Tick 1: Blinky steps onto (5, 6) -> life 2 -> 1, respawn-button appears
    await mounted.advanceIntervalTick()
    assert.equal(loseLifecycleGame.getSnapshot().pacman.status, 'dead')
    assert.equal(loseLifecycleGame.getSnapshot().lives, 1)

    // Click Continue Life (respawn-button) -> Pacman revives at (5, 6)
    mounted.canvasRecording.resetRecording()
    await mounted.clickByTestId('respawn-button')
    const respawnSnap = loseLifecycleGame.getSnapshot()
    assert.equal(respawnSnap.pacman.status, 'alive')
    assert.equal(respawnSnap.gameStatus, 'playing')
    respawnedArc = extractPacmanArc(
      mounted.canvasRecording.filledArcs,
      respawnSnap,
      CLASSIC_MAZE.tileSizePx,
    )

    // Next tick: Blinky steps onto (5, 6) -> life 1 -> 0 ('game-over'); Pacman is drawn last on canvas
    mounted.canvasRecording.resetRecording()
    await mounted.advanceIntervalTick()
    const gameOverSnap = loseLifecycleGame.getSnapshot()
    assert.equal(gameOverSnap.gameStatus, 'game-over')
    assert.equal(gameOverSnap.isGameOver, true)
    assert.equal(gameOverSnap.lives, 0)
    assert.equal(gameOverSnap.pacman.status, 'dead')
    gameOverAppArc = extractPacmanArc(
      mounted.canvasRecording.filledArcs,
      gameOverSnap,
      CLASSIC_MAZE.tileSizePx,
    )

    // Post-game-over interval tick maintains Pacman's game-over rendering
    mounted.canvasRecording.resetRecording()
    await mounted.advanceIntervalTick()
    const postGameOverSnap = loseLifecycleGame.getSnapshot()
    assert.equal(postGameOverSnap.gameStatus, 'game-over')
    postGameOverTickArc = extractPacmanArc(
      mounted.canvasRecording.filledArcs,
      postGameOverSnap,
      CLASSIC_MAZE.tileSizePx,
    )

    // Click Restart Game from 'game-over' -> restores lives=2, playing, alive
    mounted.canvasRecording.resetRecording()
    await mounted.clickByTestId('restart-button')
    const restartedSnap = loseLifecycleGame.getSnapshot()
    assert.equal(restartedSnap.gameStatus, 'playing')
    assert.equal(restartedSnap.pacman.status, 'alive')
    assert.equal(restartedSnap.lives, 2)
    restartedFromGameOverArc = extractPacmanArc(
      mounted.canvasRecording.filledArcs,
      restartedSnap,
      CLASSIC_MAZE.tileSizePx,
    )
  })

  // 3. Direct engine spawn-overlap instant game-over and engine.reset() from mid-game death
  const instantGameOverEngine = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 23, col: 13 },
    ghosts: [{ id: 'blinky', position: { row: 23, col: 13 } }],
    initialLives: 1,
  })
  const instantGameOverSnap = instantGameOverEngine.getSnapshot()
  assert.equal(instantGameOverSnap.gameStatus, 'game-over')
  assert.equal(instantGameOverSnap.pacman.status, 'dead')

  const instantGameOverCanvas = createRecordingCanvasContext()
  engineMod.renderGameToCanvas(
    instantGameOverCanvas.ctx,
    { ...instantGameOverSnap, ghosts: [] },
    CLASSIC_MAZE,
  )
  const instantGameOverArc = extractPacmanArc(
    instantGameOverCanvas.filledArcs,
    instantGameOverSnap,
    CLASSIC_MAZE.tileSizePx,
  )

  const engineResetSnap = instantGameOverEngine.reset({
    maze: CLASSIC_MAZE,
    ghosts: [],
  })
  const engineResetCanvas = createRecordingCanvasContext()
  engineMod.renderGameToCanvas(engineResetCanvas.ctx, engineResetSnap, CLASSIC_MAZE)
  const engineResetArc = extractPacmanArc(
    engineResetCanvas.filledArcs,
    engineResetSnap,
    CLASSIC_MAZE.tileSizePx,
  )

  // 4. Assert canonical Pacman blue colors across all end-of-game, respawn, and restart states
  const { pacmanAliveColor, pacmanDeadColor } = assertCanonicalPacmanColorExports(engineMod)

  assert.equal(wonArc.fillStyle, pacmanAliveColor, 'Expected Pacman in won state to render in #0000FF')
  assert.equal(
    postWinTickArc.fillStyle,
    pacmanAliveColor,
    'Expected Pacman in post-win tick to render in #0000FF',
  )
  assert.equal(
    respawnedArc.fillStyle,
    pacmanAliveColor,
    'Expected Pacman after respawn to render in #0000FF',
  )
  assert.equal(
    restartedFromWinArc.fillStyle,
    pacmanAliveColor,
    'Expected Pacman after restart from won state to render in #0000FF',
  )
  assert.equal(
    restartedFromGameOverArc.fillStyle,
    pacmanAliveColor,
    'Expected Pacman after restart from game-over state to render in #0000FF',
  )
  assert.equal(
    engineResetArc.fillStyle,
    pacmanAliveColor,
    'Expected Pacman after engine.reset() to render in #0000FF',
  )

  assert.equal(
    gameOverAppArc.fillStyle,
    pacmanDeadColor,
    'Expected Pacman in mounted game-over state to render in canonical blue PACMAN_DEAD_COLOR',
  )
  assert.equal(
    postGameOverTickArc.fillStyle,
    pacmanDeadColor,
    'Expected Pacman in post-game-over tick to render in canonical blue PACMAN_DEAD_COLOR',
  )
  assert.equal(
    instantGameOverArc.fillStyle,
    pacmanDeadColor,
    'Expected Pacman in instant spawn-overlap game-over state to render in canonical blue PACMAN_DEAD_COLOR',
  )
})

test('AC-004_REQ-002_ghosts_pellets_maze_ui_elements_and_offline_determinism_remain_unchanged', async () => {
  const mazeMod = await loadClassicMazeModule()
  const engineMod = await loadPacmanEngineModule()
  const { CLASSIC_MAZE } = mazeMod
  const tileSize = CLASSIC_MAZE.tileSizePx

  // Resolve maze/entity non-Pacman tokens from module exports when present, verifying canonical invariance
  const expectedBgColor = mazeMod.CANVAS_BACKGROUND_COLOR ?? CANONICAL_NON_PACMAN_TOKENS.canvasBackground
  const expectedWallColor = mazeMod.WALL_TILE_COLOR ?? CANONICAL_NON_PACMAN_TOKENS.mazeWall
  const expectedPelletColor = mazeMod.PELLET_COLOR ?? CANONICAL_NON_PACMAN_TOKENS.pellet
  const expectedPowerPelletColor =
    mazeMod.POWER_PELLET_COLOR ?? CANONICAL_NON_PACMAN_TOKENS.powerPellet
  const expectedDefaultGhostColor =
    typeof engineMod.DEFAULT_GHOST_COLOR === 'string'
      ? engineMod.DEFAULT_GHOST_COLOR
      : CANONICAL_NON_PACMAN_TOKENS.defaultGhost
  const expectedGhostColorsById: Readonly<Record<string, string>> =
    engineMod.GHOST_COLORS_BY_ID ?? CANONICAL_NON_PACMAN_TOKENS.ghostsById

  assert.equal(expectedBgColor, CANONICAL_NON_PACMAN_TOKENS.canvasBackground)
  assert.equal(expectedWallColor, CANONICAL_NON_PACMAN_TOKENS.mazeWall)
  assert.equal(expectedPelletColor, CANONICAL_NON_PACMAN_TOKENS.pellet)
  assert.equal(expectedPowerPelletColor, CANONICAL_NON_PACMAN_TOKENS.powerPellet)
  assert.equal(expectedDefaultGhostColor, CANONICAL_NON_PACMAN_TOKENS.defaultGhost)
  assert.deepEqual(expectedGhostColorsById, CANONICAL_NON_PACMAN_TOKENS.ghostsById)

  // 1. Render full game frame with all 4 named classic ghosts + 1 custom-ID ghost, walls, pellets, and power-pellets
  const allEntitiesGhosts: readonly GhostInit[] = [
    ...engineMod.DEFAULT_GHOST_SPAWNS,
    { id: 'custom-specter', position: { row: 17, col: 13 }, direction: null },
  ]
  const isolationGame = engineMod.createPacmanGame({
    maze: CLASSIC_MAZE,
    ghosts: allEntitiesGhosts,
    ghostMovement: 'stationary',
  })
  const snap = isolationGame.getSnapshot()

  const mazeBaseline = createRecordingCanvasContext()
  const mazeSummary = mazeMod.renderMazeToCanvas(mazeBaseline.ctx, CLASSIC_MAZE)

  const gameCanvas = createRecordingCanvasContext()
  const gameSummary = engineMod.renderGameToCanvas(gameCanvas.ctx, snap, CLASSIC_MAZE)

  // Maze background & wall rectangles in renderGameToCanvas match renderMazeToCanvas 1-for-1
  assert.deepEqual(gameCanvas.fillRects, mazeBaseline.fillRects)
  assert.equal(gameSummary.renderedWallTileCount, mazeSummary.renderedWallTileCount)
  assert.equal(gameSummary.renderedPelletCount, 244)
  assert.equal(gameSummary.renderedGhostCount, 5)

  const [bgRect, ...wallRects] = gameCanvas.fillRects
  assert.ok(bgRect, 'Expected full-canvas background fillRect')
  assert.equal(bgRect.fillStyle, expectedBgColor)
  assert.notEqual(normalizeColorToken(bgRect.fillStyle), SPEC_PACMAN_BLUE_HEX)
  assert.equal(wallRects.length, mazeSummary.renderedWallTileCount)
  for (const wallRect of wallRects) {
    assert.equal(wallRect.fillStyle, expectedWallColor)
    assert.notEqual(normalizeColorToken(wallRect.fillStyle), SPEC_PACMAN_BLUE_HEX)
  }

  // Pellet & power-pellet arcs retain their exact canonical colors (240 standard + 4 power-pellets)
  const pelletArcs = gameCanvas.filledArcs.slice(0, 244)
  assert.equal(pelletArcs.length, 244)
  const standardPelletArcs = pelletArcs.filter((arc) => arc.radius === tileSize * 0.125)
  const powerPelletArcs = pelletArcs.filter((arc) => arc.radius === tileSize * 0.3)
  assert.equal(standardPelletArcs.length, 240)
  assert.equal(powerPelletArcs.length, 4)

  for (const arc of standardPelletArcs) {
    assert.equal(arc.fillStyle, expectedPelletColor)
    assert.notEqual(normalizeColorToken(arc.fillStyle), SPEC_PACMAN_BLUE_HEX)
  }
  for (const arc of powerPelletArcs) {
    assert.equal(arc.fillStyle, expectedPowerPelletColor)
    assert.notEqual(normalizeColorToken(arc.fillStyle), SPEC_PACMAN_BLUE_HEX)
  }

  // Ghost arcs retain their exact canonical per-ID and fallback colors
  const ghostArcs = gameCanvas.filledArcs.slice(244, 244 + allEntitiesGhosts.length)
  assert.equal(ghostArcs.length, allEntitiesGhosts.length)
  for (let i = 0; i < allEntitiesGhosts.length; i += 1) {
    const ghost = allEntitiesGhosts[i]
    const arc = ghostArcs[i]
    const expectedGhostColor: string =
      (expectedGhostColorsById as Readonly<Record<string, string | undefined>>)[ghost.id] ??
      expectedDefaultGhostColor
    assert.equal(
      arc.x,
      ghost.position.col * tileSize + tileSize / 2,
      `Expected ghost "${ghost.id}" x coordinate`,
    )
    assert.equal(
      arc.y,
      ghost.position.row * tileSize + tileSize / 2,
      `Expected ghost "${ghost.id}" y coordinate`,
    )
    assert.equal(
      arc.fillStyle,
      expectedGhostColor,
      `Expected ghost "${ghost.id}" fillStyle to remain ${expectedGhostColor}, got ${arc.fillStyle}`,
    )
    assert.notEqual(normalizeColorToken(arc.fillStyle), SPEC_PACMAN_BLUE_HEX)
  }

  // 2. UI stylesheet (`web/src/styles.css`) & `<App />` markup preserve existing visual tokens and invariants
  const stylesSource = fs.readFileSync(stylesCssFilePath, 'utf8')
  assert.doesNotMatch(
    stylesSource,
    /#0000ff\b/i,
    'Expected web/src/styles.css UI rules not to have unintended #0000FF overrides',
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.app-shell'),
    new RegExp(`background-color:\\s*${CANONICAL_NON_PACMAN_TOKENS.uiCss.appShellBg}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.app-shell'),
    new RegExp(`border:\\s*2px\\s+solid\\s+${CANONICAL_NON_PACMAN_TOKENS.uiCss.appShellBorder}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.app-title'),
    new RegExp(`color:\\s*${CANONICAL_NON_PACMAN_TOKENS.uiCss.appTitleColor}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.status-badge'),
    new RegExp(`background-color:\\s*${CANONICAL_NON_PACMAN_TOKENS.uiCss.statusBadgeBg}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.hud-bar'),
    new RegExp(`background-color:\\s*${CANONICAL_NON_PACMAN_TOKENS.uiCss.hudBarBg}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.hud-stat'),
    new RegExp(`color:\\s*${CANONICAL_NON_PACMAN_TOKENS.uiCss.hudStatColor}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.hud-status'),
    new RegExp(`color:\\s*${CANONICAL_NON_PACMAN_TOKENS.uiCss.hudStatusColor}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.hud-status-won'),
    new RegExp(`color:\\s*${CANONICAL_NON_PACMAN_TOKENS.uiCss.hudStatusWonColor}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.hud-status-game-over'),
    new RegExp(`color:\\s*${CANONICAL_NON_PACMAN_TOKENS.uiCss.hudStatusGameOverColor}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.hud-button'),
    new RegExp(`background-color:\\s*${CANONICAL_NON_PACMAN_TOKENS.uiCss.hudButtonBg}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.hud-button-primary'),
    new RegExp(`background-color:\\s*${CANONICAL_NON_PACMAN_TOKENS.uiCss.hudButtonPrimaryBg}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.game-canvas'),
    new RegExp(`background-color:\\s*${CANONICAL_NON_PACMAN_TOKENS.uiCss.gameCanvasBg}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.game-canvas'),
    new RegExp(`border:\\s*2px\\s+solid\\s+${CANONICAL_NON_PACMAN_TOKENS.uiCss.gameCanvasBorder}`, 'i'),
  )
  assert.match(
    extractCssRuleBody(stylesSource, '.stage-caption'),
    new RegExp(`color:\\s*${CANONICAL_NON_PACMAN_TOKENS.uiCss.stageCaptionColor}`, 'i'),
  )

  const appHtml = await renderAppMarkup({ game: isolationGame })
  assert.match(appHtml, /aria-label="Simple Pacman placeholder game canvas/)
  assert.match(appHtml, /Static SPA · Ready/)
  assert.match(appHtml, /data-testid="score-display"/)
  assert.match(appHtml, /data-testid="lives-display"/)
  assert.match(appHtml, /data-testid="pellets-display"/)
  assert.match(appHtml, /data-testid="game-status"/)
  assert.match(appHtml, /data-testid="restart-button"/)

  // 3. Deterministic execution (zero Math.random) and client-side ephemeral source invariants (REQ-002)
  const originalMathRandom = Math.random
  let randomCalls = 0
  Math.random = () => {
    randomCalls += 1
    return 0.5
  }
  try {
    const detGame = engineMod.createPacmanGame()
    detGame.handleKeyInput('ArrowLeft')
    detGame.tick()
    detGame.tick()
    const detCanvas = createRecordingCanvasContext()
    engineMod.renderGameToCanvas(detCanvas.ctx, detGame.getSnapshot(), CLASSIC_MAZE)
    assert.equal(randomCalls, 0, 'Expected zero Math.random() calls during gameplay and canvas rendering')
  } finally {
    Math.random = originalMathRandom
  }

  const sourceFiles = collectSourceFiles(path.join(webRoot, 'src'))
  assert.ok(sourceFiles.length > 0)
  for (const filePath of sourceFiles) {
    const rawSource = fs.readFileSync(filePath, 'utf8')
    const relPath = path.relative(repoRoot, filePath)
    assert.doesNotMatch(rawSource, /\bfetch\s*\(/, `Disallowed fetch( token in ${relPath}`)
    assert.doesNotMatch(rawSource, /\bXMLHttpRequest\b/, `Disallowed XMLHttpRequest token in ${relPath}`)
    assert.doesNotMatch(rawSource, /\blocalStorage\b/, `Disallowed localStorage token in ${relPath}`)
    assert.doesNotMatch(rawSource, /\bsessionStorage\b/, `Disallowed sessionStorage token in ${relPath}`)
    assert.doesNotMatch(rawSource, /\bAudioContext\b/, `Disallowed AudioContext token in ${relPath}`)
  }

  // 4. Verify that in the same multi-entity frame, Pacman alone renders in canonical PACMAN_ALIVE_COLOR (#0000FF)
  const pacmanArc = gameCanvas.filledArcs[244 + allEntitiesGhosts.length]
  assert.ok(pacmanArc, 'Expected final canvas arc to be Pacman entity')
  assert.equal(gameCanvas.filledArcs.length, 244 + allEntitiesGhosts.length + 1)

  const { pacmanAliveColor } = assertCanonicalPacmanColorExports(engineMod)
  assert.equal(
    pacmanArc.fillStyle,
    pacmanAliveColor,
    'Expected Pacman arc in multi-entity frame to render in canonical PACMAN_ALIVE_COLOR (#0000FF) while all non-Pacman elements keep their original colors',
  )
})
