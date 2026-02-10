// Slimline Tactical — Input Manager
// Mouse, keyboard, touch input with raycasting and callbacks

import * as THREE from 'three';
import { CONSTANTS } from '../shared/constants.js';
import { worldToTile } from '../shared/utils.js';

const CAM = CONSTANTS.CAMERA;

export class InputManager {
    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {import('./camera.js').CameraController} cameraController
     * @param {import('./grid.js').GridManager} gridManager
     */
    constructor(renderer, cameraController, gridManager) {
        this.renderer = renderer;
        this.cameraController = cameraController;
        this.gridManager = gridManager;
        this.canvas = renderer.domElement;

        // State
        this.enabled = true;
        this.isDragging = false;
        this.dragButton = -1;
        this.dragStartScreen = { x: 0, y: 0 };
        this.mouseScreenPos = { x: 0, y: 0 };
        this.lastMouseScreenPos = { x: 0, y: 0 };
        this.keysDown = new Set();
        this.hoveredTile = null;
        this.lastHoveredTile = null;
        this.dragThreshold = 8; // pixels before a click becomes a drag (higher = less accidental pans)

        // Touch state
        this.touchCount = 0;
        this.touchStartPositions = []; // array of {x, y}
        this.touchStartTime = 0;
        this.initialPinchDistance = 0;
        this.isTouchPanning = false;
        this.isTouchPinching = false;
        this.touchPanLast = { x: 0, y: 0 };
        this.touchTapMaxDuration = 300; // ms — taps shorter than this always register regardless of drift

        // Callbacks
        this._onTileClick = null;
        this._onTileRightClick = null;
        this._onTileHover = null;
        this._onUnitClick = null;
        this._onEscapePress = null;

        // Unit mesh registry for raycasting against units
        this._unitMeshes = [];

        // Raycaster
        this.raycaster = new THREE.Raycaster();

        // Bind event handlers (store references for removal)
        this._onMouseDown = this._handleMouseDown.bind(this);
        this._onMouseUp = this._handleMouseUp.bind(this);
        this._onMouseMove = this._handleMouseMove.bind(this);
        this._onWheel = this._handleWheel.bind(this);
        this._onKeyDown = this._handleKeyDown.bind(this);
        this._onKeyUp = this._handleKeyUp.bind(this);
        this._onContextMenu = this._handleContextMenu.bind(this);
        this._onTouchStart = this._handleTouchStart.bind(this);
        this._onTouchMove = this._handleTouchMove.bind(this);
        this._onTouchEnd = this._handleTouchEnd.bind(this);
        this._onTouchCancel = this._handleTouchCancel.bind(this);

        // Track whether mousedown started on our canvas
        this._mouseDownOnCanvas = false;

        // Register listeners
        this.canvas.addEventListener('mousedown', this._onMouseDown);
        // Register mouseup on WINDOW (not just canvas) to catch releases
        // even if cursor moves slightly off-canvas during trackpad click
        window.addEventListener('mouseup', this._onMouseUp);
        this.canvas.addEventListener('mousemove', this._onMouseMove);
        this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
        this.canvas.addEventListener('contextmenu', this._onContextMenu);
        this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
        this.canvas.addEventListener('touchend', this._onTouchEnd);
        this.canvas.addEventListener('touchcancel', this._onTouchCancel);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);

