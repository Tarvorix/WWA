// Slimline Tactical — Editor Placement
// Handles placing/removing objects, spawn zones, and lights on the editor grid

import * as THREE from 'three';
import { CONSTANTS } from '../shared/constants.js';
import { tileToWorld, seededRandom } from '../shared/utils.js';

export class EditorPlacement {
    /**
     * @param {THREE.Scene} scene
     * @param {import('../game/grid.js').GridManager} gridManager
     * @param {import('../game/procedural.js').ProceduralGenerator} proceduralGenerator
     * @param {object} editorState — shared editor state
     */
    constructor(scene, gridManager, proceduralGenerator, editorState) {
        this.scene = scene;
        this.gridManager = gridManager;
        this.proceduralGenerator = proceduralGenerator;
        this.editorState = editorState;

        // Placed objects keyed by "col,row"
        // Each entry: { type, seed, scale, rotation, cover, mesh }
        this.placedObjects = {};

        // Spawn zone overlays keyed by "col,row"
        // Each entry: { factionId, mesh }
        this.spawnOverlays = {};

        // Placed lights keyed by "col,row"
        // Each entry: { color, intensity, radius, height, light, sprite }
        this.placedLights = {};

        // Ghost preview mesh (shows what will be placed on hover)
        this.ghostMesh = null;
        this.ghostTile = null;

        // Spawn overlay material cache
        this._spawnMaterials = {
            orderOfTheAbyss: new THREE.MeshBasicMaterial({
                color: CONSTANTS.FACTIONS.orderOfTheAbyss.spawnColor,
                transparent: true,
                opacity: 0.2,
                depthWrite: false,
                side: THREE.DoubleSide
            }),
            germani: new THREE.MeshBasicMaterial({
                color: CONSTANTS.FACTIONS.germani.spawnColor,
                transparent: true,
                opacity: 0.2,
                depthWrite: false,
                side: THREE.DoubleSide
            })
        };

        // Shared geometry for spawn overlays
        this._spawnGeometry = new THREE.PlaneGeometry(
            CONSTANTS.TILE_SIZE * 0.9,
            CONSTANTS.TILE_SIZE * 0.9
        );
        this._spawnGeometry.rotateX(-Math.PI / 2);
    }

    // ============================================================
    // Object Placement
    // ============================================================

    /**
     * Place an object on the grid at the specified tile.
     * If an object already exists at this tile, it is removed first.
     * @param {number} col
     * @param {number} row
     * @param {object} typeConfig — palette item config { id, cover, defaultScale }
     */
    placeObject(col, row, typeConfig) {
        const key = `${col},${row}`;

        // Remove existing object if any
        if (this.placedObjects[key]) {
            this.removeObject(col, row);
        }

        // Generate random seed for procedural variation
        const seed = Math.floor(Math.random() * 999999) + 1;
        const scale = typeConfig.defaultScale || 1.0;
        const rotation = this.editorState.currentRotation || 0;
        const cover = typeConfig.cover || 'none';

        // Create the procedural mesh
        const mesh = this.proceduralGenerator.createObjectFromType(
            typeConfig.id, seed, scale, rotation, cover
        );

        // Position at tile center
        const worldPos = tileToWorld(col, row, CONSTANTS.TILE_SIZE);
        mesh.position.x = worldPos.x;
        mesh.position.z = worldPos.z;
        // Y is set by the procedural generator (base at ground)

        this.scene.add(mesh);

        // Store placement data
        this.placedObjects[key] = {
            type: typeConfig.id,
            seed: seed,
            scale: scale,
            rotation: rotation,
            cover: cover,
            mesh: mesh,
            col: col,
            row: row
        };

        // Update grid tile data
        this.gridManager.setObject(col, row, typeConfig.id, mesh, cover);
    }

    /**
     * Remove an object from the grid at the specified tile.
     * @param {number} col
     * @param {number} row
     */
    removeObject(col, row) {
        const key = `${col},${row}`;
        const entry = this.placedObjects[key];

        if (!entry) return;

        // Remove mesh from scene
        this.scene.remove(entry.mesh);

        // Dispose geometry and materials
        this._disposeMesh(entry.mesh);

        // Remove from tracking
        delete this.placedObjects[key];

        // Clear grid tile data
        const tile = this.gridManager.getTile(col, row);
        if (tile) {
            tile.objectType = null;
            tile.objectMesh = null;
            tile.coverType = 'none';
            tile.walkable = true;
        }
    }

