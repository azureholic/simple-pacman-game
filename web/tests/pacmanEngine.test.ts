import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import {
  CLASSIC_MAZE,
  isTileTraversable,
  isWallTile,
  type MazeCanvasContext,
  type MazeDefinition,
} from '../src/maze/classicMaze.ts'
import {
  DEFAULT_GHOST_SPAWNS,
  GHOST_DIRECTION_PRIORITY,
  INITIAL_LIVES,
  PACMAN_ALIVE_COLOR,
  PACMAN_COLOR,
  PACMAN_DEAD_COLOR,
  PACMAN_SPAWN_POSITION,
  PELLET_SCORE,
  POWER_PELLET_SCORE,
  attachKeyboardControls,
  checkGhostCollision,
  chooseGhostDirection,
  createPacmanGame,
  getPelletScore,
  mapKeyToDirection,
  renderGameToCanvas,
  stepGhostState,
  type GhostState,
  type KeyboardEventLike,
  type KeyboardEventTargetLike,
  type PacmanGameEvent,
  type PacmanGameOptions,
} from '../src/game/pacmanEngine.ts'

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

function createKeyboardHarness() {
  const listeners = new Set<(event: KeyboardEventLike) => void>()
  let removeCalls = 0

  const target: KeyboardEventTargetLike = {
    addEventListener(type, listener) {
      assert.equal(type, 'keydown')
      listeners.add(listener)
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'keydown')
      removeCalls += 1
      listeners.delete(listener)
    },
  }

  function pressKey(
    key: unknown,
    modifiers: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {},
  ): boolean {
    let prevented = false
    const event: KeyboardEventLike = {
      key,
      ...modifiers,
      preventDefault() {
        prevented = true
      },
    }
    for (const listener of [...listeners]) {
      listener(event)
    }
    return prevented
  }

  return { target, listeners, pressKey, getRemoveCalls: () => removeCalls }
}

test('PACMAN_SPAWN_POSITION and DEFAULT_GHOST_SPAWNS are frozen and placed on safe traversable tiles', () => {
  assert.deepEqual(PACMAN_SPAWN_POSITION, { row: 23, col: 13 })
  assert.equal(Object.isFrozen(PACMAN_SPAWN_POSITION), true)
  assert.equal(isTileTraversable(CLASSIC_MAZE, PACMAN_SPAWN_POSITION.row, PACMAN_SPAWN_POSITION.col), true)

  assert.equal(Object.isFrozen(DEFAULT_GHOST_SPAWNS), true)
  assert.ok(DEFAULT_GHOST_SPAWNS.length >= 1)

  for (const ghost of DEFAULT_GHOST_SPAWNS) {
    assert.equal(Object.isFrozen(ghost), true)
    assert.equal(Object.isFrozen(ghost.position), true)
    assert.ok(ghost.id.trim().length > 0)
    assert.equal(isTileTraversable(CLASSIC_MAZE, ghost.position.row, ghost.position.col), true)
    const distance =
      Math.abs(ghost.position.row - PACMAN_SPAWN_POSITION.row) +
      Math.abs(ghost.position.col - PACMAN_SPAWN_POSITION.col)
    assert.ok(distance >= 8)
  }
})

