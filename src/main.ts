import Phaser from 'phaser'
import './style.css'

const TILE_SIZE = 32
const MAP_W = 72
const MAP_H = 48

type TileType = 'plains' | 'forest' | 'mountain' | 'river' | 'swamp' | 'snow' | 'road' | 'city_ground'
type Faction = 'player' | 'enemy'
type UnitAnim = 'idle' | 'walk' | 'attack'

interface Unit {
  id: number
  faction: Faction
  sprite: Phaser.GameObjects.Image
  ring: Phaser.GameObjects.Image
  tileX: number
  tileY: number
  worldX: number
  worldY: number
  hp: number
  damage: number
  rangeTiles: number
  attackCooldown: number
  moveSpeed: number
  destination: Phaser.Math.Vector2 | null
  path: Phaser.Math.Vector2[]
  state: UnitAnim
  pathingTimer: number
  moveAnimTick: number
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app container')

app.innerHTML = `
  <div id="hud">
    <h1>Pixel Wars</h1>
    <div class="grid">
      <span>Population</span><span id="ui-pop">0</span>
      <span>Money</span><span id="ui-money">0</span>
      <span>Army Size</span><span id="ui-army">0</span>
      <span>Selected</span><span id="ui-selected">0</span>
    </div>
    <div id="selected-panel">Selected units: none</div>
  </div>
  <div id="controls-hint">
    WASD/Arrows: camera<br>
    Wheel: zoom<br>
    Left drag: select<br>
    Right click: move
  </div>
`

const uiPop = document.querySelector<HTMLSpanElement>('#ui-pop')!
const uiMoney = document.querySelector<HTMLSpanElement>('#ui-money')!
const uiArmy = document.querySelector<HTMLSpanElement>('#ui-army')!
const uiSelected = document.querySelector<HTMLSpanElement>('#ui-selected')!
const uiSelectedPanel = document.querySelector<HTMLDivElement>('#selected-panel')!

const tileTypes: TileType[] = ['plains', 'forest', 'mountain', 'river', 'swamp', 'snow', 'road', 'city_ground']
const passableTiles: Record<TileType, boolean> = {
  plains: true,
  forest: true,
  mountain: false,
  river: false,
  swamp: true,
  snow: true,
  road: true,
  city_ground: true,
}

class BattleScene extends Phaser.Scene {
  private map: TileType[][] = []
  private units: Unit[] = []
  private selected = new Set<number>()
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key }
  private dragStart: Phaser.Math.Vector2 | null = null
  private dragCurrent: Phaser.Math.Vector2 | null = null
  private dragGraphics!: Phaser.GameObjects.Graphics
  private minimap!: Phaser.GameObjects.Graphics
  private weather!: Phaser.GameObjects.Image
  private weatherFrame = 0
  private weatherTicker = 0
  private money = 450
  private population = 35
  private nextUnitId = 1

  constructor() {
    super('battle')
  }

  preload() {
    for (const t of tileTypes) this.load.image(`tile-${t}`, `/assets/generated/tiles/${t}.png`)
    this.load.image('selection-ring', '/assets/generated/effects/selection_ring.png')
    this.load.image('bullet', '/assets/generated/effects/bullet.png')
    this.load.image('explosion-0', '/assets/generated/effects/explosion_0.png')
    this.load.image('explosion-1', '/assets/generated/effects/explosion_1.png')
    this.load.image('explosion-2', '/assets/generated/effects/explosion_2.png')
    this.load.image('explosion-3', '/assets/generated/effects/explosion_3.png')
    this.load.image('explosion-4', '/assets/generated/effects/explosion_4.png')
    this.load.image('explosion-5', '/assets/generated/effects/explosion_5.png')
    for (const faction of ['player', 'enemy'] as const) {
      for (const stance of ['idle', 'walk', 'attack'] as const) {
        for (let i = 0; i < 4; i += 1) {
          this.load.image(`u-${faction}-${stance}-${i}`, `/assets/generated/units/${faction}/infantry_${stance}_${i}.png`)
        }
      }
    }
    for (let i = 0; i < 4; i += 1) this.load.image(`weather-rain-${i}`, `/assets/generated/weather/rain_${i}.png`)
    this.load.image('fog-of-war', '/assets/generated/weather/fog_of_war.png')
  }

