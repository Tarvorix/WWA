// Slimline Tactical — Map Editor Entry Point
// Three.js scene with orthographic camera, grid overlay, object placement,
// spawn zone painting, light placement, export/import

import * as THREE from 'three';
import { CONSTANTS } from '../shared/constants.js';
import { tileToWorld, worldToTile, clamp, degToRad } from '../shared/utils.js';
import { GridManager } from '../game/grid.js';
import { ProceduralGenerator } from '../game/procedural.js';
import { EditorPalette } from './palette.js';
import { EditorPlacement } from './placement.js';
import { EditorExport } from './export.js';
import { EditorUI } from './ui.js';

// ============================================================
// Editor State
// ============================================================

const editorState = {
    mapName: 'Untitled Map',
    gridWidth: CONSTANTS.DEFAULT_GRID_SIZE[0],
    gridHeight: CONSTANTS.DEFAULT_GRID_SIZE[1],
    tileSize: CONSTANTS.TILE_SIZE,
    groundTexture: 'dirt',

    currentTool: 'select',          // 'select' | 'place' | 'spawn' | 'light'
    selectedObjectType: null,        // palette item id
    spawnFaction: null,              // 'orderOfTheAbyss' | 'germani' | null
    currentRotation: 0,              // degrees, incremented by 90
    previewMode: false
};

// ============================================================
// Three.js Setup
// ============================================================

let renderer, scene, camera;
let gridManager, proceduralGenerator;
let palette, placement, exportManager, editorUI;

// Camera state
let cameraZoom = 16;       // wider default for editor
let targetZoom = 16;
let panOffset = new THREE.Vector2(0, 0);
let targetPanOffset = new THREE.Vector2(0, 0);
const tiltAngle = 80;      // higher tilt for more top-down view in editor
const tiltRad = degToRad(tiltAngle);

// Input state
let isDragging = false;
let dragButton = -1;
let dragStart = { x: 0, y: 0 };
let mouseScreen = { x: 0, y: 0 };
let keysDown = {};
let hoveredTile = null;
let isMouseOverCanvas = false;

// Ground plane
let groundMesh = null;

// Raycaster
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function init() {
    const container = document.getElementById('editor-container');

    // ---- Renderer ----
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(CONSTANTS.RENDERER.backgroundColor, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2; // slightly brighter for editing
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // ---- Scene ----
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONSTANTS.RENDERER.backgroundColor);

    // ---- Camera ----
    const aspect = container.clientWidth / container.clientHeight;
    camera = new THREE.OrthographicCamera(
        -cameraZoom * aspect,
         cameraZoom * aspect,
         cameraZoom,
        -cameraZoom,
        0.1,
        200
    );
    _positionCamera();

    // ---- Lighting (brighter than game for editor visibility) ----
    _setupLighting();

    // ---- Grid Manager ----
    gridManager = new GridManager(scene, editorState.gridWidth, editorState.gridHeight, editorState.tileSize);

    // ---- Ground Plane ----
    _createGroundPlane();

    // ---- Procedural Generator (no textures for editor, uses fallback materials) ----
    proceduralGenerator = new ProceduralGenerator({});

    // ---- Editor Modules ----
    palette = new EditorPalette(editorState);
    placement = new EditorPlacement(scene, gridManager, proceduralGenerator, editorState);
    exportManager = new EditorExport();

    editorUI = new EditorUI(editorState, palette, placement, exportManager, {
        onApplyGrid: _onApplyGrid,
        onClearAll: _onClearAll,
        onPreviewToggle: _onPreviewToggle,
        onPaletteSelect: _onPaletteSelect,
        onSpawnMode: _onSpawnMode,
        onLightMode: _onLightMode,
        onImport: _onImport
    });

    // ---- Input ----
    _setupInput(container);

    // ---- Initial status ----
    editorUI.updateStatus();

    // ---- Start loop ----
    _animate();
}

// ============================================================
// Camera
// ============================================================

function _positionCamera() {
    const mapCenterX = editorState.gridWidth * editorState.tileSize * 0.5;
    const mapCenterZ = editorState.gridHeight * editorState.tileSize * 0.5;

    const distance = 50;
    const camY = distance * Math.sin(tiltRad);
    const camZ = mapCenterZ + distance * Math.cos(tiltRad);

    camera.position.set(
        mapCenterX + panOffset.x,
        camY,
        camZ + panOffset.y
    );

    camera.lookAt(
        mapCenterX + panOffset.x,
        0,
        mapCenterZ + panOffset.y
    );
}

