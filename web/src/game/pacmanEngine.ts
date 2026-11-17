import {
  CLASSIC_MAZE,
  isTileTraversable,
  renderMazeToCanvas,
  resolveTileMovement,
  type Direction,
  type MazeCanvasContext,
  type MazeDefinition,
  type MazeRenderSummary,
  type TilePosition,
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

export const PACMAN_SPAWN_POSITION: TilePosition = Object.freeze({ row: 23, col: 13 })

export const DEFAULT_GHOST_SPAWNS: readonly GhostInit[] = Object.freeze([
  Object.freeze({
    id: 'blinky',
    position: Object.freeze({ row: 11, col: 13 }),
    direction: null,
  }),
  Object.freeze({
    id: 'pinky',
    position: Object.freeze({ row: 14, col: 13 }),
    direction: null,
  }),
  Object.freeze({
    id: 'inky',
    position: Object.freeze({ row: 14, col: 12 }),
    direction: null,
  }),
  Object.freeze({
    id: 'clyde',
    position: Object.freeze({ row: 14, col: 14 }),
    direction: null,
  }),
])

const PACMAN_ALIVE_COLOR = '#facc15'
const PACMAN_DEAD_COLOR = '#94a3b8'
const DEFAULT_GHOST_COLOR = '#ef4444'
const GHOST_COLORS_BY_ID: Readonly<Record<string, string>> = Object.freeze({
  blinky: '#ef4444',
  pinky: '#f472b6',
  inky: '#38bdf8',
  clyde: '#fb923c',
})

function isDirection(value: unknown): value is Direction {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right'
}

function keyStringToDirection(key: string): Direction | null {
  switch (key) {
    case 'ArrowUp':
      return 'up'
    case 'ArrowDown':
      return 'down'
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    default:
      return null
  }
}

export function mapKeyToDirection(input: unknown): Direction | null {
  if (typeof input === 'string') {
    return keyStringToDirection(input)
  }

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null
  }

  try {
    const candidate = input as KeyboardEventLike
    if (candidate.ctrlKey === true || candidate.altKey === true || candidate.metaKey === true) {
      return null
    }
    if (typeof candidate.key !== 'string') {
      return null
    }
    return keyStringToDirection(candidate.key)
  } catch {
    return null
  }
}

export function attachKeyboardControls(
  target: KeyboardEventTargetLike,
  game: PacmanGameEngine,
): () => void {
  const onKeyDown = (event: KeyboardEventLike): void => {
    const direction = mapKeyToDirection(event)
    if (direction === null) {
      return
    }
    event.preventDefault?.()
    game.handleKeyInput(event)
  }

  target.addEventListener('keydown', onKeyDown)

  let disposed = false
  return () => {
    if (disposed) {
      return
    }
    disposed = true
    target.removeEventListener('keydown', onKeyDown)
  }
}

export function checkGhostCollision(
  pacmanPos: TilePosition,
  ghostPositions: readonly TilePosition[],
  prevPacmanPos?: TilePosition,
  prevGhostPositions?: readonly TilePosition[],
): boolean {
  for (const ghostPos of ghostPositions) {
    if (ghostPos.row === pacmanPos.row && ghostPos.col === pacmanPos.col) {
      return true
    }
  }

  if (prevPacmanPos !== undefined && prevGhostPositions !== undefined) {
    const pairCount = Math.min(ghostPositions.length, prevGhostPositions.length)
    for (let index = 0; index < pairCount; index += 1) {
      const currGhost = ghostPositions[index]
      const prevGhost = prevGhostPositions[index]
      if (
        prevPacmanPos.row === currGhost.row &&
        prevPacmanPos.col === currGhost.col &&
        prevGhost.row === pacmanPos.row &&
        prevGhost.col === pacmanPos.col
      ) {
        return true
      }
    }
  }

  return false
}

