# Slimline Tactical — Design Document

> **Project:** Turn-Based Squad Tactics Prototype  
> **Engine:** Three.js (vanilla JavaScript)  
> **Style:** Grimdark Military / 40K-adjacent  
> **Perspective:** Top-down 3D (Mechanicus / XCOM style)  
> **Mode:** Player vs AI (single player)  
> **Status:** Prototype / Slimline

---

## 1. Game Concept

A turn-based squad tactics game in the style of Warhammer 40K: Mechanicus and XCOM. Two grimdark military factions — the Order of the Abyss and the Germani — deploy 5-unit squads on an outdoor battlefield. Players control one faction as commander, issuing orders to individual units on a square grid. An AI opponent controls the opposing faction.

The prototype validates the core tactical loop: positioning, cover usage, action point management, and ranged/melee combat on a 3D battlefield viewed from above.

---

## 2. Tech Stack

| Component | Choice | Notes |
|-----------|--------|-------|
| Renderer | Three.js | GLB model loading, AnimationMixer, PBR materials |
| Language | JavaScript (vanilla) | No framework, no build step for prototype |
| Models | GLB format | Rigged + animated from Mixamo pipeline |
| Terrain | Procedural geometry | Flat ground plane + generated rocks/columns |
| Textures | Polyhaven PBR | CC0 ground materials, rock textures (user-provided) |
| Tiles | Quaternius Sci-Fi Kit | GLB exports already complete (future indoor maps) |
| UI | HTML/CSS overlay | Health bars, AP, turn controls |
| Map Editor | Separate Three.js app | Browser-based, exports JSON map files |

---

## 3. Camera System

### Setup
- **Projection:** Orthographic (matches Mechanicus/XCOM top-down feel, no perspective distortion)
- **Angle:** Slight tilt — not perfectly vertical. Approximately 60-70° from horizontal, looking down at the battlefield. This gives depth to the 3D models while maintaining tactical readability
- **Default zoom:** Shows roughly 12×8 grid tiles on screen
- **Rotation:** Fixed (no rotation for prototype — simplifies unit facing and readability)

### Controls
- **Pan:** Click-drag middle mouse / two-finger drag on touch / WASD keys
- **Zoom:** Scroll wheel / pinch-to-zoom, clamped between "see whole map" and "close-up on 3×3 tiles"
- **Combat zoom:** When an attack resolves, the camera smoothly tweens to frame the attacker and target at a closer zoom. Holds for the animation duration, then returns to the player's previous view. This is the Mechanicus "combat cam" feel — a brief cinematic moment within the tactical flow

### Bounds
- Camera panning is clamped so the viewport never leaves the map boundaries (Fill & Crop — no dead space visible)

---

## 4. Factions & Units

### Prototype Scope
Two factions, one infantry unit type each. Stats are mirrored (identical gameplay values) but models, animations, and color schemes are distinct.

### Order of the Abyss
- Dark, occult grimdark aesthetic
- Distinct silhouette and color palette
- **Acolytes** — 1 infantry unit type, squad of 5

### Germani
- Militant, disciplined grimdark aesthetic
- Contrasting color palette for readability
- **Shock Troops** — 1 infantry unit type, squad of 5

### Unit Stats (Mirrored)

| Stat | Value | Notes |
|------|-------|-------|
| HP | 10 | Lethal in 2-3 hits |
| AP | 2 | Per activation |
| Movement | 4 tiles | Per move action (1 AP) |
| Ranged Attack | 4 damage | 1 AP, range 8 tiles |
| Melee Attack | 5 damage | 1 AP, must be adjacent |
| Accuracy (ranged) | 70% | Base hit chance |
| Accuracy (melee) | 85% | Base hit chance |
| Cover Bonus | -25% | Applied to attacker's accuracy |
| High Ground Bonus | +10% | Attacker on elevated terrain |

*Stats are placeholder — tuning happens during playtesting.*

---

## 5. Animations

Each faction has its own model with individually exported animations (separate GLB files per animation due to export constraints). Weapon position/rotation is baked per animation.

### Per Faction (7 animations each, 14 total)