function _updateCamera(dt) {
    // Smooth zoom
    cameraZoom += (targetZoom - cameraZoom) * Math.min(1, dt * 10);

    // Smooth pan
    panOffset.x += (targetPanOffset.x - panOffset.x) * Math.min(1, dt * 10);
    panOffset.y += (targetPanOffset.y - panOffset.y) * Math.min(1, dt * 10);

    // WASD pan
    const panSpeed = cameraZoom * 0.04;
    if (keysDown['w'] || keysDown['arrowup']) targetPanOffset.y -= panSpeed;
    if (keysDown['s'] || keysDown['arrowdown']) targetPanOffset.y += panSpeed;
    if (keysDown['a'] || keysDown['arrowleft']) targetPanOffset.x -= panSpeed;
    if (keysDown['d'] || keysDown['arrowright']) targetPanOffset.x += panSpeed;

    // Clamp pan to map bounds (with some padding)
    const mapW = editorState.gridWidth * editorState.tileSize;
    const mapH = editorState.gridHeight * editorState.tileSize;
    const pad = cameraZoom;
    targetPanOffset.x = clamp(targetPanOffset.x, -pad, mapW + pad - mapW);
    targetPanOffset.y = clamp(targetPanOffset.y, -pad, mapH + pad - mapH);

    // Update frustum
    const container = document.getElementById('editor-container');
    const aspect = container.clientWidth / container.clientHeight;
    camera.left = -cameraZoom * aspect;
    camera.right = cameraZoom * aspect;
    camera.top = cameraZoom;
    camera.bottom = -cameraZoom;
    camera.updateProjectionMatrix();

    // Update position
    _positionCamera();
}

// ============================================================
// Lighting
// ============================================================

function _setupLighting() {
    // Key light — brighter than game for editor
    const keyLight = new THREE.DirectionalLight(0xfff0dd, 1.6);
    const elevRad = degToRad(35);
    const azimRad = degToRad(-30);
    const dist = 30;
    keyLight.position.set(
        dist * Math.cos(elevRad) * Math.sin(azimRad),
        dist * Math.sin(elevRad),
        dist * Math.cos(elevRad) * Math.cos(azimRad)
    );

    const mapCX = editorState.gridWidth * editorState.tileSize * 0.5;
    const mapCZ = editorState.gridHeight * editorState.tileSize * 0.5;
    keyLight.target.position.set(mapCX, 0, mapCZ);
    scene.add(keyLight.target);

    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    const shadowRange = Math.max(editorState.gridWidth, editorState.gridHeight) * editorState.tileSize * 0.6;
    keyLight.shadow.camera.left = -shadowRange;
    keyLight.shadow.camera.right = shadowRange;
    keyLight.shadow.camera.top = shadowRange;
    keyLight.shadow.camera.bottom = -shadowRange;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 100;
    keyLight.shadow.radius = 2;
    keyLight.shadow.bias = -0.0002;
    scene.add(keyLight);

    // Rim light
    const rimLight = new THREE.DirectionalLight(0xaabbff, 1.0);
    rimLight.position.set(-dist * 0.5, dist * 0.7, -dist * 0.3);
    scene.add(rimLight);

    // Ambient — brighter for editor
    const ambient = new THREE.HemisphereLight(0x222244, 0x111108, 0.4);
    scene.add(ambient);
}

// ============================================================
// Ground Plane
// ============================================================

function _createGroundPlane() {
    if (groundMesh) {
        scene.remove(groundMesh);
        groundMesh.geometry.dispose();
        groundMesh.material.dispose();
    }

    const w = editorState.gridWidth * editorState.tileSize;
    const h = editorState.gridHeight * editorState.tileSize;

    const geometry = new THREE.PlaneGeometry(w, h);
    geometry.rotateX(-Math.PI / 2);

    // Simple ground material for editor (no PBR textures)
    const material = new THREE.MeshStandardMaterial({
        color: 0x3d3425,
        roughness: 0.95,
        metalness: 0.0
    });

    groundMesh = new THREE.Mesh(geometry, material);
    groundMesh.position.set(w * 0.5, 0, h * 0.5);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
}

// ============================================================
// Input Handling
// ============================================================