    /**
     * Rotate the object at the specified tile by 90 degrees.
     * @param {number} col
     * @param {number} row
     */
    rotateObject(col, row) {
        const key = `${col},${row}`;
        const entry = this.placedObjects[key];
        if (!entry) return;

        // Update rotation
        entry.rotation = (entry.rotation + 90) % 360;

        // Remove old mesh
        this.scene.remove(entry.mesh);
        this._disposeMesh(entry.mesh);

        // Recreate with new rotation
        const mesh = this.proceduralGenerator.createObjectFromType(
            entry.type, entry.seed, entry.scale, entry.rotation, entry.cover
        );

        const worldPos = tileToWorld(col, row, CONSTANTS.TILE_SIZE);
        mesh.position.x = worldPos.x;
        mesh.position.z = worldPos.z;

        this.scene.add(mesh);
        entry.mesh = mesh;

        // Update grid
        this.gridManager.setObject(col, row, entry.type, mesh, entry.cover);
    }

    /**
     * Reroll the procedural seed for the object at the specified tile.
     * Creates a new variation of the same object type.
     * @param {number} col
     * @param {number} row
     */
    rerollSeed(col, row) {
        const key = `${col},${row}`;
        const entry = this.placedObjects[key];
        if (!entry) return;

        // Generate new seed
        entry.seed = Math.floor(Math.random() * 999999) + 1;

        // Remove old mesh
        this.scene.remove(entry.mesh);
        this._disposeMesh(entry.mesh);

        // Recreate with new seed
        const mesh = this.proceduralGenerator.createObjectFromType(
            entry.type, entry.seed, entry.scale, entry.rotation, entry.cover
        );

        const worldPos = tileToWorld(col, row, CONSTANTS.TILE_SIZE);
        mesh.position.x = worldPos.x;
        mesh.position.z = worldPos.z;

        this.scene.add(mesh);
        entry.mesh = mesh;

        // Update grid
        this.gridManager.setObject(col, row, entry.type, mesh, entry.cover);
    }

    /**
     * Check if a tile has a placed object.
     * @param {number} col
     * @param {number} row
     * @returns {boolean}
     */
    hasObject(col, row) {
        return !!this.placedObjects[`${col},${row}`];
    }

    /**
     * Get the placed object data at a tile.
     * @param {number} col
     * @param {number} row
     * @returns {object|null}
     */
    getObjectAt(col, row) {
        return this.placedObjects[`${col},${row}`] || null;
    }

    /**
     * Get the total number of placed objects.
     * @returns {number}
     */
    getObjectCount() {
        return Object.keys(this.placedObjects).length;
    }

    // ============================================================
    // Spawn Zones
    // ============================================================

    /**
     * Set a spawn zone on a tile with a colored overlay.
     * @param {number} col
     * @param {number} row
     * @param {string} factionId — 'orderOfTheAbyss' | 'germani'
     */
    setSpawnZone(col, row, factionId) {
        const key = `${col},${row}`;

        // Remove existing spawn overlay if any
        if (this.spawnOverlays[key]) {
            this.clearSpawnZone(col, row);
        }

        // Don't place spawn zones on tiles with cover objects
        if (this.placedObjects[key]) return;

        // Create visual overlay
        const material = this._spawnMaterials[factionId];
        if (!material) return;

        const mesh = new THREE.Mesh(this._spawnGeometry, material);
        const worldPos = tileToWorld(col, row, CONSTANTS.TILE_SIZE);
        mesh.position.set(worldPos.x, 0.02, worldPos.z);
        mesh.renderOrder = 1;

        this.scene.add(mesh);

        // Store
        this.spawnOverlays[key] = {
            factionId: factionId,
            mesh: mesh,
            col: col,
            row: row
        };

        // Update grid
        this.gridManager.setSpawnZone(col, row, factionId);
    }

    /**
     * Remove a spawn zone overlay from a tile.
     * @param {number} col
     * @param {number} row
     */
    clearSpawnZone(col, row) {
        const key = `${col},${row}`;
        const entry = this.spawnOverlays[key];

        if (!entry) return;

        this.scene.remove(entry.mesh);
        delete this.spawnOverlays[key];

        // Clear grid spawn zone data
        const tile = this.gridManager.getTile(col, row);
        if (tile) tile.spawnZone = null;
    }

    /**
     * Check if a tile has a spawn zone.
     * @param {number} col
     * @param {number} row
     * @returns {boolean}
     */
    hasSpawnZone(col, row) {
        return !!this.spawnOverlays[`${col},${row}`];
    }

