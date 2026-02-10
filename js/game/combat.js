// Slimline Tactical — Combat System
// Hit chance calculation, LOS, cover, flanking, ranged/melee attack execution,
// overwatch triggers, combat camera integration

import { CONSTANTS } from '../shared/constants.js';
import {
    EventBus, tileToWorld, tileDistance, delay, clamp
} from '../shared/utils.js';

const STATS = CONSTANTS.UNIT_STATS;

export class CombatSystem {
    /**
     * @param {object} gameState
     * @param {import('./grid.js').GridManager} gridManager
     * @param {import('./units.js').UnitManager} unitManager
     * @param {import('./vfx.js').VFXManager} vfxManager
     * @param {import('./camera.js').CameraController} cameraController
     * @param {import('./ui.js').UIManager} uiManager
     */
    constructor(gameState, gridManager, unitManager, vfxManager, cameraController, uiManager) {
        this.gameState = gameState;
        this.gridManager = gridManager;
        this.unitManager = unitManager;
        this.vfxManager = vfxManager;
        this.cameraController = cameraController;
        this.uiManager = uiManager;
    }

    // ============================================================
    // Valid Targets
    // ============================================================

    /**
     * Get all valid targets for a ranged attack from a given unit.
     * Checks range and line of sight.
     * @param {object} unit
     * @returns {Array<object>} — array of enemy units that can be targeted
     */
    getValidRangedTargets(unit) {
        const enemyFaction = unit.faction === this.gameState.playerFaction
            ? this.gameState.aiFaction
            : this.gameState.playerFaction;

        const enemies = this.unitManager.getAliveUnits(enemyFaction);
        const targets = [];

        for (const enemy of enemies) {
            const dist = tileDistance(unit.tile, enemy.tile);
            if (dist > STATS.rangedRange) continue;

            // Check line of sight
            const los = this.gridManager.checkLOS(
                unit.tile.col, unit.tile.row,
                enemy.tile.col, enemy.tile.row
            );

            if (los.clear) {
                targets.push(enemy);
            }
        }

        return targets;
    }

    /**
     * Get all valid targets for a melee attack from a given unit.
     * Checks adjacency (Chebyshev distance 1).
     * @param {object} unit
     * @returns {Array<object>} — array of adjacent enemy units
     */
    getValidMeleeTargets(unit) {
        const enemyFaction = unit.faction === this.gameState.playerFaction
            ? this.gameState.aiFaction
            : this.gameState.playerFaction;

        const enemies = this.unitManager.getAliveUnits(enemyFaction);
        const targets = [];

        for (const enemy of enemies) {
            const dist = tileDistance(unit.tile, enemy.tile);
            if (dist <= STATS.meleeRange) {
                targets.push(enemy);
            }
        }

        return targets;
    }

    /**
     * Get all valid targets for any attack type.
     * @param {object} unit
     * @param {string} attackType — 'ranged' | 'melee'
     * @returns {Array<object>}
     */
    getValidTargets(unit, attackType) {
        if (attackType === 'ranged') return this.getValidRangedTargets(unit);
        if (attackType === 'melee') return this.getValidMeleeTargets(unit);
        return [];
    }

    // ============================================================
    // Hit Chance Calculation
    // ============================================================

