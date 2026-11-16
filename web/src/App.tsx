import { useEffect, useRef } from 'react'
import { DEMO_SEED } from './seed/demoSeed.ts'

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

    ctx.fillStyle = '#020617'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.strokeStyle = '#1d4ed8'
    ctx.lineWidth = 4
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)

    ctx.fillStyle = '#fde047'
    ctx.font = 'bold 24px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('READY!', canvas.width / 2, canvas.height / 2 - 12)

    ctx.fillStyle = '#cbd5e1'
    ctx.font = '14px system-ui, sans-serif'
    ctx.fillText(
      `${DEMO_SEED.levelName} (${DEMO_SEED.columns}x${DEMO_SEED.rows})`,
      canvas.width / 2,
      canvas.height / 2 + 20,
    )
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
          width={DEMO_SEED.canvasWidth}
          height={DEMO_SEED.canvasHeight}
          role="img"
          aria-label={`Simple Pacman placeholder game canvas, ${DEMO_SEED.canvasWidth} by ${DEMO_SEED.canvasHeight} pixels, ${DEMO_SEED.levelName} ready`}
        />
        <p className="stage-caption" role="status" data-testid="placeholder-status">
          Desktop viewport ready ({DEMO_SEED.columns} × {DEMO_SEED.rows} tiles · {DEMO_SEED.canvasWidth} ×{' '}
          {DEMO_SEED.canvasHeight} px · client-side only)
        </p>
      </section>
    </main>
  )
}

export default App