  create() {
    this.input.mouse?.disableContextMenu()
    this.cameras.main.setBounds(0, 0, MAP_W * TILE_SIZE, MAP_H * TILE_SIZE)
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd

    this.makeMap()
    this.drawMap()
    this.spawnUnits()

    const fog = this.add.tileSprite(0, 0, MAP_W * TILE_SIZE, MAP_H * TILE_SIZE, 'fog-of-war')
    fog.setOrigin(0, 0).setDepth(20).setAlpha(0.25)
    fog.setScrollFactor(1)

    this.weather = this.add.image(0, 0, 'weather-rain-0').setOrigin(0, 0).setDepth(30).setAlpha(0.32)
    this.weather.setDisplaySize(MAP_W * TILE_SIZE, MAP_H * TILE_SIZE)

    this.dragGraphics = this.add.graphics().setDepth(40).setScrollFactor(0)
    this.minimap = this.add.graphics().setDepth(50).setScrollFactor(0)
    this.drawMinimap()

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        this.commandMove(pointer.worldX, pointer.worldY)
      } else {
        this.dragStart = new Phaser.Math.Vector2(pointer.x, pointer.y)
        this.dragCurrent = new Phaser.Math.Vector2(pointer.x, pointer.y)
      }
    })

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.dragStart) this.dragCurrent = new Phaser.Math.Vector2(pointer.x, pointer.y)
    })

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.dragStart || !this.dragCurrent) return
      const dragDistance = Phaser.Math.Distance.BetweenPoints(this.dragStart, this.dragCurrent)
      if (dragDistance < 5) {
        this.selectByClick(pointer.worldX, pointer.worldY)
      } else {
        this.selectByDrag(this.dragStart, this.dragCurrent)
      }
      this.dragStart = null
      this.dragCurrent = null
      this.dragGraphics.clear()
      this.updateUi()
    })

    this.input.on('wheel', (_p: unknown, _go: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main
      cam.zoom = Phaser.Math.Clamp(cam.zoom - dy * 0.001, 0.6, 2)
    })

    this.time.addEvent({
      delay: 4000,
      loop: true,
      callback: () => {
        this.money += 6 + this.units.filter((u) => u.faction === 'player').length
      },
    })

    this.updateUi()
  }

  update(_time: number, delta: number) {
    this.handleCamera(delta / 1000)
    this.updateDragVisual()
    this.updateUnits(delta / 1000)
    this.updateWeather(delta / 1000)
    this.drawMinimap()
    this.updateUi()
  }

  private makeMap() {
    const rows: TileType[][] = []
    for (let y = 0; y < MAP_H; y += 1) {
      const row: TileType[] = []
      for (let x = 0; x < MAP_W; x += 1) {
        let t: TileType = 'plains'
        if (y > 16 && y < 20 && x > 6 && x < 62) t = 'river'
        else if ((x + y) % 11 === 0) t = 'forest'
        else if ((x * 3 + y) % 17 === 0) t = 'swamp'
        else if (y < 6 || x < 6) t = 'snow'
        else if ((x - y + 40) % 23 === 0) t = 'mountain'
        else if (x > 30 && x < 40 && y > 24 && y < 30) t = 'city_ground'
        else if (x % 9 === 0 || y % 10 === 0) t = 'road'
        row.push(t)
      }
      rows.push(row)
    }
    this.map = rows
  }

  private drawMap() {
    for (let y = 0; y < MAP_H; y += 1) {
      for (let x = 0; x < MAP_W; x += 1) {
        const t = this.map[y][x]
        this.add.image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, `tile-${t}`).setDepth(1)
      }
    }
  }

  private createUnit(faction: Faction, x: number, y: number) {
    const key = `u-${faction}-idle-0`
    const sprite = this.add.image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, key).setDepth(10)
    const ring = this.add.image(sprite.x, sprite.y, 'selection-ring').setDepth(9).setVisible(false)
    this.units.push({
      id: this.nextUnitId++,
      faction,
      sprite,
      ring,
      tileX: x,
      tileY: y,
      worldX: sprite.x,
      worldY: sprite.y,
      hp: 32,
      damage: 11,
      rangeTiles: 2.6,
      attackCooldown: 0,
      moveSpeed: 72,
      destination: null,
      path: [],
      state: 'idle',
      pathingTimer: 0,
      moveAnimTick: 0,
    })
  }

  private spawnUnits() {
    for (let i = 0; i < 10; i += 1) this.createUnit('player', 8 + (i % 5), 28 + Math.floor(i / 5))
    for (let i = 0; i < 12; i += 1) this.createUnit('enemy', 55 + (i % 6), 10 + Math.floor(i / 6))
  }

  private handleCamera(dt: number) {
    const cam = this.cameras.main
    const speed = 520 * dt / cam.zoom
    if (this.wasd.A.isDown || this.cursors.left.isDown) cam.scrollX -= speed
    if (this.wasd.D.isDown || this.cursors.right.isDown) cam.scrollX += speed
    if (this.wasd.W.isDown || this.cursors.up.isDown) cam.scrollY -= speed
    if (this.wasd.S.isDown || this.cursors.down.isDown) cam.scrollY += speed
  }

  private selectByClick(worldX: number, worldY: number) {
    this.selected.clear()
    for (const u of this.units) {
      if (u.faction !== 'player') continue
      if (Phaser.Math.Distance.Between(worldX, worldY, u.sprite.x, u.sprite.y) < 18) this.selected.add(u.id)
    }
    this.refreshSelection()
  }

  private selectByDrag(start: Phaser.Math.Vector2, end: Phaser.Math.Vector2) {
    const cam = this.cameras.main
    const x1 = Math.min(start.x, end.x)
    const y1 = Math.min(start.y, end.y)
    const x2 = Math.max(start.x, end.x)
    const y2 = Math.max(start.y, end.y)
    const worldTL = cam.getWorldPoint(x1, y1)
    const worldBR = cam.getWorldPoint(x2, y2)
    this.selected.clear()
    for (const u of this.units) {
      if (u.faction !== 'player') continue
      if (u.sprite.x >= worldTL.x && u.sprite.x <= worldBR.x && u.sprite.y >= worldTL.y && u.sprite.y <= worldBR.y) {
        this.selected.add(u.id)
      }
    }
    this.refreshSelection()
  }

  private refreshSelection() {
    for (const u of this.units) u.ring.setVisible(this.selected.has(u.id))
  }

  private updateDragVisual() {
    this.dragGraphics.clear()
    if (!this.dragStart || !this.dragCurrent) return
    const x = Math.min(this.dragStart.x, this.dragCurrent.x)
    const y = Math.min(this.dragStart.y, this.dragCurrent.y)
    const w = Math.abs(this.dragStart.x - this.dragCurrent.x)
    const h = Math.abs(this.dragStart.y - this.dragCurrent.y)
    this.dragGraphics.lineStyle(1, 0x7be4ff, 0.95)
    this.dragGraphics.fillStyle(0x3aa3c9, 0.2)
    this.dragGraphics.fillRect(x, y, w, h)
    this.dragGraphics.strokeRect(x, y, w, h)
  }

  private commandMove(worldX: number, worldY: number) {
    const targetX = Phaser.Math.Clamp(Math.floor(worldX / TILE_SIZE), 0, MAP_W - 1)
    const targetY = Phaser.Math.Clamp(Math.floor(worldY / TILE_SIZE), 0, MAP_H - 1)
    const selectedUnits = this.units.filter((u) => this.selected.has(u.id) && u.faction === 'player')
    if (!selectedUnits.length) return
    selectedUnits.forEach((unit, i) => {
      const column = i % 4
      const row = Math.floor(i / 4)
      const tx = Phaser.Math.Clamp(targetX + column - 1, 0, MAP_W - 1)
      const ty = Phaser.Math.Clamp(targetY + row - 1, 0, MAP_H - 1)
      unit.destination = new Phaser.Math.Vector2(tx, ty)
      unit.path = this.findPath(unit.tileX, unit.tileY, tx, ty)
      unit.state = unit.path.length > 0 ? 'walk' : 'idle'
    })
  }

  private updateUnits(dt: number) {
    const aliveUnits = this.units.filter((u) => u.hp > 0)
    for (const u of aliveUnits) {
      u.attackCooldown = Math.max(0, u.attackCooldown - dt)
      u.pathingTimer += dt
      if (u.destination && u.path.length === 0 && u.pathingTimer > 0.65) {
        u.path = this.findPath(u.tileX, u.tileY, u.destination.x, u.destination.y)
        u.pathingTimer = 0
      }

      if (u.path.length > 0) {
        const next = u.path[0]
        const tx = next.x * TILE_SIZE + TILE_SIZE / 2
        const ty = next.y * TILE_SIZE + TILE_SIZE / 2
        const dx = tx - u.worldX
        const dy = ty - u.worldY
        const dist = Math.hypot(dx, dy)
        if (dist < 1) {
          u.tileX = next.x
          u.tileY = next.y
          u.worldX = tx
          u.worldY = ty
          u.path.shift()
        } else {
          const step = Math.min(u.moveSpeed * dt, dist)
          u.worldX += (dx / dist) * step
          u.worldY += (dy / dist) * step
        }
        u.state = 'walk'
        u.moveAnimTick += dt * 8
        const frame = Math.floor(u.moveAnimTick) % 4
        u.sprite.setTexture(`u-${u.faction}-walk-${frame}`)
      } else {
        u.state = 'idle'
        const idleFrame = Math.floor((performance.now() / 400) % 4)
        u.sprite.setTexture(`u-${u.faction}-idle-${idleFrame}`)
      }

      u.sprite.setPosition(u.worldX, u.worldY)
      u.ring.setPosition(u.worldX, u.worldY)
    }

    const enemies = aliveUnits.filter((u) => u.faction === 'enemy')
    const players = aliveUnits.filter((u) => u.faction === 'player')

    for (const e of enemies) {
      if (e.path.length === 0 && e.destination === null) {
        const near = players[Math.floor(Math.random() * Math.max(1, players.length))]
        if (near) {
          e.destination = new Phaser.Math.Vector2(near.tileX + Phaser.Math.Between(-2, 2), near.tileY + Phaser.Math.Between(-2, 2))
          e.path = this.findPath(e.tileX, e.tileY, Phaser.Math.Clamp(e.destination.x, 0, MAP_W - 1), Phaser.Math.Clamp(e.destination.y, 0, MAP_H - 1))
        }
      }
    }

    for (const u of aliveUnits) {
      const opponents = u.faction === 'player' ? enemies : players
      let target: Unit | undefined
      let closest = Number.POSITIVE_INFINITY
      for (const op of opponents) {
        const distance = Phaser.Math.Distance.Between(u.worldX, u.worldY, op.worldX, op.worldY)
        if (distance < closest && distance <= u.rangeTiles * TILE_SIZE) {
          closest = distance
          target = op
        }
      }
      if (target && u.attackCooldown <= 0) {
        u.attackCooldown = 0.37
        u.state = 'attack'
        u.sprite.setTexture(`u-${u.faction}-attack-${Phaser.Math.Between(0, 3)}`)
        this.fireProjectile(u, target)
      }
    }

    for (const u of this.units) {
      if (u.hp > 0) continue
      if (this.selected.has(u.id)) this.selected.delete(u.id)
      u.sprite.destroy()
      u.ring.destroy()
    }
    this.units = this.units.filter((u) => u.hp > 0)
  }

  private fireProjectile(attacker: Unit, defender: Unit) {
    const bullet = this.add.image(attacker.worldX, attacker.worldY, 'bullet').setDepth(12)
    this.tweens.add({
      targets: bullet,
      x: defender.worldX,
      y: defender.worldY,
      duration: 120,
      ease: 'Linear',
      onComplete: () => {
        bullet.destroy()
        defender.hp -= attacker.damage
        this.showDamage(defender.worldX, defender.worldY, attacker.damage)
        if (defender.hp <= 0) this.playExplosion(defender.worldX, defender.worldY)
      },
    })
  }

  private showDamage(x: number, y: number, damage: number) {
    const txt = this.add.text(x - 6, y - 22, String(damage), {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#ff7f7f',
      stroke: '#1a1e24',
      strokeThickness: 3,
    }).setDepth(25)
    this.tweens.add({ targets: txt, y: y - 44, alpha: 0, duration: 420, onComplete: () => txt.destroy() })
  }

  private playExplosion(x: number, y: number) {
    let i = 0
    const exp = this.add.image(x, y, 'explosion-0').setDepth(24)
    this.time.addEvent({
      delay: 45,
      repeat: 5,
      callback: () => {
        exp.setTexture(`explosion-${i}`)
        i += 1
        if (i > 5) exp.destroy()
      },
    })
  }

  private findPath(sx: number, sy: number, tx: number, ty: number): Phaser.Math.Vector2[] {
    if (!this.inBounds(tx, ty) || !passableTiles[this.map[ty][tx]]) return []
    const queue: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(sx, sy)]
    const cameFrom = new Map<string, Phaser.Math.Vector2 | null>()
    cameFrom.set(`${sx},${sy}`, null)
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]

    while (queue.length) {
      const current = queue.shift()!
      if (current.x === tx && current.y === ty) break
      for (const [dx, dy] of dirs) {
        const nx = current.x + dx
        const ny = current.y + dy
        const key = `${nx},${ny}`
        if (!this.inBounds(nx, ny) || cameFrom.has(key) || !passableTiles[this.map[ny][nx]]) continue
        cameFrom.set(key, current)
        queue.push(new Phaser.Math.Vector2(nx, ny))
      }
    }

    const endKey = `${tx},${ty}`
    if (!cameFrom.has(endKey)) return []
    const result: Phaser.Math.Vector2[] = []
    let cursor: Phaser.Math.Vector2 | null = new Phaser.Math.Vector2(tx, ty)
    while (cursor && !(cursor.x === sx && cursor.y === sy)) {
      result.push(cursor)
      cursor = cameFrom.get(`${cursor.x},${cursor.y}`) ?? null
    }
    return result.reverse()
  }

  private inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H
  }

  private updateWeather(dt: number) {
    this.weatherTicker += dt
    if (this.weatherTicker >= 0.2) {
      this.weatherTicker = 0
      this.weatherFrame = (this.weatherFrame + 1) % 4
      this.weather.setTexture(`weather-rain-${this.weatherFrame}`)
    }
  }

  private drawMinimap() {
    const cam = this.cameras.main
    const width = 220
    const height = 145
    const x = this.scale.width - width - 12
    const y = this.scale.height - height - 12
    this.minimap.clear()
    this.minimap.fillStyle(0x0d151f, 0.85).fillRoundedRect(x, y, width, height, 8)
    const sx = width / MAP_W
    const sy = height / MAP_H
    for (let py = 0; py < MAP_H; py += 3) {
      for (let px = 0; px < MAP_W; px += 3) {
        const t = this.map[py][px]
        const color =
          t === 'river' ? 0x3d74bd : t === 'mountain' ? 0x778088 : t === 'forest' ? 0x4f9349 : t === 'road' ? 0x9d8a67 : 0x6ea350
        this.minimap.fillStyle(color, 0.82)
        this.minimap.fillRect(x + px * sx, y + py * sy, sx * 2, sy * 2)
      }
    }
    for (const u of this.units) {
      this.minimap.fillStyle(u.faction === 'player' ? 0x3f9dff : 0xff6368, 1)
      this.minimap.fillRect(x + u.tileX * sx, y + u.tileY * sy, 3, 3)
    }

    const viewX = x + (cam.scrollX / (MAP_W * TILE_SIZE)) * width
    const viewY = y + (cam.scrollY / (MAP_H * TILE_SIZE)) * height
    const viewW = (cam.width / cam.zoom / (MAP_W * TILE_SIZE)) * width
    const viewH = (cam.height / cam.zoom / (MAP_H * TILE_SIZE)) * height
    this.minimap.lineStyle(1, 0xd6ecff, 0.9).strokeRect(viewX, viewY, viewW, viewH)
  }

  private updateUi() {
    const playerArmy = this.units.filter((u) => u.faction === 'player').length
    uiPop.textContent = String(this.population)
    uiMoney.textContent = String(this.money)
    uiArmy.textContent = String(playerArmy)
    uiSelected.textContent = String(this.selected.size)
    if (this.selected.size === 0) {
      uiSelectedPanel.textContent = 'Selected units: none'
      return
    }
    const selectedUnits = this.units.filter((u) => this.selected.has(u.id))
    const lines = selectedUnits.slice(0, 6).map((u) => `Infantry #${u.id} HP ${Math.max(0, u.hp)}`)
    uiSelectedPanel.textContent = `Selected units: ${lines.join(' | ')}${selectedUnits.length > 6 ? ' ...' : ''}`
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#101723',
  pixelArt: true,
  scene: [BattleScene],
})
