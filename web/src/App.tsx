import { useEffect, useRef, useState } from 'react'
import {
  attachKeyboardControls,
  createPacmanGame,
  renderGameToCanvas,
  type PacmanGameEngine,
  type PacmanGameSnapshot,
} from './game/pacmanEngine.ts'
import {
  CLASSIC_MAZE,
  getPelletSpawnPositions,
  isWallTile,
  type MazeCanvasContext,
  type MazeDefinition,
} from './maze/classicMaze.ts'
import { DEMO_SEED } from './seed/demoSeed.ts'

const DEFAULT_TICK_INTERVAL_MS = 150

interface MazeMetrics {
  readonly width: number
  readonly height: number
  readonly wallTileCount: number
  readonly corridorTileCount: number
  readonly pelletSpawnCount: number
}

function computeMazeMetrics(maze: MazeDefinition): MazeMetrics {
  let wallTileCount = 0
  let corridorTileCount = 0

  for (let row = 0; row < maze.rows; row += 1) {
    for (let col = 0; col < maze.columns; col += 1) {
      if (isWallTile(maze, row, col)) {
        wallTileCount += 1
      } else {
        corridorTileCount += 1
      }
    }
  }

  return {
    width: maze.columns * maze.tileSizePx,
    height: maze.rows * maze.tileSizePx,
    wallTileCount,
    corridorTileCount,
    pelletSpawnCount: getPelletSpawnPositions(maze).length,
  }
}

const CLASSIC_MAZE_METRICS: MazeMetrics = computeMazeMetrics(CLASSIC_MAZE)

function getCanvas2dContext(canvas: HTMLCanvasElement | null): MazeCanvasContext | null {
  if (!canvas) {
    return null
  }

  try {
    return canvas.getContext('2d')
  } catch {
    return null
  }
}

export interface AppProps {
  readonly game?: PacmanGameEngine
  readonly tickIntervalMs?: number
}

export function App({ game, tickIntervalMs = DEFAULT_TICK_INTERVAL_MS }: AppProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fallbackGameRef = useRef<PacmanGameEngine | null>(null)
  if (game === undefined && fallbackGameRef.current === null) {
    fallbackGameRef.current = createPacmanGame()
  }

  const activeGame = game ?? fallbackGameRef.current!
  const activeMaze = activeGame.getMaze()
  const mazeMetrics = activeMaze === CLASSIC_MAZE ? CLASSIC_MAZE_METRICS : computeMazeMetrics(activeMaze)

  const [trackedState, setTrackedState] = useState<{
    readonly engine: PacmanGameEngine
    readonly snapshot: PacmanGameSnapshot
  }>(() => ({
    engine: activeGame,
    snapshot: activeGame.getSnapshot(),
  }))

  const snapshot =
    trackedState.engine === activeGame ? trackedState.snapshot : activeGame.getSnapshot()

  const effectiveTickIntervalMs =
    typeof tickIntervalMs === 'number' && Number.isFinite(tickIntervalMs) && tickIntervalMs > 0
      ? tickIntervalMs
      : DEFAULT_TICK_INTERVAL_MS

  useEffect(() => {
    const initialSnapshot = activeGame.getSnapshot()
    setTrackedState((prev) =>
      prev.engine === activeGame && prev.snapshot.tick === initialSnapshot.tick
        ? prev
        : { engine: activeGame, snapshot: initialSnapshot },
    )

    const initialCtx = getCanvas2dContext(canvasRef.current)
    if (initialCtx) {
      renderGameToCanvas(initialCtx, initialSnapshot, activeGame.getMaze())
    }

    const detachKeyboard = attachKeyboardControls(window, activeGame)
    const intervalId = window.setInterval(() => {
      const nextSnapshot = activeGame.tick()
      setTrackedState({ engine: activeGame, snapshot: nextSnapshot })

      const tickCtx = getCanvas2dContext(canvasRef.current)
      if (tickCtx) {
        renderGameToCanvas(tickCtx, nextSnapshot, activeGame.getMaze())
      }
    }, effectiveTickIntervalMs)

    return () => {
      detachKeyboard()
      window.clearInterval(intervalId)
    }
  }, [activeGame, effectiveTickIntervalMs])

  return (
    <main className="app-shell" data-testid="pacman-app">
      <header className="app-header">
        <h1 className="app-title">Simple Pacman</h1>
        <span className="status-badge" data-testid="runtime-mode">
          Static SPA · Ready
        </span>
      </header>

      <section className="stage-panel" aria-labelledby="stage-heading">
        <h2 id="stage-heading" className="stage-heading">
          {DEMO_SEED.levelName} Stage
        </h2>
        <canvas
          ref={canvasRef}
          className="game-canvas"
          data-testid="game-canvas"
          data-level-id={activeMaze.levelId}
          data-maze-cols={activeMaze.columns}
          data-maze-rows={activeMaze.rows}
          data-wall-tiles={mazeMetrics.wallTileCount}
          data-corridor-tiles={mazeMetrics.corridorTileCount}
          data-pellet-spawns={mazeMetrics.pelletSpawnCount}
          data-pacman-row={snapshot.pacman.position.row}
          data-pacman-col={snapshot.pacman.position.col}
          data-pacman-status={snapshot.pacman.status}
          width={mazeMetrics.width}
          height={mazeMetrics.height}
          role="img"
          aria-label={`Simple Pacman placeholder game canvas, ${mazeMetrics.width} by ${mazeMetrics.height} pixels, ${DEMO_SEED.levelName} ready`}
        />
        <p className="stage-caption" role="status" data-testid="placeholder-status">
          Desktop viewport ready ({activeMaze.columns} × {activeMaze.rows} tiles · {mazeMetrics.width} ×{' '}
          {mazeMetrics.height} px · client-side only)
        </p>
      </section>
    </main>
  )
}

export default App
