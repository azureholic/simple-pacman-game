import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { DEMO_SEED } from '../src/seed/demoSeed.ts'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(currentDir, '..')

test('DEMO_SEED defines synthetic classic arcade dimensions with zero backend or persistence dependencies', () => {
  assert.equal(DEMO_SEED.levelId, 'classic-maze-seed')
  assert.equal(DEMO_SEED.columns, 28)
  assert.equal(DEMO_SEED.rows, 31)
  assert.equal(DEMO_SEED.tileSizePx, 20)
  assert.equal(DEMO_SEED.canvasWidth, 560)
  assert.equal(DEMO_SEED.canvasHeight, 620)
  assert.equal(DEMO_SEED.backendRequired, false)
  assert.equal(DEMO_SEED.persistence, 'none')
  assert.equal(DEMO_SEED.audio, 'disabled')
  assert.equal(Object.isFrozen(DEMO_SEED), true)
})

test('App component renders desktop placeholder screen and accessible game canvas without runtime errors', async () => {
  const vite = await createServer({
    root: webRoot,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  })

  try {
    const mod = await vite.ssrLoadModule('/src/App.tsx')
    const html = renderToStaticMarkup(createElement(mod.App))

    assert.match(html, /data-testid="pacman-app"/)
    assert.match(html, />Simple Pacman<\/h1>/)
    assert.match(html, /data-testid="game-canvas"/)
    assert.match(html, /width="560"/)
    assert.match(html, /height="620"/)
    assert.match(html, /role="img"/)
    assert.match(html, /aria-label="Simple Pacman placeholder game canvas/)
    assert.match(html, /Static SPA · Ready/)
  } finally {
    await vite.close()
  }
})

test('Frontend source contains no backend network calls, storage persistence, or audio APIs', () => {
  const srcFiles = [
    path.join(webRoot, 'src', 'main.tsx'),
    path.join(webRoot, 'src', 'App.tsx'),
    path.join(webRoot, 'src', 'seed', 'demoSeed.ts'),
  ]

  for (const filePath of srcFiles) {
    const source = fs.readFileSync(filePath, 'utf8')
    assert.doesNotMatch(source, /\bfetch\s*\(/)
    assert.doesNotMatch(source, /\bXMLHttpRequest\b/)
    assert.doesNotMatch(source, /\blocalStorage\b/)
    assert.doesNotMatch(source, /\bsessionStorage\b/)
    assert.doesNotMatch(source, /\bAudioContext\b/)
  }
})
