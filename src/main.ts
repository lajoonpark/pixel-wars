import Phaser from 'phaser'
import './style.css'

const TILE_SIZE = 32
const MAP_W = 72
const MAP_H = 48
const BASE_POP_GROWTH_PER_SECOND = 0.17

const BUILDING_STATS = {
  farm: { cost: 90, buildTime: 3, incomePerSecond: 4.2, popCap: 0, blocksMovement: true },
  military_camp: { cost: 130, buildTime: 3.5, incomePerSecond: 0, popCap: 0, blocksMovement: true },
  city: { cost: 210, buildTime: 4.5, incomePerSecond: 0.5, popCap: 22, blocksMovement: true },
  defense_outpost: { cost: 150, buildTime: 3.5, incomePerSecond: 0, popCap: 0, blocksMovement: true },
  factory: { cost: 260, buildTime: 5, incomePerSecond: 1.25, popCap: 0, blocksMovement: true },
} as const

const BASE_POP_CAP = 46
const INFANTRY_COST = 40
const INFANTRY_POP_COST = 1

type TileType = 'plains' | 'forest' | 'mountain' | 'river' | 'swamp' | 'snow' | 'road' | 'city_ground'
type Faction = 'player' | 'enemy'
type UnitAnim = 'idle' | 'walk' | 'attack'
type BuildingType = keyof typeof BUILDING_STATS

type FactionState = {
  money: number
  population: number
  maxPopulation: number
  conscriptionPct: number
  militaryPopulation: number
  incomeRate: number
}

interface Unit {
  id: number
  faction: Faction
  unitType: 'infantry'
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
  popCost: number
}

interface Building {
  id: number
  faction: Faction
  type: BuildingType
  sprite: Phaser.GameObjects.Image
  tileX: number
  tileY: number
  hp: number
  constructionLeft: number
  attackCooldown: number
  animTick: number
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app container')

app.innerHTML = `
  <div id="hud">
    <h1>Pixel Wars</h1>
    <div class="grid">
      <span>Population</span><span id="ui-pop">0</span>
      <span>Capacity</span><span id="ui-pop-cap">0</span>
      <span>Money</span><span id="ui-money">0</span>
      <span>Income/sec</span><span id="ui-income">0</span>
      <span>Army Size</span><span id="ui-army">0</span>
      <span>Selected</span><span id="ui-selected">0</span>
    </div>
    <div class="conscription-row">
      <label for="ui-conscription">Conscription</label>
      <input id="ui-conscription" type="range" min="5" max="70" step="1" value="35" />
      <span id="ui-conscription-value">35%</span>
    </div>
    <div class="actions-row">
      <button id="ui-train">Train Infantry</button>
      <span id="ui-train-cost">$40 + 1 pop</span>
    </div>
    <div id="selected-panel">Selected units: none</div>
    <div id="build-panel">
      <p>Build</p>
      <div class="build-grid">
        <button data-build="farm">Farm ($90)</button>
        <button data-build="military_camp">Camp ($130)</button>
        <button data-build="city">City ($210)</button>
        <button data-build="defense_outpost">Outpost ($150)</button>
        <button data-build="factory">Factory ($260)</button>
        <button data-build="cancel">Cancel</button>
      </div>
      <div id="build-status">Build mode: none</div>
    </div>
  </div>
  <div id="controls-hint">
    WASD/Arrows: camera<br>
    Wheel: zoom<br>
    Left drag: select<br>
    Left click: place building in build mode<br>
    Right click: move
  </div>
`

const uiPop = document.querySelector<HTMLSpanElement>('#ui-pop')!
const uiPopCap = document.querySelector<HTMLSpanElement>('#ui-pop-cap')!
const uiMoney = document.querySelector<HTMLSpanElement>('#ui-money')!
const uiIncome = document.querySelector<HTMLSpanElement>('#ui-income')!
const uiArmy = document.querySelector<HTMLSpanElement>('#ui-army')!
const uiSelected = document.querySelector<HTMLSpanElement>('#ui-selected')!
const uiSelectedPanel = document.querySelector<HTMLDivElement>('#selected-panel')!
const uiBuildStatus = document.querySelector<HTMLDivElement>('#build-status')!
const uiTrain = document.querySelector<HTMLButtonElement>('#ui-train')!
const uiConscription = document.querySelector<HTMLInputElement>('#ui-conscription')!
const uiConscriptionValue = document.querySelector<HTMLSpanElement>('#ui-conscription-value')!
const buildButtons = [...document.querySelectorAll<HTMLButtonElement>('#build-panel [data-build]')]

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
  private buildings: Building[] = []
  private selected = new Set<number>()
  private selectedBuild: BuildingType | null = null
  private hoveredBuildTile: Phaser.Math.Vector2 | null = null
  private nextBuildingId = 1
  private nextUnitId = 1

