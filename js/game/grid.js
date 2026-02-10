// Slimline Tactical — Grid Manager
// 2D tile grid with occupants, cover, highlights, BFS movement, LOS

import * as THREE from 'three';
import { CONSTANTS } from '../shared/constants.js';
import {
    tileToWorld, tileDistance, getNeighbors,
    bresenhamLine, getTileDirection
} from '../shared/utils.js';

export class GridManager {
    /**
     * @param {THREE.Scene} scene
     * @param {number} gridWidth — columns
     * @param {number} gridHeight — rows
     * @param {number} tileSize
     */
    constructor(scene, gridWidth, gridHeight, tileSize) {
        this.scene = scene;
        this.gridWidth = gridWidth;
        this.gridHeight = gridHeight;
        this.tileSize = tileSize;

        // ---- Tile data array ----
        // tiles[col][row]
        this.tiles = [];
        for (let c = 0; c < gridWidth; c++) {
            this.tiles[c] = [];
            for (let r = 0; r < gridHeight; r++) {
                this.tiles[c][r] = {
                    col: c,
                    row: r,
                    walkable: true,
                    coverType: 'none',    // 'none' | 'half' | 'full'
                    coverDirection: null,  // direction the cover faces (for directional cover)
                    objectType: null,      // string type id of placed object
                    objectMesh: null,      // THREE.Object3D reference
                    occupant: null,        // unit reference or null
                    spawnZone: null        // faction id or null
                };
            }
        }

        // ---- Grid overlay lines ----
        this.gridOverlay = this._createGridOverlay();
        this.scene.add(this.gridOverlay);

        // ---- Tile highlight system ----
        this.highlightMeshes = [];          // pool of reusable highlight quads
        this.activeHighlights = [];         // currently visible highlights
        this.singleHighlightMesh = null;    // single tile hover highlight
        this._createHighlightPool();
        this._createSingleHighlight();
    }

    // ============================================================
    // Grid Overlay
    // ============================================================

    _createGridOverlay() {
        const positions = [];
        const w = this.gridWidth;
        const h = this.gridHeight;
        const s = this.tileSize;
        const y = 0.01; // slightly above ground to avoid z-fighting

        // Vertical lines
        for (let c = 0; c <= w; c++) {
            positions.push(c * s, y, 0);
            positions.push(c * s, y, h * s);
        }

        // Horizontal lines
        for (let r = 0; r <= h; r++) {
            positions.push(0, y, r * s);
            positions.push(w * s, y, r * s);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
            color: 0x222233,
            transparent: true,
            opacity: 0.25,
            depthWrite: false
        });

