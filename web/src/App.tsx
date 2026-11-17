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

function formatGameStatusLabel(snapshot: PacmanGameSnapshot): string {
  if (snapshot.gameStatus === 'won') {
    return 'You Win! All pellets collected.'
  }

  if (snapshot.gameStatus === 'game-over') {
    return 'Game Over'
  }

  if (snapshot.pacman.status === 'dead' && snapshot.lives > 0) {
    return 'Life lost — click Continue Life to respawn'
  }

  return 'Active — use Arrow keys to move'
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
      prev.engine === activeGame &&
      prev.snapshot.tick === initialSnapshot.tick &&
      prev.snapshot.score === initialSnapshot.score &&
      prev.snapshot.lives === initialSnapshot.lives &&
      prev.snapshot.remainingPelletCount === initialSnapshot.remainingPelletCount &&
      prev.snapshot.gameStatus === initialSnapshot.gameStatus &&
      prev.snapshot.pacman.status === initialSnapshot.pacman.status
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

  const handleRespawn = (): void => {
    const nextSnapshot = activeGame.respawn()
    setTrackedState({ engine: activeGame, snapshot: nextSnapshot })

    const ctx = getCanvas2dContext(canvasRef.current)
    if (ctx) {
      renderGameToCanvas(ctx, nextSnapshot, activeGame.getMaze())
    }
  }

  const handleRestart = (): void => {
    const nextSnapshot = activeGame.reset()
    setTrackedState({ engine: activeGame, snapshot: nextSnapshot })

    const ctx = getCanvas2dContext(canvasRef.current)
    if (ctx) {
      renderGameToCanvas(ctx, nextSnapshot, activeGame.getMaze())
    }
  }

  const canRespawn =
    snapshot.gameStatus === 'playing' && snapshot.pacman.status === 'dead' && snapshot.lives > 0

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

        <div className="hud-bar" aria-label="Game scoreboard and controls">
          <div className="hud-stats">
            <span className="hud-stat" data-testid="score-display" data-score={snapshot.score}>
              Score: {snapshot.score}
            </span>
            <span className="hud-stat" data-testid="lives-display" data-lives={snapshot.lives}>
              Lives: {snapshot.lives}
            </span>
            <span
              className="hud-stat"
              data-testid="pellets-display"
              data-remaining-pellets={snapshot.remainingPelletCount}
            >
              Pellets: {snapshot.remainingPelletCount}
            </span>
          </div>

          <div className="hud-status-row">
            <span
              className={`hud-status hud-status-${snapshot.gameStatus}`}
              role="status"
              data-testid="game-status"
              data-game-status={snapshot.gameStatus}
            >
              {formatGameStatusLabel(snapshot)}
            </span>

            <div className="hud-actions">
              {canRespawn && (
                <button
                  type="button"
                  className="hud-button hud-button-primary"
                  data-testid="respawn-button"
                  onClick={handleRespawn}
                >
                  Continue Life
                </button>
              )}
              <button
                type="button"
                className="hud-button"
                data-testid="restart-button"
                onClick={handleRestart}
              >
                Restart Game
              </button>
            </div>
          </div>
        </div>

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
          data-ghost-count={snapshot.ghosts.length}
          data-score={snapshot.score}
          data-lives={snapshot.lives}
          data-remaining-pellets={snapshot.remainingPelletCount}
          data-game-status={snapshot.gameStatus}
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
