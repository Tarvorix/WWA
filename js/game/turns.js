// Slimline Tactical — Turn Manager
// Alternating activation flow, AP tracking, phase transitions,
// overwatch interrupts, win condition checking, game flow orchestration

import { CONSTANTS } from '../shared/constants.js';
import {
    EventBus, tileToWorld, delay
} from '../shared/utils.js';

const PHASES = CONSTANTS.GAME_PHASES;

export class TurnManager {
    /**
     * @param {object} gameState
     * @param {import('./units.js').UnitManager} unitManager
     * @param {import('./grid.js').GridManager} gridManager
     * @param {import('./combat.js').CombatSystem} combatSystem
     * @param {import('./camera.js').CameraController} cameraController
     * @param {import('./input.js').InputManager} inputManager
     * @param {import('./ui.js').UIManager} uiManager
     */
    constructor(gameState, unitManager, gridManager, combatSystem, cameraController, inputManager, uiManager) {
        this.gameState = gameState;
        this.unitManager = unitManager;
        this.gridManager = gridManager;
        this.combatSystem = combatSystem;
        this.cameraController = cameraController;
        this.inputManager = inputManager;
        this.uiManager = uiManager;

        // AI controller set after construction
        this.aiController = null;

        // Activation queue: interleaved player/AI units
        this.activationQueue = [];
        this.currentActivationIndex = 0;

        // Movement state
        this._selectedMoveTiles = [];
        this._pendingMoveUnit = null;

        // ---- Register event listeners ----
        this._setupEventListeners();
    }

    /**
     * Set the AI controller reference (called after AI is constructed).
     * @param {import('./ai.js').AIController} aiController
     */
    setAIController(aiController) {
        this.aiController = aiController;
    }

    // ============================================================
    // Game Start
    // ============================================================

    /**
     * Initialize and start the game.
     */
    startGame() {
        this.gameState.turn = 1;
        this.gameState.currentFaction = this.gameState.playerFaction;

        // Build first activation queue
        this.buildActivationQueue();
        this.currentActivationIndex = 0;

        // Update UI
        const playerFactionConfig = CONSTANTS.FACTIONS[this.gameState.playerFaction];
        this.uiManager.updateTopBar(this.gameState.turn, playerFactionConfig.name);
        this.uiManager.updateRoster(this.gameState.units, null);

        // Start first activation
        this.nextActivation();
    }

    // ============================================================
    // Turn Flow
    // ============================================================

    /**
     * Build the alternating activation queue for the current turn.
     * Interleaves player and AI units.
     */
    buildActivationQueue() {
        const playerUnits = this.unitManager.getUnactivatedUnits(this.gameState.playerFaction);
        const aiUnits = this.unitManager.getUnactivatedUnits(this.gameState.aiFaction);

        this.activationQueue = [];

        const maxLen = Math.max(playerUnits.length, aiUnits.length);
        for (let i = 0; i < maxLen; i++) {
            if (i < playerUnits.length) {
                this.activationQueue.push(playerUnits[i]);
            }
            if (i < aiUnits.length) {
                this.activationQueue.push(aiUnits[i]);
            }
        }
    }

    /**
     * Advance to the next activation in the queue.
     */
    nextActivation() {
        // Check win condition
        const winner = this.checkWinCondition();
        if (winner) {
            this.handleGameOver(winner);
            return;
        }

        // Find next living, unactivated unit
        while (this.currentActivationIndex < this.activationQueue.length) {
            const unit = this.activationQueue[this.currentActivationIndex];

            if (unit.alive && !unit.activated) {
                // Found a valid unit to activate
                if (unit.faction === this.gameState.playerFaction) {
                    this.beginPlayerActivation(unit);
                } else {
                    this.beginAIActivation(unit);
                }
                return;
            }

            this.currentActivationIndex++;
        }

        // All units activated — end turn
        this.endTurn();
    }