        return new THREE.LineSegments(geometry, material);
    }

    // ============================================================
    // Highlight System
    // ============================================================

    _createHighlightPool() {
        // Pre-create a pool of highlight quads for movement/attack range display
        const poolSize = this.gridWidth * this.gridHeight; // worst case: entire grid
        const geometry = new THREE.PlaneGeometry(this.tileSize * 0.92, this.tileSize * 0.92);
        geometry.rotateX(-Math.PI / 2); // lay flat on XZ

        for (let i = 0; i < poolSize; i++) {
            const material = new THREE.MeshBasicMaterial({
                color: 0x4466ff,
                transparent: true,
                opacity: 0.25,
                depthWrite: false,
                side: THREE.DoubleSide
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = 0.02; // slightly above grid lines
            mesh.visible = false;
            mesh.renderOrder = 1;
            this.scene.add(mesh);
            this.highlightMeshes.push(mesh);
        }
    }

    _createSingleHighlight() {
        const geometry = new THREE.PlaneGeometry(this.tileSize * 0.96, this.tileSize * 0.96);
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.MeshBasicMaterial({
            color: 0xffcc44,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.singleHighlightMesh = new THREE.Mesh(geometry, material);
        this.singleHighlightMesh.position.y = 0.03;
        this.singleHighlightMesh.visible = false;
        this.singleHighlightMesh.renderOrder = 2;
        this.scene.add(this.singleHighlightMesh);
    }

    // ============================================================
    // Tile Data Access
    // ============================================================

    /**
     * Get tile data at given grid coordinates.
     * @param {number} col
     * @param {number} row
     * @returns {object|null}
     */
    getTile(col, row) {
        if (col < 0 || col >= this.gridWidth || row < 0 || row >= this.gridHeight) return null;
        return this.tiles[col][row];
    }

    /**
     * Set the occupant of a tile.
     * @param {number} col
     * @param {number} row
     * @param {object} unit
     */
    setOccupant(col, row, unit) {
        const tile = this.getTile(col, row);
        if (tile) tile.occupant = unit;
    }

    /**
     * Clear the occupant from a tile.
     * @param {number} col
     * @param {number} row
     */
    clearOccupant(col, row) {
        const tile = this.getTile(col, row);
        if (tile) tile.occupant = null;
    }

    /**
     * Check if a tile is walkable (in bounds, walkable flag true, no occupant).
     * @param {number} col
     * @param {number} row
     * @returns {boolean}
     */
    isWalkable(col, row) {
        const tile = this.getTile(col, row);
        if (!tile) return false;
        return tile.walkable && !tile.occupant;
    }

    /**
     * Check if a tile is in bounds and walkable (ignoring occupants).
     * @param {number} col
     * @param {number} row
     * @returns {boolean}
     */
    isWalkableIgnoreOccupant(col, row) {
        const tile = this.getTile(col, row);
        if (!tile) return false;
        return tile.walkable;
    }

    /**
     * Set cover data for a tile.
     * @param {number} col
     * @param {number} row
     * @param {string} coverType — 'none' | 'half' | 'full'
     * @param {object|null} direction — normalized direction cover faces
     */
    setCover(col, row, coverType, direction) {
        const tile = this.getTile(col, row);
        if (tile) {
            tile.coverType = coverType;
            tile.coverDirection = direction;
        }
    }

    /**
     * Set an object on a tile (marks as non-walkable if cover is not 'none').
     * @param {number} col
     * @param {number} row
     * @param {string} objectType — type identifier
     * @param {THREE.Object3D} mesh
     * @param {string} coverType
     */
    setObject(col, row, objectType, mesh, coverType) {
        const tile = this.getTile(col, row);
        if (tile) {
            tile.objectType = objectType;
            tile.objectMesh = mesh;
            tile.coverType = coverType || 'none';
            // Objects with cover block walking through them
            if (coverType && coverType !== 'none') {
                tile.walkable = false;
            }
        }
    }

    /**
     * Set spawn zone for a tile.
     * @param {number} col
     * @param {number} row
     * @param {string} factionId
     */
    setSpawnZone(col, row, factionId) {
        const tile = this.getTile(col, row);
        if (tile) tile.spawnZone = factionId;
    }

    /**
     * Get all spawn tiles for a faction.
     * @param {string} factionId
     * @returns {Array<{col: number, row: number}>}
     */
    getSpawnTiles(factionId) {
        const tiles = [];
        for (let c = 0; c < this.gridWidth; c++) {
            for (let r = 0; r < this.gridHeight; r++) {
                if (this.tiles[c][r].spawnZone === factionId) {
                    tiles.push({ col: c, row: r });
                }
            }
        }
        return tiles;
    }

    // ============================================================
    // Highlight Methods
    // ============================================================

    /**
     * Show highlight quads at specified tile positions.
     * @param {Array<{col: number, row: number}>} tiles
     * @param {THREE.Color|number} color
     * @param {number} opacity
     */
    highlightTiles(tiles, color, opacity = 0.25) {
        this.clearHighlights();

        const threeColor = new THREE.Color(color);

        for (let i = 0; i < tiles.length && i < this.highlightMeshes.length; i++) {
            const tile = tiles[i];
            const mesh = this.highlightMeshes[i];
            const worldPos = tileToWorld(tile.col, tile.row, this.tileSize);

            mesh.position.x = worldPos.x;
            mesh.position.z = worldPos.z;
            mesh.material.color.copy(threeColor);
            mesh.material.opacity = opacity;
            mesh.visible = true;

            this.activeHighlights.push(mesh);
        }
    }

    /**
     * Hide all tile highlights.
     */
    clearHighlights() {
        for (const mesh of this.activeHighlights) {
            mesh.visible = false;
        }
        this.activeHighlights = [];
    }

    /**
     * Highlight a single tile (for hover effect).
     * @param {number} col
     * @param {number} row
     * @param {THREE.Color|number} color
     */
    highlightSingle(col, row, color) {
        const worldPos = tileToWorld(col, row, this.tileSize);
        this.singleHighlightMesh.position.x = worldPos.x;
        this.singleHighlightMesh.position.z = worldPos.z;
        this.singleHighlightMesh.material.color.set(color || 0xffcc44);
        this.singleHighlightMesh.visible = true;
    }

    /**
     * Hide the single hover highlight.
     */
    clearSingleHighlight() {
        this.singleHighlightMesh.visible = false;
    }

    // ============================================================
    // Movement Range (BFS Flood Fill)
    // ============================================================

    /**
     * Get all tiles reachable from start within moveRange steps.
     * Uses BFS with 8-directional movement, respecting walkability.
     * @param {number} startCol
     * @param {number} startRow
     * @param {number} moveRange
     * @returns {Array<{col: number, row: number, cost: number}>}
     */
    getMovementRange(startCol, startRow, moveRange) {
        const reachable = [];
        const visited = new Set();
        const queue = [{ col: startCol, row: startRow, cost: 0 }];
        const startKey = `${startCol},${startRow}`;
        visited.add(startKey);

        while (queue.length > 0) {
            const current = queue.shift();

            if (current.cost > 0) {
                reachable.push(current);
            }

            if (current.cost >= moveRange) continue;

            const neighbors = getNeighbors(current.col, current.row, this.gridWidth, this.gridHeight);

            for (const neighbor of neighbors) {
                const key = `${neighbor.col},${neighbor.row}`;
                if (visited.has(key)) continue;
                if (!this.isWalkable(neighbor.col, neighbor.row)) continue;

                // Diagonal movement: check that both cardinal neighbors are walkable
                // to prevent cutting corners through walls/cover objects
                const dc = neighbor.col - current.col;
                const dr = neighbor.row - current.row;
                if (dc !== 0 && dr !== 0) {
                    if (!this.isWalkableIgnoreOccupant(current.col + dc, current.row) ||
                        !this.isWalkableIgnoreOccupant(current.col, current.row + dr)) {
                        continue;
                    }
                }

                visited.add(key);
                queue.push({ col: neighbor.col, row: neighbor.row, cost: current.cost + 1 });
            }
        }

        return reachable;
    }

    /**
     * Find a path between two tiles.
     * Uses BFS with the same walkability and diagonal corner rules as movement range.
     * @param {{col: number, row: number}} start
     * @param {{col: number, row: number}} end
     * @returns {Array<{col: number, row: number}>|null}
     */
    findPath(start, end) {
        return this._findPathBFS(start, end, false);
    }

    /**
     * Find a path allowing the destination to be occupied (for moving TO an enemy's adjacent tile).
     * @param {{col: number, row: number}} start
     * @param {{col: number, row: number}} end
     * @returns {Array<{col: number, row: number}>|null}
     */
    findPathAllowDestination(start, end) {
        return this._findPathBFS(start, end, true);
    }

    /**
     * Internal BFS path search used by player and AI movement.
     * Keeps path results consistent with getMovementRange() rules.
     * @param {{col: number, row: number}} start
     * @param {{col: number, row: number}} end
     * @param {boolean} allowDestinationOccupied
     * @returns {Array<{col: number, row: number}>|null}
     */
    _findPathBFS(start, end, allowDestinationOccupied = false) {
        const startCol = Number(start?.col);
        const startRow = Number(start?.row);
        const endCol = Number(end?.col);
        const endRow = Number(end?.row);

        if (!Number.isFinite(startCol) || !Number.isFinite(startRow) ||
            !Number.isFinite(endCol) || !Number.isFinite(endRow)) {
            return null;
        }

        if (startCol === endCol && startRow === endRow) return [];

        const destinationWalkable = allowDestinationOccupied
            ? this.isWalkableIgnoreOccupant(endCol, endRow)
            : this.isWalkable(endCol, endRow);

        if (!destinationWalkable) return null;

        const key = (col, row) => `${col},${row}`;
        const startKey = key(startCol, startRow);
        const endKey = key(endCol, endRow);

        const queue = [{ col: startCol, row: startRow }];
        const visited = new Set([startKey]);
        const cameFrom = new Map();

        let found = false;

        while (queue.length > 0 && !found) {
            const current = queue.shift();

            if (current.col === endCol && current.row === endRow) {
                found = true;
                break;
            }

            const neighbors = getNeighbors(current.col, current.row, this.gridWidth, this.gridHeight);

            for (const neighbor of neighbors) {
                const neighborKey = key(neighbor.col, neighbor.row);
                if (visited.has(neighborKey)) continue;

                const isDestination = neighbor.col === endCol && neighbor.row === endRow;
                const walkable = (isDestination && allowDestinationOccupied)
                    ? this.isWalkableIgnoreOccupant(neighbor.col, neighbor.row)
                    : this.isWalkable(neighbor.col, neighbor.row);

                if (!walkable) continue;

                // Diagonal movement: check that both cardinal neighbors are passable
                // to prevent corner-cutting through walls/cover.
                const dc = neighbor.col - current.col;
                const dr = neighbor.row - current.row;
                if (dc !== 0 && dr !== 0) {
                    if (!this.isWalkableIgnoreOccupant(current.col + dc, current.row) ||
                        !this.isWalkableIgnoreOccupant(current.col, current.row + dr)) {
                        continue;
                    }
                }

                visited.add(neighborKey);
                cameFrom.set(neighborKey, key(current.col, current.row));

                if (neighbor.col === endCol && neighbor.row === endRow) {
                    found = true;
                    break;
                }

                queue.push(neighbor);
            }
        }

        if (!found) return null;

        const path = [];
        let currentKey = endKey;

        while (currentKey !== startKey) {
            const parts = currentKey.split(',');
            path.unshift({ col: parseInt(parts[0], 10), row: parseInt(parts[1], 10) });
            currentKey = cameFrom.get(currentKey);
            if (!currentKey) return null;
        }

        return path;
    }

    // ============================================================
    // Line of Sight & Cover
    // ============================================================

    /**
     * Check line of sight and cover between attacker and target tiles.
     * Uses Bresenham's line to trace from attacker to target.
     * @param {number} fromCol — attacker column
     * @param {number} fromRow — attacker row
     * @param {number} toCol — target column
     * @param {number} toRow — target row
     * @returns {{ clear: boolean, coverPenalty: number, coverType: string }}
     */
    checkLOS(fromCol, fromRow, toCol, toRow) {
        const start = { col: fromCol, row: fromRow };
        const end = { col: toCol, row: toRow };

        // Get all tiles the line passes through (excluding start)
        const lineTiles = bresenhamLine(start, end);

        // Check for full-blocking obstacles along the path (exclude the target tile itself)
        for (let i = 0; i < lineTiles.length; i++) {
            const lt = lineTiles[i];

            // Don't check the target tile for blocking — we check it for cover separately
            if (lt.col === toCol && lt.row === toRow) continue;

            const tile = this.getTile(lt.col, lt.row);
            if (!tile) continue;

            // Full cover objects in the path block LOS
            if (tile.coverType === 'full' && tile.objectType) {
                return { clear: false, coverPenalty: 0, coverType: 'blocked' };
            }
        }

        // LOS is clear — now check directional cover at the target's position
        const coverResult = this.getCoverBetween(start, end);

        return {
            clear: true,
            coverPenalty: coverResult.penalty,
            coverType: coverResult.coverType
        };
    }

    /**
     * Determine cover protection the target gets from the attacker's direction.
     * Checks tiles adjacent to the target that are between the attacker and target.
     * @param {{col: number, row: number}} attackerTile
     * @param {{col: number, row: number}} targetTile
     * @returns {{ coverType: string, penalty: number }}
     */
    getCoverBetween(attackerTile, targetTile) {
        const dir = getTileDirection(attackerTile, targetTile);

        // Check the tile(s) adjacent to the target that lie on the attacker's side
        // These are the tiles the target might be hiding behind
        const checkPositions = [];

        // Primary: tile directly between attacker and target
        if (dir.col !== 0) {
            checkPositions.push({
                col: targetTile.col - dir.col,
                row: targetTile.row
            });
        }
        if (dir.row !== 0) {
            checkPositions.push({
                col: targetTile.col,
                row: targetTile.row - dir.row
            });
        }
        // Diagonal case: also check the diagonal between
        if (dir.col !== 0 && dir.row !== 0) {
            checkPositions.push({
                col: targetTile.col - dir.col,
                row: targetTile.row - dir.row
            });
        }

        let bestCover = 'none';
        let bestPenalty = 0;

        for (const pos of checkPositions) {
            const tile = this.getTile(pos.col, pos.row);
            if (!tile) continue;

            if (tile.coverType === 'full' && tile.objectType) {
                // Full cover from this direction
                if (Math.abs(CONSTANTS.COVER_BONUS.full) > Math.abs(bestPenalty)) {
                    bestCover = 'full';
                    bestPenalty = CONSTANTS.COVER_BONUS.full;
                }
            } else if (tile.coverType === 'half' && tile.objectType) {
                // Half cover from this direction
                if (Math.abs(CONSTANTS.COVER_BONUS.half) > Math.abs(bestPenalty)) {
                    bestCover = 'half';
                    bestPenalty = CONSTANTS.COVER_BONUS.half;
                }
            }
        }

        return { coverType: bestCover, penalty: bestPenalty };
    }

    /**
     * Check if the target would be flanked by the attacker.
     * Flanking occurs when attacking from the side/rear relative to the target's facing.
     * @param {{col: number, row: number}} attackerTile
     * @param {{col: number, row: number}} targetTile
     * @param {{col: number, row: number}} targetFacing — direction target is facing
     * @returns {boolean}
     */
    checkFlanking(attackerTile, targetTile, targetFacing) {
        if (!targetFacing) return false;

        // Direction from target to attacker
        const toAttacker = getTileDirection(targetTile, attackerTile);

        // If attacking from the opposite direction of the target's facing, it's a flank
        // More precisely: if the dot product of facing and toAttacker directions is negative
        const dot = targetFacing.col * toAttacker.col + targetFacing.row * toAttacker.row;

        // dot < 0 means attacking from behind; dot === 0 means attacking from the side
        // Both count as flanking
        return dot <= 0;
    }

    /**
     * Get all tiles adjacent to cover (for AI cover-seeking behavior).
     * @param {Array<{col: number, row: number}>} searchTiles — tiles to check
     * @returns {Array<{col: number, row: number, coverType: string}>}
     */
    getCoverAdjacentTiles(searchTiles) {
        const result = [];

        for (const tile of searchTiles) {
            const neighbors = getNeighbors(tile.col, tile.row, this.gridWidth, this.gridHeight);
            let bestAdjacentCover = 'none';

            for (const n of neighbors) {
                const nTile = this.getTile(n.col, n.row);
                if (!nTile) continue;
                if (nTile.coverType === 'full') {
                    bestAdjacentCover = 'full';
                    break;
                }
                if (nTile.coverType === 'half' && bestAdjacentCover !== 'full') {
                    bestAdjacentCover = 'half';
                }
            }

            if (bestAdjacentCover !== 'none') {
                result.push({
                    col: tile.col,
                    row: tile.row,
                    coverType: bestAdjacentCover
                });
            }
        }

        return result;
    }

    // ============================================================
    // Grid Visibility
    // ============================================================

    /**
     * Show or hide the grid overlay lines.
     * @param {boolean} visible
     */
    setGridVisible(visible) {
        this.gridOverlay.visible = visible;
    }

    // ============================================================
    // Cleanup
    // ============================================================

    /**
     * Remove all grid-related objects from the scene and dispose geometries/materials.
     */
    dispose() {
        // Remove grid overlay
        this.scene.remove(this.gridOverlay);
        this.gridOverlay.geometry.dispose();
        this.gridOverlay.material.dispose();

        // Remove highlight pool
        for (const mesh of this.highlightMeshes) {
            this.scene.remove(mesh);
            mesh.material.dispose();
        }
        // Shared geometry — dispose once
        if (this.highlightMeshes.length > 0) {
            this.highlightMeshes[0].geometry.dispose();
        }
        this.highlightMeshes = [];
        this.activeHighlights = [];

        // Remove single highlight
        if (this.singleHighlightMesh) {
            this.scene.remove(this.singleHighlightMesh);
            this.singleHighlightMesh.geometry.dispose();
            this.singleHighlightMesh.material.dispose();
            this.singleHighlightMesh = null;
        }
    }
}