function _setupInput(container) {
    const canvas = renderer.domElement;

    // Mouse events on canvas
    canvas.addEventListener('mousedown', _onMouseDown);
    canvas.addEventListener('mousemove', _onMouseMove);
    canvas.addEventListener('mouseup', _onMouseUp);
    canvas.addEventListener('wheel', _onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mouseenter', () => { isMouseOverCanvas = true; });
    canvas.addEventListener('mouseleave', () => {
        isMouseOverCanvas = false;
        gridManager.clearSingleHighlight();
        placement.hideGhost();
        hoveredTile = null;
    });

    // Keyboard events
    window.addEventListener('keydown', _onKeyDown);
    window.addEventListener('keyup', _onKeyUp);

    // Window resize
    window.addEventListener('resize', _onResize);
}

function _onMouseDown(e) {
    isDragging = false;
    dragButton = e.button;
    dragStart = { x: e.clientX, y: e.clientY };

    // Left click — immediate action (place/paint)
    if (e.button === 0 && !e.altKey) {
        _handleLeftClick(e);
    }
}

function _onMouseMove(e) {
    mouseScreen.x = e.clientX;
    mouseScreen.y = e.clientY;

    // Middle mouse drag or Alt+Left drag: pan
    if ((dragButton === 1) || (dragButton === 0 && e.altKey)) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        dragStart = { x: e.clientX, y: e.clientY };
        isDragging = true;

        // Convert screen pixels to world units
        const container = document.getElementById('editor-container');
        const pixelsPerUnit = container.clientWidth / (cameraZoom * 2 * (container.clientWidth / container.clientHeight));
        const worldDX = -dx / pixelsPerUnit;

        // For the Z axis, account for the camera tilt
        const pixelsPerUnitZ = container.clientHeight / (cameraZoom * 2);
        const worldDZ = -dy / pixelsPerUnitZ;

        targetPanOffset.x += worldDX;
        targetPanOffset.y += worldDZ;
        return;
    }

    // Left drag: continuous paint for spawn zones
    if (dragButton === 0 && !e.altKey && editorState.currentTool === 'spawn' && editorState.spawnFaction) {
        const tile = _getTileUnderMouse(e);
        if (tile) {
            placement.setSpawnZone(tile.col, tile.row, editorState.spawnFaction);
            editorUI.updateStatus(tile.col, tile.row);
        }
    }

    // Hover highlight
    if (isMouseOverCanvas && !editorState.previewMode) {
        const tile = _getTileUnderMouse(e);
        if (tile) {
            if (!hoveredTile || hoveredTile.col !== tile.col || hoveredTile.row !== tile.row) {
                hoveredTile = tile;
                gridManager.highlightSingle(tile.col, tile.row, 0xffcc44);

                // Ghost preview for object placement
                if (editorState.currentTool === 'place' && editorState.selectedObjectType) {
                    const typeConfig = palette.getSelected();
                    if (typeConfig && !placement.hasObject(tile.col, tile.row)) {
                        placement.showGhost(tile.col, tile.row, typeConfig);
                    } else {
                        placement.hideGhost();
                    }
                } else {
                    placement.hideGhost();
                }

                editorUI.updateStatus(tile.col, tile.row);
            }
        } else {
            if (hoveredTile) {
                hoveredTile = null;
                gridManager.clearSingleHighlight();
                placement.hideGhost();
            }
        }
    }
}

function _onMouseUp(e) {
    dragButton = -1;
    isDragging = false;
}

function _onWheel(e) {
    e.preventDefault();
    const zoomDelta = e.deltaY * 0.01;
    targetZoom = clamp(targetZoom + zoomDelta, 3, 40);
}

