# Pixel Wars Prototype

First playable real-time prototype for a fast-paced pixel-war strategy game using TypeScript + Phaser.

## Run

```bash
npm install
python3 -m pip install -r requirements.txt
npm run assets:generate
npm run dev
```

## Controls

- WASD / Arrow keys: move camera
- Mouse wheel: zoom
- Left drag: drag-select player infantry
- Left click: single select
- Left click in build mode: place selected building
- Right click: issue tile movement command

## Prototype Features

- Real-time tile-based battlefield
- Two factions (Player blue, Enemy red)
- Infantry unit selection, movement, and auto-combat
- Building placement: farm, military camp, city, defense outpost, and factory placeholder
- Economy loop with farm-based income, building/unit costs, and income-per-second HUD readout
- Population + capacity model with logistic-style growth slowdown near cap
- Conscription slider that trades military capacity for worker-driven income
- Military camp infantry training with money + population costs
- Defense outposts as stationary auto-firing defenses
- Enemy AI that expands economy, trains units, and launches periodic attacks
- Fast time-to-kill combat readability
- Minimap and expanded top HUD (population, capacity, money, income, army, selected units)
- Generated pixel-art assets and SVG icon set

## Asset Pipeline

- Pixel PNG assets are generated with Pillow via `tools/generate_assets.py`
- Scalable UI/tech/resource/faction icons are generated as SVG
- Asset manifest is generated at `public/assets/asset-manifest.json`

Regenerate all assets:

```bash
npm run assets:generate
```