    /**
     * Calculate the hit chance for an attack.
     * @param {object} attacker
     * @param {object} target
     * @param {string} attackType — 'ranged' | 'melee'
     * @returns {{ chance: number, breakdown: object }}
     */
    calculateHitChance(attacker, target, attackType) {
        const breakdown = {};

        if (attackType === 'ranged') {
            // Base ranged accuracy
            breakdown.base = STATS.rangedAccuracy;
            let chance = STATS.rangedAccuracy;

            // Cover penalty
            const los = this.gridManager.checkLOS(
                attacker.tile.col, attacker.tile.row,
                target.tile.col, target.tile.row
            );

            if (los.coverPenalty !== 0) {
                breakdown.coverPenalty = los.coverPenalty;
                breakdown.coverType = los.coverType;
                chance += los.coverPenalty; // coverPenalty is negative
            }

            // Hunkered bonus (double cover effectiveness)
            if (target.status === CONSTANTS.UNIT_STATUS.HUNKERED && los.coverPenalty !== 0) {
                const extraPenalty = los.coverPenalty; // double the penalty
                breakdown.hunkeredPenalty = extraPenalty;
                chance += extraPenalty;
            }

            // Flanking bonus
            if (this.gridManager.checkFlanking(attacker.tile, target.tile, target.facing)) {
                breakdown.flankingBonus = CONSTANTS.FLANKING_BONUS;
                chance += CONSTANTS.FLANKING_BONUS;
            }

            // Distance factor (optional: slight penalty at max range)
            const dist = tileDistance(attacker.tile, target.tile);
            if (dist >= STATS.rangedRange - 1) {
                const rangePenalty = -0.05;
                breakdown.rangePenalty = rangePenalty;
                chance += rangePenalty;
            }

            // Damage info
            breakdown.damage = STATS.rangedDamage;

            // Clamp
            chance = clamp(chance, CONSTANTS.MIN_HIT_CHANCE, CONSTANTS.MAX_HIT_CHANCE);
            breakdown.final = chance;

            return { chance, breakdown };

        } else if (attackType === 'melee') {
            // Base melee accuracy
            breakdown.base = STATS.meleeAccuracy;
            let chance = STATS.meleeAccuracy;

            // Flanking bonus (still applies to melee)
            if (this.gridManager.checkFlanking(attacker.tile, target.tile, target.facing)) {
                breakdown.flankingBonus = CONSTANTS.FLANKING_BONUS;
                chance += CONSTANTS.FLANKING_BONUS;
            }

            // No cover penalty for melee (adjacent combat bypasses cover)

            // Damage info
            breakdown.damage = STATS.meleeDamage;

            // Clamp
            chance = clamp(chance, CONSTANTS.MIN_HIT_CHANCE, CONSTANTS.MAX_HIT_CHANCE);
            breakdown.final = chance;

            return { chance, breakdown };
        }

        return { chance: 0, breakdown: {} };
    }

    // ============================================================
    // Attack Execution
    // ============================================================