| Animation | Use | Priority |
|-----------|-----|----------|
| **Idle** | Default standing state, weapon ready | Must-have |
| **Walk** | Moving between grid tiles (standard movement) | Must-have |
| **Run** | Faster movement, sprinting between positions | Must-have |
| **Attack Ranged** | Shooting at a target | Must-have |
| **Attack Melee** | Close combat strike | Must-have |
| **Hit Reaction** | Taking damage, flinch/stagger | Should-have |
| **Death** | Unit eliminated | Must-have |

### Animation Pipeline
1. Source character from Mixamo (or Meshy AI → Mixamo rigging)
2. Download each animation as separate FBX (with skin)
3. Process in Blender — weapon positioning per animation, material setup
4. Export each animation as individual GLB
5. Load in Three.js, assign to AnimationMixer per unit instance

### Runtime Animation Logic
- Idle plays on loop when unit has no orders
- Walk plays during movement, blends back to idle on arrival
- Attack animations play once, triggered by combat resolution
- Hit reaction plays on the target when damage is dealt
- Death plays once, model remains on ground (or fades out after delay)

---

## 6. Game Flow

### Match Setup
1. Load map from JSON
2. Spawn Order of the Abyss Acolytes on designated spawn tiles
3. Spawn Germani Shock Troops (AI) on opposing spawn tiles
4. Player goes first (or coin flip — configurable)

### Turn Structure (Alternating Activation)
Unlike XCOM's "move all your units then enemy moves all," this uses **alternating activation** — player activates one unit, then AI activates one unit, back and forth. This keeps both sides engaged and creates tactical interplay.

```
Turn Start
  → Player activates Unit 1 (move + action)
  → AI activates Unit 1 (move + action)
  → Player activates Unit 2
  → AI activates Unit 2
  → ... until all units activated
  → Turn ends
  → New turn begins
```

### Unit Activation Flow
1. **Select unit** — Click on a friendly unit that hasn't activated this turn
2. **Movement phase** — Grid highlights reachable tiles (blue). Click a tile to move (costs 1 AP). Can skip movement
3. **Action phase** — Choose action:
   - **Shoot** — Select enemy in range and LOS. Resolve hit/miss, play animations (1 AP)
   - **Melee** — Must be adjacent to enemy. Resolve hit/miss, play animations (1 AP)
   - **Overwatch** — Unit watches a cone/area, will auto-shoot first enemy that enters (1 AP, resolves during enemy turn)
   - **Hunker Down** — Double cover bonus until next activation (1 AP)
   - **End activation** — Save remaining AP (unused AP is lost)
4. Unit is marked as activated (dimmed/grayed)

### Win Conditions
- **Elimination:** Destroy all enemy units
- **Future expansion:** Objective-based (hold points, retrieve items, reach extraction)

---

## 7. Combat System

### Ranged Attack Resolution
```
1. Check LOS (raycast from attacker to target on grid)
2. Check range (tile distance ≤ weapon range)
3. Calculate hit chance:
   Base accuracy (70%)
   - Cover penalty (if target in cover: -25%)
   + High ground bonus (if attacker elevated: +10%)
   + Flanking bonus (if attacking from side/rear: +15%)
4. Roll random [0-100]
5. If hit: deal damage, play attack animation → hit reaction on target
6. If miss: play attack animation, miss VFX (shot goes wide)
7. If target HP ≤ 0: play death animation, remove from active units
```

### Melee Attack Resolution
```
1. Must be on adjacent tile (including diagonals)
2. Calculate hit chance:
   Base accuracy (85%)
   - No cover penalty in melee
3. Roll, resolve damage
4. Play melee animation on attacker, hit reaction on target
```

### Cover System
- **Half cover:** Rocks, low walls, debris. -25% to incoming ranged accuracy
- **Full cover:** Large rocks, thick columns. -50% to incoming ranged accuracy, blocks LOS from certain angles
- Cover is directional — only applies if the cover object is between attacker and target
- Melee ignores cover

### Line of Sight
- Grid-based raycast from attacker tile to target tile
- If the ray crosses a wall tile or full-cover tile, LOS is blocked
- Half-cover tiles don't block LOS, they just apply a penalty
- Units do not block LOS for prototype (simplification)

---

## 8. Battlefield — Outdoor Map

### Terrain Composition
The prototype uses outdoor maps only. The ground is a flat textured plane with procedurally generated 3D cover objects placed on the grid.