    /**
     * Start a new turn.
     */
    async startTurn() {
        this.gameState.turn++;

        // Reset all units
        this.unitManager.resetActivations();

        // Build new queue
        this.buildActivationQueue();
        this.currentActivationIndex = 0;

        // Update UI
        const playerFactionConfig = CONSTANTS.FACTIONS[this.gameState.playerFaction];
        this.uiManager.updateTopBar(this.gameState.turn, playerFactionConfig.name);

        // Show turn transition
        await this.uiManager.showTurnTransition(this.gameState.turn, playerFactionConfig.name);

        // Update roster
        this.uiManager.updateRoster(this.gameState.units, null);

        // Emit event
        EventBus.emit('turn:start', { turn: this.gameState.turn });

        // Start first activation
        this.nextActivation();
    }

    /**
     * End the current turn and start a new one.
     */
    endTurn() {
        EventBus.emit('turn:end', { turn: this.gameState.turn });
        this.startTurn();
    }

    // ============================================================
    // Player Activation
    // ============================================================

    /**
     * Begin a player unit's activation.
     * @param {object} unit
     */
    beginPlayerActivation(unit) {
        console.log('[TurnManager] beginPlayerActivation:', unit.id, 'tile:', unit.tile.col, unit.tile.row, 'ap:', unit.ap);

        this.gameState.activeUnit = unit;
        this.gameState.phase = PHASES.PLAYER_MOVEMENT;

        // Select the unit
        this.unitManager.selectUnit(unit);

        // Show movement range
        this._showMovementRange(unit);

        // Update UI
        this.uiManager.showEnemyTurnBanner(false);
        this.uiManager.updatePhaseIndicator('Movement');
        this.uiManager.updateRoster(this.gameState.units, unit);

        // Show unit card
        this.uiManager.showUnitCard(unit);

        // Pan camera to unit
        const worldPos = tileToWorld(unit.tile.col, unit.tile.row, CONSTANTS.TILE_SIZE);
        this.cameraController.panToWorldPos(worldPos.x, worldPos.z, 0.4);

        // Enable input
        this.inputManager.setEnabled(true);

        console.log('[TurnManager] beginPlayerActivation complete — phase:', this.gameState.phase, 'moveTiles:', this._selectedMoveTiles?.length);

        EventBus.emit('activation:start', { unit, isPlayer: true });
    }

    /**
     * Show movement range for a unit.
     * @param {object} unit
     */
    _showMovementRange(unit) {
        console.log('[TurnManager] _showMovementRange for', unit.id, 'at tile:', unit.tile.col, unit.tile.row, 'moveRange:', CONSTANTS.UNIT_STATS.movement);

        const moveTiles = this.gridManager.getMovementRange(
            unit.tile.col, unit.tile.row,
            CONSTANTS.UNIT_STATS.movement
        );

        console.log('[TurnManager] moveTiles count:', moveTiles.length, 'tiles:', moveTiles.map(t => `(${t.col},${t.row})`).join(' '));

        this._selectedMoveTiles = moveTiles;
        this.gridManager.highlightTiles(moveTiles, 0x4466ff, 0.2);
    }

