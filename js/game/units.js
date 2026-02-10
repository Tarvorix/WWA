// Slimline Tactical — Unit Manager
// Loads faction models, creates units, handles animation, movement, selection

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONSTANTS } from '../shared/constants.js';
import {
    EventBus, tileToWorld, tileDistance,
    lerp, clamp, normalizeAngle, easeInOutCubic
} from '../shared/utils.js';

const MOVE = CONSTANTS.MOVEMENT;

export class UnitManager {
    /**
     * @param {THREE.Scene} scene
     * @param {import('./grid.js').GridManager} gridManager
     * @param {object} gameState
     */
    constructor(scene, gridManager, gameState) {
        this.scene = scene;
        this.gridManager = gridManager;
        this.gameState = gameState;

        this.gltfLoader = new GLTFLoader();
        this.units = [];       // all unit objects
        this.modelCache = {};  // { factionId: { model, clips: { animName: AnimationClip } } }

        // Unit ID counter
        this._nextId = 0;
    }

    // ============================================================
    // Model Loading
    // ============================================================

    /**
     * Load all animation GLBs for a faction.
     * The idle GLB provides the base model/skeleton; other GLBs provide animation clips.
     * @param {string} factionId
     * @returns {Promise}
     */
    async loadFactionModels(factionId) {
        const factionConfig = CONSTANTS.FACTIONS[factionId];
        if (!factionConfig) {
            throw new Error(`Unknown faction: ${factionId}`);
        }

        const basePath = factionConfig.modelPath;
        const prefix = factionConfig.modelPrefix;
        const animNames = CONSTANTS.ANIMATIONS;

        const cache = {
            model: null,
            clips: {}
        };

        // Load all animation GLBs
        const loadPromises = animNames.map(async (animName) => {
            const path = `${basePath}${prefix}_${animName}.glb`;

            try {
                const gltf = await this._loadGLTF(path);

                if (animName === 'idle') {
                    // The idle GLB provides the base model
                    cache.model = gltf.scene;

                    // Configure all meshes in the model
                    gltf.scene.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                            // Ensure materials render correctly
                            if (child.material) {
                                child.material.side = THREE.FrontSide;
                                // Boost material visibility — ensure not too dark
                                if (child.material.isMeshStandardMaterial || child.material.isMeshPhysicalMaterial) {
                                    // Lighten overly dark materials
                                    const color = child.material.color;
                                    const lum = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
                                    if (lum < 0.15) {
                                        color.multiplyScalar(2.5);
                                    }
                                }
                            }
                        }
                    });
                }

                // Store the animation clip(s) from each GLB
                if (gltf.animations && gltf.animations.length > 0) {
                    // Use the first animation clip from each file
                    cache.clips[animName] = gltf.animations[0];
                }

                // Dispose non-idle GLTF scenes — they contain duplicate mesh/texture data
                // that wastes GPU memory. We only need the animation clips from them.
                if (animName !== 'idle') {
                    gltf.scene.traverse((child) => {
                        if (child.isMesh) {
                            if (child.geometry) child.geometry.dispose();
                            if (child.material) {
                                const materials = Array.isArray(child.material) ? child.material : [child.material];
                                for (const mat of materials) {
                                    for (const key of Object.keys(mat)) {
                                        if (mat[key] && mat[key].isTexture) {
                                            mat[key].dispose();
                                        }
                                    }
                                    mat.dispose();
                                }
                            }
                        }
                    });
                }
            } catch (err) {
                console.warn(`UnitManager: Failed to load ${path}:`, err);
            }
        });

        await Promise.all(loadPromises);

        if (!cache.model) {
            throw new Error(`Failed to load base model for faction "${factionId}"`);
        }

        this.modelCache[factionId] = cache;
    }

    /**
     * Load a GLTF/GLB file.
     * @param {string} path
     * @returns {Promise<GLTF>}
     */
    _loadGLTF(path) {
        return new Promise((resolve, reject) => {
            this.gltfLoader.load(
                path,
                (gltf) => resolve(gltf),
                undefined,
                (err) => reject(err)
            );
        });
    }

    // ============================================================
    // Unit Creation
    // ============================================================

    /**
     * Create a single unit at a grid position.
     * @param {string} factionId
     * @param {number} unitIndex — index within the squad (0-4)
     * @param {number} spawnCol
     * @param {number} spawnRow
     * @returns {object} unit object
     */
    createUnit(factionId, unitIndex, spawnCol, spawnRow) {
        const factionConfig = CONSTANTS.FACTIONS[factionId];
        const cache = this.modelCache[factionId];

        if (!cache || !cache.model) {
            throw new Error(`Model cache not loaded for faction "${factionId}"`);
        }

        // Clone the model (SkeletonUtils.clone handles skinned meshes properly)
        const model = SkeletonUtils.clone(cache.model);

        // Scale model if needed (default is 1:1)
        // model.scale.setScalar(1.0);

        // Create animation mixer for this unit instance
        const mixer = new THREE.AnimationMixer(model);

        // Create animation actions from cached clips
        const animations = {};
        for (const [animName, clip] of Object.entries(cache.clips)) {
            const action = mixer.clipAction(clip);
            animations[animName] = action;
        }

        // Position at spawn tile
        const worldPos = tileToWorld(spawnCol, spawnRow, CONSTANTS.TILE_SIZE);
        model.position.set(worldPos.x, 0, worldPos.z);

        // Create faction-colored point light attached to unit
        const unitLight = new THREE.PointLight(
            factionConfig.unitLightColor,
            CONSTANTS.LIGHTING.unitLightIntensity,
            CONSTANTS.LIGHTING.unitLightRadius,
            CONSTANTS.LIGHTING.unitLightDecay
        );
        unitLight.position.set(0, 1.2, 0); // slightly above unit center
        unitLight.castShadow = false;
        model.add(unitLight);

        // Build unit object
        const unit = {
            id: `${factionId}_${unitIndex}`,
            faction: factionId,
            factionConfig: factionConfig,
            unitType: factionConfig.unitType,
            unitLabel: factionConfig.unitLabel,
            tile: { col: spawnCol, row: spawnRow },
            hp: CONSTANTS.UNIT_STATS.hp,
            maxHp: CONSTANTS.UNIT_STATS.hp,
            ap: CONSTANTS.UNIT_STATS.ap,
            maxAp: CONSTANTS.UNIT_STATS.ap,
            activated: false,
            alive: true,
            status: CONSTANTS.UNIT_STATUS.READY,
            facing: factionId === 'orderOfTheAbyss' ? { col: 1, row: 0 } : { col: -1, row: 0 },
            overwatchCone: null,
            model: model,
            mixer: mixer,
            animations: animations,
            currentAnimation: 'idle',
            unitLight: unitLight,
            isMoving: false,
            movePath: [],
            moveIndex: 0,
            moveProgress: 0,
            moveResolve: null, // promise resolve for movement completion
            _unitIndex: unitIndex
        };

        // Start idle animation
        if (animations.idle) {
            animations.idle.reset();
            animations.idle.setLoop(THREE.LoopRepeat, Infinity);
            animations.idle.play();
        }

        // Register on grid
        this.gridManager.setOccupant(spawnCol, spawnRow, unit);

        // Add model to scene
        this.scene.add(model);

        // Store
        this.units.push(unit);
        this.gameState.units.push(unit);

        return unit;
    }

    /**
     * Spawn an entire squad for a faction at their spawn tiles.
     * @param {string} factionId
     * @returns {Array<object>} spawned units
     */
    spawnSquad(factionId) {
        const factionConfig = CONSTANTS.FACTIONS[factionId];
        const spawnTiles = this.gridManager.getSpawnTiles(factionId);
        const squadSize = factionConfig.squadSize;
        const spawned = [];

        for (let i = 0; i < squadSize && i < spawnTiles.length; i++) {
            const tile = spawnTiles[i];
            const unit = this.createUnit(factionId, i, tile.col, tile.row);
            spawned.push(unit);
        }

        return spawned;
    }

    // ============================================================
    // Selection
    // ============================================================

    /**
     * Select a unit.
     * @param {object} unit
     */
    selectUnit(unit) {
        this.gameState.selectedUnit = unit;
        EventBus.emit('unit:selected', unit);
    }

    /**
     * Deselect the currently selected unit.
     */
    deselectUnit() {
        const prev = this.gameState.selectedUnit;
        this.gameState.selectedUnit = null;
        EventBus.emit('unit:deselected', prev);
    }

    // ============================================================
    // Animation
    // ============================================================

    /**
     * Crossfade to a specified animation.
     * @param {object} unit
     * @param {string} animName — animation name from CONSTANTS.ANIMATIONS
     * @param {object} options — { loop: boolean, onComplete: Function, crossFadeDuration: number }
     */
    playAnimation(unit, animName, options = {}) {
        const action = unit.animations[animName];
        if (!action) {
            console.warn(`UnitManager: Animation "${animName}" not found for unit ${unit.id}`);
            return;
        }

        const {
            loop = true,
            onComplete = null,
            crossFadeDuration = MOVE.animCrossFadeDuration
        } = options;

        // Get current playing action
        const currentAction = unit.animations[unit.currentAnimation];

        // Configure new action
        action.reset();
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
        action.clampWhenFinished = !loop;

        if (currentAction && currentAction !== action) {
            // Crossfade from current to new
            action.crossFadeFrom(currentAction, crossFadeDuration, true);
        }

        action.play();
        unit.currentAnimation = animName;

        // Handle one-shot completion
        if (!loop && onComplete) {
            const onFinished = (e) => {
                if (e.action === action) {
                    unit.mixer.removeEventListener('finished', onFinished);
                    onComplete();
                }
            };
            unit.mixer.addEventListener('finished', onFinished);
        }
    }

    /**
     * Play an animation and return a promise that resolves when it completes.
     * @param {object} unit
     * @param {string} animName
     * @param {object} options
     * @returns {Promise}
     */
    playAnimationAsync(unit, animName, options = {}) {
        return new Promise(resolve => {
            this.playAnimation(unit, animName, {
                ...options,
                loop: false,
                onComplete: resolve
            });
        });
    }

    /**
     * Rotate unit model to face a target tile.
     * @param {object} unit
     * @param {{ col: number, row: number }} targetTile
     */
    faceTarget(unit, targetTile) {
        const targetWorld = tileToWorld(targetTile.col, targetTile.row, CONSTANTS.TILE_SIZE);
        const dx = targetWorld.x - unit.model.position.x;
        const dz = targetWorld.z - unit.model.position.z;
        const angle = Math.atan2(dx, dz);

        unit.model.rotation.y = angle;

        // Update facing direction
        unit.facing = {
            col: dx === 0 ? 0 : (dx > 0 ? 1 : -1),
            row: dz === 0 ? 0 : (dz > 0 ? 1 : -1)
        };
    }

    /**
     * Smoothly rotate unit to face a direction over time.
     * @param {object} unit
     * @param {number} targetAngle — radians
     * @param {number} deltaTime
     */
    _smoothRotate(unit, targetAngle, deltaTime) {
        const current = unit.model.rotation.y;
        let diff = normalizeAngle(targetAngle - current);
        const step = MOVE.rotationSpeed * deltaTime;

        if (Math.abs(diff) < step) {
            unit.model.rotation.y = targetAngle;
        } else {
            unit.model.rotation.y += Math.sign(diff) * step;
        }
    }

    // ============================================================
    // Movement
    // ============================================================

    /**
     * Move a unit along a path (array of {col, row}).
     * Returns a promise that resolves when movement is complete.
     * @param {object} unit
     * @param {Array<{col: number, row: number}>} path — tiles to visit in order
     * @returns {Promise}
     */
    moveUnit(unit, path) {
        return new Promise(resolve => {
            if (!path || path.length === 0) {
                resolve();
                return;
            }

            unit.isMoving = true;
            unit.movePath = path;
            unit.moveIndex = 0;
            unit.moveProgress = 0;
            unit.moveResolve = resolve;

            // Determine animation: walk for short moves, run for longer
            const animName = path.length > 2 ? 'run' : 'walk';
            const speed = path.length > 2 ? MOVE.runSpeed : MOVE.walkSpeed;
            unit._moveSpeed = speed;

            this.playAnimation(unit, animName, { loop: true });

            // Clear occupant from old tile
            this.gridManager.clearOccupant(unit.tile.col, unit.tile.row);
        });
    }

    /**
     * Update movement for all moving units (called each frame).
     * @param {number} deltaTime
     */
    _updateMovement(deltaTime) {
        for (const unit of this.units) {
            if (!unit.isMoving || !unit.movePath || unit.movePath.length === 0) continue;

            const path = unit.movePath;
            const speed = unit._moveSpeed || MOVE.walkSpeed;

            // Current and next waypoint
            const currentWaypoint = unit.moveIndex === 0
                ? tileToWorld(unit.tile.col, unit.tile.row, CONSTANTS.TILE_SIZE)
                : tileToWorld(path[unit.moveIndex - 1].col, path[unit.moveIndex - 1].row, CONSTANTS.TILE_SIZE);

            const nextWaypoint = tileToWorld(path[unit.moveIndex].col, path[unit.moveIndex].row, CONSTANTS.TILE_SIZE);

            // Distance between waypoints
            const dx = nextWaypoint.x - currentWaypoint.x;
            const dz = nextWaypoint.z - currentWaypoint.z;
            const segmentDist = Math.sqrt(dx * dx + dz * dz);

            // Progress along segment
            unit.moveProgress += (speed * deltaTime) / segmentDist;

            // Rotate toward next waypoint
            const targetAngle = Math.atan2(dx, dz);
            this._smoothRotate(unit, targetAngle, deltaTime);

            if (unit.moveProgress >= 1.0) {
                // Arrived at waypoint
                const arrivedTile = path[unit.moveIndex];

                // Update unit tile
                unit.tile.col = arrivedTile.col;
                unit.tile.row = arrivedTile.row;

                // Snap position
                const snappedPos = tileToWorld(arrivedTile.col, arrivedTile.row, CONSTANTS.TILE_SIZE);
                unit.model.position.x = snappedPos.x;
                unit.model.position.z = snappedPos.z;

                // Emit movement step event (for overwatch checking)
                EventBus.emit('unit:movedStep', {
                    unit,
                    from: unit.moveIndex > 0 ? path[unit.moveIndex - 1] : unit.tile,
                    to: arrivedTile
                });

                unit.moveIndex++;
                unit.moveProgress = 0;

                if (unit.moveIndex >= path.length) {
                    // Movement complete
                    this._finishMovement(unit);
                }
            } else {
                // Interpolate position
                const t = unit.moveProgress;
                unit.model.position.x = lerp(currentWaypoint.x, nextWaypoint.x, t);
                unit.model.position.z = lerp(currentWaypoint.z, nextWaypoint.z, t);
            }
        }
    }

    /**
     * Complete movement for a unit.
     * @param {object} unit
     */
    _finishMovement(unit) {
        unit.isMoving = false;

        // Set occupant on final tile
        this.gridManager.setOccupant(unit.tile.col, unit.tile.row, unit);

        // Update facing direction based on last movement segment
        if (unit.movePath.length >= 2) {
            const lastTwo = unit.movePath.slice(-2);
            unit.facing = {
                col: lastTwo[1].col - lastTwo[0].col || 0,
                row: lastTwo[1].row - lastTwo[0].row || 0
            };
        } else if (unit.movePath.length === 1) {
            // Update facing based on single step
            const step = unit.movePath[0];
            const prevCol = unit.tile.col;
            const prevRow = unit.tile.row;
            // facing was already set during move
        }

        // Return to idle animation
        this.playAnimation(unit, 'idle', { loop: true });

        // Clean up movement state
        const resolve = unit.moveResolve;
        unit.movePath = [];
        unit.moveIndex = 0;
        unit.moveProgress = 0;
        unit.moveResolve = null;
        unit._moveSpeed = 0;

        // Emit event
        EventBus.emit('unit:moveComplete', unit);

        // Resolve the movement promise
        if (resolve) resolve();
    }

    /**
     * Interrupt and stop a unit's movement immediately.
     * @param {object} unit
     */
    stopMovement(unit) {
        if (!unit.isMoving) return;

        // Snap to the nearest completed tile
        this._finishMovement(unit);
    }

    // ============================================================
    // Unit State
    // ============================================================

    /**
     * Mark a unit as dead.
     * @param {object} unit
     * @returns {Promise} resolves when death animation completes
     */
    async setUnitDead(unit) {
        unit.alive = false;
        unit.status = CONSTANTS.UNIT_STATUS.DEAD;
        unit.hp = 0;

        // Clear grid occupant
        this.gridManager.clearOccupant(unit.tile.col, unit.tile.row);

        // Play death animation
        await this.playAnimationAsync(unit, 'death');

        // Dim the model — reduce opacity and darken
        unit.model.traverse((child) => {
            if (child.isMesh && child.material) {
                // Make semi-transparent and dark
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = 0.4;
                child.material.emissive = new THREE.Color(0x000000);
                child.material.color.multiplyScalar(0.3);
            }
        });

        // Dim unit light
        if (unit.unitLight) {
            unit.unitLight.intensity = 0;
        }

        EventBus.emit('unit:died', unit);
    }

    /**
     * Apply damage to a unit.
     * @param {object} unit
     * @param {number} damage
     * @returns {{ killed: boolean }}
     */
    applyDamage(unit, damage) {
        unit.hp = Math.max(0, unit.hp - damage);

        EventBus.emit('unit:damaged', { unit, damage, hpRemaining: unit.hp });

        if (unit.hp <= 0) {
            return { killed: true };
        }

        return { killed: false };
    }

    /**
     * Set a unit's status.
     * @param {object} unit
     * @param {string} status — from CONSTANTS.UNIT_STATUS
     */
    setUnitStatus(unit, status) {
        unit.status = status;
        EventBus.emit('unit:statusChanged', { unit, status });
    }

    /**
     * Reset all living units' activation state and AP for a new turn.
     */
    resetActivations() {
        for (const unit of this.units) {
            if (!unit.alive) continue;

            unit.activated = false;
            unit.ap = unit.maxAp;

            // Clear overwatch and hunkered status
            if (unit.status === CONSTANTS.UNIT_STATUS.OVERWATCH ||
                unit.status === CONSTANTS.UNIT_STATUS.HUNKERED) {
                unit.status = CONSTANTS.UNIT_STATUS.READY;
                unit.overwatchCone = null;
            }

            // Restore visual brightness for activated units
            this._restoreUnitVisuals(unit);
        }
    }

    /**
     * Mark a unit as having completed its activation.
     * @param {object} unit
     */
    markActivated(unit) {
        unit.activated = true;

        // Don't change status if overwatch or hunkered (those persist)
        if (unit.status === CONSTANTS.UNIT_STATUS.READY) {
            unit.status = CONSTANTS.UNIT_STATUS.ACTIVATED;
        }

        // Visually dim activated units slightly
        this._dimUnitVisuals(unit);

        EventBus.emit('unit:activated', unit);
    }

    /**
     * Slightly dim a unit's visuals to indicate it has been activated.
     * @param {object} unit
     */
    _dimUnitVisuals(unit) {
        unit.model.traverse((child) => {
            if (child.isMesh && child.material) {
                if (!child.userData._originalEmissive) {
                    child.userData._originalEmissive = child.material.emissive
                        ? child.material.emissive.clone()
                        : new THREE.Color(0x000000);
                    child.userData._originalColor = child.material.color.clone();
                }
                // Slightly desaturate
                child.material.color.lerp(new THREE.Color(0x333333), 0.2);
            }
        });

        if (unit.unitLight) {
            unit.unitLight.intensity = CONSTANTS.LIGHTING.unitLightIntensity * 0.4;
        }
    }

    /**
     * Restore a unit's visuals to normal.
     * @param {object} unit
     */
    _restoreUnitVisuals(unit) {
        unit.model.traverse((child) => {
            if (child.isMesh && child.material && child.userData._originalColor) {
                child.material.color.copy(child.userData._originalColor);
                if (child.userData._originalEmissive) {
                    child.material.emissive.copy(child.userData._originalEmissive);
                }
            }
        });

        if (unit.unitLight) {
            unit.unitLight.intensity = CONSTANTS.LIGHTING.unitLightIntensity;
        }
    }

    // ============================================================
    // Queries
    // ============================================================

    /**
     * Get a unit by ID.
     * @param {string} id
     * @returns {object|null}
     */
    getUnit(id) {
        return this.units.find(u => u.id === id) || null;
    }

    /**
     * Get all alive units for a faction.
     * @param {string} factionId
     * @returns {Array<object>}
     */
    getAliveUnits(factionId) {
        return this.units.filter(u => u.faction === factionId && u.alive);
    }

    /**
     * Get all units that haven't been activated this turn.
     * @param {string} factionId
     * @returns {Array<object>}
     */
    getUnactivatedUnits(factionId) {
        return this.units.filter(u => u.faction === factionId && u.alive && !u.activated);
    }

    /**
     * Get the unit occupying a specific tile.
     * @param {number} col
     * @param {number} row
     * @returns {object|null}
     */
    getUnitAtTile(col, row) {
        const tile = this.gridManager.getTile(col, row);
        return tile ? tile.occupant : null;
    }

    /**
     * Get all unit mesh references for input raycasting.
     * @returns {Array<{ mesh: THREE.Object3D, unit: object }>}
     */
    getUnitMeshList() {
        return this.units
            .filter(u => u.alive)
            .map(u => ({ mesh: u.model, unit: u }));
    }

    // ============================================================
    // Per-Frame Update
    // ============================================================

    /**
     * Update all animation mixers and movement.
     * @param {number} deltaTime
     */
    update(deltaTime) {
        // Update animation mixers
        for (const unit of this.units) {
            if (unit.mixer) {
                unit.mixer.update(deltaTime);
            }
        }

        // Update movement
        this._updateMovement(deltaTime);
    }

    // ============================================================
    // Cleanup
    // ============================================================

    dispose() {
        for (const unit of this.units) {
            if (unit.model) {
                this.scene.remove(unit.model);
                unit.model.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            }
            if (unit.mixer) {
                unit.mixer.stopAllAction();
            }
        }
        this.units = [];
    }
}
