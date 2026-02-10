// Slimline Tactical — Shared Utilities
// EventBus, grid math, A* pathfinding, seeded RNG, math helpers, easing

// ============================================================
// EventBus — Simple pub/sub for decoupled system communication
// ============================================================

class EventBusClass {
    constructor() {
        this._listeners = {};
    }

    on(event, callback) {
        if (!this._listeners[event]) {
            this._listeners[event] = [];
        }
        this._listeners[event].push(callback);
    }

    off(event, callback) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }

    emit(event, data) {
        if (!this._listeners[event]) return;
        for (const callback of this._listeners[event]) {
            callback(data);
        }
    }

    removeAll(event) {
        if (event) {
            delete this._listeners[event];
        } else {
            this._listeners = {};
        }
    }
}

export const EventBus = new EventBusClass();


// ============================================================
// Grid Math
// ============================================================

/**
 * Convert grid tile coordinates to world position (center of tile).
 * Grid lies on XZ plane, Y is up.
 */
export function tileToWorld(col, row, tileSize) {
    return {
        x: col * tileSize + tileSize * 0.5,
        y: 0,
        z: row * tileSize + tileSize * 0.5
    };
}

/**
 * Convert world position (XZ) to grid tile coordinates (floored).
 */
export function worldToTile(x, z, tileSize) {
    return {
        col: Math.floor(x / tileSize),
        row: Math.floor(z / tileSize)
    };
}

/**
 * Chebyshev distance between two tiles (allows diagonal movement at cost 1).
 */
export function tileDistance(a, b) {
    return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

/**
 * Manhattan distance between two tiles.
 */
export function tileManhattan(a, b) {
    return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/**
 * Euclidean distance between two tiles.
 */
export function tileEuclidean(a, b) {
    const dx = a.col - b.col;
    const dy = a.row - b.row;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Get all tiles within Chebyshev distance range, clamped to grid bounds.
 */
export function tilesInRange(origin, range, gridWidth, gridHeight) {
    const tiles = [];
    for (let c = origin.col - range; c <= origin.col + range; c++) {
        for (let r = origin.row - range; r <= origin.row + range; r++) {
            if (c < 0 || c >= gridWidth || r < 0 || r >= gridHeight) continue;
            if (c === origin.col && r === origin.row) continue;
            if (tileDistance(origin, { col: c, row: r }) <= range) {
                tiles.push({ col: c, row: r });
            }
        }
    }
    return tiles;
}

/**
 * Bresenham's line algorithm for grid-based raycasting (LOS).
 * Returns array of {col, row} tiles the line passes through, excluding start.
 */
export function bresenhamLine(start, end) {
    const tiles = [];
    let x0 = start.col;
    let y0 = start.row;
    const x1 = end.col;
    const y1 = end.row;

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
        if (x0 === x1 && y0 === y1) break;

        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y0 += sy;
        }

        tiles.push({ col: x0, row: y0 });
    }

    return tiles;
}

/**
 * Get the 8 neighboring tile positions (or fewer at edges).
 */
export function getNeighbors(col, row, gridWidth, gridHeight) {
    const neighbors = [];
    for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
            if (dc === 0 && dr === 0) continue;
            const nc = col + dc;
            const nr = row + dr;
            if (nc >= 0 && nc < gridWidth && nr >= 0 && nr < gridHeight) {
                neighbors.push({ col: nc, row: nr });
            }
        }
    }
    return neighbors;
}

/**
 * Get the direction vector from one tile to another (normalized to -1, 0, 1).
 */
export function getTileDirection(from, to) {
    const dx = to.col - from.col;
    const dy = to.row - from.row;
    return {
        col: dx === 0 ? 0 : (dx > 0 ? 1 : -1),
        row: dy === 0 ? 0 : (dy > 0 ? 1 : -1)
    };
}

/**
 * Get the angle in radians from one tile to another (on XZ plane).
 */
export function getTileAngle(from, to) {
    return Math.atan2(to.row - from.row, to.col - from.col);
}


// ============================================================
// A* Pathfinding
// ============================================================

/**
 * A* pathfinding on a square grid with 8-directional movement.
 * @param {Object} start - {col, row}
 * @param {Object} end - {col, row}
 * @param {Function} isWalkable - (col, row) => boolean
 * @param {number} gridWidth
 * @param {number} gridHeight
 * @param {Function} [isDiagonalPassable] - Optional callback for diagonal corner checks.
 *   If provided, used instead of isWalkable for the diagonal corner-cutting prevention.
 *   This allows units to path diagonally past occupied tiles (units) while still
 *   preventing cutting corners through walls/cover objects.
 * @returns {Array|null} Array of {col, row} from start (excluded) to end (included), or null if no path.
 */