    /**
     * Handle the player clicking a tile during movement phase.
     * @param {number} col
     * @param {number} row
     */
    async onPlayerMoveClick(col, row) {
        try {
            const unit = this.gameState.activeUnit;
            console.log('[TurnManager] onPlayerMoveClick', col, row, 'activeUnit:', unit?.id, 'phase:', this.gameState.phase, 'moveTiles count:', this._selectedMoveTiles?.length);

            if (!unit || this.gameState.phase !== PHASES.PLAYER_MOVEMENT) {
                console.log('[TurnManager] onPlayerMoveClick — early return: no unit or wrong phase');
                return;
            }

            // Check if clicked tile is in movement range
            const isValidMove = this._selectedMoveTiles.some(t => t.col === col && t.row === row);
            console.log('[TurnManager] isValidMove:', isValidMove, 'for tile', col, row);
            if (!isValidMove) {
                console.log('[TurnManager] Tile not in movement range — ignoring click');
                return;
            }

            // Disable input during movement
            this.inputManager.setEnabled(false);
            this.gridManager.clearHighlights();

            // Find path
            console.log('[TurnManager] Finding path from', unit.tile.col, unit.tile.row, 'to', col, row);
            const path = this.gridManager.findPath(unit.tile, { col, row });
            console.log('[TurnManager] Path result:', path ? path.map(t => `(${t.col},${t.row})`).join('→') : 'null');

            if (!path || path.length === 0) {
                console.log('[TurnManager] No valid path found — re-showing movement range');
                this.inputManager.setEnabled(true);
                this._showMovementRange(unit);
                return;
            }

            // Deduct AP
            unit.ap = Math.max(0, unit.ap - 1);
            console.log('[TurnManager] AP deducted, remaining:', unit.ap);

            // Move the unit
            this.gameState.phase = PHASES.COMBAT_ANIMATION; // temporarily lock input
            console.log('[TurnManager] Starting unit movement...');
            await this.unitManager.moveUnit(unit, path);
            console.log('[TurnManager] Movement complete');

            // Check overwatch triggers along the path
            const overwatchTriggered = await this._checkOverwatchAlongPath(unit, path);

            // If unit was killed by overwatch, end activation
            if (!unit.alive) {
                this.endActivation(unit);
                return;
            }

            // Transition to action phase
            if (unit.ap > 0) {
                this._enterActionPhase(unit);
            } else {
                this.endActivation(unit);
            }
        } catch (err) {
            console.error('[TurnManager] onPlayerMoveClick ERROR:', err);
            // Recovery: re-enable input
            this.inputManager.setEnabled(true);
            this.gameState.phase = PHASES.PLAYER_MOVEMENT;
        }
    }

    /**
     * Check overwatch triggers along a movement path.
     * @param {object} unit
     * @param {Array<{col: number, row: number}>} path
     * @returns {Promise<boolean>} true if overwatch was triggered
     */
    async _checkOverwatchAlongPath(unit, path) {
        let triggered = false;

        for (let i = 0; i < path.length; i++) {
            const fromTile = i === 0 ? unit.tile : path[i - 1];
            const toTile = path[i];

            const triggers = this.combatSystem.checkOverwatch(unit, fromTile, toTile);

            for (const trigger of triggers) {
                triggered = true;
                await this.combatSystem.executeOverwatchShot(trigger.overwatchUnit, unit);

                if (!unit.alive) return true;
            }
        }

        return triggered;
    }

    /**
     * Enter the action phase for a player unit.
     * @param {object} unit
     */
    _enterActionPhase(unit) {
        this.gameState.phase = PHASES.PLAYER_ACTION;

        // Update available actions
        const actions = this.combatSystem.getAvailableActions(unit);
        this.uiManager.updateActionBar(unit, actions);
        this.uiManager.updateUnitCard(unit);
        this.uiManager.updatePhaseIndicator('Action');

        // Re-enable input
        this.inputManager.setEnabled(true);
    }

    /**
     * Handle a player action (from action bar button).
     * @param {string} actionType — 'shoot' | 'melee' | 'overwatch' | 'hunker' | 'endTurn'
     */
    async onPlayerAction(actionType) {
        const unit = this.gameState.activeUnit;
        if (!unit || !unit.alive) return;

        switch (actionType) {
            case 'shoot':
                this._enterTargetSelectPhase(unit, 'ranged');
                break;

            case 'melee':
                this._enterTargetSelectPhase(unit, 'melee');
                break;

            case 'overwatch':
                this.combatSystem.setOverwatch(unit);
                this.uiManager.showNotification('Overwatch set', 'overwatch-trigger');
                this.uiManager.updateUnitCard(unit);
                this.endActivation(unit);
                break;

            case 'hunker':
                this.combatSystem.setHunker(unit);
                this.uiManager.showNotification('Hunkered down');
                this.uiManager.updateUnitCard(unit);
                this.endActivation(unit);
                break;

            case 'endTurn':
                this.endActivation(unit);
                break;
        }
    }