function _onKeyDown(e) {
    const key = e.key.toLowerCase();
    keysDown[key] = true;

    // R — rotate
    if (key === 'r' && !e.ctrlKey && !e.metaKey) {
        editorState.currentRotation = (editorState.currentRotation + 90) % 360;

        // If hovering over an existing object, rotate it
        if (hoveredTile && placement.hasObject(hoveredTile.col, hoveredTile.row)) {
            placement.rotateObject(hoveredTile.col, hoveredTile.row);
        }

        // Update ghost preview if showing
        if (hoveredTile && editorState.currentTool === 'place') {
            placement.hideGhost();
            const typeConfig = palette.getSelected();
            if (typeConfig && !placement.hasObject(hoveredTile.col, hoveredTile.row)) {
                placement.showGhost(hoveredTile.col, hoveredTile.row, typeConfig);
            }
        }
    }

    // P — toggle preview
    if (key === 'p' && !e.ctrlKey && !e.metaKey) {
        editorState.previewMode = !editorState.previewMode;
        editorUI.togglePreviewMode(editorState.previewMode);
        gridManager.setGridVisible(!editorState.previewMode);

        if (editorState.previewMode) {
            gridManager.clearSingleHighlight();
            placement.hideGhost();
        }
    }

    // Escape — deselect tool
    if (key === 'escape') {
        editorUI.deselectAll();
        placement.hideGhost();
    }

    // Delete — remove object at hovered tile
    if ((key === 'delete' || key === 'backspace') && hoveredTile) {
        _removeAtTile(hoveredTile.col, hoveredTile.row);
    }
}

function _onKeyUp(e) {
    keysDown[e.key.toLowerCase()] = false;
}

function _onResize() {
    const container = document.getElementById('editor-container');
    renderer.setSize(container.clientWidth, container.clientHeight);

    const aspect = container.clientWidth / container.clientHeight;
    camera.left = -cameraZoom * aspect;
    camera.right = cameraZoom * aspect;
    camera.top = cameraZoom;
    camera.bottom = -cameraZoom;
    camera.updateProjectionMatrix();
}

// ============================================================
// Click Handling
// ============================================================

function _handleLeftClick(e) {
    if (editorState.previewMode) return;

    const tile = _getTileUnderMouse(e);
    if (!tile) return;

    const { col, row } = tile;

    switch (editorState.currentTool) {
        case 'place': {
            const typeConfig = palette.getSelected();
            if (typeConfig && !placement.hasObject(col, row)) {
                placement.placeObject(col, row, typeConfig);
                placement.hideGhost();
                editorUI.updateStatus(col, row);
            }
            break;
        }
        case 'spawn': {
            if (editorState.spawnFaction) {
                // Toggle spawn zone: if already set to this faction, clear it
                const key = `${col},${row}`;
                if (placement.hasSpawnZone(col, row)) {
                    placement.clearSpawnZone(col, row);
                } else {
                    placement.setSpawnZone(col, row, editorState.spawnFaction);
                }
                editorUI.updateStatus(col, row);
            }
            break;
        }
        case 'light': {
            const lightSettings = editorUI.getLightSettings();
            if (placement.hasLight(col, row)) {
                placement.removeLight(col, row);
            } else {
                placement.placeLight(
                    col, row,
                    lightSettings.color,
                    lightSettings.intensity,
                    lightSettings.radius,
                    lightSettings.height
                );
            }
            editorUI.updateStatus(col, row);
            break;
        }
        case 'select': {
            // In select mode, clicking an object could select it for info/rotation
            // For now, just update status
            editorUI.updateStatus(col, row);
            break;
        }
    }
}

function _handleRightClick(e) {
    if (editorState.previewMode) return;

    const tile = _getTileUnderMouse(e);
    if (!tile) return;

    _removeAtTile(tile.col, tile.row);
    editorUI.updateStatus(tile.col, tile.row);
}

function _removeAtTile(col, row) {
    // Remove whatever is on this tile (object, spawn zone, or light)
    if (placement.hasObject(col, row)) {
        placement.removeObject(col, row);
    }
    if (placement.hasSpawnZone(col, row)) {
        placement.clearSpawnZone(col, row);
    }
    if (placement.hasLight(col, row)) {
        placement.removeLight(col, row);
    }
    editorUI.updateStatus(col, row);
}

// ============================================================
// Raycast / Tile Detection
// ============================================================

function _getTileUnderMouse(e) {
    const container = document.getElementById('editor-container');
    const rect = container.getBoundingClientRect();

    // Convert to NDC
    mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouseNDC, camera);

    // Intersect with Y=0 ground plane
    const intersection = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(groundPlane, intersection);

    if (!hit) return null;

    // Convert world position to tile coordinates
    const tileCoord = worldToTile(intersection.x, intersection.z, editorState.tileSize);

    // Bounds check
    if (tileCoord.col < 0 || tileCoord.col >= editorState.gridWidth ||
        tileCoord.row < 0 || tileCoord.row >= editorState.gridHeight) {
        return null;
    }

    return tileCoord;
}

// ============================================================
// Callbacks from EditorUI
// ============================================================