test('mapKeyToDirection and attachKeyboardControls handle desktop arrow keys and ignore unsupported inputs', () => {
  assert.equal(mapKeyToDirection('ArrowUp'), 'up')
  assert.equal(mapKeyToDirection('ArrowDown'), 'down')
  assert.equal(mapKeyToDirection('ArrowLeft'), 'left')
  assert.equal(mapKeyToDirection('ArrowRight'), 'right')
  assert.equal(mapKeyToDirection({ key: 'ArrowUp', ctrlKey: false, altKey: false, metaKey: false }), 'up')

  const throwingInput = Object.defineProperty({}, 'key', {
    get() {
      throw new Error('Synthetic getter failure')
    },
  })

  for (const unsupported of [
    '',
    ' ',
    'Enter',
    'Escape',
    'w',
    'a',
    's',
    'd',
    'arrowup',
    'up',
    null,
    undefined,
    42,
    false,
    ['ArrowUp'],
    {},
    { key: 99 },
    { key: 'ArrowUp', ctrlKey: true },
    { key: 'ArrowDown', altKey: true },
    { key: 'ArrowLeft', metaKey: true },
    throwingInput,
  ]) {
    assert.equal(mapKeyToDirection(unsupported), null)
  }

  const game = createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [] })
  const harness = createKeyboardHarness()
  const dispose = attachKeyboardControls(harness.target, game)

  assert.equal(harness.listeners.size, 1)
  assert.equal(harness.pressKey('Enter'), false)
  assert.equal(harness.pressKey('ArrowUp', { ctrlKey: true }), false)
  assert.equal(game.getSnapshot().pacman.direction, null)

  assert.equal(harness.pressKey('ArrowLeft'), true)
  assert.equal(game.getSnapshot().pacman.direction, 'left')
  assert.deepEqual(game.getPacmanPosition(), { row: 23, col: 13 })

  // Idempotent cleanup removes listener exactly once
  dispose()
  dispose()
  assert.equal(harness.listeners.size, 0)
  assert.equal(harness.getRemoveCalls(), 1)
  assert.equal(harness.pressKey('ArrowRight'), false)
  assert.equal(game.getSnapshot().pacman.direction, 'left')
})

test('Pacman moves along open tiles, executes turns and reversals, and stops cleanly against walls and bounds', () => {
  const game = createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [] })

  // Idle tick does not move Pacman
  assert.deepEqual(game.tick().pacman.position, { row: 23, col: 13 })

  // Blocked upward move at spawn (22, 13 is a wall) keeps position unchanged
  assert.equal(game.handleKeyInput('ArrowUp'), true)
  assert.deepEqual(game.tick().pacman.position, { row: 23, col: 13 })

  // Move left to intersection at (23, 12), then turn up into corridor (22, 12) -> (21, 12)
  assert.equal(game.handleKeyInput('ArrowLeft'), true)
  assert.deepEqual(game.tick().pacman.position, { row: 23, col: 12 })
  assert.equal(game.handleKeyInput('ArrowUp'), true)
  assert.deepEqual(game.tick().pacman.position, { row: 22, col: 12 })
  assert.deepEqual(game.tick().pacman.position, { row: 21, col: 12 })

  // Reverse direction downward back to (23, 12), then turn right past spawn
  assert.equal(game.handleKeyInput('ArrowDown'), true)
  assert.deepEqual(game.tick().pacman.position, { row: 22, col: 12 })
  assert.deepEqual(game.tick().pacman.position, { row: 23, col: 12 })
  assert.equal(game.handleKeyInput('ArrowRight'), true)
  assert.deepEqual(game.tick().pacman.position, { row: 23, col: 13 })
  assert.deepEqual(game.tick().pacman.position, { row: 23, col: 14 })

  // Custom open-edge grid blocks stepping outside 0..rows-1 and 0..columns-1
  const openEdgeMaze: MazeDefinition = {
    levelId: 'edge-clamp',
    columns: 3,
    rows: 3,
    tileSizePx: 20,
    grid: [
      ['wall', 'corridor', 'wall'],
      ['corridor', 'corridor', 'corridor'],
      ['wall', 'corridor', 'wall'],
    ],
  }
  const edgeGame = createPacmanGame({ maze: openEdgeMaze, pacmanSpawn: { row: 0, col: 1 } })
  edgeGame.handleKeyInput('ArrowUp')
  assert.deepEqual(edgeGame.tick().pacman.position, { row: 0, col: 1 })
  edgeGame.handleKeyInput('ArrowDown')
  assert.deepEqual(edgeGame.tick().pacman.position, { row: 1, col: 1 })
})