        // Fallback: also listen for 'click' event on canvas
        // This catches cases where mousedown/mouseup pair doesn't fire correctly
        this._onClick = this._handleClickEvent.bind(this);
        this.canvas.addEventListener('click', this._onClick);
    }

    // ============================================================
    // Public API — Callbacks
    // ============================================================

    /**
     * Register callback for left-click on a tile.
     * @param {Function} callback — (col, row) => void
     */
    onTileClick(callback) {
        this._onTileClick = callback;
    }

    /**
     * Register callback for right-click on a tile.
     * @param {Function} callback — (col, row) => void
     */
    onTileRightClick(callback) {
        this._onTileRightClick = callback;
    }

    /**
     * Register callback for mouse hover over a new tile.
     * @param {Function} callback — (col, row) => void, or (null) when off-grid
     */
    onTileHover(callback) {
        this._onTileHover = callback;
    }

    /**
     * Register callback for clicking on a unit mesh.
     * @param {Function} callback — (unit) => void
     */
    onUnitClick(callback) {
        this._onUnitClick = callback;
    }

    /**
     * Register callback for Escape key press.
     * @param {Function} callback — () => void
     */
    onEscapePress(callback) {
        this._onEscapePress = callback;
    }

    /**
     * Register unit meshes for raycast hit detection.
     * @param {Array<{ mesh: THREE.Object3D, unit: object }>} meshList
     */
    registerUnitMeshes(meshList) {
        this._unitMeshes = meshList;
    }

    /**
     * Get the currently hovered tile.
     * @returns {{ col: number, row: number } | null}
     */
    getHoveredTile() {
        return this.hoveredTile;
    }

    /**
     * Enable or disable all input processing.
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }

    // ============================================================
    // Per-frame update
    // ============================================================

    /**
     * Called each frame. Handles continuous key-based panning.
     */
    update() {
        if (!this.enabled) return;

        // WASD camera pan
        let panX = 0;
        let panZ = 0;

        if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) panZ -= 1;
        if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) panZ += 1;
        if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) panX -= 1;
        if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) panX += 1;

        if (panX !== 0 || panZ !== 0) {
            const speed = CAM.panSpeed * this.cameraController.currentZoom;
            this.cameraController.pan(panX * speed, panZ * speed);
        }
    }

    // ============================================================
    // Mouse Handlers
    // ============================================================

    _handleMouseDown(e) {
        this._mouseDownOnCanvas = true;

        if (!this.enabled) return;

        this.isDragging = false;
        this.dragButton = e.button;
        this.dragStartScreen.x = e.clientX;
        this.dragStartScreen.y = e.clientY;
        this.lastMouseScreenPos.x = e.clientX;
        this.lastMouseScreenPos.y = e.clientY;

        console.log('[Input] mousedown button:', e.button, 'at:', e.clientX, e.clientY, 'enabled:', this.enabled);
    }

    _handleMouseUp(e) {
        // Only handle if mousedown started on our canvas
        if (!this._mouseDownOnCanvas) return;
        this._mouseDownOnCanvas = false;

        console.log('[Input] mouseup button:', e.button, 'at:', e.clientX, e.clientY, 'enabled:', this.enabled);

        if (!this.enabled) {
            this.isDragging = false;
            this.dragButton = -1;
            return;
        }

        const dx = e.clientX - this.dragStartScreen.x;
        const dy = e.clientY - this.dragStartScreen.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (e.button === 0) {
            // Left click: ALWAYS treat as a click regardless of movement.
            // Left-drag doesn't do anything (panning is right-drag/trackpad only),
            // so there's no conflict. This fixes MacBook trackpad where pressing
            // down moves the cursor 10+ pixels.
            this._handleLeftClick(e);
        } else if (e.button === 2 && dist < this.dragThreshold) {
            // Right click: only if not dragging (right-drag = pan)
            this._handleRightClick(e);
        }

        this.isDragging = false;
        this.dragButton = -1;
    }

    _handleMouseMove(e) {
        this.mouseScreenPos.x = e.clientX;
        this.mouseScreenPos.y = e.clientY;

        if (!this.enabled) return;

        // Check for drag
        if (this.dragButton >= 0) {
            const dx = e.clientX - this.dragStartScreen.x;
            const dy = e.clientY - this.dragStartScreen.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist >= this.dragThreshold) {
                this.isDragging = true;
            }
        }

        // Pan camera on right-click drag or middle-mouse drag only.
        // Left-click is reserved for game interaction (select unit, click tile).
        // Trackpad users pan with two-finger scroll (handled in wheel handler).
        if (this.isDragging && (this.dragButton === 1 || this.dragButton === 2)) {
            const deltaX = e.clientX - this.lastMouseScreenPos.x;
            const deltaY = e.clientY - this.lastMouseScreenPos.y;
            this.cameraController.panFromScreenDelta(deltaX, deltaY);
        }

        this.lastMouseScreenPos.x = e.clientX;
        this.lastMouseScreenPos.y = e.clientY;

        // Update hovered tile
        this._updateHoveredTile(e.clientX, e.clientY);
    }

    _handleWheel(e) {
        e.preventDefault();
        if (!this.enabled) return;

        // Trackpad pinch-to-zoom: macOS sends ctrlKey=true for pinch gestures
        // Also handles ctrl+scroll on mouse for zooming
        if (e.ctrlKey) {
            const delta = e.deltaY > 0 ? 1 : -1;
            this.cameraController.zoom(delta);
            return;
        }

        // All other scroll/swipe → pan the camera
        // This makes two-finger trackpad scrolling pan in any direction.
        // Mouse users can zoom with ctrl+scroll, pinch, or +/- keys.
        this.cameraController.panFromScreenDelta(-e.deltaX * 0.5, -e.deltaY * 0.5);
    }

    _handleContextMenu(e) {
        e.preventDefault();
    }

    // ============================================================
    // Keyboard Handlers
    // ============================================================

    _handleKeyDown(e) {
        this.keysDown.add(e.code);

        if (!this.enabled) return;

        if (e.code === 'Escape' && this._onEscapePress) {
            this._onEscapePress();
        }

        // +/- keys for zoom (works on all keyboards)
        if (e.code === 'Equal' || e.code === 'NumpadAdd') {
            this.cameraController.zoom(-1); // zoom in
        }
        if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
            this.cameraController.zoom(1); // zoom out
        }
    }

    _handleKeyUp(e) {
        this.keysDown.delete(e.code);
    }

    // ============================================================
    // Touch Handlers
    // ============================================================

    _handleTouchStart(e) {
        e.preventDefault();
        if (!this.enabled) return;

        this.touchCount = e.touches.length;
        this.touchStartPositions = [];
        this.touchStartTime = performance.now();

        for (let i = 0; i < e.touches.length; i++) {
            this.touchStartPositions.push({
                x: e.touches[i].clientX,
                y: e.touches[i].clientY
            });
        }

        if (this.touchCount === 1) {
            this.isTouchPanning = false;
            this.isTouchPinching = false;
            this.touchPanLast.x = e.touches[0].clientX;
            this.touchPanLast.y = e.touches[0].clientY;
        }

        if (this.touchCount === 2) {
            this.isTouchPinching = true;
            this.isTouchPanning = true;
            this.initialPinchDistance = this._getTouchDistance(e.touches[0], e.touches[1]);
            this.touchPanLast.x = (e.touches[0].clientX + e.touches[1].clientX) * 0.5;
            this.touchPanLast.y = (e.touches[0].clientY + e.touches[1].clientY) * 0.5;
        }
    }

    _handleTouchMove(e) {
        e.preventDefault();
        if (!this.enabled) return;

        if (this.touchCount === 1 && e.touches.length === 1) {
            // Single finger: check if it's a pan (moved enough)
            const dx = e.touches[0].clientX - this.touchStartPositions[0].x;
            const dy = e.touches[0].clientY - this.touchStartPositions[0].y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > this.dragThreshold) {
                this.isTouchPanning = true;
            }

            if (this.isTouchPanning) {
                const deltaX = e.touches[0].clientX - this.touchPanLast.x;
                const deltaY = e.touches[0].clientY - this.touchPanLast.y;
                this.cameraController.panFromScreenDelta(deltaX, deltaY);
                this.touchPanLast.x = e.touches[0].clientX;
                this.touchPanLast.y = e.touches[0].clientY;
            }
        }

        if (this.touchCount === 2 && e.touches.length === 2) {
            // Two-finger pan
            const midX = (e.touches[0].clientX + e.touches[1].clientX) * 0.5;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) * 0.5;
            const deltaX = midX - this.touchPanLast.x;
            const deltaY = midY - this.touchPanLast.y;
            this.cameraController.panFromScreenDelta(deltaX, deltaY);
            this.touchPanLast.x = midX;
            this.touchPanLast.y = midY;

            // Pinch zoom
            const currentDist = this._getTouchDistance(e.touches[0], e.touches[1]);
            const pinchDelta = this.initialPinchDistance - currentDist;
            if (Math.abs(pinchDelta) > 5) {
                this.cameraController.zoom(pinchDelta * 0.01);
                this.initialPinchDistance = currentDist;
            }
        }
    }

    _handleTouchEnd(e) {
        if (!this.enabled) {
            this.touchCount = e.touches.length;
            return;
        }

        // Determine if this was a tap or a pan.
        // On iOS, even a stationary tap can drift 10-15+ pixels due to finger
        // contact area and touch prediction — same issue as MacBook trackpad
        // (see _handleMouseUp comment). Fix: if touch duration is short, always
        // treat as a tap regardless of drift. Long touches only tap if no pan.
        if (this.touchCount === 1 && this.touchStartPositions.length > 0) {
            const touchDuration = performance.now() - this.touchStartTime;
            const isQuickTap = touchDuration < this.touchTapMaxDuration;

            if (isQuickTap || !this.isTouchPanning) {
                const tx = this.touchStartPositions[0].x;
                const ty = this.touchStartPositions[0].y;
                this._handleTap(tx, ty);
            }
        }

        this.touchCount = e.touches.length;
        this.isTouchPanning = false;
        this.isTouchPinching = false;
    }

    _handleTouchCancel(e) {
        // iOS fires touchcancel frequently (notifications, system gestures,
        // control center, etc.). Reset all touch state to prevent stuck state
        // that would cause subsequent taps to silently fail.
        this.touchCount = e.touches.length;
        this.isTouchPanning = false;
        this.isTouchPinching = false;
        this.touchStartPositions = [];
    }

    _getTouchDistance(t1, t2) {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ============================================================
    // Click / Tap Handlers
    // ============================================================

    _handleLeftClick(e) {
        const screenX = e.clientX;
        const screenY = e.clientY;

        console.log('[Input] _handleLeftClick at:', screenX, screenY);
        this._lastLeftClickTime = performance.now();

        // First, check for unit click via raycasting
        const unitHit = this._raycastUnits(screenX, screenY);
        if (unitHit && this._onUnitClick) {
            console.log('[Input] Unit hit:', unitHit.id, 'at tile:', unitHit.tile?.col, unitHit.tile?.row);
            this._onUnitClick(unitHit);
            return;
        }

        // Then check for tile click
        const tileHit = this._screenToTile(screenX, screenY);
        console.log('[Input] Tile hit:', tileHit);
        if (tileHit && this._onTileClick) {
            this._onTileClick(tileHit.col, tileHit.row);
        }
    }

    /**
     * Fallback click handler — fires if mousedown/mouseup pair doesn't work.
     * Debounced: only fires if _handleLeftClick didn't already fire in the last 100ms.
     */
    _handleClickEvent(e) {
        if (!this.enabled) return;
        if (e.button !== 0) return;

        // The mouseup handler already called _handleLeftClick, so we skip
        // to avoid double-processing. We use a flag to track this.
        // The click event fires AFTER mouseup, so we check timing.
        const now = performance.now();
        if (this._lastLeftClickTime && (now - this._lastLeftClickTime) < 200) {
            return; // mouseup already handled this click
        }

        console.log('[Input] click fallback at:', e.clientX, e.clientY);
        this._handleLeftClick(e);
    }

    _handleRightClick(e) {
        const tileHit = this._screenToTile(e.clientX, e.clientY);
        if (tileHit && this._onTileRightClick) {
            this._onTileRightClick(tileHit.col, tileHit.row);
        }
    }

    _handleTap(screenX, screenY) {
        // Touch tap = left click equivalent
        const unitHit = this._raycastUnits(screenX, screenY);
        if (unitHit && this._onUnitClick) {
            this._onUnitClick(unitHit);
            return;
        }

        const tileHit = this._screenToTile(screenX, screenY);
        if (tileHit && this._onTileClick) {
            this._onTileClick(tileHit.col, tileHit.row);
        }
    }

    // ============================================================
    // Raycasting Helpers
    // ============================================================

    _screenToTile(screenX, screenY) {
        const worldPos = this.cameraController.screenToWorldPlane(screenX, screenY);
        if (!worldPos) return null;

        const tile = worldToTile(worldPos.x, worldPos.z, this.gridManager.tileSize);

        // Bounds check
        if (tile.col < 0 || tile.col >= this.gridManager.gridWidth ||
            tile.row < 0 || tile.row >= this.gridManager.gridHeight) {
            return null;
        }

        return tile;
    }

    _raycastUnits(screenX, screenY) {
        if (this._unitMeshes.length === 0) return null;

        const size = this.renderer.getSize(new THREE.Vector2());
        const ndcX = (screenX / size.x) * 2 - 1;
        const ndcY = -(screenY / size.y) * 2 + 1;

        const camera = this.cameraController.getCamera();
        this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

        // Collect all unit meshes and their children for intersection
        const meshes = [];
        for (const entry of this._unitMeshes) {
            if (entry.mesh) {
                entry.mesh.traverse(child => {
                    if (child.isMesh) {
                        child.userData._unitRef = entry.unit;
                        meshes.push(child);
                    }
                });
            }
        }

        const intersects = this.raycaster.intersectObjects(meshes, false);
        if (intersects.length > 0) {
            return intersects[0].object.userData._unitRef || null;
        }

        return null;
    }

    _updateHoveredTile(screenX, screenY) {
        const tile = this._screenToTile(screenX, screenY);

        if (tile) {
            if (!this.hoveredTile || this.hoveredTile.col !== tile.col || this.hoveredTile.row !== tile.row) {
                this.hoveredTile = tile;
                if (this._onTileHover) {
                    this._onTileHover(tile.col, tile.row);
                }
            }
        } else {
            if (this.hoveredTile !== null) {
                this.hoveredTile = null;
                if (this._onTileHover) {
                    this._onTileHover(null, null);
                }
            }
        }
    }

    // ============================================================
    // Cleanup
    // ============================================================

    /**
     * Remove all event listeners.
     */
    dispose() {
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        window.removeEventListener('mouseup', this._onMouseUp);
        this.canvas.removeEventListener('mousemove', this._onMouseMove);
        this.canvas.removeEventListener('wheel', this._onWheel);
        this.canvas.removeEventListener('contextmenu', this._onContextMenu);
        this.canvas.removeEventListener('touchstart', this._onTouchStart);
        this.canvas.removeEventListener('touchmove', this._onTouchMove);
        this.canvas.removeEventListener('touchend', this._onTouchEnd);
        this.canvas.removeEventListener('touchcancel', this._onTouchCancel);
        this.canvas.removeEventListener('click', this._onClick);
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
    }
}
