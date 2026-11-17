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
  PACMAN_SPAWN_POSITION,
  attachKeyboardControls,
  checkGhostCollision,
  chooseGhostDirection,
  createPacmanGame,
  mapKeyToDirection,
  renderGameToCanvas,
  stepGhostState,
  type GhostState,
  type KeyboardEventLike,
  type KeyboardEventTargetLike,
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