test('Spawn validation rejects walls, out-of-bounds coordinates, empty ghost IDs, and preserves state on bad reset', () => {
  assert.throws(() => createPacmanGame({ maze: CLASSIC_MAZE, pacmanSpawn: { row: 0, col: 0 } }), Error)
  assert.throws(() => createPacmanGame({ maze: CLASSIC_MAZE, pacmanSpawn: { row: -1, col: 1 } }), Error)
  assert.throws(
    () =>
      createPacmanGame({
        maze: CLASSIC_MAZE,
        ghosts: [{ id: '', position: { row: 11, col: 13 } }],
      }),
    Error,
  )
  assert.throws(
    () =>
      createPacmanGame({
        maze: CLASSIC_MAZE,
        ghosts: [{ id: 'blinky', position: { row: 0, col: 0 } }],
      }),
    Error,
  )

  const mutableSpawn = { row: 23, col: 13 }
  const initialOptions: PacmanGameOptions = {
    maze: CLASSIC_MAZE,
    pacmanSpawn: mutableSpawn,
    ghosts: [],
  }
  const game = createPacmanGame(initialOptions)
  mutableSpawn.row = 0

  game.handleKeyInput('ArrowLeft')
  game.tick()
  assert.deepEqual(game.getPacmanPosition(), { row: 23, col: 12 })

  // Failed reset throws without corrupting current engine state
  assert.throws(() => game.reset({ maze: CLASSIC_MAZE, pacmanSpawn: { row: 0, col: 0 } }), Error)
  assert.deepEqual(game.getPacmanPosition(), { row: 23, col: 12 })

  // Default reset uses defensively cloned creation options
  const resetSnap = game.reset()
  assert.equal(resetSnap.tick, 0)
  assert.deepEqual(resetSnap.pacman.position, { row: 23, col: 13 })
})

test('Ghost collision transitions Pacman to dead state, halts further input and movement, and supports reset', () => {
  assert.equal(checkGhostCollision({ row: 5, col: 6 }, [{ row: 5, col: 6 }]), true)
  assert.equal(checkGhostCollision({ row: 5, col: 6 }, [{ row: 1, col: 1 }, { row: 5, col: 6 }]), true)
  assert.equal(checkGhostCollision({ row: 5, col: 6 }, [{ row: 5, col: 7 }]), false)
  assert.equal(
    checkGhostCollision(
      { row: 5, col: 7 },
      [{ row: 5, col: 6 }],
      { row: 5, col: 6 },
      [{ row: 5, col: 7 }],
    ),
    true,
  )

  const game = createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 5, col: 5 },
    ghosts: [{ id: 'blinky', position: { row: 5, col: 6 } }],
    ghostMovement: 'stationary',
  })

  assert.equal(game.handleKeyInput('ArrowRight'), true)
  const deadSnap = game.tick()
  assert.deepEqual(deadSnap.pacman.position, { row: 5, col: 6 })
  assert.equal(deadSnap.pacman.status, 'dead')
  assert.equal(deadSnap.pacman.direction, null)
  assert.equal(deadSnap.isPacmanDead, true)
  assert.equal(deadSnap.deathCount, 1)

  // Inputs and ticks while dead do not move Pacman or increment deathCount again
  assert.equal(game.handleKeyInput('ArrowLeft'), false)
  const afterDeadTick = game.tick()
  assert.equal(afterDeadTick.tick, 2)
  assert.deepEqual(afterDeadTick.pacman.position, { row: 5, col: 6 })
  assert.equal(afterDeadTick.deathCount, 1)

  // Reset restores alive state
  const restored = game.reset()
  assert.equal(restored.pacman.status, 'alive')
  assert.equal(restored.isPacmanDead, false)
  assert.equal(restored.deathCount, 0)
  assert.deepEqual(restored.pacman.position, { row: 5, col: 5 })

  // Snapshots and positions are frozen and isolated across instances
  const otherGame = createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [] })
  assert.equal(Object.isFrozen(restored), true)
  assert.equal(Object.isFrozen(restored.pacman), true)
  assert.equal(Object.isFrozen(restored.pacman.position), true)
  assert.equal(Object.isFrozen(restored.ghosts), true)
  assert.deepEqual(otherGame.getPacmanPosition(), { row: 23, col: 13 })
})