### Ground Plane
- Flat `PlaneGeometry` sized to the grid (e.g., 20×20 tiles = 40m × 40m with 2m tiles)
- Polyhaven PBR texture applied: albedo, normal, roughness, AO maps
- Suggested textures: cracked earth, muddy ground, scorched dirt, gravel — grimdark aesthetic
- Texture tiled/repeated across the plane

### Procedural Cover Objects
Generated at runtime from Three.js geometry + Polyhaven rock/stone textures:

| Object | Geometry | Cover Type | Generation |
|--------|----------|------------|------------|
| **Boulders** | IcosahedronGeometry with vertex displacement | Half or full cover (size-dependent) | Random seed → vertex noise → non-uniform scale |
| **Rock clusters** | Multiple small displaced spheres merged | Half cover | 3-5 small rocks grouped |
| **Columns/pillars** | CylinderGeometry, optional vertex noise | Full cover | Height variation, optional "broken top" |
| **Ruined walls** | BoxGeometry, stretched, jagged top edge | Full cover (directional) | Width/height variation, vertex displacement on top |
| **Barricades** | Stacked deformed boxes | Half cover | Low and wide, tactical height |
| **Craters** | Inverted hemisphere in ground | No cover (open ground marker) | Circular depression, charred texture |

### Map Data
Each procedural object is deterministic from a seed, so the map JSON stores minimal data:

```json
{
  "name": "Scorched Outpost",
  "gridSize": [20, 16],
  "tileSize": 2.0,
  "groundTexture": "cracked_earth",
  "spawnZones": {
    "orderOfTheAbyss": [[0,6], [0,7], [0,8], [0,9], [1,6], [1,7], [1,8], [1,9]],
    "germani": [[19,6], [19,7], [19,8], [19,9], [18,6], [18,7], [18,8], [18,9]]
  },
  "objects": [
    { "type": "boulder", "tile": [5, 4], "seed": 12345, "scale": 1.2, "cover": "half" },
    { "type": "column", "tile": [10, 8], "seed": 67890, "scale": 1.0, "cover": "full" },
    { "type": "ruined_wall", "tile": [7, 10], "seed": 11111, "rotation": 90, "cover": "full" },
    { "type": "rock_cluster", "tile": [14, 3], "seed": 22222, "scale": 0.8, "cover": "half" }
  ]
}
```

### Elevation (Future)
The prototype uses a flat plane. Future versions can add heightmap elevation for high ground / low ground gameplay. The grid system and LOS calculations are designed to accommodate a Y-component later.

---

## 9. Map Editor

A separate browser-based Three.js application for authoring maps. Exports JSON files consumed by the game.

### Editor Features
- **Grid overlay** on a ground plane, showing tile boundaries
- **Object palette** — sidebar listing available object types (boulder, column, wall, barricade, crater, spawn zone)
- **Click to place** — Select object type, click a tile to place it
- **Right-click to remove** — Delete object from tile
- **Rotation** — R key or button to rotate selected object in 90° increments
- **Cover type toggle** — Cycle between half/full/none for placed objects
- **Seed randomization** — Each placed object gets a random seed; button to re-roll for a different look
- **Spawn zone painting** — Toggle mode to paint Order of the Abyss / Germani spawn tiles
- **Grid size controls** — Set map width and height
- **Ground texture selector** — Choose from available Polyhaven textures
- **Preview mode** — Hide grid overlay and UI to see the map as it would appear in-game
- **Export** — Save map as JSON file
- **Import** — Load existing JSON map for editing

### Editor Does NOT Need
- Undo/redo (for prototype)
- Multi-select or copy/paste
- Custom object scaling (use preset sizes)
- Terrain elevation editing (flat maps only for now)

---

## 10. GUI — Player Interface