    /**
     * Enter target selection phase.
     * @param {object} unit
     * @param {string} attackType — 'ranged' | 'melee'
     */
    _enterTargetSelectPhase(unit, attackType) {
        this.gameState.phase = PHASES.PLAYER_TARGET_SELECT;
        this.gameState._pendingAttackType = attackType;

        // Get and highlight valid targets
        const targets = this.combatSystem.getValidTargets(unit, attackType);
        if (targets.length === 0) {
            this.uiManager.showNotification('No valid targets');
            this._enterActionPhase(unit);
            return;
        }

        this.gridManager.clearHighlights();
        this.uiManager.highlightTargets(targets, this.gridManager, 0xff4444);
        this.uiManager.setActiveAction(attackType === 'ranged' ? 'shoot' : 'melee');
        this.uiManager.updatePhaseIndicator('Select Target');
        this.uiManager.setCursor('cursor-attack');

        // Store targets for click validation
        this.gameState._validTargets = targets;
    }

    /**
     * Handle clicking on a target tile during target selection.
     * @param {number} col
     * @param {number} row
     */
    async onTargetClick(col, row) {
        const unit = this.gameState.activeUnit;
        if (!unit || this.gameState.phase !== PHASES.PLAYER_TARGET_SELECT) return;

        const targets = this.gameState._validTargets || [];
        const target = targets.find(t => t.tile.col === col && t.tile.row === row);
        if (!target) return;

        const attackType = this.gameState._pendingAttackType;

        // Disable input during combat
        this.inputManager.setEnabled(false);
        this.gridManager.clearHighlights();
        this.uiManager.hideAttackPreview();
        this.uiManager.setCursor('cursor-default');
        this.uiManager.clearActiveAction();

        // Execute attack
        const result = await this.combatSystem.executeAttack(unit, target, attackType);

        // Update UI
        this.uiManager.updateUnitCard(unit);
        this.uiManager.updateRoster(this.gameState.units, unit);

        // Clean up temp state
        this.gameState._validTargets = null;
        this.gameState._pendingAttackType = null;

        // Check win condition
        const winner = this.checkWinCondition();
        if (winner) {
            this.handleGameOver(winner);
            return;
        }

        // Continue or end activation
        if (unit.ap > 0 && unit.alive) {
            this._enterActionPhase(unit);
        } else {
            this.endActivation(unit);
        }
    }

    /**
     * Handle hovering over a target tile (show attack preview).
     * @param {number} col
     * @param {number} row
     */
    onTargetHover(col, row) {
        if (this.gameState.phase !== PHASES.PLAYER_TARGET_SELECT) return;

        const unit = this.gameState.activeUnit;
        if (!unit) return;

        const targets = this.gameState._validTargets || [];
        const target = targets.find(t => t.tile.col === col && t.tile.row === row);

        if (target) {
            const attackType = this.gameState._pendingAttackType;
            const { chance, breakdown } = this.combatSystem.calculateHitChance(unit, target, attackType);

            // Get screen position from mouse
            const hoveredTile = this.inputManager.getHoveredTile();
            if (hoveredTile) {
                this.uiManager.showAttackPreview(
                    chance,
                    breakdown,
                    this.inputManager.mouseScreenPos.x,
                    this.inputManager.mouseScreenPos.y
                );
            }
        } else {
            this.uiManager.hideAttackPreview();
        }
    }

    // ============================================================
    // AI Activation
    // ============================================================