test('renderGameToCanvas and App render Pacman, ghosts, and data-pacman attributes with zero disallowed APIs', async () => {
  const aliveGame = createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 23, col: 13 },
    ghosts: [{ id: 'blinky', position: { row: 11, col: 13 } }],
  })
  const deadGame = createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 23, col: 13 },
    ghosts: [{ id: 'blinky', position: { row: 23, col: 13 } }],
  })

  const aliveCanvas = createMockCanvasContext()
  const aliveSummary = renderGameToCanvas(aliveCanvas.ctx, aliveGame.getSnapshot(), CLASSIC_MAZE)
  assert.equal(aliveSummary.pacmanStatus, 'alive')
  assert.equal(aliveSummary.renderedGhostCount, 1)
  assert.deepEqual(aliveSummary.pacmanCenterPx, { x: 270, y: 470 })

  const deadCanvas = createMockCanvasContext()
  const deadSummary = renderGameToCanvas(
    deadCanvas.ctx,
    { ...deadGame.getSnapshot(), ghosts: [] },
    CLASSIC_MAZE,
  )
  assert.equal(deadSummary.pacmanStatus, 'dead')
  assert.equal(deadSummary.renderedGhostCount, 0)

  const aliveArc = aliveCanvas.filledArcs.at(-1)
  const deadArc = deadCanvas.filledArcs.at(-1)
  assert.ok(aliveArc && deadArc)
  assert.notEqual(aliveArc.fillStyle, deadArc.fillStyle)

  const vite = await createServer({
    root: webRoot,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  })

  try {
    const mod = await vite.ssrLoadModule('/src/App.tsx')
    const defaultHtml = renderToStaticMarkup(createElement(mod.App))
    assert.match(defaultHtml, /data-ghost-count="4"/)

    const aliveHtml = renderToStaticMarkup(createElement(mod.App, { game: aliveGame }))
    assert.match(aliveHtml, /data-pacman-row="23"/)
    assert.match(aliveHtml, /data-pacman-col="13"/)
    assert.match(aliveHtml, /data-pacman-status="alive"/)
    assert.match(aliveHtml, /data-ghost-count="1"/)

    const deadHtml = renderToStaticMarkup(createElement(mod.App, { game: deadGame }))
    assert.match(deadHtml, /data-pacman-status="dead"/)
  } finally {
    await vite.close()
  }

  const engineSource = fs.readFileSync(path.join(webRoot, 'src', 'game', 'pacmanEngine.ts'), 'utf8')
  assert.doesNotMatch(engineSource, /\bfetch\s*\(/)
  assert.doesNotMatch(engineSource, /\bXMLHttpRequest\b/)
  assert.doesNotMatch(engineSource, /\blocalStorage\b/)
  assert.doesNotMatch(engineSource, /\bsessionStorage\b/)
  assert.doesNotMatch(engineSource, /\bAudioContext\b/)
})

