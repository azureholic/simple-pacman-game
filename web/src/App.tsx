import { useEffect, useRef } from 'react'
import {
  CLASSIC_MAZE,
  getPelletSpawnPositions,
  isWallTile,
  renderMazeToCanvas,
} from './maze/classicMaze.ts'
import { DEMO_SEED } from './seed/demoSeed.ts'

const CANVAS_WIDTH = CLASSIC_MAZE.columns * CLASSIC_MAZE.tileSizePx
const CANVAS_HEIGHT = CLASSIC_MAZE.rows * CLASSIC_MAZE.tileSizePx

let wallTiles = 0
let corridorTiles = 0
for (let row = 0; row < CLASSIC_MAZE.rows; row += 1) {
  for (let col = 0; col < CLASSIC_MAZE.columns; col += 1) {
    if (isWallTile(CLASSIC_MAZE, row, col)) {
      wallTiles += 1
    } else {
      corridorTiles += 1
    }
  }
}

const WALL_TILE_COUNT = wallTiles
const CORRIDOR_TILE_COUNT = corridorTiles
const PELLET_SPAWN_COUNT = getPelletSpawnPositions(CLASSIC_MAZE).length

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = canvas.getContext('2d')
    } catch {
      ctx = null
    }

    if (!ctx) {
      return
    }

    renderMazeToCanvas(ctx, CLASSIC_MAZE)
  }, [])

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
          data-level-id={CLASSIC_MAZE.levelId}
          data-maze-cols={CLASSIC_MAZE.columns}
          data-maze-rows={CLASSIC_MAZE.rows}
          data-wall-tiles={WALL_TILE_COUNT}
          data-corridor-tiles={CORRIDOR_TILE_COUNT}
          data-pellet-spawns={PELLET_SPAWN_COUNT}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          role="img"
          aria-label={`Simple Pacman placeholder game canvas, ${CANVAS_WIDTH} by ${CANVAS_HEIGHT} pixels, ${DEMO_SEED.levelName} ready`}
        />
        <p className="stage-caption" role="status" data-testid="placeholder-status">
          Desktop viewport ready ({CLASSIC_MAZE.columns} × {CLASSIC_MAZE.rows} tiles · {CANVAS_WIDTH} ×{' '}
          {CANVAS_HEIGHT} px · client-side only)
        </p>
      </section>
    </main>
  )
}

export default App
