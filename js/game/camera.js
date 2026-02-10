// Slimline Tactical — Camera Controller
// Orthographic camera with tilt, pan, zoom, combat cam, projections

import * as THREE from 'three';
import { CONSTANTS } from '../shared/constants.js';
import { lerp, clamp, degToRad, easeInOutCubic } from '../shared/utils.js';

const CAM = CONSTANTS.CAMERA;

export class CameraController {
    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {number} mapWidth — grid columns
     * @param {number} mapHeight — grid rows
     * @param {number} tileSize
     */
    constructor(renderer, mapWidth, mapHeight, tileSize) {
        this.renderer = renderer;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.tileSize = tileSize;

        // World-space map dimensions
        this.mapWorldWidth = mapWidth * tileSize;
        this.mapWorldHeight = mapHeight * tileSize;
        this.mapCenterX = this.mapWorldWidth * 0.5;
        this.mapCenterZ = this.mapWorldHeight * 0.5;

        // Zoom state (frustum half-width in world units)
        this.currentZoom = CAM.defaultZoom;
        this.targetZoom = CAM.defaultZoom;

        // Pan offset from map center (world-space XZ)
        this.panOffset = new THREE.Vector2(0, 0);
        this.targetPanOffset = new THREE.Vector2(0, 0);

        // Camera tilt angle in radians
        this.tiltRad = degToRad(CAM.tiltAngle);

        // Create orthographic camera
        const aspect = this._getAspect();
        this.camera = new THREE.OrthographicCamera(
            -this.currentZoom * aspect,
             this.currentZoom * aspect,
             this.currentZoom,
            -this.currentZoom,
            0.1,
            200
        );

        // Position camera using tilt angle
        this._positionCamera();

        // Raycaster for screen-to-world projection
        this.raycaster = new THREE.Raycaster();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

        // Combat camera state
        this.savedView = null;
        this.combatTween = null; // { from, to, progress, duration, onComplete }

        // Smooth pan tween (for programmatic pans like AI camera follow)
        this.panTween = null; // { fromX, fromZ, toX, toZ, progress, duration, onComplete }
    }

    // ---- Private ----

    _getAspect() {
        const size = this.renderer.getSize(new THREE.Vector2());
        return size.x / size.y;
    }

    /**
     * Position the camera based on current zoom, pan offset, and tilt angle.
     * Camera looks at a focal point on the ground plane (mapCenter + panOffset).
     */
    _positionCamera() {
        const aspect = this._getAspect();

        // Update frustum
        this.camera.left = -this.currentZoom * aspect;
        this.camera.right = this.currentZoom * aspect;
        this.camera.top = this.currentZoom;
        this.camera.bottom = -this.currentZoom;

        // Focal point on ground plane (map center + pan offset)
        const focalX = this.mapCenterX + this.panOffset.x;
        const focalZ = this.mapCenterZ + this.panOffset.y;

        // Distance from focal point along the tilt direction
        // Larger distance to ensure the view encompasses everything properly
        const distance = 50;

        // Camera position: offset from focal point upward and backward based on tilt
        const camX = focalX;
        const camY = distance * Math.sin(this.tiltRad);
        const camZ = focalZ + distance * Math.cos(this.tiltRad);

        this.camera.position.set(camX, camY, camZ);
        this.camera.lookAt(focalX, 0, focalZ);

        this.camera.updateProjectionMatrix();
    }

    /**
     * Clamp pan offset so the camera doesn't drift too far off the map.
     */
    _clampPanOffset(offset) {
        // Allow panning up to half the visible area beyond map edges
        const aspect = this._getAspect();
        const visibleWidth = this.currentZoom * aspect;
        const visibleHeight = this.currentZoom;

        const maxPanX = Math.max(0, this.mapWorldWidth * 0.5 + visibleWidth * 0.3);
        const maxPanZ = Math.max(0, this.mapWorldHeight * 0.5 + visibleHeight * 0.3);

        offset.x = clamp(offset.x, -maxPanX, maxPanX);
        offset.y = clamp(offset.y, -maxPanZ, maxPanZ);

        return offset;
    }

    // ---- Public API ----