    /**
     * Begin an AI unit's activation.
     * @param {object} unit
     */
    async beginAIActivation(unit) {
        this.gameState.activeUnit = unit;
        this.gameState.phase = PHASES.AI_THINKING;

        // Update UI
        this.uiManager.showEnemyTurnBanner(true);
        this.uiManager.updatePhaseIndicator('Enemy Thinking');
        this.uiManager.updateRoster(this.gameState.units, unit);
        this.uiManager.hideActionBar();
        this.uiManager.hideUnitCard();

        // Disable player input
        this.inputManager.setEnabled(false);

        // Deselect any player selection
        this.unitManager.deselectUnit();

        // Let AI handle the activation
        if (this.aiController) {
            this.gameState.phase = PHASES.AI_ACTING;
            this.uiManager.updatePhaseIndicator('Enemy Acting');

            await this.aiController.activateUnit(unit);
        }

        // Check win condition
        const winner = this.checkWinCondition();
        if (winner) {
            this.handleGameOver(winner);
            return;
        }

        // End AI activation
        this.endActivation(unit);
    }

    // ============================================================
    // Activation End
    // ============================================================

    /**
     * End a unit's activation and advance to the next.
     * @param {object} unit
     */
    endActivation(unit) {
        // Mark unit as activated
        this.unitManager.markActivated(unit);

        // Clear game state
        this.gameState.activeUnit = null;
        this.gridManager.clearHighlights();
        this.uiManager.hideActionBar();
        this.uiManager.hideAttackPreview();
        this.uiManager.setCursor('cursor-default');

        // Update roster
        this.uiManager.updateRoster(this.gameState.units, null);

        // Advance
        this.currentActivationIndex++;
        this.nextActivation();
    }

    // ============================================================
    // Win Condition
    // ============================================================

    /**
     * Check if either faction has been wiped out.
     * @returns {string|null} — winning faction id, or null
     */
    checkWinCondition() {
        const playerAlive = this.unitManager.getAliveUnits(this.gameState.playerFaction);
        const aiAlive = this.unitManager.getAliveUnits(this.gameState.aiFaction);

        if (aiAlive.length === 0) return this.gameState.playerFaction;
        if (playerAlive.length === 0) return this.gameState.aiFaction;

        return null;
    }

    /**
     * Handle game over state.
     * @param {string} winner — winning faction id
     */
    handleGameOver(winner) {
        this.gameState.phase = PHASES.GAME_OVER;

        // Disable input
        this.inputManager.setEnabled(false);

        // Show game over screen
        this.uiManager.showGameOverScreen(winner, this.gameState.playerFaction);
        this.uiManager.showEnemyTurnBanner(false);
        this.uiManager.hideActionBar();

        EventBus.emit('game:over', { winner });
    }

    // ============================================================
    // Cancel / Escape
    // ============================================================

    /**
     * Handle escape/cancel during player turns.
     */
    handleCancel() {
        const phase = this.gameState.phase;

        if (phase === PHASES.PLAYER_TARGET_SELECT) {
            // Cancel target selection, return to action phase
            this.gridManager.clearHighlights();
            this.uiManager.hideAttackPreview();
            this.uiManager.setCursor('cursor-default');
            this.uiManager.clearActiveAction();
            this.gameState._validTargets = null;
            this.gameState._pendingAttackType = null;

            const unit = this.gameState.activeUnit;
            if (unit) {
                this._enterActionPhase(unit);
            }
        } else if (phase === PHASES.PLAYER_ACTION) {
            // Cancel action phase, show movement again? Or end activation.
            // For simplicity, just deselect
            this.gridManager.clearHighlights();
        }
    }

    // ============================================================
    // Event Listeners
    // ============================================================