### HUD Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [TURN 1]        ORDER OF THE ABYSS's TURN          [⚙ Settings] │  ← Top bar
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                                                                 │
│                                                                 │
│                     3D BATTLEFIELD                              │
│                     (Three.js canvas)                           │
│                                                                 │
│                                                                 │
│                                                                 │
├────────────────────┬────────────────────────────────────────────┤
│  [UNIT CARD]       │  [ACTION BAR]                              │
│  Portrait/Icon     │  [🔫 Shoot] [⚔ Melee] [👁 Overwatch]     │
│  HP: ████████░░    │  [🛡 Hunker] [⏭ End Turn]                │
│  AP: ●●            │                                            │
│  Status: Ready     │  [Unit 1 ● ] [Unit 2 ● ] [Unit 3 ○ ]    │
│                    │  [Unit 4 ○ ] [Unit 5 ○ ]                  │
│                    │  ● = activated  ○ = available              │
└────────────────────┴────────────────────────────────────────────┘
```

### Top Bar
- Current turn number
- Whose turn it is (faction name)
- Settings button (volume, quit — minimal for prototype)

### Unit Card (Bottom Left)
- Shown when a unit is selected
- Displays: unit portrait/icon, HP bar, AP pips, status (ready / activated / in overwatch / hunkered / injured)
- Fades out when no unit selected

### Action Bar (Bottom Center/Right)
- Appears when a unit with remaining AP is selected
- Buttons for available actions, grayed out if invalid (e.g., melee grayed if no adjacent enemy, shoot grayed if no LOS targets)
- End Turn button always available

### Unit Roster (Bottom Right)
- Small icons/pips for all 5 squad members
- Shows activated vs available status
- Click a pip to select that unit (camera pans to them)

### Floating UI (In 3D Space)
- **Health bars** — Small bar above each unit's head, always facing camera (HTML overlay positioned via `Vector3.project()`)
- **AP pips** — Dots below the health bar showing remaining AP
- **Damage numbers** — Float up from target when damage is dealt, fade out
- **Movement range** — Blue highlighted tiles when in movement mode
- **Attack range** — Red highlighted tiles showing valid targets
- **LOS indicator** — Line drawn from attacker to hovered target (green = clear, red = blocked)

### AI Turn Presentation
During the AI's activations, the camera follows the active AI unit. Actions play out with a brief delay between each (0.5-1s) so the player can follow what's happening. A subtle "ENEMY TURN" banner displays at the top.

---

## 11. VFX — Weapon Effects

### Ranged Attack (Shooting)
- **Muzzle flash** — Bright point light + small billboard sprite at weapon barrel, flashes for 2-3 frames
- **Tracer/bullet trail** — Thin glowing line (or stretched billboard) from weapon to target, travels quickly (not instant — ~0.15s travel time gives visual feedback)
- **Impact hit** — Small particle burst at target position (sparks for metal/armor, dust for ground miss)
- **Miss trail** — Same tracer but offset to pass near the target and hit the ground behind them, small dirt impact

### Melee Attack
- **Weapon swing trail** — Arc-shaped mesh or series of billboards showing the weapon path, fades quickly
- **Impact flash** — Bright flash at contact point
- **Blood/spark burst** — Small particle burst at hit location

### Overwatch Trigger
- Same as ranged attack VFX but preceded by a brief "reaction" indicator — unit's overwatch cone flashes, short delay, then fires

### Death
- Unit plays death animation
- Optional: small dust cloud at base as they fall
- Unit model stays on the ground (dimmed/desaturated) or fades out after a few seconds

### Implementation Approach
- Muzzle flash: `PointLight` + `SpriteMaterial` with additive blending
- Tracers: Stretched `PlaneGeometry` with emissive material, animated along a path
- Particles: Simple billboard sprites with velocity, gravity, fade-out (custom particle system or `Points` with shader)
- All VFX are short-lived (< 1 second) and self-cleaning

---

## 12. AI Opponent

### Prototype AI (Rule-Based)
No machine learning for the prototype. Simple priority-based decision making:

### Activation Priority (Which Unit to Activate)
1. Unit with an enemy in range and LOS (can shoot immediately)
2. Unit closest to an enemy (can close distance)
3. Unit furthest from cover (needs to reposition)
4. Any remaining unit

### Action Decision Tree
```
IF adjacent enemy exists:
  → Melee attack (higher damage, higher accuracy)
ELSE IF enemy in range + LOS:
  → Shoot highest-priority target
    Priority: lowest HP > closest > no cover
ELSE IF can move into range of an enemy:
  → Move toward nearest enemy, end in cover if possible
  → Shoot if now in range
ELSE:
  → Move toward nearest enemy
  → End activation