test('Ghost AI helpers respect walls, classic non-reverse rule, BFS routing, and priority tie-breakers', () => {
  assert.deepEqual(GHOST_DIRECTION_PRIORITY, ['up', 'left', 'down', 'right'])
  assert.equal(Object.isFrozen(GHOST_DIRECTION_PRIORITY), true)

  // Wall, out-of-bounds, and enclosed pocket ghosts return null and remain stationary without mutating input
  const wallGhost: GhostState = { id: 'wall-probe', position: { row: 0, col: 0 }, direction: 'right' }
  assert.equal(chooseGhostDirection(CLASSIC_MAZE, wallGhost, PACMAN_SPAWN_POSITION), null)
  const wallStep = stepGhostState(CLASSIC_MAZE, wallGhost, PACMAN_SPAWN_POSITION)
  assert.deepEqual(wallGhost, { id: 'wall-probe', position: { row: 0, col: 0 }, direction: 'right' })
  assert.deepEqual(wallStep, { id: 'wall-probe', position: { row: 0, col: 0 }, direction: null })
  assert.equal(Object.isFrozen(wallStep), true)
  assert.equal(Object.isFrozen(wallStep.position), true)

  const pocketMaze: MazeDefinition = {
    levelId: 'pocket-test',
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
    chooseGhostDirection(pocketMaze, { id: 'trapped', position: { row: 1, col: 1 }, direction: 'up' }, { row: 1, col: 1 }),
    null,
  )

  // Non-reverse mid-corridor and reversal at dead end
  const deadEndMaze: MazeDefinition = {
    levelId: 'dead-end-test',
    columns: 5,
    rows: 3,
    tileSizePx: 20,
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'corridor', 'corridor', 'corridor', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall'],
    ],
  }
  const forwardStep = stepGhostState(
    deadEndMaze,
    { id: 'runner', position: { row: 1, col: 2 }, direction: 'right' },
    { row: 1, col: 1 },
  )
  assert.deepEqual(forwardStep, { id: 'runner', position: { row: 1, col: 3 }, direction: 'right' })
  const reverseStep = stepGhostState(deadEndMaze, forwardStep, { row: 1, col: 1 })
  assert.deepEqual(reverseStep, { id: 'runner', position: { row: 1, col: 2 }, direction: 'left' })

  // BFS shortest-path routes around Ghost House wall instead of entering dead-end doorway
  const blinkyAtDoor: GhostState = { id: 'blinky', position: { row: 11, col: 13 }, direction: null }
  assert.equal(chooseGhostDirection(CLASSIC_MAZE, blinkyAtDoor, PACMAN_SPAWN_POSITION), 'left')

  // Unreachable target across solid wall falls back to Manhattan distance then GHOST_DIRECTION_PRIORITY
  const splitMaze: MazeDefinition = {
    levelId: 'split-test',
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
  assert.equal(
    chooseGhostDirection(splitMaze, { id: 'caged', position: { row: 1, col: 2 }, direction: null }, { row: 3, col: 3 }),
    'right',
  )
  assert.equal(
    chooseGhostDirection(splitMaze, { id: 'caged', position: { row: 1, col: 2 }, direction: null }, { row: 3, col: 2 }),
    'left',
  )
})

test('Default AI ghostMovement navigates CLASSIC_MAZE deterministically and resolves all collision encounters', () => {
  // Invalid ghostMovement throws on createPacmanGame and reset without corrupting existing state
  assert.throws(
    () => createPacmanGame({ maze: CLASSIC_MAZE, ghostMovement: 'invalid' as never }),
    Error,
  )

  const game = createPacmanGame()
  assert.throws(() => game.reset({ maze: CLASSIC_MAZE, ghostMovement: 'invalid' as never }), Error)
  assert.equal(game.getSnapshot().tick, 0)

  for (let step = 0; step < 20; step += 1) {
    const snap = game.tick()
    for (const ghost of snap.ghosts) {
      assert.equal(isWallTile(CLASSIC_MAZE, ghost.position.row, ghost.position.col), false)
      assert.equal(isTileTraversable(CLASSIC_MAZE, ghost.position.row, ghost.position.col), true)
    }
    if (snap.isPacmanDead) {
      break
    }
  }
  const caughtSnap = game.getSnapshot()
  assert.equal(caughtSnap.isPacmanDead, true)
  assert.equal(caughtSnap.pacman.status, 'dead')
  assert.equal(caughtSnap.deathCount, 1)

  // Ghosts halt once Pacman is dead, and reset replays identical deterministic trajectory
  const postDeathGhosts = caughtSnap.ghosts.map((g) => g.position)
  const afterDeadTick = game.tick()
  assert.deepEqual(
    afterDeadTick.ghosts.map((g) => g.position),
    postDeathGhosts,
  )
  assert.equal(afterDeadTick.deathCount, 1)

  const replayGame = createPacmanGame()
  for (let step = 0; step < caughtSnap.tick; step += 1) {
    replayGame.tick()
  }
  assert.deepEqual(replayGame.getSnapshot(), caughtSnap)

  // Converging, head-on swap, and retreating corridor encounters under AI movement
  const convergeGame = createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 5, col: 5 },
    ghosts: [{ id: 'blinky', position: { row: 5, col: 7 } }],
  })
  convergeGame.handleKeyInput('ArrowRight')
  const convergeSnap = convergeGame.tick()
  assert.deepEqual(convergeSnap.pacman.position, { row: 5, col: 6 })
  assert.deepEqual(convergeSnap.ghosts[0].position, { row: 5, col: 6 })
  assert.equal(convergeSnap.isPacmanDead, true)

  const swapGame = createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 5, col: 6 },
    ghosts: [{ id: 'blinky', position: { row: 5, col: 7 } }],
  })
  swapGame.handleKeyInput('ArrowRight')
  const swapSnap = swapGame.tick()
  assert.deepEqual(swapSnap.pacman.position, { row: 5, col: 7 })
  assert.deepEqual(swapSnap.ghosts[0].position, { row: 5, col: 6 })
  assert.equal(swapSnap.isPacmanDead, true)

  const retreatGame = createPacmanGame({
    maze: CLASSIC_MAZE,
    pacmanSpawn: { row: 5, col: 6 },
    ghosts: [{ id: 'blinky', position: { row: 5, col: 7 } }],
  })
  retreatGame.handleKeyInput('ArrowLeft')
  const retreatSnap = retreatGame.tick()
  assert.deepEqual(retreatSnap.pacman.position, { row: 5, col: 5 })
  assert.deepEqual(retreatSnap.ghosts[0].position, { row: 5, col: 6 })
  assert.equal(retreatSnap.isPacmanDead, false)
})

