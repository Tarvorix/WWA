// Slimline Tactical — AI Controller
// Rule-based AI: target scoring, cover-seeking movement, ranged/melee decisions,
// camera follow, and action delays for readability

import { CONSTANTS } from '../shared/constants.js';
import {
    EventBus, tileToWorld, tileDistance, delay
} from '../shared/utils.js';

const AI_CFG = CONSTANTS.AI;
const STATS = CONSTANTS.UNIT_STATS;

export class AIController {
    /**
     * @param {object} gameState
     * @param {import('./units.js').UnitManager} unitManager
     * @param {import('./grid.js').GridManager} gridManager
     * @param {import('./combat.js').CombatSystem} combatSystem
     * @param {import('./camera.js').CameraController} cameraController
     */
    constructor(gameState, unitManager, gridManager, combatSystem, cameraController) {
        this.gameState = gameState;
        this.unitManager = unitManager;
        this.gridManager = gridManager;
        this.combatSystem = combatSystem;
        this.cameraController = cameraController;
    }

    // ============================================================
    // Activation Entry Point
    // ============================================================

    /**
     * Activate an AI unit: decide and execute actions.
     * @param {object} unit
     */
    async activateUnit(unit) {
        // Pan camera to unit
        const unitWorldPos = tileToWorld(unit.tile.col, unit.tile.row, CONSTANTS.TILE_SIZE);
        await this.cameraController.panToWorldPos(unitWorldPos.x, unitWorldPos.z, 0.5);
        await delay(AI_CFG.decisionDelay * 0.5);

        // Decision tree
        // Priority 1: Adjacent enemy → melee
        const meleeTargets = this.combatSystem.getValidMeleeTargets(unit);
        if (meleeTargets.length > 0 && unit.ap > 0) {
            const target = this.pickBestTarget(unit, meleeTargets);
            await this.executeAIAttack(unit, target, 'melee');

            // If we still have AP and can act again
            if (unit.ap > 0 && unit.alive) {
                await delay(AI_CFG.decisionDelay * 0.5);
                return this._continueActivation(unit);
            }
            return;
        }

        // Priority 2: Enemy in range + LOS → shoot
        const rangedTargets = this.combatSystem.getValidRangedTargets(unit);
        if (rangedTargets.length > 0 && unit.ap > 0) {
            const target = this.pickBestTarget(unit, rangedTargets);
            await this.executeAIAttack(unit, target, 'ranged');

            // If we still have AP
            if (unit.ap > 0 && unit.alive) {
                await delay(AI_CFG.decisionDelay * 0.5);
                return this._continueActivation(unit);
            }
            return;
        }

        // Priority 3: Move toward best position, then attack if possible
        if (unit.ap > 0) {
            const moved = await this._moveTowardEnemy(unit);

            if (!unit.alive) return; // killed by overwatch during move

            // After moving, try to attack
            if (unit.ap > 0) {
                await delay(AI_CFG.decisionDelay * 0.5);

                const newRangedTargets = this.combatSystem.getValidRangedTargets(unit);
                if (newRangedTargets.length > 0) {
                    const target = this.pickBestTarget(unit, newRangedTargets);
                    await this.executeAIAttack(unit, target, 'ranged');
                    return;
                }

                const newMeleeTargets = this.combatSystem.getValidMeleeTargets(unit);
                if (newMeleeTargets.length > 0) {
                    const target = this.pickBestTarget(unit, newMeleeTargets);
                    await this.executeAIAttack(unit, target, 'melee');
                    return;
                }

                // No targets after moving — set overwatch if possible
                if (unit.ap > 0) {
                    this.combatSystem.setOverwatch(unit);
                    await delay(AI_CFG.decisionDelay * 0.3);
                }
            }
        }
    }