    // ============================================================
    // Point Lights
    // ============================================================

    /**
     * Place a point light on a tile.
     * @param {number} col
     * @param {number} row
     * @param {string} color — hex color string like '#ff4422'
     * @param {number} intensity
     * @param {number} radius — light distance/radius
     * @param {number} height — Y position
     */
    placeLight(col, row, color, intensity, radius, height) {
        const key = `${col},${row}`;

        // Remove existing light if any
        if (this.placedLights[key]) {
            this.removeLight(col, row);
        }

        const worldPos = tileToWorld(col, row, CONSTANTS.TILE_SIZE);
        const hexColor = new THREE.Color(color);

        // Create point light
        const light = new THREE.PointLight(hexColor, intensity, radius, 2);
        light.position.set(worldPos.x, height, worldPos.z);
        this.scene.add(light);

        // Create small visual indicator (sprite)
        const spriteMaterial = new THREE.SpriteMaterial({
            color: hexColor,
            transparent: true,
            opacity: 0.8,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(worldPos.x, height + 0.3, worldPos.z);
        sprite.scale.set(0.3, 0.3, 0.3);
        this.scene.add(sprite);

        // Store
        this.placedLights[key] = {
            color: color,
            intensity: intensity,
            radius: radius,
            height: height,
            light: light,
            sprite: sprite,
            col: col,
            row: row
        };
    }

    /**
     * Remove a point light from a tile.
     * @param {number} col
     * @param {number} row
     */
    removeLight(col, row) {
        const key = `${col},${row}`;
        const entry = this.placedLights[key];
        if (!entry) return;

        this.scene.remove(entry.light);
        entry.light.dispose();

        this.scene.remove(entry.sprite);
        entry.sprite.material.dispose();

        delete this.placedLights[key];
    }

    /**
     * Check if a tile has a light.
     * @param {number} col
     * @param {number} row
     * @returns {boolean}
     */
    hasLight(col, row) {
        return !!this.placedLights[`${col},${row}`];
    }

    // ============================================================
    // Ghost Preview
    // ============================================================

    /**
     * Show a ghost preview mesh at a tile position.
     * @param {number} col
     * @param {number} row
     * @param {object} typeConfig — palette item config
     */
    showGhost(col, row, typeConfig) {
        // Only update if tile changed
        if (this.ghostTile && this.ghostTile.col === col && this.ghostTile.row === row) return;

        this.hideGhost();

        const seed = 42; // Fixed seed for consistent preview
        const scale = typeConfig.defaultScale || 1.0;
        const rotation = this.editorState.currentRotation || 0;
        const cover = typeConfig.cover || 'none';

        this.ghostMesh = this.proceduralGenerator.createObjectFromType(
            typeConfig.id, seed, scale, rotation, cover
        );

        // Make it semi-transparent
        this.ghostMesh.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = 0.4;
                child.material.depthWrite = false;
            }
        });

        const worldPos = tileToWorld(col, row, CONSTANTS.TILE_SIZE);
        this.ghostMesh.position.x = worldPos.x;
        this.ghostMesh.position.z = worldPos.z;