interface InternalEngineState {
  maze: MazeDefinition
  tick: number
  pacmanPosition: TilePosition
  pacmanDirection: Direction | null
  pacmanStatus: PacmanStatus
  ghosts: GhostState[]
  ghostMovement: GhostMovementMode
  deathCount: number
}

function clonePosition(pos: TilePosition): TilePosition {
  return Object.freeze({ row: pos.row, col: pos.col })
}

function cloneGameOptions(options?: PacmanGameOptions): PacmanGameOptions | undefined {
  if (options === undefined) {
    return undefined
  }

  return {
    maze: options.maze,
    pacmanSpawn:
      options.pacmanSpawn !== undefined
        ? { row: options.pacmanSpawn.row, col: options.pacmanSpawn.col }
        : undefined,
    ghosts:
      options.ghosts !== undefined
        ? options.ghosts.map((ghost) => ({
            id: ghost.id,
            position: { row: ghost.position.row, col: ghost.position.col },
            direction: ghost.direction,
          }))
        : undefined,
    ghostMovement: options.ghostMovement,
  }
}

function buildInitialState(options?: PacmanGameOptions): InternalEngineState {
  const maze = options?.maze ?? CLASSIC_MAZE
  const rawPacmanSpawn = options?.pacmanSpawn ?? PACMAN_SPAWN_POSITION

  if (!rawPacmanSpawn || !isTileTraversable(maze, rawPacmanSpawn.row, rawPacmanSpawn.col)) {
    throw new Error(
      `Invalid Pacman spawn position (${String(rawPacmanSpawn?.row)}, ${String(rawPacmanSpawn?.col)}) for level "${maze.levelId}"`,
    )
  }

  const rawGhosts =
    options?.ghosts !== undefined ? options.ghosts : maze === CLASSIC_MAZE ? DEFAULT_GHOST_SPAWNS : []

  const normalizedGhosts: GhostState[] = []
  for (const ghost of rawGhosts) {
    if (typeof ghost.id !== 'string' || ghost.id.trim().length === 0) {
      throw new Error('Ghost id must be a non-empty string')
    }
    if (!ghost.position || !isTileTraversable(maze, ghost.position.row, ghost.position.col)) {
      throw new Error(
        `Invalid ghost "${ghost.id}" spawn position (${String(ghost.position?.row)}, ${String(ghost.position?.col)}) for level "${maze.levelId}"`,
      )
    }
    if (ghost.direction !== undefined && ghost.direction !== null && !isDirection(ghost.direction)) {
      throw new Error(`Invalid ghost "${ghost.id}" direction "${String(ghost.direction)}"`)
    }

    normalizedGhosts.push({
      id: ghost.id,
      position: { row: ghost.position.row, col: ghost.position.col },
      direction: ghost.direction ?? null,
    })
  }

  const pacmanPosition: TilePosition = { row: rawPacmanSpawn.row, col: rawPacmanSpawn.col }
  const initialOverlap = checkGhostCollision(
    pacmanPosition,
    normalizedGhosts.map((ghost) => ghost.position),
  )

  return {
    maze,
    tick: 0,
    pacmanPosition,
    pacmanDirection: null,
    pacmanStatus: initialOverlap ? 'dead' : 'alive',
    ghosts: normalizedGhosts,
    ghostMovement: options?.ghostMovement ?? 'stationary',
    deathCount: initialOverlap ? 1 : 0,
  }
}

function createFrozenSnapshot(state: InternalEngineState): PacmanGameSnapshot {
  const pacmanState: PacmanState = Object.freeze({
    position: clonePosition(state.pacmanPosition),
    direction: state.pacmanDirection,
    status: state.pacmanStatus,
  })

  const ghostStates: readonly GhostState[] = Object.freeze(
    state.ghosts.map((ghost) =>
      Object.freeze({
        id: ghost.id,
        position: clonePosition(ghost.position),
        direction: ghost.direction,
      }),
    ),
  )

  return Object.freeze({
    levelId: state.maze.levelId,
    tick: state.tick,
    pacman: pacmanState,
    ghosts: ghostStates,
    isPacmanDead: state.pacmanStatus === 'dead',
    deathCount: state.deathCount,
  })
}