  private nations: Record<Faction, FactionState> = {
    player: { money: 420, population: 34, maxPopulation: BASE_POP_CAP, conscriptionPct: 0.35, militaryPopulation: 0, incomeRate: 0 },
    enemy: { money: 420, population: 34, maxPopulation: BASE_POP_CAP, conscriptionPct: 0.35, militaryPopulation: 0, incomeRate: 0 },
  }

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key }
  private dragStart: Phaser.Math.Vector2 | null = null
  private dragCurrent: Phaser.Math.Vector2 | null = null
  private dragGraphics!: Phaser.GameObjects.Graphics
  private minimap!: Phaser.GameObjects.Graphics
  private placementGraphics!: Phaser.GameObjects.Graphics
  private weather!: Phaser.GameObjects.Image
  private weatherFrame = 0
  private weatherTicker = 0
  private aiBuildTimer = 0
  private aiTrainTimer = 0
  private aiAttackTimer = 0

  constructor() {
    super('battle')
  }

  preload() {
    for (const t of tileTypes) this.load.image(`tile-${t}`, `/assets/generated/tiles/${t}.png`)
    this.load.image('selection-ring', '/assets/generated/effects/selection_ring.png')
    this.load.image('bullet', '/assets/generated/effects/bullet.png')
    for (let i = 0; i < 6; i += 1) this.load.image(`explosion-${i}`, `/assets/generated/effects/explosion_${i}.png`)

    for (const buildingType of Object.keys(BUILDING_STATS) as BuildingType[]) {
      this.load.image(`building-${buildingType}`, `/assets/generated/buildings/${buildingType}.png`)
    }
    for (let i = 0; i < 4; i += 1) {
      this.load.image(`anim-factory-${i}`, `/assets/generated/buildings/anim/factory_working_${i}.png`)
      this.load.image(`anim-farm-${i}`, `/assets/generated/buildings/anim/farm_producing_${i}.png`)
      this.load.image(`anim-city-${i}`, `/assets/generated/buildings/anim/city_active_${i}.png`)
      this.load.image(`anim-outpost-${i}`, `/assets/generated/buildings/anim/outpost_firing_${i}.png`)
    }

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
    this.spawnStartingForces()

    const fog = this.add.tileSprite(0, 0, MAP_W * TILE_SIZE, MAP_H * TILE_SIZE, 'fog-of-war')
    fog.setOrigin(0, 0).setDepth(20).setAlpha(0.24)

    this.weather = this.add.image(0, 0, 'weather-rain-0').setOrigin(0, 0).setDepth(30).setAlpha(0.28)
    this.weather.setDisplaySize(MAP_W * TILE_SIZE, MAP_H * TILE_SIZE)

    this.dragGraphics = this.add.graphics().setDepth(40).setScrollFactor(0)
    this.minimap = this.add.graphics().setDepth(50).setScrollFactor(0)
    this.placementGraphics = this.add.graphics().setDepth(18)

    this.bindUiEvents()

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        this.commandMove(pointer.worldX, pointer.worldY)
        return
      }
      this.dragStart = new Phaser.Math.Vector2(pointer.x, pointer.y)
      this.dragCurrent = new Phaser.Math.Vector2(pointer.x, pointer.y)
    })

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.hoveredBuildTile = new Phaser.Math.Vector2(
        Phaser.Math.Clamp(Math.floor(pointer.worldX / TILE_SIZE), 0, MAP_W - 1),
        Phaser.Math.Clamp(Math.floor(pointer.worldY / TILE_SIZE), 0, MAP_H - 1),
      )
      if (this.dragStart) this.dragCurrent = new Phaser.Math.Vector2(pointer.x, pointer.y)
    })

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonReleased()) return
      if (this.selectedBuild) {
        const tx = Phaser.Math.Clamp(Math.floor(pointer.worldX / TILE_SIZE), 0, MAP_W - 1)
        const ty = Phaser.Math.Clamp(Math.floor(pointer.worldY / TILE_SIZE), 0, MAP_H - 1)
        this.tryPlaceBuilding('player', this.selectedBuild, tx, ty)
        this.dragStart = null
        this.dragCurrent = null
        this.dragGraphics.clear()
        return
      }

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
    })

    this.input.on('wheel', (_p: unknown, _go: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main
      cam.zoom = Phaser.Math.Clamp(cam.zoom - dy * 0.001, 0.6, 2)
    })

    this.updateUi()
  }

  update(_time: number, deltaMs: number) {
    const dt = deltaMs / 1000
    this.handleCamera(dt)
    this.updateDragVisual()
    this.updatePlacementVisual()
    this.updateEconomyAndPopulation(dt)
    this.updateBuildings(dt)
    this.updateUnits(dt)
    this.updateEnemyAi(dt)
    this.updateWeather(dt)
    this.drawMinimap()
    this.updateUi()
  }

  private bindUiEvents() {
    buildButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const selected = button.dataset.build
        if (!selected || selected === 'cancel') {
          this.selectedBuild = null
        } else {
          this.selectedBuild = selected as BuildingType
        }
        uiBuildStatus.textContent = `Build mode: ${this.selectedBuild ?? 'none'}`
      })
    })

    uiTrain.addEventListener('click', () => {
      const camp = this.buildings.find((b) => b.faction === 'player' && b.type === 'military_camp' && b.constructionLeft <= 0)
      if (!camp) {
        uiBuildStatus.textContent = 'Need a finished military camp to train infantry'
        return
      }
      if (!this.tryTrainInfantry('player', camp.tileX, camp.tileY)) {
        uiBuildStatus.textContent = 'Cannot train (money/pop/conscription cap)'
      }
    })

    uiConscription.addEventListener('input', () => {
      const pct = Number(uiConscription.value) / 100
      this.nations.player.conscriptionPct = pct
      uiConscriptionValue.textContent = `${Math.round(pct * 100)}%`
    })
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

  private spawnStartingForces() {
    this.placeBuildingDirect('player', 'city', 12, 31, 0)
    this.placeBuildingDirect('player', 'military_camp', 15, 29, 0)
    this.placeBuildingDirect('player', 'farm', 10, 33, 0)

    this.placeBuildingDirect('enemy', 'city', 58, 9, 0)
    this.placeBuildingDirect('enemy', 'military_camp', 55, 11, 0)
    this.placeBuildingDirect('enemy', 'farm', 60, 8, 0)

    for (let i = 0; i < 6; i += 1) this.tryTrainInfantry('player', 14 + (i % 3), 30 + Math.floor(i / 3), true)
    for (let i = 0; i < 7; i += 1) this.tryTrainInfantry('enemy', 56 + (i % 4), 11 + Math.floor(i / 4), true)
  }

  private placeBuildingDirect(faction: Faction, type: BuildingType, x: number, y: number, constructionLeft?: number) {
    const sprite = this.add
      .image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, `building-${type}`)
      .setDepth(7)
    const building: Building = {
      id: this.nextBuildingId++,
      faction,
      type,
      sprite,
      tileX: x,
      tileY: y,
      hp: 120,
      constructionLeft: constructionLeft ?? BUILDING_STATS[type].buildTime,
      attackCooldown: 0,
      animTick: 0,
    }
    this.buildings.push(building)
  }

  private tryPlaceBuilding(faction: Faction, type: BuildingType, x: number, y: number): boolean {
    const nation = this.nations[faction]
    const stats = BUILDING_STATS[type]
    if (nation.money < stats.cost || !this.isValidBuildingTile(x, y)) return false

    nation.money -= stats.cost
    this.placeBuildingDirect(faction, type, x, y)
    return true
  }

  private tryTrainInfantry(faction: Faction, baseX: number, baseY: number, free = false): boolean {
    const nation = this.nations[faction]
    const maxMilitaryPop = nation.population * nation.conscriptionPct
    if (!free) {
      if (nation.money < INFANTRY_COST) return false
      if (nation.militaryPopulation + INFANTRY_POP_COST > nation.population) return false
      if (nation.militaryPopulation + INFANTRY_POP_COST > maxMilitaryPop) return false
      nation.money -= INFANTRY_COST
    }

    const spawn = this.findOpenTileNear(baseX, baseY)
    if (!spawn) {
      if (!free) nation.money += INFANTRY_COST
      return false
    }

    const key = `u-${faction}-idle-0`
    const sprite = this.add.image(spawn.x * TILE_SIZE + TILE_SIZE / 2, spawn.y * TILE_SIZE + TILE_SIZE / 2, key).setDepth(10)
    const ring = this.add.image(sprite.x, sprite.y, 'selection-ring').setDepth(9).setVisible(false)
    this.units.push({
      id: this.nextUnitId++,
      faction,
      unitType: 'infantry',
      sprite,
      ring,
      tileX: spawn.x,
      tileY: spawn.y,
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
      popCost: INFANTRY_POP_COST,
    })
    nation.militaryPopulation += INFANTRY_POP_COST
    return true
  }

  private findOpenTileNear(cx: number, cy: number): Phaser.Math.Vector2 | null {
    for (let radius = 0; radius <= 4; radius += 1) {
      for (let y = cy - radius; y <= cy + radius; y += 1) {
        for (let x = cx - radius; x <= cx + radius; x += 1) {
          if (Math.abs(x - cx) !== radius && Math.abs(y - cy) !== radius) continue
          if (this.isTileWalkable(x, y)) return new Phaser.Math.Vector2(x, y)
        }
      }
    }
    return null
  }

  private isValidBuildingTile(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false
    const tile = this.map[y][x]
    if (!passableTiles[tile]) return false
    if (tile === 'river' || tile === 'mountain') return false
    if (this.buildings.some((b) => b.tileX === x && b.tileY === y && b.hp > 0)) return false
    if (this.units.some((u) => u.tileX === x && u.tileY === y && u.hp > 0)) return false
    return true
  }

  private isTileWalkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false
    if (!passableTiles[this.map[y][x]]) return false
    const blocker = this.buildings.find((b) => b.tileX === x && b.tileY === y && b.hp > 0 && BUILDING_STATS[b.type].blocksMovement)
    return !blocker
  }

  private handleCamera(dt: number) {
    const cam = this.cameras.main
    const speed = (520 * dt) / cam.zoom
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
    if (!this.dragStart || !this.dragCurrent || this.selectedBuild) return
    const x = Math.min(this.dragStart.x, this.dragCurrent.x)
    const y = Math.min(this.dragStart.y, this.dragCurrent.y)
    const w = Math.abs(this.dragStart.x - this.dragCurrent.x)
    const h = Math.abs(this.dragStart.y - this.dragCurrent.y)
    this.dragGraphics.lineStyle(1, 0x7be4ff, 0.95)
    this.dragGraphics.fillStyle(0x3aa3c9, 0.2)
    this.dragGraphics.fillRect(x, y, w, h)
    this.dragGraphics.strokeRect(x, y, w, h)
  }

  private updatePlacementVisual() {
    this.placementGraphics.clear()
    if (!this.selectedBuild || !this.hoveredBuildTile) return
    const tx = this.hoveredBuildTile.x
    const ty = this.hoveredBuildTile.y
    const valid = this.isValidBuildingTile(tx, ty) && this.nations.player.money >= BUILDING_STATS[this.selectedBuild].cost
    this.placementGraphics.lineStyle(2, valid ? 0x7bf29a : 0xff6c6c, 0.95)
    this.placementGraphics.fillStyle(valid ? 0x40ca6a : 0xc94646, 0.22)
    this.placementGraphics.fillRect(tx * TILE_SIZE + 1, ty * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2)
    this.placementGraphics.strokeRect(tx * TILE_SIZE + 1, ty * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2)
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

  private updateEconomyAndPopulation(dt: number) {
    for (const faction of ['player', 'enemy'] as const) {
      const nation = this.nations[faction]
      const built = this.buildings.filter((b) => b.faction === faction && b.hp > 0 && b.constructionLeft <= 0)
      const cityCount = built.filter((b) => b.type === 'city').length
      const incomeBase = built.reduce((sum, b) => sum + BUILDING_STATS[b.type].incomePerSecond, 0)
      const workingRatio = Phaser.Math.Clamp(1 - nation.conscriptionPct, 0.1, 1)
      nation.incomeRate = incomeBase * workingRatio
      nation.money += nation.incomeRate * dt

      nation.maxPopulation = BASE_POP_CAP + cityCount * BUILDING_STATS.city.popCap
      const capacityRatio = nation.maxPopulation > 0 ? nation.population / nation.maxPopulation : 1
      const slowdown = Phaser.Math.Clamp(1 - capacityRatio, 0, 1)
      nation.population = Math.min(nation.maxPopulation, nation.population + BASE_POP_GROWTH_PER_SECOND * slowdown * dt)

      if (nation.militaryPopulation > nation.population) nation.militaryPopulation = nation.population
    }
  }

  private updateBuildings(dt: number) {
    const playerUnits = this.units.filter((u) => u.faction === 'player' && u.hp > 0)
    const enemyUnits = this.units.filter((u) => u.faction === 'enemy' && u.hp > 0)

    for (const b of this.buildings) {
      if (b.hp <= 0) continue
      if (b.constructionLeft > 0) {
        b.constructionLeft = Math.max(0, b.constructionLeft - dt)
        b.sprite.setAlpha(0.58 + (1 - b.constructionLeft / Math.max(BUILDING_STATS[b.type].buildTime, 0.1)) * 0.42)
        b.sprite.setTint(0xcfd9e4)
        continue
      }
      b.sprite.setAlpha(1)
      b.sprite.clearTint()
      b.attackCooldown = Math.max(0, b.attackCooldown - dt)

      const frame = Math.floor((b.animTick += dt * 5)) % 4
      if (b.type === 'farm') b.sprite.setTexture(`anim-farm-${frame}`)
      if (b.type === 'city') b.sprite.setTexture(`anim-city-${frame}`)
      if (b.type === 'factory') b.sprite.setTexture(`anim-factory-${frame}`)

      if (b.type === 'defense_outpost') {
        const opponents = b.faction === 'player' ? enemyUnits : playerUnits
        const target = opponents.find((u) => Phaser.Math.Distance.Between(u.worldX, u.worldY, b.sprite.x, b.sprite.y) <= TILE_SIZE * 4.2)
        if (target && b.attackCooldown <= 0) {
          b.attackCooldown = 0.6
          b.sprite.setTexture(`anim-outpost-${frame}`)
          this.fireProjectileFromWorld(b.sprite.x, b.sprite.y, 13, target)
        } else {
          b.sprite.setTexture(`building-defense_outpost`)
        }
      }
    }
  }

  private updateEnemyAi(dt: number) {
    this.aiBuildTimer += dt
    this.aiTrainTimer += dt
    this.aiAttackTimer += dt

    if (this.aiBuildTimer >= 5.5) {
      this.aiBuildTimer = 0
      const builtEnemy = this.buildings.filter((b) => b.faction === 'enemy' && b.hp > 0)
      const goals: BuildingType[] = ['farm', 'farm', 'farm', 'military_camp', 'military_camp', 'city', 'city', 'defense_outpost']
      const current = new Map<BuildingType, number>()
      goals.forEach((g) => current.set(g, builtEnemy.filter((b) => b.type === g).length))
      const nextGoal = goals.find((g) => (current.get(g) ?? 0) < goals.filter((x) => x === g).length)
      if (nextGoal) {
        const spot = this.findAiBuildSpot(50, 4, MAP_W - 3, 17)
        if (spot) this.tryPlaceBuilding('enemy', nextGoal, spot.x, spot.y)
      }
    }

    if (this.aiTrainTimer >= 3.4) {
      this.aiTrainTimer = 0
      const camps = this.buildings.filter((b) => b.faction === 'enemy' && b.type === 'military_camp' && b.constructionLeft <= 0)
      if (camps.length) {
        const camp = Phaser.Utils.Array.GetRandom(camps)
        this.tryTrainInfantry('enemy', camp.tileX, camp.tileY)
      }
    }

    if (this.aiAttackTimer >= 12) {
      this.aiAttackTimer = 0
      const playerCities = this.buildings.filter((b) => b.faction === 'player' && b.type === 'city' && b.hp > 0)
      const target = playerCities[0] ?? this.units.find((u) => u.faction === 'player')
      if (!target) return
      const enemyUnits = this.units.filter((u) => u.faction === 'enemy' && u.hp > 0)
      enemyUnits.forEach((unit, i) => {
        const tx = Phaser.Math.Clamp((target as Unit | Building).tileX + (i % 3) - 1, 0, MAP_W - 1)
        const ty = Phaser.Math.Clamp((target as Unit | Building).tileY + Math.floor(i / 3) - 1, 0, MAP_H - 1)
        unit.destination = new Phaser.Math.Vector2(tx, ty)
        unit.path = this.findPath(unit.tileX, unit.tileY, tx, ty)
      })
    }
  }

  private findAiBuildSpot(minX: number, minY: number, maxX: number, maxY: number): Phaser.Math.Vector2 | null {
    for (let tries = 0; tries < 50; tries += 1) {
      const x = Phaser.Math.Between(minX, maxX)
      const y = Phaser.Math.Between(minY, maxY)
      if (this.isValidBuildingTile(x, y)) return new Phaser.Math.Vector2(x, y)
    }
    return null
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
        this.fireProjectileFromWorld(u.worldX, u.worldY, u.damage, target)
      }
    }

    this.resolveDestroyedUnits()
  }

  private resolveDestroyedUnits() {
    for (const u of this.units) {
      if (u.hp > 0) continue
      if (this.selected.has(u.id)) this.selected.delete(u.id)
      this.nations[u.faction].militaryPopulation = Math.max(0, this.nations[u.faction].militaryPopulation - u.popCost)
      u.sprite.destroy()
      u.ring.destroy()
    }
    this.units = this.units.filter((u) => u.hp > 0)
  }

  private fireProjectileFromWorld(x: number, y: number, damage: number, defender: Unit) {
    const bullet = this.add.image(x, y, 'bullet').setDepth(12)
    this.tweens.add({
      targets: bullet,
      x: defender.worldX,
      y: defender.worldY,
      duration: 120,
      ease: 'Linear',
      onComplete: () => {
        bullet.destroy()
        defender.hp -= damage
        this.showDamage(defender.worldX, defender.worldY, damage)
        if (defender.hp <= 0) this.playExplosion(defender.worldX, defender.worldY)
      },
    })
  }

  private showDamage(x: number, y: number, damage: number) {
    const txt = this.add
      .text(x - 6, y - 22, String(damage), {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ff7f7f',
        stroke: '#1a1e24',
        strokeThickness: 3,
      })
      .setDepth(25)
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
    if (!this.inBounds(tx, ty) || !this.isTileWalkable(tx, ty)) return []
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
        if (!this.inBounds(nx, ny) || cameFrom.has(key) || !this.isTileWalkable(nx, ny)) continue
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

    for (const b of this.buildings) {
      this.minimap.fillStyle(b.faction === 'player' ? 0x77beff : 0xff8f92, 0.9)
      this.minimap.fillRect(x + b.tileX * sx, y + b.tileY * sy, 2, 2)
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
    const player = this.nations.player
    const playerArmy = this.units.filter((u) => u.faction === 'player').length
    const maxConscriptionArmy = Math.floor(player.population * player.conscriptionPct)
    uiPop.textContent = player.population.toFixed(1)
    uiPopCap.textContent = player.maxPopulation.toFixed(0)
    uiMoney.textContent = Math.floor(player.money).toString()
    uiIncome.textContent = player.incomeRate.toFixed(1)
    uiArmy.textContent = `${playerArmy} / ${maxConscriptionArmy}`
    uiSelected.textContent = String(this.selected.size)

    const affordable = player.money >= INFANTRY_COST
    uiTrain.disabled = !affordable

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