test('Pellet collection, scoring, lives, respawn, win/lose end states, events, and HUD attributes work end-to-end', async () => {
  assert.equal(PELLET_SCORE, 10)
  assert.equal(POWER_PELLET_SCORE, 50)
  assert.equal(INITIAL_LIVES, 3)
  assert.equal(getPelletScore('pellet'), 10)
  assert.equal(getPelletScore('power-pellet'), 50)

  for (const badLives of [0, -2, 2.5, Number.NaN]) {
    assert.throws(() => createPacmanGame({ maze: CLASSIC_MAZE, ghosts: [], initialLives: badLives }), Error)
  }

  const stage: MazeDefinition = {
    levelId: 'unit-win-lose-stage',
    columns: 6,
    rows: 3,
    tileSizePx: 20,
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'corridor', 'pellet', 'power-pellet', 'corridor', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
    ],
  }

  // 1. Pellet collection, win transition, and decoupled event emission
  const winEvents: PacmanGameEvent[] = []
  const winGame = createPacmanGame({
    maze: stage,
    pacmanSpawn: { row: 1, col: 1 },
    ghosts: [],
    onEvent(ev) {
      winEvents.push(ev)
    },
  })
  const subscribedEvents: PacmanGameEvent[] = []
  const unsubscribe = winGame.subscribe!((ev) => subscribedEvents.push(ev))

  assert.equal(winGame.getSnapshot().score, 0)
  assert.equal(winGame.getSnapshot().remainingPelletCount, 2)
  assert.equal(winGame.getSnapshot().gameStatus, 'playing')

  winGame.handleKeyInput('ArrowRight')
  const afterFirst = winGame.tick()
  assert.equal(afterFirst.score, 10)
  assert.equal(afterFirst.remainingPelletCount, 1)
  assert.equal(afterFirst.gameStatus, 'playing')

  const afterWin = winGame.tick()
  assert.equal(afterWin.score, 60)
  assert.equal(afterWin.remainingPelletCount, 0)
  assert.equal(afterWin.gameStatus, 'won')
  assert.equal(afterWin.isWin, true)
  assert.equal(afterWin.isGameOver, false)
  assert.equal(afterWin.pacman.direction, null)

  // Post-win input, tick, and respawn are halted; gameWon fires only once
  assert.equal(winGame.handleKeyInput('ArrowLeft'), false)
  const postWinTick = winGame.tick()
  assert.equal(postWinTick.score, 60)
  assert.equal(postWinTick.gameStatus, 'won')
  assert.deepEqual(winGame.respawn(), postWinTick)

  assert.deepEqual(
    winEvents.map((e) => e.type),
    ['pelletCollected', 'pelletCollected', 'gameWon'],
  )
  assert.deepEqual(subscribedEvents, winEvents)
  unsubscribe()
  unsubscribe()

  const canvasCheck = createMockCanvasContext()
  const renderSummary = renderGameToCanvas(canvasCheck.ctx, afterFirst, stage)
  assert.equal(renderSummary.renderedPelletCount, 1)

  // 2. Lives decrement, respawn continuation, and game-over transition
  const loseEvents: PacmanGameEvent[] = []
  const loseGame = createPacmanGame({
    maze: stage,
    pacmanSpawn: { row: 1, col: 1 },
    ghosts: [{ id: 'blinky', position: { row: 1, col: 3 } }],
    ghostMovement: 'stationary',
    initialLives: 2,
    onEvent(ev) {
      loseEvents.push(ev)
    },
  })

  loseGame.handleKeyInput('ArrowRight')
  loseGame.tick() // (1, 2) collects pellet (+10)
  const firstDeath = loseGame.tick() // (1, 3) collides with stationary Blinky before power-pellet
  assert.equal(firstDeath.pacman.status, 'dead')
  assert.equal(firstDeath.lives, 1)
  assert.equal(firstDeath.score, 10)
  assert.equal(firstDeath.remainingPelletCount, 1)
  assert.equal(firstDeath.gameStatus, 'playing')
  assert.equal(firstDeath.isGameOver, false)

  const revived = loseGame.respawn()
  assert.equal(revived.pacman.status, 'alive')
  assert.deepEqual(revived.pacman.position, { row: 1, col: 1 })
  assert.equal(revived.lives, 1)
  assert.equal(revived.score, 10)
  assert.equal(revived.remainingPelletCount, 1)

  loseGame.handleKeyInput('ArrowRight')
  loseGame.tick() // (1, 2) already cleared -> +0
  const finalDeath = loseGame.tick() // (1, 3) collides -> lives=0, game-over
  assert.equal(finalDeath.lives, 0)
  assert.equal(finalDeath.gameStatus, 'game-over')
  assert.equal(finalDeath.isGameOver, true)
  assert.equal(finalDeath.isWin, false)
  assert.equal(loseGame.handleKeyInput('ArrowLeft'), false)
  assert.deepEqual(loseGame.respawn(), finalDeath)
  assert.deepEqual(
    loseEvents.map((e) => e.type),
    ['pelletCollected', 'playerDied', 'playerDied', 'gameLost'],
  )

  // 3. App SSR HUD markup reflects score, lives, remaining pellets, status, and buttons
  const vite = await createServer({
    root: webRoot,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  })

  try {
    const mod = await vite.ssrLoadModule('/src/App.tsx')
    const wonHtml = renderToStaticMarkup(createElement(mod.App, { game: winGame }))
    assert.match(wonHtml, /data-testid="score-display"/)
    assert.match(wonHtml, /data-score="60"/)
    assert.match(wonHtml, /data-testid="pellets-display"/)
    assert.match(wonHtml, /data-remaining-pellets="0"/)
    assert.match(wonHtml, /data-game-status="won"/)
    assert.match(wonHtml, /data-testid="restart-button"/)
    assert.doesNotMatch(wonHtml, /data-testid="respawn-button"/)

    const gameOverHtml = renderToStaticMarkup(createElement(mod.App, { game: loseGame }))
    assert.match(gameOverHtml, /data-testid="lives-display"/)
    assert.match(gameOverHtml, /data-lives="0"/)
    assert.match(gameOverHtml, /data-game-status="game-over"/)
    assert.match(gameOverHtml, /Game Over/i)
    assert.doesNotMatch(gameOverHtml, /data-testid="respawn-button"/)
  } finally {
    await vite.close()
  }
})

