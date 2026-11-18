import {
  CLASSIC_MAZE,
  canMoveFromTile,
  getPelletSpawnPositions,
  isTileTraversable,
  renderMazeToCanvas,
  resolveTileMovement,
  type Direction,
  type MazeCanvasContext,
  type MazeDefinition,
  type MazeRenderSummary,
  type PelletSpawn,
  type TilePosition,
} from '../maze/classicMaze.ts'

export type PacmanStatus = 'alive' | 'dead'

export type GhostMovementMode = 'stationary' | 'ai'

export type GameStatus = 'playing' | 'won' | 'game-over'

export const PELLET_SCORE = 10
export const POWER_PELLET_SCORE = 50
export const INITIAL_LIVES = 3

export function getPelletScore(kind: PelletSpawn['kind']): number {
  return kind === 'power-pellet' ? POWER_PELLET_SCORE : PELLET_SCORE
}

/**
 * Gameplay events emitted synchronously by `PacmanGameEngine`:
 * - `'pelletCollected'`: emitted when Pacman consumes an active `'pellet'` or `'power-pellet'`.
 * - `'playerDied'`: emitted when Pacman collides with a ghost and loses a life.
 * - `'gameWon'`: emitted at most once per game session when all pellets are collected.
 * - `'gameLost'`: emitted at most once per game session when remaining lives reach `0`.
 */
export type PacmanGameEventType = 'pelletCollected' | 'playerDied' | 'gameWon' | 'gameLost'

export type PacmanGameEvent =
  | {
      readonly type: 'pelletCollected'
      readonly pellet: PelletSpawn
      readonly pointsAwarded: number
      readonly score: number
      readonly remainingPelletCount: number
    }
  | {
      readonly type: 'playerDied'
      readonly position: TilePosition
      readonly lives: number
      readonly deathCount: number
    }
  | {
      readonly type: 'gameWon'
      readonly score: number
      readonly tick: number
    }
  | {
      readonly type: 'gameLost'
      readonly score: number
      readonly deathCount: number
      readonly tick: number
    }

export type PacmanGameEventListener = (event: PacmanGameEvent) => void

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

export interface PacmanGameOptions {
  readonly maze?: MazeDefinition
  readonly pacmanSpawn?: TilePosition
  readonly ghosts?: readonly GhostInit[]
  readonly ghostMovement?: GhostMovementMode
  readonly initialLives?: number
  readonly onEvent?: PacmanGameEventListener
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
  respawn(): PacmanGameSnapshot
  reset(options?: PacmanGameOptions): PacmanGameSnapshot
  subscribe?(listener: PacmanGameEventListener): () => void
}

export const PACMAN_SPAWN_POSITION: TilePosition = Object.freeze({ row: 23, col: 13 })

export const GHOST_DIRECTION_PRIORITY: readonly Direction[] = Object.freeze([
  'up',
  'left',
  'down',
  'right',
])

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

export const PACMAN_COLOR = '#0000FF'
export const PACMAN_ALIVE_COLOR = '#0000FF'
export const PACMAN_DEAD_COLOR = 'rgba(0, 0, 255, 0.6)'
const DEFAULT_GHOST_COLOR = '#ef4444'
const GHOST_COLORS_BY_ID: Readonly<Record<string, string>> = Object.freeze({
  blinky: '#ef4444',
  pinky: '#f472b6',
  inky: '#38bdf8',
  clyde: '#fb923c',
})

const OPPOSITE_DIRECTION: Readonly<Record<Direction, Direction>> = Object.freeze({
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
})

const CARDINAL_DELTAS: readonly { readonly dRow: number; readonly dCol: number }[] = Object.freeze([
  Object.freeze({ dRow: -1, dCol: 0 }),
  Object.freeze({ dRow: 0, dCol: -1 }),
  Object.freeze({ dRow: 1, dCol: 0 }),
  Object.freeze({ dRow: 0, dCol: 1 }),
])

function isDirection(value: unknown): value is Direction {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right'
}

function isGhostMovementMode(value: unknown): value is GhostMovementMode {
  return value === 'stationary' || value === 'ai'
}

function manhattanDistance(a: TilePosition, b: TilePosition): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col)
}