```

### AI Behavior Notes
- AI always tries to use cover when moving (prefers tiles adjacent to cover objects)
- AI doesn't use overwatch or hunker down in prototype (simplification)
- AI has a short delay (0.5-1s) between decisions so the player can follow along
- AI uses the same rules as the player — no cheating, no information the player doesn't have

### Future AI Expansion
- Difficulty levels (easy skips optimal plays, hard uses flanking and focus fire)
- Overwatch and hunker usage
- AlphaZero / MCTS integration (the turn-based grid structure is ideal for this)

---

## 13. Lighting & Atmosphere

The visual target is Warhammer 40K: Mechanicus and Chaos Gate — Daemonhunters. These games share a signature look: predominantly dark scenes punctuated by strong localized light sources, glowing emissives, volumetric haze, and heavy rim lighting on characters. The world feels dangerous and atmospheric, not evenly lit.

### Core Lighting Philosophy
The scene should be **dark by default**. Ambient light is cranked very low. Players see things because of specific, intentional light sources — not because the world is uniformly bright. Every light in the scene should feel like it has a reason to exist.

### Light Rig

**1. Key Light (Directional)**
- Angled to cast long dramatic shadows across the battlefield (~30-40° elevation, slightly warm desaturated tone)
- Intensity kept moderate — this is NOT a sunny day. Think overcast sky filtering through smoke
- Shadow mapping enabled, soft shadows (shadow radius > 1)
- Shadow bias tuned to avoid peter-panning on thin geometry

**2. Rim/Back Light (Directional)**
- Positioned roughly opposite the key light, aimed at the camera-facing side of units
- Cool tone (pale blue-white) to contrast the warm key light
- Primary purpose: creates that bright edge outline on characters that Mechanicus/Chaos Gate use for readability and style
- No shadow casting — purely for the rim highlight effect
- Intensity moderate-high, the rim should be clearly visible on unit silhouettes

**3. Ambient (Hemisphere Light)**
- Top color: very dark desaturated blue-grey
- Bottom/ground color: near-black with a slight warm tint
- Intensity very low — just enough to prevent pure black in unlit areas
- The darkness is the point. Resist the urge to brighten this

**4. Environmental Point Lights**
- Scattered across the map at points of interest: burning debris, glowing craters, weapon caches, obelisks, warp rifts
- Colored light with falloff: sickly green, deep red, amber fire, cold blue
- Creates pools of colored illumination that break up the dark ground plane
- Each point light defined in the map JSON so the editor can place them
- Small radius (3-5 tiles), strong near the source, quick falloff
- These are what give the scene its character — without them it's just dark. With them it's grimdark

**5. Unit-Attached Lights (Optional but High Impact)**
- Small point lights parented to each unit model
- Colored to match faction: Order of the Abyss might have cold blue weapon glow, Germani warm red/amber
- Very low intensity and small radius — just enough to cast a subtle pool of colored light at their feet
- Sells the "glowing eyes and weapons" look when combined with emissive materials

### Emissive Materials
Critical to the Mechanicus/Chaos Gate aesthetic. Every unit and many environment objects should have emissive regions:

- **Unit eyes** — Glowing through helmet visors
- **Weapon details** — Power cells, barrel tips, energy coils
- **Armor accents** — Runes, insignia, power conduits
- **Environment objects** — Cracked ground with lava/warp energy underneath, obelisk carvings, data terminals
- Emissive color and intensity are tuned per faction for visual identity
- Emissives interact with bloom post-processing to create the signature glow bleed

### Atmospheric Particles
A subtle but constant particle layer that gives the air visible texture:

- **Floating ash/embers** — Tiny billboard sprites drifting slowly upward with slight horizontal sway. Warm orange-white. Sparse — maybe 50-100 particles across the visible scene
- **Dust motes** — Even smaller, neutral colored, caught in light shafts. Drift lazily
- **Ground fog wisps** — Low-lying translucent planes or particle strips that hug the ground, drift slowly. Semi-transparent white/grey. Concentrated in low areas and around certain map objects
- All particles are camera-facing billboards, very low opacity, additive or alpha blending
- Performance cost is minimal — these are tiny sprites with simple movement

### Post-Processing Stack (Three.js EffectComposer)

Applied in this order:

**1. SSAO (Screen-Space Ambient Occlusion)**
- Deep contact shadows in crevices, under units, where cover meets ground
- Radius tuned for the camera distance — visible darkening at object bases
- This is what grounds everything in the scene and prevents the "floating on a plane" look

**2. Bloom (UnrealBloomPass)**
- Threshold set so only emissive materials and bright VFX trigger it
- Strength moderate — visible glow bleed but not overwhelming
- Radius set for a soft, wide glow rather than tight halos
- This is what makes weapon glows, eyes, and energy effects pop against the dark scene

**3. Volumetric God Rays (Optional — High Impact)**
- Light shafts from the key light direction cutting through the atmospheric haze
- Can be achieved with a godrays post-processing shader or pre-baked light shaft meshes (stretched transparent cones with a gradient texture)
- If full volumetrics are too expensive, fake it with 2-3 static transparent mesh planes angled to look like light shafts, placed strategically on the map. Still sells the effect at top-down camera angles

**4. Color Grading / LUT**
- Desaturate the scene significantly (~30-40% saturation reduction)
- Push shadows toward cool blue-black
- Push highlights toward warm amber-white
- Midtones slightly green-grey (the Mechanicus sickly tone)
- Overall contrast boost — darks are darker, brights pop more
- Can be achieved with a custom shader pass or a color LUT texture

**5. Vignette**
- Moderate darkening at screen edges
- Pushes the player's eye toward the center of the battlefield
- Reinforces the claustrophobic grimdark feel

**6. Film Grain (Subtle)**
- Very light noise overlay, animated
- Adds grit and breaks up the clean digital rendering
- Keep it barely perceptible — it should feel like texture, not static

### Skybox / Background
- **No bright sky.** Dark overcast, smoke-filled, or void-like
- Polyhaven HDRI with heavy desaturation and darkening applied, or a simple dark gradient
- At the top-down camera angle, sky is barely visible — but what is visible should not break the mood
- Consider a very dark solid color with subtle cloud/smoke texture rather than a realistic sky

### Lighting in Map JSON
Environmental lights are part of the map data so they can be placed in the editor:

```json
{
  "lights": [
    { "type": "point", "tile": [8, 5], "color": "#44ff44", "intensity": 2.0, "radius": 6.0, "height": 0.5 },
    { "type": "point", "tile": [12, 10], "color": "#ff4422", "intensity": 1.5, "radius": 4.0, "height": 1.0 },
    { "type": "point", "tile": [3, 14], "color": "#ffaa33", "intensity": 2.5, "radius": 5.0, "height": 0.3 }
  ]
}
```

### Performance Considerations
- Point lights are the biggest cost. Limit to ~10-15 per map. Use `distance` and `decay` parameters aggressively so they don't illuminate the whole scene
- SSAO is moderately expensive — can be disabled on low-end devices
- Bloom is cheap. Always on
- Particles at these counts (< 200 total) are negligible
- Shadow maps only on the key directional light, not on point lights. Point light shadows are expensive and not worth it at top-down angles

---

## 14. Project Structure

```
slimline-tactical/
├── index.html              # Game entry point
├── editor.html             # Map editor entry point
├── css/
│   ├── game.css            # Game UI styles
│   └── editor.css          # Editor UI styles
├── js/
│   ├── game/
│   │   ├── main.js         # Three.js scene setup, game loop
│   │   ├── camera.js       # Orthographic camera, pan/zoom, combat cam
│   │   ├── grid.js         # Grid creation, tile management, highlighting
│   │   ├── units.js        # Unit loading, animation, state management
│   │   ├── combat.js       # Attack resolution, damage, LOS
│   │   ├── turns.js        # Turn state machine, activation tracking
│   │   ├── ai.js           # AI decision making
│   │   ├── vfx.js          # Weapon effects, particles
│   │   ├── input.js        # Mouse/touch input, raycasting
│   │   ├── ui.js           # HTML overlay management
│   │   ├── map-loader.js   # Load map JSON, generate terrain/objects
│   │   └── procedural.js   # Rock, column, wall generation
│   ├── editor/
│   │   ├── main.js         # Editor Three.js scene
│   │   ├── palette.js      # Object type selection
│   │   ├── placement.js    # Click-to-place logic
│   │   ├── export.js       # JSON export
│   │   └── ui.js           # Editor interface
│   └── shared/
│       ├── constants.js    # Grid size, unit stats, shared config
│       └── utils.js        # Math helpers, raycasting utilities
├── assets/
│   ├── models/
│   │   ├── order-of-the-abyss/  # Acolyte GLB files (idle.glb, walk.glb, etc.)
│   │   └── germani/             # Shock Trooper GLB files
│   ├── textures/
│   │   └── polyhaven/      # Ground + rock PBR textures (user-provided)
│   └── tiles/              # Quaternius sci-fi GLB tiles (for future indoor maps)
├── maps/
│   └── test-map.json       # Default test map
└── lib/
    └── three/              # Three.js library files