export function findPath(start, end, isWalkable, gridWidth, gridHeight, isDiagonalPassable = null) {
    if (start.col === end.col && start.row === end.row) return [];
    if (!isWalkable(end.col, end.row)) return null;

    const key = (col, row) => `${col},${row}`;
    const startKey = key(start.col, start.row);
    const endKey = key(end.col, end.row);

    const openSet = new Map();
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    gScore.set(startKey, 0);
    fScore.set(startKey, tileDistance(start, end));
    openSet.set(startKey, { col: start.col, row: start.row });

    while (openSet.size > 0) {
        // Find node in openSet with lowest fScore
        let currentKey = null;
        let currentNode = null;
        let lowestF = Infinity;

        for (const [k, node] of openSet) {
            const f = fScore.get(k) ?? Infinity;
            if (f < lowestF) {
                lowestF = f;
                currentKey = k;
                currentNode = node;
            }
        }

        if (currentKey === endKey) {
            // Reconstruct path
            const path = [];
            let traceKey = endKey;
            while (traceKey && traceKey !== startKey) {
                const parts = traceKey.split(',');
                path.unshift({ col: parseInt(parts[0]), row: parseInt(parts[1]) });
                traceKey = cameFrom.get(traceKey);
            }
            return path;
        }

        openSet.delete(currentKey);
        closedSet.add(currentKey);

        // Check all 8 neighbors
        const neighbors = getNeighbors(currentNode.col, currentNode.row, gridWidth, gridHeight);

        for (const neighbor of neighbors) {
            const neighborKey = key(neighbor.col, neighbor.row);

            if (closedSet.has(neighborKey)) continue;
            if (!isWalkable(neighbor.col, neighbor.row)) continue;

            // Diagonal movement: check that both cardinal neighbors are passable
            // to prevent cutting corners through walls/cover objects.
            // Uses isDiagonalPassable if provided (ignores occupants, only checks terrain),
            // otherwise falls back to isWalkable.
            const dc = neighbor.col - currentNode.col;
            const dr = neighbor.row - currentNode.row;
            if (dc !== 0 && dr !== 0) {
                const passCheck = isDiagonalPassable || isWalkable;
                if (!passCheck(currentNode.col + dc, currentNode.row) ||
                    !passCheck(currentNode.col, currentNode.row + dr)) {
                    continue;
                }
            }

            // Chebyshev distance: diagonal = 1 cost
            const tentativeG = (gScore.get(currentKey) ?? Infinity) + 1;

            if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
                cameFrom.set(neighborKey, currentKey);
                gScore.set(neighborKey, tentativeG);
                fScore.set(neighborKey, tentativeG + tileDistance(neighbor, end));

                if (!openSet.has(neighborKey)) {
                    openSet.set(neighborKey, neighbor);
                }
            }
        }
    }

    return null; // No path found
}


// ============================================================
// Seeded Random Number Generator (Mulberry32)
// ============================================================

/**
 * Creates a deterministic pseudo-random number generator from a seed.
 * Returns a function that produces the next float in [0, 1) each call.
 */
export function seededRandom(seed) {
    let state = seed | 0;
    return function () {
        state |= 0;
        state = state + 0x6D2B79F5 | 0;
        let t = Math.imul(state ^ state >>> 15, 1 | state);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}


// ============================================================
// Math Helpers
// ============================================================

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function degToRad(degrees) {
    return degrees * (Math.PI / 180);
}

export function radToDeg(radians) {
    return radians * (180 / Math.PI);
}

export function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

export function randomInRange(min, max, rng) {
    const r = rng ? rng() : Math.random();
    return min + r * (max - min);
}

export function randomInt(min, max, rng) {
    return Math.floor(randomInRange(min, max + 1, rng));
}

/**
 * Normalize an angle to [-PI, PI].
 */
export function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
}

/**
 * Shortest signed angle difference between two angles.
 */
export function angleDifference(from, to) {
    return normalizeAngle(to - from);
}

/**
 * Remap a value from one range to another.
 */
export function remap(value, inMin, inMax, outMin, outMax) {
    const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
    return outMin + t * (outMax - outMin);
}


// ============================================================
// Easing Functions
// ============================================================

export function easeInOutCubic(t) {
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

export function easeInCubic(t) {
    return t * t * t;
}

export function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
}

export function easeInQuad(t) {
    return t * t;
}

export function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function easeOutElastic(t) {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 :
        Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

export function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}


// ============================================================
// Promise / Timing Helpers
// ============================================================

/**
 * Returns a promise that resolves after the specified duration in seconds.
 */
export function delay(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Creates a deferred promise with external resolve/reject.
 */
export function createDeferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}


// ============================================================
// Color Helpers
// ============================================================

/**
 * Parse a hex color string (#rrggbb) to a numeric hex value.
 */
export function parseHexColor(hexString) {
    if (hexString.startsWith('#')) {
        return parseInt(hexString.slice(1), 16);
    }
    return parseInt(hexString, 16);
}

/**
 * Convert a hex number to {r, g, b} in [0, 1] range.
 */
export function hexToRGB(hex) {
    return {
        r: ((hex >> 16) & 0xff) / 255,
        g: ((hex >> 8) & 0xff) / 255,
        b: (hex & 0xff) / 255
    };
}