function computeBfsDistancesToTarget(
  maze: MazeDefinition,
  candidates: readonly TilePosition[],
  targetPos: TilePosition,
): readonly number[] {
  if (
    !targetPos ||
    !isTileTraversable(maze, targetPos.row, targetPos.col) ||
    maze.rows <= 0 ||
    maze.columns <= 0
  ) {
    return candidates.map(() => Number.POSITIVE_INFINITY)
  }

  const cols = maze.columns
  const totalCells = maze.rows * cols
  const distances = new Int32Array(totalCells).fill(-1)
  const neededMask = new Uint8Array(totalCells)
  let remainingCandidates = 0

  for (const candidate of candidates) {
    const idx = candidate.row * cols + candidate.col
    if (neededMask[idx] === 0) {
      neededMask[idx] = 1
      remainingCandidates += 1
    }
  }

  const startIdx = targetPos.row * cols + targetPos.col
  distances[startIdx] = 0
  if (neededMask[startIdx] === 1) {
    neededMask[startIdx] = 0
    remainingCandidates -= 1
  }

  if (remainingCandidates > 0) {
    const queue = new Int32Array(totalCells)
    let head = 0
    let tail = 0
    queue[tail] = startIdx
    tail += 1

    while (head < tail && remainingCandidates > 0) {
      const currentIdx = queue[head]
      head += 1
      const currentRow = Math.floor(currentIdx / cols)
      const currentCol = currentIdx - currentRow * cols
      const nextDist = distances[currentIdx] + 1

      for (const delta of CARDINAL_DELTAS) {
        const neighborRow = currentRow + delta.dRow
        const neighborCol = currentCol + delta.dCol
        if (!isTileTraversable(maze, neighborRow, neighborCol)) {
          continue
        }

        const neighborIdx = neighborRow * cols + neighborCol
        if (distances[neighborIdx] !== -1) {
          continue
        }

        distances[neighborIdx] = nextDist
        queue[tail] = neighborIdx
        tail += 1

        if (neededMask[neighborIdx] === 1) {
          neededMask[neighborIdx] = 0
          remainingCandidates -= 1
        }
      }
    }
  }

  return candidates.map((candidate) => {
    const dist = distances[candidate.row * cols + candidate.col]
    return dist >= 0 ? dist : Number.POSITIVE_INFINITY
  })
}

export function chooseGhostDirection(
  maze: MazeDefinition,
  ghost: GhostState,
  targetPos: TilePosition,
): Direction | null {
  if (!ghost?.position || !isTileTraversable(maze, ghost.position.row, ghost.position.col)) {
    return null
  }

  const validDirs = GHOST_DIRECTION_PRIORITY.filter((dir) =>
    canMoveFromTile(maze, ghost.position, dir),
  )
  if (validDirs.length === 0) {
    return null
  }

  const currentHeading = ghost.direction
  const candidateDirs =
    currentHeading !== null && isDirection(currentHeading) && validDirs.length > 1
      ? validDirs.filter((dir) => dir !== OPPOSITE_DIRECTION[currentHeading])
      : validDirs

  if (candidateDirs.length === 1) {
    return candidateDirs[0]
  }

  const candidatePositions = candidateDirs.map((dir) =>
    resolveTileMovement(maze, ghost.position, dir),
  )
  const bfsDistances = computeBfsDistancesToTarget(maze, candidatePositions, targetPos)

  let bestIndex = 0
  let bestBfsDist = bfsDistances[0]
  let bestManhattanDist = manhattanDistance(candidatePositions[0], targetPos)

  for (let index = 1; index < candidateDirs.length; index += 1) {
    const bfsDist = bfsDistances[index]
    const manhattanDist = manhattanDistance(candidatePositions[index], targetPos)

    if (
      bfsDist < bestBfsDist ||
      (bfsDist === bestBfsDist && manhattanDist < bestManhattanDist)
    ) {
      bestIndex = index
      bestBfsDist = bfsDist
      bestManhattanDist = manhattanDist
    }
  }

  return candidateDirs[bestIndex]
}

export function stepGhostState(
  maze: MazeDefinition,
  ghost: GhostState,
  targetPos: TilePosition,
): GhostState {
  const nextDirection = chooseGhostDirection(maze, ghost, targetPos)
  if (nextDirection === null) {
    return Object.freeze({
      id: ghost.id,
      position: clonePosition(ghost.position),
      direction: null,
    })
  }

  const nextPos = resolveTileMovement(maze, ghost.position, nextDirection)
  return Object.freeze({
    id: ghost.id,
    position: clonePosition(nextPos),
    direction: nextDirection,
  })
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
  pacmanSpawn: TilePosition
  pacmanPosition: TilePosition
  pacmanDirection: Direction | null
  pacmanStatus: PacmanStatus
  initialGhosts: GhostState[]
  ghosts: GhostState[]
  ghostMovement: GhostMovementMode
  deathCount: number
  score: number
  lives: number
  initialLives: number
  pellets: PelletSpawn[]
  totalPelletCount: number
  gameStatus: GameStatus
  optionListener: PacmanGameEventListener | undefined
}