    /**
     * Continue activation after an action (check if AI can do more).
     * @param {object} unit
     */
    async _continueActivation(unit) {
        if (!unit.alive || unit.ap <= 0) return;

        // Check for new targets
        const meleeTargets = this.combatSystem.getValidMeleeTargets(unit);
        if (meleeTargets.length > 0) {
            const target = this.pickBestTarget(unit, meleeTargets);
            await this.executeAIAttack(unit, target, 'melee');
            return;
        }

        const rangedTargets = this.combatSystem.getValidRangedTargets(unit);
        if (rangedTargets.length > 0) {
            const target = this.pickBestTarget(unit, rangedTargets);
            await this.executeAIAttack(unit, target, 'ranged');
            return;
        }

        // No more targets, set overwatch
        if (unit.ap > 0) {
            this.combatSystem.setOverwatch(unit);
        }
    }

    // ============================================================
    // Target Scoring
    // ============================================================

    /**
     * Pick the best target from a list of valid targets using weighted scoring.
     * @param {object} unit — attacking unit
     * @param {Array<object>} targets
     * @returns {object} best target
     */
    pickBestTarget(unit, targets) {
        if (targets.length === 1) return targets[0];

        const weights = AI_CFG.targetScoreWeights;
        let bestTarget = targets[0];
        let bestScore = -Infinity;

        for (const target of targets) {
            let score = 0;

            // Lower HP = higher priority
            const hpRatio = 1.0 - (target.hp / target.maxHp);
            score += hpRatio * weights.lowHp;

            // Closer = higher priority
            const dist = tileDistance(unit.tile, target.tile);
            const distRatio = 1.0 - (dist / STATS.rangedRange);
            score += distRatio * weights.close;

            // Not in cover = higher priority
            const coverResult = this.gridManager.getCoverBetween(unit.tile, target.tile);
            if (coverResult.coverType === 'none') {
                score += weights.noCover;
            } else if (coverResult.coverType === 'half') {
                score += weights.noCover * 0.3;
            }

            if (score > bestScore) {
                bestScore = score;
                bestTarget = target;
            }
        }

        return bestTarget;
    }

    // ============================================================
    // Movement Decisions
    // ============================================================

    /**
     * Move the AI unit toward the nearest/best enemy position.
     * Prefers tiles with cover and good shooting range.
     * @param {object} unit
     * @returns {Promise<boolean>} — true if unit moved
     */
    async _moveTowardEnemy(unit) {
        const enemies = this.unitManager.getAliveUnits(this.gameState.playerFaction);
        if (enemies.length === 0) return false;

        // Find nearest enemy
        let nearestEnemy = null;
        let nearestDist = Infinity;
        for (const enemy of enemies) {
            const dist = tileDistance(unit.tile, enemy.tile);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestEnemy = enemy;
            }
        }

        if (!nearestEnemy) return false;

        // Get reachable tiles
        const reachableTiles = this.gridManager.getMovementRange(
            unit.tile.col, unit.tile.row,
            STATS.movement
        );

        if (reachableTiles.length === 0) return false;

        // Find the best tile to move to
        const bestTile = this.findBestMoveTile(unit, nearestEnemy, reachableTiles, enemies);

        if (!bestTile) return false;

        // Check if moving is worthwhile (don't move if already in great position)
        if (bestTile.col === unit.tile.col && bestTile.row === unit.tile.row) return false;

