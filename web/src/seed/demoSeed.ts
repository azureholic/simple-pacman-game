export interface DemoSeedMetadata {
  readonly levelId: string
  readonly levelName: string
  readonly columns: number
  readonly rows: number
  readonly tileSizePx: number
  readonly canvasWidth: number
  readonly canvasHeight: number
  readonly layout: readonly string[]
  readonly mode: 'ready'
  readonly backendRequired: false
  readonly persistence: 'none'
  readonly audio: 'disabled'
}

const COLUMNS = 28
const ROWS = 31
const TILE_SIZE_PX = 20

const CLASSIC_MAZE_LAYOUT: readonly string[] = Object.freeze([
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##### ## #####.######',
  '######.##### ## #####.######',
  '######.##          ##.######',
  '######.## ###  ### ##.######',
  '######.## #      # ##.######',
  '#     .   #      #   .     #',
  '######.## #      # ##.######',
  '######.## ######## ##.######',
  '######.##          ##.######',
  '######.## ######## ##.######',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##.......  .......##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
])

export const DEMO_SEED: DemoSeedMetadata = Object.freeze({
  levelId: 'classic-maze-seed',
  levelName: 'Classic Arcade Maze',
  columns: COLUMNS,
  rows: ROWS,
  tileSizePx: TILE_SIZE_PX,
  canvasWidth: COLUMNS * TILE_SIZE_PX,
  canvasHeight: ROWS * TILE_SIZE_PX,
  layout: CLASSIC_MAZE_LAYOUT,
  mode: 'ready',
  backendRequired: false,
  persistence: 'none',
  audio: 'disabled',
})