    _setupEventListeners() {
        // Tile click — route based on phase
        EventBus.on('tile:clicked', ({ col, row }) => {
            const phase = this.gameState.phase;

            console.log('[TurnManager] tile:clicked', col, row, 'phase:', phase);

            if (phase === PHASES.PLAYER_MOVEMENT) {
                this.onPlayerMoveClick(col, row).catch(err => {
                    console.error('[TurnManager] onPlayerMoveClick UNHANDLED ERROR:', err);
                    this.inputManager.setEnabled(true);
                    this.gameState.phase = PHASES.PLAYER_MOVEMENT;
                });
            } else if (phase === PHASES.PLAYER_TARGET_SELECT) {
                this.onTargetClick(col, row);
            }
        });

        // Unit click
        EventBus.on('unit:clicked', (unit) => {
            const phase = this.gameState.phase;

            console.log('[TurnManager] unit:clicked', unit.id, 'phase:', phase, 'activeUnit:', this.gameState.activeUnit?.id);

            if (phase === PHASES.PLAYER_TARGET_SELECT) {
                // Clicking an enemy unit during target select = attack
                this.onTargetClick(unit.tile.col, unit.tile.row);
            } else if (phase === PHASES.PLAYER_SELECT_UNIT) {
                // No active unit yet — clicking a friendly unit starts its activation
                if (unit.faction === this.gameState.playerFaction && unit.alive && !unit.activated) {
                    console.log('[TurnManager] Starting activation for clicked unit:', unit.id);
                    this.beginPlayerActivation(unit);
                }
            } else if (phase === PHASES.PLAYER_MOVEMENT) {
                // Already in someone's activation
                if (unit.faction === this.gameState.playerFaction && unit.alive && !unit.activated) {
                    if (this.gameState.activeUnit && this.gameState.activeUnit.id !== unit.id) {
                        // Clicked a different friendly unit — switch activation to them.
                        // This is essential for touch users who have no right-click/Escape
                        // to cancel the current selection before picking a new unit.
                        this.gridManager.clearHighlights();
                        this.beginPlayerActivation(unit);
                    }
                    // Clicking the same active unit does nothing (movement tiles are shown)
                }
            }
        });

        // Action button events
        EventBus.on('action:shoot', () => this.onPlayerAction('shoot'));
        EventBus.on('action:melee', () => this.onPlayerAction('melee'));
        EventBus.on('action:overwatch', () => this.onPlayerAction('overwatch'));
        EventBus.on('action:hunker', () => this.onPlayerAction('hunker'));
        EventBus.on('action:endTurn', () => this.onPlayerAction('endTurn'));

        // Escape / selection cleared
        EventBus.on('selection:cleared', () => this.handleCancel());

        // Hover during target select
        // This is handled by the input system's onTileHover, which we hook into
        // via the input manager callback

        // Game restart
        EventBus.on('game:restart', () => {
            const gameOverScreen = document.getElementById('game-over-screen');
            if (gameOverScreen && !gameOverScreen.classList.contains('visible')) {
                console.warn('[TurnManager] Ignoring game:restart because game over screen is not visible');
                return;
            }
            // DEBUG: block reload temporarily to confirm this is the culprit
            console.error('[TurnManager] game:restart triggered — reload BLOCKED for debugging');
            console.trace('[TurnManager] game:restart call stack');
            const d = document.getElementById('loading-status') || document.createElement('div');
            d.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:20px;background:red;color:white;z-index:9999;font-size:18px;';
            d.textContent = 'DEBUG: game:restart fired! Reload blocked. Check console.';
            document.body.appendChild(d);
            // window.location.reload();  // TEMPORARILY DISABLED
        });
    }

    /**
     * Set up the tile hover callback for target select phase.
     * Called from main.js after turn manager is constructed.
     */
    setupHoverCallback() {
        this.inputManager.onTileHover((col, row) => {
            if (col === null || row === null) {
                this.gridManager.clearSingleHighlight();
                this.uiManager.hideAttackPreview();
                return;
            }

            this.gridManager.highlightSingle(col, row, 0xffcc44);

            // Show attack preview during target selection
            if (this.gameState.phase === PHASES.PLAYER_TARGET_SELECT) {
                this.onTargetHover(col, row);
            }
        });
    }

    // ============================================================
    // Update (per-frame)
    // ============================================================

    /**
     * Per-frame update for turn management.
     * @param {number} deltaTime
     */
    update(deltaTime) {
        // Currently no per-frame logic needed for turn management
        // AI delays and animations are handled via async/await
    }
}