    /**
     * Update camera interpolation each frame.
     * @param {number} deltaTime — seconds
     */
    update(deltaTime) {
        // Handle combat camera tween
        if (this.combatTween) {
            const ct = this.combatTween;
            ct.progress += deltaTime / ct.duration;

            if (ct.progress >= 1.0) {
                ct.progress = 1.0;
                this.currentZoom = ct.toZoom;
                this.panOffset.set(ct.toPanX, ct.toPanZ);
                const onComplete = ct.onComplete;
                this.combatTween = null;
                if (onComplete) onComplete();
            } else {
                const t = easeInOutCubic(ct.progress);
                this.currentZoom = lerp(ct.fromZoom, ct.toZoom, t);
                this.panOffset.x = lerp(ct.fromPanX, ct.toPanX, t);
                this.panOffset.y = lerp(ct.fromPanZ, ct.toPanZ, t);
            }

            this._positionCamera();
            return;
        }

        // Handle smooth pan tween (for AI camera follow etc.)
        if (this.panTween) {
            const pt = this.panTween;
            pt.progress += deltaTime / pt.duration;

            if (pt.progress >= 1.0) {
                pt.progress = 1.0;
                this.targetPanOffset.set(pt.toX, pt.toZ);
                this.panOffset.set(pt.toX, pt.toZ);
                const onComplete = pt.onComplete;
                this.panTween = null;
                if (onComplete) onComplete();
            } else {
                const t = easeInOutCubic(pt.progress);
                const px = lerp(pt.fromX, pt.toX, t);
                const pz = lerp(pt.fromZ, pt.toZ, t);
                this.targetPanOffset.set(px, pz);
                this.panOffset.set(px, pz);
            }

            this._positionCamera();
            return;
        }

        // Smoothly interpolate zoom
        const zoomLerp = 1.0 - Math.exp(-CAM.zoomLerpSpeed * deltaTime);
        this.currentZoom = lerp(this.currentZoom, this.targetZoom, zoomLerp);

        // Smoothly interpolate pan
        const panLerp = 1.0 - Math.exp(-CAM.panLerpSpeed * deltaTime);
        this.panOffset.x = lerp(this.panOffset.x, this.targetPanOffset.x, panLerp);
        this.panOffset.y = lerp(this.panOffset.y, this.targetPanOffset.y, panLerp);

        this._positionCamera();
    }

    /**
     * Add to pan offset in world-space XZ.
     * Cancels any active pan tween so user input takes priority.
     * @param {number} deltaX — world X offset
     * @param {number} deltaZ — world Z offset
     */
    pan(deltaX, deltaZ) {
        // Cancel any programmatic pan tween — user input takes priority
        if (this.panTween) {
            this.panTween = null;
        }

        this.targetPanOffset.x += deltaX;
        this.targetPanOffset.y += deltaZ;
        this._clampPanOffset(this.targetPanOffset);
    }

    /**
     * Adjust zoom level.
     * @param {number} delta — positive zooms out, negative zooms in
     */
    zoom(delta) {
        // Cancel any programmatic pan tween — user input takes priority
        if (this.panTween) {
            this.panTween = null;
        }

        this.targetZoom = clamp(
            this.targetZoom + delta * CAM.zoomSpeed,
            CAM.minZoom,
            CAM.maxZoom
        );
    }

    /**
     * Convert screen-space mouse delta to world-space pan.
     * Accounts for camera tilt and current zoom level.
     * @param {number} dx — screen pixels
     * @param {number} dy — screen pixels
     */
    panFromScreenDelta(dx, dy) {
        const size = this.renderer.getSize(new THREE.Vector2());
        const aspect = size.x / size.y;

        // World units visible
        const worldWidth = this.currentZoom * 2 * aspect;
        const worldHeight = this.currentZoom * 2;

        // Convert pixel delta to world delta
        const worldDX = -(dx / size.x) * worldWidth;
        // Y screen movement translates to Z world movement, scaled by tilt
        const worldDZ = -(dy / size.y) * worldHeight / Math.sin(this.tiltRad);

        this.pan(worldDX, worldDZ);
    }

    /**
     * Smoothly pan camera to center on a world position.
     * @param {number} worldX
     * @param {number} worldZ
     * @param {number} duration — seconds
     * @returns {Promise} resolves when pan completes
     */
    panToWorldPos(worldX, worldZ, duration = 0.6) {
        return new Promise(resolve => {
            const toPanX = worldX - this.mapCenterX;
            const toPanZ = worldZ - this.mapCenterZ;

            this.panTween = {
                fromX: this.panOffset.x,
                fromZ: this.panOffset.y,
                toX: toPanX,
                toZ: toPanZ,
                progress: 0,
                duration: duration,
                onComplete: resolve
            };
        });
    }