```

---

## 15. Development Phases

### Phase 1 — Foundation
- Three.js scene with orthographic camera (pan + zoom)
- Square grid rendering on a flat textured ground plane
- Load one GLB infantry model with idle animation playing
- Click a tile to highlight it

### Phase 2 — Units & Movement
- Load 5 units per side, positioned on spawn tiles
- Unit selection (click to select, show unit card)
- Movement range calculation and tile highlighting
- Click-to-move with walk animation playing during movement
- Pathfinding (A* on grid, respecting impassable tiles)

### Phase 3 — Combat
- Ranged attack: target selection, LOS check, hit/miss roll, damage
- Attack animations playing on attacker and target
- Death animation and unit removal
- Basic VFX (muzzle flash, tracer, impact)
- Melee attack (adjacent tiles)

### Phase 4 — Turn System
- Alternating activation flow
- AP tracking (2 AP per unit per turn)
- Unit activation status (available / activated)
- Turn counter, turn transition UI
- Win condition check (all enemies eliminated)

### Phase 5 — AI Opponent
- Rule-based AI decision tree
- AI unit activation with camera follow
- Delayed action execution for readability
- AI movement toward enemies, preference for cover

### Phase 6 — Map Editor
- Separate Three.js app
- Grid with click-to-place objects
- Object palette (rocks, columns, walls, barricades, craters)
- Procedural object generation with seed control
- Spawn zone painting
- JSON export / import

### Phase 7 — Cover & Terrain
- Procedural rock/column generation with Polyhaven textures
- Cover system (half/full, directional)
- Cover visual indicators in UI
- LOS visualization (line from attacker to target)

### Phase 8 — Polish
- Post-processing (bloom, fog, color grading, vignette)
- Damage numbers floating up from targets
- Combat camera (zoom in during attacks)
- Sound effects (if desired)
- Overwatch and hunker down actions
- Second faction model integration with unique animations

---

## 16. Future Expansion (Out of Scope for Prototype)

These are noted for architectural awareness — the prototype should not block these but does not implement them:

- **Base mechanics** — Resource gathering, unit production, base building between missions
- **Multiple unit types** — Specialists, heavy weapons, vehicles per faction
- **Campaign/mission structure** — Linked missions with persistent squad
- **Multiplayer** — Player vs player via WebSocket
- **Indoor maps** — Using existing Quaternius sci-fi tile kit
- **Elevation** — Heightmap terrain with high ground gameplay
- **Abilities** — Faction-specific special abilities (grenades, buffs, airstrikes)
- **Fog of war** — Hidden information, scouting
- **Destructible cover** — Cover objects that degrade and break from weapon fire
- **Godot migration** — Move from Three.js prototype to full Godot 4 implementation with AlphaZero AI

---

## 17. Reference Games

| Game | What to Reference |
|------|-------------------|
| **Warhammer 40K: Mechanicus** | Camera angle, combat cam zoom, grid movement, dark atmosphere, turn flow |
| **Warhammer 40K: Chaos Gate — Daemonhunters** | Lighting rig, grimdark atmosphere, emissive materials, combat presentation, unit weight |
| **XCOM / XCOM 2** | Cover system, action point economy, overwatch, squad management UI |
| **Jagged Alliance 3** | Squad-level tactics, individual unit personality, positioning depth, tactical flexibility |
| **Warhammer 40K: Battlesector** | Alternating activation, military unit feel, ranged combat at distance |
| **Into the Breach** | Clean grid readability, showing enemy intent, tight tactical decisions |

---

*Document Version: 1.0*  
*Last Updated: February 2026*