function _onApplyGrid(newWidth, newHeight) {
    // Store old placements
    const { objects, spawnZones } = placement.getAllPlacedData();
    const lights = placement.getAllLightData();

    // Clear everything
    placement.clearAll();

    // Remove old grid and ground
    gridManager.dispose();
    if (groundMesh) {
        scene.remove(groundMesh);
        groundMesh.geometry.dispose();
        groundMesh.material.dispose();
        groundMesh = null;
    }

    // Update state
    editorState.gridWidth = newWidth;
    editorState.gridHeight = newHeight;

    // Recreate grid and ground
    gridManager = new GridManager(scene, newWidth, newHeight, editorState.tileSize);
    _createGroundPlane();

    // Recreate placement with new grid
    placement = new EditorPlacement(scene, gridManager, proceduralGenerator, editorState);

    // Re-load objects that are within new bounds
    const filteredObjects = objects.filter(obj =>
        obj.tile[0] < newWidth && obj.tile[1] < newHeight
    );
    const filteredSpawnZones = {};
    for (const factionId in spawnZones) {
        filteredSpawnZones[factionId] = spawnZones[factionId].filter(
            tile => tile[0] < newWidth && tile[1] < newHeight
        );
    }
    const filteredLights = lights.filter(l =>
        l.tile[0] < newWidth && l.tile[1] < newHeight
    );

    const reloadData = {
        objects: filteredObjects,
        spawnZones: filteredSpawnZones,
        lights: filteredLights
    };
    placement.loadFromData(reloadData);

    // Update UI reference
    editorUI.placement = placement;

    // Reset camera to center on new grid
    targetPanOffset.set(0, 0);
    panOffset.set(0, 0);

    editorUI.updateStatus();
}

function _onClearAll() {
    placement.clearAll();
    editorUI.updateStatus();
}

function _onPreviewToggle(preview) {
    editorUI.togglePreviewMode(preview);
    gridManager.setGridVisible(!preview);

    if (preview) {
        gridManager.clearSingleHighlight();
        placement.hideGhost();
    }
}

function _onPaletteSelect(typeId) {
    // Clear spawn and light modes when palette is selected
    editorState.spawnFaction = null;
}

function _onSpawnMode(factionId) {
    // Clear palette selection when entering spawn mode
    if (factionId) {
        editorState.selectedObjectType = null;
    }
}

function _onLightMode(active) {
    // Clear other modes when entering light mode
    if (active) {
        editorState.selectedObjectType = null;
        editorState.spawnFaction = null;
    }
}

function _onImport(mapData) {
    // Apply imported map settings
    editorUI.loadSettingsFromData(mapData);

    // Resize grid if needed
    const newWidth = mapData.gridSize[0];
    const newHeight = mapData.gridSize[1];

    if (newWidth !== editorState.gridWidth || newHeight !== editorState.gridHeight) {
        editorState.gridWidth = newWidth;
        editorState.gridHeight = newHeight;
        editorUI.updateGridSizeDisplay(newWidth, newHeight);

        // Rebuild grid and ground
        gridManager.dispose();
        if (groundMesh) {
            scene.remove(groundMesh);
            groundMesh.geometry.dispose();
            groundMesh.material.dispose();
            groundMesh = null;
        }

        gridManager = new GridManager(scene, newWidth, newHeight, editorState.tileSize);
        _createGroundPlane();

        // Recreate placement with new grid
        placement = new EditorPlacement(scene, gridManager, proceduralGenerator, editorState);
        editorUI.placement = placement;
    } else {
        placement.clearAll();
    }

    // Load all data
    placement.loadFromData(mapData);

    // Reset camera
    targetPanOffset.set(0, 0);
    panOffset.set(0, 0);

    editorUI.updateStatus();
}

// ============================================================
// Right-click handler (added to canvas via contextmenu workaround)
// ============================================================

function _setupRightClick() {
    renderer.domElement.addEventListener('mouseup', (e) => {
        if (e.button === 2 && !isDragging) {
            _handleRightClick(e);
        }
    });
}

// ============================================================
// Animation Loop
// ============================================================

let lastTime = performance.now();

function _animate() {
    requestAnimationFrame(_animate);

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap delta
    lastTime = now;

    _updateCamera(dt);

    renderer.render(scene, camera);
}

// ============================================================
// Boot
// ============================================================

init();
_setupRightClick();
