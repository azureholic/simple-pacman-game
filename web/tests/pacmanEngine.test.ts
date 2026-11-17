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
  type MazeCanvasContext,
  type MazeDefinition,
} from '../src/maze/classicMaze.ts'
import {
  DEFAULT_GHOST_SPAWNS,
  PACMAN_SPAWN_POSITION,
  attachKeyboardControls,
  checkGhostCollision,
  createPacmanGame,
  mapKeyToDirection,
  renderGameToCanvas,
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
    const aliveHtml = renderToStaticMarkup(createElement(mod.App, { game: aliveGame }))
    assert.match(aliveHtml, /data-pacman-row="23"/)
    assert.match(aliveHtml, /data-pacman-col="13"/)
    assert.match(aliveHtml, /data-pacman-status="alive"/)

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