    /**
     * Save current view and tween camera to frame attacker and target during combat.
     * @param {{ x: number, z: number }} attackerPos — world position
     * @param {{ x: number, z: number }} targetPos — world position
     * @returns {Promise} resolves when tween completes
     */
    startCombatCam(attackerPos, targetPos) {
        return new Promise(resolve => {
            // Save current view state
            this.savedView = {
                zoom: this.targetZoom,
                panX: this.targetPanOffset.x,
                panZ: this.targetPanOffset.y
            };

            // Calculate midpoint between attacker and target
            const midX = (attackerPos.x + targetPos.x) * 0.5;
            const midZ = (attackerPos.z + targetPos.z) * 0.5;

            // Calculate zoom to frame both units with padding
            const dx = Math.abs(attackerPos.x - targetPos.x);
            const dz = Math.abs(attackerPos.z - targetPos.z);
            const combatSpan = Math.max(dx, dz) + 6; // padding of 3 tiles on each side
            const combatZoom = clamp(
                combatSpan * CAM.combatZoomFactor,
                CAM.minZoom,
                this.currentZoom * 0.8 // never zoom out further than current view
            );

            // Pan offset to center on midpoint
            const toPanX = midX - this.mapCenterX;
            const toPanZ = midZ - this.mapCenterZ;

            this.combatTween = {
                fromZoom: this.currentZoom,
                toZoom: combatZoom,
                fromPanX: this.panOffset.x,
                fromPanZ: this.panOffset.y,
                toPanX: toPanX,
                toPanZ: toPanZ,
                progress: 0,
                duration: CAM.combatTweenDuration,
                onComplete: resolve
            };
        });
    }

    /**
     * Tween camera back to the saved view from before combat cam.
     * @returns {Promise} resolves when tween completes
     */
    endCombatCam() {
        return new Promise(resolve => {
            if (!this.savedView) {
                resolve();
                return;
            }

            this.combatTween = {
                fromZoom: this.currentZoom,
                toZoom: this.savedView.zoom,
                fromPanX: this.panOffset.x,
                fromPanZ: this.panOffset.y,
                toPanX: this.savedView.panX,
                toPanZ: this.savedView.panZ,
                progress: 0,
                duration: CAM.combatTweenDuration,
                onComplete: () => {
                    // Restore targets so normal interpolation takes over
                    this.targetZoom = this.savedView.zoom;
                    this.targetPanOffset.set(this.savedView.panX, this.savedView.panZ);
                    this.savedView = null;
                    resolve();
                }
            };
        });
    }

    /**
     * Hold combat camera for a duration, then return.
     * @param {number} holdDuration — seconds to hold before returning
     * @returns {Promise} resolves when camera has returned to saved view
     */
    async holdAndReturn(holdDuration) {
        await new Promise(resolve => setTimeout(resolve, holdDuration * 1000));
        return this.endCombatCam();
    }

    /**
     * Project a world position to normalized screen coordinates.
     * @param {THREE.Vector3 | { x: number, y: number, z: number }} worldPos
     * @returns {{ x: number, y: number }} — screen coordinates in pixels
     */
    worldToScreen(worldPos) {
        const vec = new THREE.Vector3(worldPos.x, worldPos.y || 0, worldPos.z);
        vec.project(this.camera);

        const size = this.renderer.getSize(new THREE.Vector2());
        return {
            x: (vec.x * 0.5 + 0.5) * size.x,
            y: (-vec.y * 0.5 + 0.5) * size.y
        };
    }

    /**
     * Raycast from screen coordinates onto the Y=0 ground plane.
     * @param {number} screenX — screen pixels
     * @param {number} screenY — screen pixels
     * @returns {{ x: number, z: number } | null} — world position on ground, or null if no intersection
     */
    screenToWorldPlane(screenX, screenY) {
        const size = this.renderer.getSize(new THREE.Vector2());

        // Convert screen pixels to NDC [-1, 1]
        const ndcX = (screenX / size.x) * 2 - 1;
        const ndcY = -(screenY / size.y) * 2 + 1;

        this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

        const intersection = new THREE.Vector3();
        const hit = this.raycaster.ray.intersectPlane(this.groundPlane, intersection);

        if (hit) {
            return { x: intersection.x, z: intersection.z };
        }
        return null;
    }

    /**
     * Get the Three.js camera instance.
     * @returns {THREE.OrthographicCamera}
     */
    getCamera() {
        return this.camera;
    }

    /**
     * Update camera on window resize.
     * @param {number} width — new container width
     * @param {number} height — new container height
     */
    resize(width, height) {
        this._positionCamera();
    }

    /**
     * Instantly set camera to look at a specific world position (no animation).
     * @param {number} worldX
     * @param {number} worldZ
     */
    lookAt(worldX, worldZ) {
        this.targetPanOffset.x = worldX - this.mapCenterX;
        this.targetPanOffset.y = worldZ - this.mapCenterZ;
        this._clampPanOffset(this.targetPanOffset);
        this.panOffset.copy(this.targetPanOffset);
        this._positionCamera();
    }

    /**
     * Set zoom level instantly (no animation).
     * @param {number} zoomLevel
     */
    setZoom(zoomLevel) {
        this.targetZoom = clamp(zoomLevel, CAM.minZoom, CAM.maxZoom);
        this.currentZoom = this.targetZoom;
        this._positionCamera();
    }

    /**
     * Check if the camera is currently in a combat tween.
     * @returns {boolean}
     */
    isTweening() {
        return this.combatTween !== null || this.panTween !== null;
    }
}