        // Execute move
        await this.executeAIMove(unit, bestTile);
        return true;
    }

    /**
     * Score and select the best tile to move to.
     * @param {object} unit
     * @param {object} primaryTarget — nearest enemy
     * @param {Array<{col: number, row: number}>} reachableTiles
     * @param {Array<object>} allEnemies
     * @returns {{ col: number, row: number }|null}
     */
    findBestMoveTile(unit, primaryTarget, reachableTiles, allEnemies) {
        let bestTile = null;
        let bestScore = -Infinity;

        const preferredMin = AI_CFG.preferredRangedDistance.min;
        const preferredMax = AI_CFG.preferredRangedDistance.max;

        for (const tile of reachableTiles) {
            let score = 0;

            const distToTarget = tileDistance(tile, primaryTarget.tile);

            // Prefer optimal ranged distance (4-6 tiles)
            if (distToTarget >= preferredMin && distToTarget <= preferredMax) {
                score += 40;
            } else if (distToTarget < preferredMin) {
                // Too close, slight penalty
                score += 20 - (preferredMin - distToTarget) * 5;
            } else if (distToTarget <= STATS.rangedRange) {
                // In range but further than preferred
                score += 30 - (distToTarget - preferredMax) * 3;
            } else {
                // Out of range — prefer closer
                score += 10 - distToTarget;
            }

            // Check LOS to primary target
            const los = this.gridManager.checkLOS(tile.col, tile.row, primaryTarget.tile.col, primaryTarget.tile.row);
            if (los.clear && distToTarget <= STATS.rangedRange) {
                score += 25; // Strong bonus for having LOS + in range
            }

            // Cover bonus: check if tile is adjacent to cover
            const coverAdjacentTiles = this.gridManager.getCoverAdjacentTiles([tile]);
            if (coverAdjacentTiles.length > 0) {
                const coverTile = coverAdjacentTiles[0];
                if (coverTile.coverType === 'full') {
                    score += AI_CFG.coverPreferenceWeight;
                } else if (coverTile.coverType === 'half') {
                    score += AI_CFG.coverPreferenceWeight * 0.6;
                }
            }

            // Penalty for being adjacent to multiple enemies (dangerous)
            let adjacentEnemyCount = 0;
            for (const enemy of allEnemies) {
                if (tileDistance(tile, enemy.tile) <= 1) {
                    adjacentEnemyCount++;
                }
            }
            if (adjacentEnemyCount > 1) {
                score -= adjacentEnemyCount * 15;
            }

            // Slight bonus for moving (don't stay still if there's a better position)
            if (tile.col !== unit.tile.col || tile.row !== unit.tile.row) {
                score += 1;
            }

            if (score > bestScore) {
                bestScore = score;
                bestTile = tile;
            }
        }

        return bestTile;
    }

    // ============================================================
    // Action Execution
    // ============================================================

    /**
     * Execute an AI movement.
     * @param {object} unit
     * @param {{ col: number, row: number }} targetTile
     */
    async executeAIMove(unit, targetTile) {
        const path = this.gridManager.findPath(unit.tile, targetTile);
        if (!path || path.length === 0) return;

        // Deduct AP
        unit.ap = Math.max(0, unit.ap - 1);

        // Move
        await this.unitManager.moveUnit(unit, path);

        // Pan camera to follow
        const newWorldPos = tileToWorld(unit.tile.col, unit.tile.row, CONSTANTS.TILE_SIZE);
        await this.cameraController.panToWorldPos(newWorldPos.x, newWorldPos.z, 0.3);

        await delay(AI_CFG.decisionDelay * 0.3);
    }

    /**
     * Execute an AI attack.
     * @param {object} unit
     * @param {object} target
     * @param {string} attackType — 'ranged' | 'melee'
     */
    async executeAIAttack(unit, target, attackType) {
        await delay(AI_CFG.decisionDelay * 0.3);
        await this.combatSystem.executeAttack(unit, target, attackType);
        await delay(AI_CFG.decisionDelay * 0.3);
    }

    // ============================================================
    // Activation Order
    // ============================================================

    /**
     * Sort AI units to determine activation order.
     * Priority: can shoot immediately > closest to enemy > furthest from cover.
     * @param {Array<object>} units
     * @returns {Array<object>} sorted units
     */
    chooseActivationOrder(units) {
        const scored = units.map(unit => {
            let score = 0;

            // Can shoot immediately?
            const rangedTargets = this.combatSystem.getValidRangedTargets(unit);
            if (rangedTargets.length > 0) score += 100;

            // Can melee immediately?
            const meleeTargets = this.combatSystem.getValidMeleeTargets(unit);
            if (meleeTargets.length > 0) score += 90;

            // Closest to any enemy
            const enemies = this.unitManager.getAliveUnits(this.gameState.playerFaction);
            let minDist = Infinity;
            for (const enemy of enemies) {
                const dist = tileDistance(unit.tile, enemy.tile);
                if (dist < minDist) minDist = dist;
            }
            score += Math.max(0, 20 - minDist);

            // Furthest from cover (units without cover should act first to seek it)
            const coverTiles = this.gridManager.getCoverAdjacentTiles([unit.tile]);
            if (coverTiles.length === 0) score += 10;

            return { unit, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.map(s => s.unit);
    }
}