    /**
     * Execute a full attack sequence between attacker and target.
     * Handles camera, animations, VFX, damage, death, and UI updates.
     * @param {object} attacker
     * @param {object} target
     * @param {string} attackType — 'ranged' | 'melee'
     * @returns {Promise<{ hit: boolean, damage: number, killed: boolean }>}
     */
    async executeAttack(attacker, target, attackType) {
        const { chance, breakdown } = this.calculateHitChance(attacker, target, attackType);

        // Get world positions
        const attackerPos = tileToWorld(attacker.tile.col, attacker.tile.row, CONSTANTS.TILE_SIZE);
        const targetPos = tileToWorld(target.tile.col, target.tile.row, CONSTANTS.TILE_SIZE);

        // Set game phase
        const prevPhase = this.gameState.phase;
        this.gameState.phase = CONSTANTS.GAME_PHASES.COMBAT_ANIMATION;

        // 1. Start combat camera
        await this.cameraController.startCombatCam(attackerPos, targetPos);

        // 2. Face attacker toward target
        this.unitManager.faceTarget(attacker, target.tile);

        // Brief pause for dramatic effect
        await delay(0.2);

        // 3. Roll for hit
        const roll = Math.random();
        const hit = roll <= chance;

        let damage = 0;
        let killed = false;

        if (hit) {
            damage = attackType === 'ranged' ? STATS.rangedDamage : STATS.meleeDamage;

            if (attackType === 'ranged') {
                // ---- Ranged Hit ----

                // Play attack animation on attacker
                const attackAnimPromise = this.unitManager.playAnimationAsync(attacker, 'attack_range');

                // After brief delay, fire VFX
                await delay(0.15);

                // Muzzle flash
                this.vfxManager.playMuzzleFlash(attackerPos, targetPos);

                // Tracer
                await this.vfxManager.playTracer(attackerPos, targetPos);

                // Impact particles
                this.vfxManager.playImpactParticles(targetPos, 'blood');

                // Play hit reaction on target
                this.unitManager.playAnimation(target, 'hit_reaction', { loop: false });

                // Apply damage
                const result = this.unitManager.applyDamage(target, damage);
                killed = result.killed;

                // Show damage number
                this.uiManager.showDamageNumber(targetPos, damage);

                // Wait for attacker animation
                await attackAnimPromise;

            } else {
                // ---- Melee Hit ----

                // Play melee attack animation
                const attackAnimPromise = this.unitManager.playAnimationAsync(attacker, 'attack_melee');

                // After brief delay, fire VFX
                await delay(0.2);

                // Melee trail and impact
                this.vfxManager.playMeleeTrail(attackerPos, targetPos);
                this.vfxManager.playImpactParticles(targetPos, 'spark');

                // Play hit reaction on target
                this.unitManager.playAnimation(target, 'hit_reaction', { loop: false });

                // Apply damage
                const result = this.unitManager.applyDamage(target, damage);
                killed = result.killed;

                // Show damage number
                this.uiManager.showDamageNumber(targetPos, damage);

                // Wait for attacker animation
                await attackAnimPromise;
            }

            // Handle death
            if (killed) {
                await this.unitManager.setUnitDead(target);
                this.vfxManager.playDeathEffect(targetPos);
                this.uiManager.showNotification(
                    `${target.unitLabel} eliminated!`,
                    'kill'
                );
                EventBus.emit('combat:kill', { attacker, target, attackType });
            }

            EventBus.emit('combat:damage', { attacker, target, damage, attackType });

        } else {
            // ---- Miss ----

            if (attackType === 'ranged') {
                // Play attack animation
                const attackAnimPromise = this.unitManager.playAnimationAsync(attacker, 'attack_range');

                await delay(0.15);

                // Muzzle flash
                this.vfxManager.playMuzzleFlash(attackerPos, targetPos);

                // Miss tracer (offset trajectory)
                this.vfxManager.playMissTracer(attackerPos, targetPos);

                // Show miss text
                this.uiManager.showMissText(targetPos);

                await attackAnimPromise;

            } else {
                // Melee miss
                const attackAnimPromise = this.unitManager.playAnimationAsync(attacker, 'attack_melee');

                await delay(0.2);

                // Show miss text
                this.uiManager.showMissText(targetPos);

                await attackAnimPromise;
            }

            EventBus.emit('combat:miss', { attacker, target, attackType });
        }

        // 4. Brief hold for drama
        await delay(CONSTANTS.CAMERA.combatHoldDuration);

        // 5. Return camera
        await this.cameraController.endCombatCam();

        // 6. Return attacker to idle
        this.unitManager.playAnimation(attacker, 'idle', { loop: true });

        // Return target to idle (if still alive)
        if (target.alive) {
            this.unitManager.playAnimation(target, 'idle', { loop: true });
        }

        // Deduct AP
        attacker.ap = Math.max(0, attacker.ap - 1);

        // Emit completion
        EventBus.emit('combat:complete', { attacker, target, hit, damage, killed, attackType });

        return { hit, damage, killed };
    }

    // ============================================================
    // Overwatch
    // ============================================================