export function createPacmanGame(options?: PacmanGameOptions): PacmanGameEngine {
  const savedCreationOptions = cloneGameOptions(options)
  let state = buildInitialState(savedCreationOptions)

  return {
    getMaze(): MazeDefinition {
      return state.maze
    },

    getSnapshot(): PacmanGameSnapshot {
      return createFrozenSnapshot(state)
    },

    getPacmanPosition(): TilePosition {
      return clonePosition(state.pacmanPosition)
    },

    handleKeyInput(input: unknown): boolean {
      const mappedDirection = mapKeyToDirection(input)
      if (mappedDirection === null || state.pacmanStatus === 'dead') {
        return false
      }

      state.pacmanDirection = mappedDirection
      return true
    },

    tick(): PacmanGameSnapshot {
      state.tick += 1

      if (state.pacmanStatus === 'dead') {
        return createFrozenSnapshot(state)
      }

      const prevPacmanPos: TilePosition = {
        row: state.pacmanPosition.row,
        col: state.pacmanPosition.col,
      }
      const prevGhostPositions: TilePosition[] = state.ghosts.map((ghost) => ({
        row: ghost.position.row,
        col: ghost.position.col,
      }))

      if (state.pacmanDirection !== null) {
        state.pacmanPosition = resolveTileMovement(
          state.maze,
          state.pacmanPosition,
          state.pacmanDirection,
        )
      }

      if (state.ghostMovement === 'stationary') {
        // Ghosts remain stationary across ticks.
      }

      const currentGhostPositions = state.ghosts.map((ghost) => ghost.position)
      if (
        checkGhostCollision(
          state.pacmanPosition,
          currentGhostPositions,
          prevPacmanPos,
          prevGhostPositions,
        )
      ) {
        state.pacmanStatus = 'dead'
        state.pacmanDirection = null
        state.deathCount += 1
      }

      return createFrozenSnapshot(state)
    },

    reset(nextOptions?: PacmanGameOptions): PacmanGameSnapshot {
      const effectiveOptions = nextOptions !== undefined ? nextOptions : savedCreationOptions
      state = buildInitialState(effectiveOptions)
      return createFrozenSnapshot(state)
    },
  }
}

export function renderGameToCanvas(
  ctx: MazeCanvasContext,
  snapshot: PacmanGameSnapshot,
  maze: MazeDefinition = CLASSIC_MAZE,
): GameRenderSummary {
  const mazeSummary = renderMazeToCanvas(ctx, maze)
  const tileSize = maze.tileSizePx
  const ghostRadius = tileSize * 0.38
  const pacmanRadius = tileSize * 0.42

  for (const ghost of snapshot.ghosts) {
    const gx = ghost.position.col * tileSize + tileSize / 2
    const gy = ghost.position.row * tileSize + tileSize / 2
    ctx.fillStyle = GHOST_COLORS_BY_ID[ghost.id] ?? DEFAULT_GHOST_COLOR
    ctx.beginPath()
    ctx.arc(gx, gy, ghostRadius, 0, Math.PI * 2)
    ctx.fill()
  }

  const pacmanCenterX = snapshot.pacman.position.col * tileSize + tileSize / 2
  const pacmanCenterY = snapshot.pacman.position.row * tileSize + tileSize / 2
  ctx.fillStyle = snapshot.pacman.status === 'dead' ? PACMAN_DEAD_COLOR : PACMAN_ALIVE_COLOR
  ctx.beginPath()
  ctx.arc(pacmanCenterX, pacmanCenterY, pacmanRadius, 0, Math.PI * 2)
  ctx.fill()

  return {
    ...mazeSummary,
    pacmanCenterPx: { x: pacmanCenterX, y: pacmanCenterY },
    pacmanStatus: snapshot.pacman.status,
    renderedGhostCount: snapshot.ghosts.length,
  }
}