test('Pacman renders in blue (#0000FF) across start, active gameplay, dying, win, game-over, respawn, and reset states without altering non-Pacman colors', () => {
  assert.equal(PACMAN_COLOR, '#0000FF')
  assert.equal(PACMAN_ALIVE_COLOR, '#0000FF')
  assert.equal(PACMAN_DEAD_COLOR, 'rgba(0, 0, 255, 0.6)')
  assert.notEqual(PACMAN_ALIVE_COLOR, PACMAN_DEAD_COLOR)

  // Start screen and non-Pacman entity/maze color isolation on CLASSIC_MAZE
  const startGame = createPacmanGame({
    maze: CLASSIC_MAZE,
    ghosts: DEFAULT_GHOST_SPAWNS,
    ghostMovement: 'stationary',
  })
  const startCanvas = createMockCanvasContext()
  renderGameToCanvas(startCanvas.ctx, startGame.getSnapshot(), CLASSIC_MAZE)

  assert.equal(startCanvas.fillRectCalls[0].fillStyle, '#020617')
  for (const wallRect of startCanvas.fillRectCalls.slice(1)) {
    assert.equal(wallRect.fillStyle, '#1d4ed8')
  }
  const pelletArcs = startCanvas.filledArcs.slice(0, 244)
  for (const arc of pelletArcs) {
    assert.equal(
      arc.fillStyle,
      arc.radius === CLASSIC_MAZE.tileSizePx * 0.3 ? '#fde047' : '#fde68a',
    )
  }
  const ghostArcs = startCanvas.filledArcs.slice(244, 248)
  assert.deepEqual(
    ghostArcs.map((a) => a.fillStyle),
    ['#ef4444', '#f472b6', '#38bdf8', '#fb923c'],
  )
  assert.equal(startCanvas.filledArcs[248].fillStyle, PACMAN_ALIVE_COLOR)

  // Active gameplay movement, pellet & power-pellet collection, win, dying, respawn, game-over, and reset
  const stage: MazeDefinition = {
    levelId: 'blue-color-stage',
    columns: 6,
    rows: 3,
    tileSizePx: 20,
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'corridor', 'pellet', 'power-pellet', 'corridor', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
    ],
  }

  const getPacmanArcFill = (snap: ReturnType<typeof startGame.getSnapshot>) => {
    const mock = createMockCanvasContext()
    renderGameToCanvas(mock.ctx, { ...snap, ghosts: [] }, stage)
    const arc = mock.filledArcs.at(-1)
    assert.ok(arc)
    return arc.fillStyle
  }

  const playGame = createPacmanGame({
    maze: stage,
    pacmanSpawn: { row: 1, col: 1 },
    ghosts: [],
  })
  playGame.handleKeyInput('ArrowRight')
  assert.equal(getPacmanArcFill(playGame.tick()), PACMAN_ALIVE_COLOR) // pellet collected
  const wonSnap = playGame.tick() // power-pellet collected -> won
  assert.equal(wonSnap.gameStatus, 'won')
  assert.equal(getPacmanArcFill(wonSnap), PACMAN_ALIVE_COLOR)
  assert.equal(getPacmanArcFill(playGame.reset()), PACMAN_ALIVE_COLOR)

  const deathGame = createPacmanGame({
    maze: stage,
    pacmanSpawn: { row: 1, col: 1 },
    ghosts: [{ id: 'blinky', position: { row: 1, col: 2 } }],
    ghostMovement: 'stationary',
    initialLives: 2,
  })
  deathGame.handleKeyInput('ArrowRight')
  const midDeadSnap = deathGame.tick()
  assert.equal(midDeadSnap.pacman.status, 'dead')
  assert.equal(midDeadSnap.gameStatus, 'playing')
  assert.equal(getPacmanArcFill(midDeadSnap), PACMAN_DEAD_COLOR)

  const respawnSnap = deathGame.respawn()
  assert.equal(respawnSnap.pacman.status, 'alive')
  assert.equal(getPacmanArcFill(respawnSnap), PACMAN_ALIVE_COLOR)

  deathGame.handleKeyInput('ArrowRight')
  const gameOverSnap = deathGame.tick()
  assert.equal(gameOverSnap.gameStatus, 'game-over')
  assert.equal(getPacmanArcFill(gameOverSnap), PACMAN_DEAD_COLOR)
  assert.equal(getPacmanArcFill(deathGame.reset()), PACMAN_ALIVE_COLOR)
})