function clonePosition(pos: TilePosition): TilePosition {
  return Object.freeze({ row: pos.row, col: pos.col })
}

function clonePellet(pellet: PelletSpawn): PelletSpawn {
  return Object.freeze({ row: pellet.row, col: pellet.col, kind: pellet.kind })
}

function cloneGhostStates(ghosts: readonly GhostState[]): GhostState[] {
  return ghosts.map((ghost) => ({
    id: ghost.id,
    position: { row: ghost.position.row, col: ghost.position.col },
    direction: ghost.direction,
  }))
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
    initialLives: options.initialLives,
    onEvent: options.onEvent,
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

  if (options?.ghostMovement !== undefined && !isGhostMovementMode(options.ghostMovement)) {
    throw new Error(`Invalid ghostMovement mode "${String(options.ghostMovement)}"`)
  }
  const ghostMovement: GhostMovementMode = options?.ghostMovement ?? 'ai'

  if (
    options?.initialLives !== undefined &&
    (!Number.isInteger(options.initialLives) || options.initialLives < 1)
  ) {
    throw new Error(
      `Invalid initialLives "${String(options.initialLives)}": expected a positive integer >= 1`,
    )
  }
  const initialLives = options?.initialLives ?? INITIAL_LIVES

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

  const pacmanSpawn: TilePosition = { row: rawPacmanSpawn.row, col: rawPacmanSpawn.col }
  const pacmanPosition: TilePosition = { row: pacmanSpawn.row, col: pacmanSpawn.col }
  const initialPellets = getPelletSpawnPositions(maze).map((pellet) => ({
    row: pellet.row,
    col: pellet.col,
    kind: pellet.kind,
  }))
  const totalPelletCount = initialPellets.length

  const initialOverlap = checkGhostCollision(
    pacmanPosition,
    normalizedGhosts.map((ghost) => ghost.position),
  )
  const lives = initialOverlap ? Math.max(0, initialLives - 1) : initialLives
  const gameStatus: GameStatus = initialOverlap && lives === 0 ? 'game-over' : 'playing'

  return {
    maze,
    tick: 0,
    pacmanSpawn,
    pacmanPosition,
    pacmanDirection: null,
    pacmanStatus: initialOverlap ? 'dead' : 'alive',
    initialGhosts: cloneGhostStates(normalizedGhosts),
    ghosts: normalizedGhosts,
    ghostMovement,
    deathCount: initialOverlap ? 1 : 0,
    score: 0,
    lives,
    initialLives,
    pellets: initialPellets,
    totalPelletCount,
    gameStatus,
    optionListener: options?.onEvent,
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

  const pelletStates: readonly PelletSpawn[] = Object.freeze(
    state.pellets.map((pellet) => clonePellet(pellet)),
  )

  return Object.freeze({
    levelId: state.maze.levelId,
    tick: state.tick,
    pacman: pacmanState,
    ghosts: ghostStates,
    isPacmanDead: state.pacmanStatus === 'dead',
    deathCount: state.deathCount,
    score: state.score,
    lives: state.lives,
    initialLives: state.initialLives,
    pellets: pelletStates,
    totalPelletCount: state.totalPelletCount,
    remainingPelletCount: pelletStates.length,
    gameStatus: state.gameStatus,
    isGameOver: state.gameStatus === 'game-over',
    isWin: state.gameStatus === 'won',
  })
}

export function createPacmanGame(options?: PacmanGameOptions): PacmanGameEngine {
  const savedCreationOptions = cloneGameOptions(options)
  const subscribers = new Set<PacmanGameEventListener>()
  let state = buildInitialState(savedCreationOptions)

  function emitEvent(event: PacmanGameEvent): void {
    const frozenEvent = Object.freeze(event)
    state.optionListener?.(frozenEvent)
    for (const listener of [...subscribers]) {
      listener(frozenEvent)
    }
  }

  function emitInitialOverlapEventsIfNeeded(currentState: InternalEngineState): void {
    if (currentState.pacmanStatus === 'dead') {
      emitEvent({
        type: 'playerDied',
        position: clonePosition(currentState.pacmanPosition),
        lives: currentState.lives,
        deathCount: currentState.deathCount,
      })
      if (currentState.gameStatus === 'game-over') {
        emitEvent({
          type: 'gameLost',
          score: currentState.score,
          deathCount: currentState.deathCount,
          tick: currentState.tick,
        })
      }
    }
  }

  emitInitialOverlapEventsIfNeeded(state)

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
      if (
        mappedDirection === null ||
        state.pacmanStatus === 'dead' ||
        state.gameStatus !== 'playing'
      ) {
        return false
      }

      state.pacmanDirection = mappedDirection
      return true
    },

    tick(): PacmanGameSnapshot {
      state.tick += 1

      if (state.pacmanStatus === 'dead' || state.gameStatus !== 'playing') {
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
          prevPacmanPos,
          state.pacmanDirection,
        )
      }

      if (state.ghostMovement === 'ai') {
        state.ghosts = state.ghosts.map((ghost) =>
          stepGhostState(state.maze, ghost, prevPacmanPos),
        )
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
        state.lives = Math.max(0, state.lives - 1)
        emitEvent({
          type: 'playerDied',
          position: clonePosition(state.pacmanPosition),
          lives: state.lives,
          deathCount: state.deathCount,
        })
        if (state.lives === 0) {
          state.gameStatus = 'game-over'
          emitEvent({
            type: 'gameLost',
            score: state.score,
            deathCount: state.deathCount,
            tick: state.tick,
          })
        }
        return createFrozenSnapshot(state)
      }

      const pelletIndex = state.pellets.findIndex(
        (pellet) =>
          pellet.row === state.pacmanPosition.row && pellet.col === state.pacmanPosition.col,
      )
      if (pelletIndex >= 0) {
        const [collectedPellet] = state.pellets.splice(pelletIndex, 1)
        const pointsAwarded = getPelletScore(collectedPellet.kind)
        state.score += pointsAwarded
        emitEvent({
          type: 'pelletCollected',
          pellet: clonePellet(collectedPellet),
          pointsAwarded,
          score: state.score,
          remainingPelletCount: state.pellets.length,
        })

        if (state.totalPelletCount > 0 && state.pellets.length === 0) {
          state.gameStatus = 'won'
          state.pacmanDirection = null
          emitEvent({
            type: 'gameWon',
            score: state.score,
            tick: state.tick,
          })
        }
      }

      return createFrozenSnapshot(state)
    },

    respawn(): PacmanGameSnapshot {
      if (
        state.pacmanStatus !== 'dead' ||
        state.lives <= 0 ||
        state.gameStatus !== 'playing'
      ) {
        return createFrozenSnapshot(state)
      }

      state.pacmanPosition = { row: state.pacmanSpawn.row, col: state.pacmanSpawn.col }
      state.pacmanDirection = null
      state.ghosts = cloneGhostStates(state.initialGhosts)

      const respawnOverlap = checkGhostCollision(
        state.pacmanPosition,
        state.ghosts.map((ghost) => ghost.position),
      )
      if (respawnOverlap) {
        state.pacmanStatus = 'dead'
        state.deathCount += 1
        state.lives = Math.max(0, state.lives - 1)
        emitEvent({
          type: 'playerDied',
          position: clonePosition(state.pacmanPosition),
          lives: state.lives,
          deathCount: state.deathCount,
        })
        if (state.lives === 0) {
          state.gameStatus = 'game-over'
          emitEvent({
            type: 'gameLost',
            score: state.score,
            deathCount: state.deathCount,
            tick: state.tick,
          })
        }
      } else {
        state.pacmanStatus = 'alive'
        state.gameStatus = 'playing'
      }

      return createFrozenSnapshot(state)
    },

    reset(nextOptions?: PacmanGameOptions): PacmanGameSnapshot {
      const effectiveOptions = nextOptions !== undefined ? nextOptions : savedCreationOptions
      state = buildInitialState(effectiveOptions)
      emitInitialOverlapEventsIfNeeded(state)
      return createFrozenSnapshot(state)
    },

    subscribe(listener: PacmanGameEventListener): () => void {
      subscribers.add(listener)
      let unsubscribed = false
      return () => {
        if (unsubscribed) {
          return
        }
        unsubscribed = true
        subscribers.delete(listener)
      }
    },
  }
}

export function renderGameToCanvas(
  ctx: MazeCanvasContext,
  snapshot: PacmanGameSnapshot,
  maze: MazeDefinition = CLASSIC_MAZE,
): GameRenderSummary {
  const activePellets = Array.isArray((snapshot as Partial<PacmanGameSnapshot>).pellets)
    ? snapshot.pellets
    : undefined
  const mazeSummary = renderMazeToCanvas(ctx, maze, activePellets)
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