        this.scene.add(this.ghostMesh);
        this.ghostTile = { col, row };
    }

    /**
     * Hide and dispose the ghost preview.
     */
    hideGhost() {
        if (this.ghostMesh) {
            this.scene.remove(this.ghostMesh);
            this._disposeMesh(this.ghostMesh);
            this.ghostMesh = null;
            this.ghostTile = null;
        }
    }

    // ============================================================
    // Data Export / Import
    // ============================================================

    /**
     * Get all placed object and spawn zone data for export.
     * @returns {{ objects: Array, spawnZones: object }}
     */
    getAllPlacedData() {
        // Build objects array
        const objects = [];
        for (const key in this.placedObjects) {
            const obj = this.placedObjects[key];
            objects.push({
                type: obj.type,
                tile: [obj.col, obj.row],
                seed: obj.seed,
                scale: obj.scale,
                rotation: obj.rotation,
                cover: obj.cover
            });
        }

        // Build spawn zones object
        const spawnZones = {};
        for (const key in this.spawnOverlays) {
            const entry = this.spawnOverlays[key];
            if (!spawnZones[entry.factionId]) {
                spawnZones[entry.factionId] = [];
            }
            spawnZones[entry.factionId].push([entry.col, entry.row]);
        }

        return { objects, spawnZones };
    }

    /**
     * Get all placed light data for export.
     * @returns {Array<object>}
     */
    getAllLightData() {
        const lights = [];
        for (const key in this.placedLights) {
            const entry = this.placedLights[key];
            lights.push({
                type: 'point',
                tile: [entry.col, entry.row],
                color: entry.color,
                intensity: entry.intensity,
                radius: entry.radius,
                height: entry.height
            });
        }
        return lights;
    }

    /**
     * Load objects, spawn zones, and lights from imported map data.
     * Clears all existing placements first.
     * @param {object} mapData — parsed map JSON
     */
    loadFromData(mapData) {
        this.clearAll();

        // Load objects
        if (mapData.objects && Array.isArray(mapData.objects)) {
            for (const obj of mapData.objects) {
                const col = obj.tile[0];
                const row = obj.tile[1];
                const seed = obj.seed || Math.floor(Math.random() * 999999) + 1;
                const scale = obj.scale || 1.0;
                const rotation = obj.rotation || 0;
                const cover = obj.cover || 'none';

                // Create the procedural mesh
                const mesh = this.proceduralGenerator.createObjectFromType(
                    obj.type, seed, scale, rotation, cover
                );

                const worldPos = tileToWorld(col, row, CONSTANTS.TILE_SIZE);
                mesh.position.x = worldPos.x;
                mesh.position.z = worldPos.z;

                this.scene.add(mesh);

                const key = `${col},${row}`;
                this.placedObjects[key] = {
                    type: obj.type,
                    seed: seed,
                    scale: scale,
                    rotation: rotation,
                    cover: cover,
                    mesh: mesh,
                    col: col,
                    row: row
                };

                // Update grid
                this.gridManager.setObject(col, row, obj.type, mesh, cover);
            }
        }

        // Load spawn zones
        if (mapData.spawnZones) {
            for (const factionId in mapData.spawnZones) {
                const tiles = mapData.spawnZones[factionId];
                if (Array.isArray(tiles)) {
                    for (const tile of tiles) {
                        this.setSpawnZone(tile[0], tile[1], factionId);
                    }
                }
            }
        }

        // Load lights
        if (mapData.lights && Array.isArray(mapData.lights)) {
            for (const lightData of mapData.lights) {
                this.placeLight(
                    lightData.tile[0],
                    lightData.tile[1],
                    lightData.color,
                    lightData.intensity,
                    lightData.radius,
                    lightData.height
                );
            }
        }
    }

    // ============================================================
    // Clear All
    // ============================================================

    /**
     * Remove all placed objects, spawn zones, and lights.
     */
    clearAll() {
        // Clear objects
        for (const key in this.placedObjects) {
            const entry = this.placedObjects[key];
            this.scene.remove(entry.mesh);
            this._disposeMesh(entry.mesh);
        }
        this.placedObjects = {};

        // Clear spawn overlays
        for (const key in this.spawnOverlays) {
            const entry = this.spawnOverlays[key];
            this.scene.remove(entry.mesh);
        }
        this.spawnOverlays = {};

        // Clear lights
        for (const key in this.placedLights) {
            const entry = this.placedLights[key];
            this.scene.remove(entry.light);
            entry.light.dispose();
            this.scene.remove(entry.sprite);
            entry.sprite.material.dispose();
        }
        this.placedLights = {};

        // Reset grid tiles
        for (let c = 0; c < this.gridManager.gridWidth; c++) {
            for (let r = 0; r < this.gridManager.gridHeight; r++) {
                const tile = this.gridManager.getTile(c, r);
                if (tile) {
                    tile.objectType = null;
                    tile.objectMesh = null;
                    tile.coverType = 'none';
                    tile.walkable = true;
                    tile.spawnZone = null;
                }
            }
        }

        // Clean up ghost
        this.hideGhost();
    }

    // ============================================================
    // Utility
    // ============================================================

    /**
     * Dispose mesh geometry and materials recursively.
     * @param {THREE.Object3D} object
     * @private
     */
    _disposeMesh(object) {
        if (!object) return;

        object.traverse((child) => {
            if (child.geometry) {
                child.geometry.dispose();
            }
            if (child.material) {
                if (Array.isArray(child.material)) {
                    for (const mat of child.material) {
                        mat.dispose();
                    }
                } else {
                    child.material.dispose();
                }
            }
        });
    }

    /**
     * Dispose all resources.
     */
    dispose() {
        this.clearAll();

        // Dispose shared resources
        this._spawnGeometry.dispose();
        this._spawnMaterials.orderOfTheAbyss.dispose();
        this._spawnMaterials.germani.dispose();
    }
}