    /**
     * Check if any enemy units in overwatch would trigger on a unit's movement.
     * @param {object} movingUnit — the unit that just moved
     * @param {{ col: number, row: number }} fromTile — tile moved from
     * @param {{ col: number, row: number }} toTile — tile moved to
     * @returns {Array<{ overwatchUnit: object }>} — units that trigger overwatch
     */
    checkOverwatch(movingUnit, fromTile, toTile) {
        const triggers = [];

        // Check all enemy units
        const enemyFaction = movingUnit.faction === this.gameState.playerFaction
            ? this.gameState.aiFaction
            : this.gameState.playerFaction;

        const enemies = this.unitManager.getAliveUnits(enemyFaction);

        for (const enemy of enemies) {
            if (enemy.status !== CONSTANTS.UNIT_STATUS.OVERWATCH) continue;

            // Check if movement tile is within overwatch range
            const dist = tileDistance(enemy.tile, toTile);
            if (dist > CONSTANTS.OVERWATCH.range) continue;

            // Check LOS
            const los = this.gridManager.checkLOS(
                enemy.tile.col, enemy.tile.row,
                toTile.col, toTile.row
            );
            if (!los.clear) continue;

            // Check overwatch cone (180 degree arc in facing direction)
            if (enemy.overwatchCone) {
                const dx = toTile.col - enemy.tile.col;
                const dz = toTile.row - enemy.tile.row;
                const facingDot = dx * enemy.overwatchCone.col + dz * enemy.overwatchCone.row;

                // If target is behind the overwatch direction (dot < 0 means behind)
                if (facingDot < 0) continue;
            }

            triggers.push({ overwatchUnit: enemy });
        }

        return triggers;
    }

    /**
     * Execute an overwatch shot from an overwatch unit against a moving unit.
     * @param {object} overwatchUnit
     * @param {object} triggerUnit
     * @returns {Promise<{ hit: boolean, damage: number, killed: boolean }>}
     */
    async executeOverwatchShot(overwatchUnit, triggerUnit) {
        // Show notification
        this.uiManager.showNotification(
            `${overwatchUnit.unitLabel} — Overwatch!`,
            'overwatch-trigger'
        );

        // Brief pause with overwatch flash
        const overwatchPos = tileToWorld(overwatchUnit.tile.col, overwatchUnit.tile.row, CONSTANTS.TILE_SIZE);
        this.vfxManager.playOverwatchFlash(overwatchPos);

        await delay(CONSTANTS.OVERWATCH.reactionDelay);

        // Execute the shot (ranged attack)
        const result = await this.executeAttack(overwatchUnit, triggerUnit, 'ranged');

        // Clear overwatch status after firing
        overwatchUnit.status = CONSTANTS.UNIT_STATUS.ACTIVATED;
        overwatchUnit.overwatchCone = null;

        EventBus.emit('overwatch:fired', { overwatchUnit, triggerUnit, result });

        return result;
    }

    /**
     * Set a unit into overwatch mode.
     * @param {object} unit
     */
    setOverwatch(unit) {
        unit.status = CONSTANTS.UNIT_STATUS.OVERWATCH;
        unit.overwatchCone = { ...unit.facing }; // store current facing as overwatch direction
        unit.ap = Math.max(0, unit.ap - 1);

        this.unitManager.setUnitStatus(unit, CONSTANTS.UNIT_STATUS.OVERWATCH);

        EventBus.emit('unit:overwatch', unit);
    }

    /**
     * Set a unit into hunkered mode.
     * @param {object} unit
     */
    setHunker(unit) {
        unit.status = CONSTANTS.UNIT_STATUS.HUNKERED;
        unit.ap = Math.max(0, unit.ap - 1);

        this.unitManager.setUnitStatus(unit, CONSTANTS.UNIT_STATUS.HUNKERED);

        EventBus.emit('unit:hunkered', unit);
    }

    // ============================================================
    // Utility
    // ============================================================

    /**
     * Check what actions are available for a unit in its current state.
     * @param {object} unit
     * @returns {{ canShoot: boolean, canMelee: boolean, canOverwatch: boolean, canHunker: boolean }}
     */
    getAvailableActions(unit) {
        if (!unit || !unit.alive || unit.ap <= 0) {
            return { canShoot: false, canMelee: false, canOverwatch: false, canHunker: false };
        }

        const rangedTargets = this.getValidRangedTargets(unit);
        const meleeTargets = this.getValidMeleeTargets(unit);

        return {
            canShoot: rangedTargets.length > 0,
            canMelee: meleeTargets.length > 0,
            canOverwatch: unit.status !== CONSTANTS.UNIT_STATUS.OVERWATCH,
            canHunker: unit.status !== CONSTANTS.UNIT_STATUS.HUNKERED
        };
    }
}
