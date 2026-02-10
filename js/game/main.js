// Slimline Tactical — Main Entry Point
// Sets up renderer, scene, lighting, post-processing, game loop, and all systems

import * as THREE from 'three';

import { CONSTANTS } from '../shared/constants.js';
import { EventBus, degToRad } from '../shared/utils.js';
import { CameraController } from './camera.js';
import { GridManager } from './grid.js';
import { InputManager } from './input.js';
import { ProceduralGenerator } from './procedural.js';
import { MapLoader } from './map-loader.js';
import { UnitManager } from './units.js';
import { UIManager } from './ui.js';
import { CombatSystem } from './combat.js';
import { VFXManager } from './vfx.js';
import { TurnManager } from './turns.js';
import { AIController } from './ai.js';

// ============================================================
// Game State
// ============================================================

const gameState = {
    phase: CONSTANTS.GAME_PHASES.LOADING,
    turn: 1,
    currentFaction: 'orderOfTheAbyss',
    activeUnit: null,
    selectedUnit: null,
    units: [],
    mapData: null,
    playerFaction: 'orderOfTheAbyss',
    aiFaction: 'germani'
};

// ============================================================
// System References (populated during init)
// ============================================================

let renderer, scene, clock;
let cameraController, gridManager, inputManager;
let mapLoader, proceduralGenerator;
let unitManager, combatSystem, turnManager, aiController, vfxManager, uiManager;

// Loading screen references
const loadingScreen = document.getElementById('loading-screen');
const loadingBarFill = document.getElementById('loading-bar-fill');
const loadingStatus = document.getElementById('loading-status');

// ============================================================
// Initialization
// ============================================================

async function init() {
    try {
        updateLoadingProgress('Initializing renderer...', 0);

        // 1. Create Renderer (WebGPU with automatic WebGL2 fallback)
        renderer = new THREE.WebGPURenderer({
            antialias: CONSTANTS.RENDERER.antialias,
            powerPreference: 'high-performance'
        });
        await renderer.init();

        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Tone mapping
        renderer.toneMapping = THREE.LinearToneMapping;
        renderer.toneMappingExposure = CONSTANTS.RENDERER.toneMappingExposure;

        // Color space
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Shadows
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Background
        renderer.setClearColor(0x1a0a2e);

        // Append canvas to container
        const container = document.getElementById('game-container');
        container.appendChild(renderer.domElement);

        // 2. Create Scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a0a2e); // dark purple — distinguishable from black ground

        // No fog — it crushes ground visibility with the orthographic camera
        // scene.fog = new THREE.FogExp2(0x0a0a10, 0.003);

        // 3. Clock
        clock = new THREE.Clock();

        updateLoadingProgress('Creating grid...', 0.05);

        // 4. Grid Manager (using default grid size, will update when map loads)
        const [defaultWidth, defaultHeight] = CONSTANTS.DEFAULT_GRID_SIZE;
        gridManager = new GridManager(scene, defaultWidth, defaultHeight, CONSTANTS.TILE_SIZE);

        // 5. Camera Controller
        cameraController = new CameraController(renderer, defaultWidth, defaultHeight, CONSTANTS.TILE_SIZE);
        scene.add(cameraController.getCamera());

        // 6. Input Manager
        inputManager = new InputManager(renderer, cameraController, gridManager);

        // 7. Set up lighting rig
        updateLoadingProgress('Setting up lighting...', 0.1);
        setupLightingRig();

        // 8. Create ProceduralGenerator and MapLoader
        proceduralGenerator = new ProceduralGenerator({});
        mapLoader = new MapLoader(scene, gridManager, proceduralGenerator);

        // 9. Load Map
        updateLoadingProgress('Loading map...', 0.15);
        const mapResult = await mapLoader.loadMap('maps/test-map.json', (status, progress) => {
            updateLoadingProgress(status, 0.15 + progress * 0.5);
        });
        gameState.mapData = mapResult.mapData;

        // Debug: confirm scene contents after map load
        console.log('[Main] Scene children after map load:', scene.children.length);
        console.log('[Main] Ground mesh:', mapResult.groundMesh?.position);
        console.log('[Main] Cover objects:', mapResult.coverObjects?.length);
        console.log('[Main] Env lights:', mapResult.envLights?.length);
        console.log('[Main] Camera position:', cameraController.getCamera().position);
        console.log('[Main] Camera zoom:', cameraController.currentZoom);

        // 10. Post-processing — disabled (WebGL EffectComposer not compatible with WebGPU renderer)
        // Will need node-based post-processing when re-enabled

        // 11. Create VFX Manager
        vfxManager = new VFXManager(scene);

        // 12. Create Unit Manager and load faction models
        updateLoadingProgress('Loading unit models...', 0.7);
        unitManager = new UnitManager(scene, gridManager, gameState);

        // Load both factions' models
        await unitManager.loadFactionModels('orderOfTheAbyss');
        updateLoadingProgress('Loading enemy models...', 0.78);
        await unitManager.loadFactionModels('germani');

        // 13. Spawn squads
        updateLoadingProgress('Deploying units...', 0.82);
        unitManager.spawnSquad('orderOfTheAbyss');
        unitManager.spawnSquad('germani');

        // Register unit meshes for input raycasting
        inputManager.registerUnitMeshes(unitManager.getUnitMeshList());

        // 14. Create UI Manager
        uiManager = new UIManager(gameState, cameraController, unitManager);

        // Create floating UI for all units
        for (const unit of gameState.units) {
            uiManager.createFloatingUI(unit);
        }

        // 15. Create Combat System
        combatSystem = new CombatSystem(gameState, gridManager, unitManager, vfxManager, cameraController, uiManager);

        // 16. Create AI Controller
        aiController = new AIController(gameState, unitManager, gridManager, combatSystem, cameraController);

        // 17. Create Turn Manager
        turnManager = new TurnManager(gameState, unitManager, gridManager, combatSystem, cameraController, inputManager, uiManager);
        turnManager.setAIController(aiController);

        // 18. Set up input callbacks (wired to turn manager)
        setupInputCallbacks();
        turnManager.setupHoverCallback();

        // 19. Create atmospheric particles
        updateLoadingProgress('Creating atmosphere...', 0.9);
        createAtmosphere();

        // 20. Window resize handler
        window.addEventListener('resize', onWindowResize);

        // 21. Transition from loading to game
        updateLoadingProgress('Ready.', 1.0);

        await new Promise(resolve => setTimeout(resolve, 300));

        // Fade out loading screen and force-ensure it's fully removed
        if (loadingScreen) {
            loadingScreen.classList.add('fade-out');
            loadingScreen.style.pointerEvents = 'none'; // immediately stop blocking clicks
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 800);
        }

        // 22. Start the game via the turn manager
        gameState.phase = CONSTANTS.GAME_PHASES.PLAYER_SELECT_UNIT;
        updatePhaseIndicator();

        // Start game loop via renderer's animation loop
        renderer.setAnimationLoop(gameLoop);

        // Then start the turn system (will trigger first activation)
        try {
            turnManager.startGame();
            console.log('[Main] startGame() completed — phase:', gameState.phase, 'activeUnit:', gameState.activeUnit?.id);
        } catch (startError) {
            console.error('[Main] startGame() failed:', startError);
            // Recovery: ensure input is enabled and phase is correct so player can still click
            gameState.phase = CONSTANTS.GAME_PHASES.PLAYER_SELECT_UNIT;
            inputManager.setEnabled(true);
            updatePhaseIndicator();
        }

        console.log('Slimline Tactical initialized successfully.');

    } catch (error) {
        console.error('Failed to initialize game:', error);
        if (loadingStatus) {
            loadingStatus.textContent = `Error: ${error.message}`;
            loadingStatus.style.color = '#aa2222';
        }
    }
}

// ============================================================
// Lighting Rig
// ============================================================

function setupLightingRig() {
    const LIGHT = CONSTANTS.LIGHTING;

    // ---- Key Light (Directional) ----
    const keyLightConfig = LIGHT.keyLight;
    const keyLight = new THREE.DirectionalLight(keyLightConfig.color, keyLightConfig.intensity);

    // Position from elevation and azimuth angles
    const elevRad = degToRad(keyLightConfig.elevation);
    const azimRad = degToRad(keyLightConfig.azimuth);
    const lightDist = 40;

    const mapCenterX = gridManager.gridWidth * CONSTANTS.TILE_SIZE * 0.5;
    const mapCenterZ = gridManager.gridHeight * CONSTANTS.TILE_SIZE * 0.5;

    keyLight.position.set(
        mapCenterX + Math.cos(azimRad) * Math.cos(elevRad) * lightDist,
        Math.sin(elevRad) * lightDist,
        mapCenterZ + Math.sin(azimRad) * Math.cos(elevRad) * lightDist
    );
    keyLight.target.position.set(mapCenterX, 0, mapCenterZ);
    scene.add(keyLight.target);

    // Shadow configuration
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = keyLightConfig.shadowMapSize;
    keyLight.shadow.mapSize.height = keyLightConfig.shadowMapSize;
    keyLight.shadow.radius = keyLightConfig.shadowRadius;
    keyLight.shadow.bias = keyLightConfig.shadowBias;

    // Shadow camera frustum to cover the map
    const mapWidth = gridManager.gridWidth * CONSTANTS.TILE_SIZE;
    const mapHeight = gridManager.gridHeight * CONSTANTS.TILE_SIZE;
    const shadowPadding = 5;
    keyLight.shadow.camera.left = -(mapWidth / 2 + shadowPadding);
    keyLight.shadow.camera.right = mapWidth / 2 + shadowPadding;
    keyLight.shadow.camera.top = mapHeight / 2 + shadowPadding;
    keyLight.shadow.camera.bottom = -(mapHeight / 2 + shadowPadding);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 100;

    scene.add(keyLight);

    // ---- Rim Light (Directional, opposite to key) ----
    const rimLightConfig = LIGHT.rimLight;
    const rimLight = new THREE.DirectionalLight(rimLightConfig.color, rimLightConfig.intensity);

    // Position opposite to key light
    rimLight.position.set(
        mapCenterX - Math.cos(azimRad) * Math.cos(elevRad) * lightDist * 0.8,
        Math.sin(elevRad) * lightDist * 0.6,
        mapCenterZ - Math.sin(azimRad) * Math.cos(elevRad) * lightDist * 0.8
    );
    rimLight.target.position.set(mapCenterX, 0, mapCenterZ);
    scene.add(rimLight.target);
    rimLight.castShadow = false;

    scene.add(rimLight);

    // ---- Hemisphere Ambient Light ----
    const ambientConfig = LIGHT.ambient;
    const ambientLight = new THREE.HemisphereLight(
        ambientConfig.skyColor,
        ambientConfig.groundColor,
        ambientConfig.intensity
    );
    scene.add(ambientLight);
}

// ============================================================
// Post-Processing Pipeline
// ============================================================

function setupPostProcessing() {
    const camera = cameraController.getCamera();
    const size = renderer.getSize(new THREE.Vector2());

    composer = new EffectComposer(renderer);

    // 1. Render Pass
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // 2. SSAO Pass — DISABLED: causes black ground with orthographic camera
    // Can be re-enabled once scene visibility is dialed in
    // const ssaoConfig = CONSTANTS.POSTPROCESSING.ssao;
    // const ssaoPass = new SSAOPass(scene, camera, size.x, size.y);
    // ssaoPass.kernelRadius = ssaoConfig.kernelRadius;
    // ssaoPass.minDistance = ssaoConfig.minDistance;
    // ssaoPass.maxDistance = ssaoConfig.maxDistance;
    // ssaoPass.output = SSAOPass.OUTPUT.Default;
    // composer.addPass(ssaoPass);

    // 3. Bloom Pass
    const bloomConfig = CONSTANTS.POSTPROCESSING.bloom;
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        bloomConfig.strength,
        bloomConfig.radius,
        bloomConfig.threshold
    );
    composer.addPass(bloomPass);

    // 4. Color Grading Shader
    const colorGradingShader = createColorGradingShader();
    const colorGradingPass = new ShaderPass(colorGradingShader);
    composer.addPass(colorGradingPass);

    // 5. Vignette Shader
    const vignetteShader = createVignetteShader();
    const vignettePass = new ShaderPass(vignetteShader);
    composer.addPass(vignettePass);

    // 6. Film Grain Shader
    const filmGrainShader = createFilmGrainShader();
    const filmGrainPass = new ShaderPass(filmGrainShader);
    composer.addPass(filmGrainPass);

    // 7. Output Pass (final tone mapping & color space conversion)
    const outputPass = new OutputPass();
    composer.addPass(outputPass);
}

// ---- Custom Shaders ----

function createColorGradingShader() {
    const config = CONSTANTS.POSTPROCESSING.colorGrading;

    return {
        uniforms: {
            tDiffuse: { value: null },
            saturation: { value: config.saturation },
            contrast: { value: config.contrast },
            shadowTint: { value: new THREE.Vector3(...config.shadowTint) },
            highlightTint: { value: new THREE.Vector3(...config.highlightTint) },
            midtoneTint: { value: new THREE.Vector3(...config.midtoneTint) }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float saturation;
            uniform float contrast;
            uniform vec3 shadowTint;
            uniform vec3 highlightTint;
            uniform vec3 midtoneTint;
            varying vec2 vUv;

            void main() {
                vec4 texColor = texture2D(tDiffuse, vUv);
                vec3 color = texColor.rgb;

                // Luminance
                float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));

                // Desaturation
                color = mix(vec3(lum), color, saturation);

                // Shadow tint (affect dark areas)
                float shadowWeight = 1.0 - smoothstep(0.0, 0.3, lum);
                color = mix(color, color * shadowTint, shadowWeight * 0.5);

                // Midtone tint
                float midWeight = 1.0 - abs(lum - 0.5) * 2.0;
                midWeight = max(midWeight, 0.0);
                color = mix(color, color * midtoneTint, midWeight * 0.15);

                // Highlight tint (affect bright areas)
                float highlightWeight = smoothstep(0.6, 1.0, lum);
                color = mix(color, color * highlightTint, highlightWeight * 0.4);

                // Contrast
                color = (color - 0.5) * contrast + 0.5;

                // Clamp
                color = clamp(color, 0.0, 1.0);

                gl_FragColor = vec4(color, texColor.a);
            }
        `
    };
}

function createVignetteShader() {
    const config = CONSTANTS.POSTPROCESSING.vignette;

    return {
        uniforms: {
            tDiffuse: { value: null },
            darkness: { value: config.darkness },
            offset: { value: config.offset }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float darkness;
            uniform float offset;
            varying vec2 vUv;

            void main() {
                vec4 texColor = texture2D(tDiffuse, vUv);

                // Distance from center
                vec2 center = vUv - 0.5;
                float dist = length(center) * 1.414; // normalize diagonal to ~1.0

                // Vignette factor
                float vignette = smoothstep(offset, offset - darkness, dist);

                gl_FragColor = vec4(texColor.rgb * vignette, texColor.a);
            }
        `
    };
}

function createFilmGrainShader() {
    const config = CONSTANTS.POSTPROCESSING.filmGrain;

    return {
        uniforms: {
            tDiffuse: { value: null },
            time: { value: 0.0 },
            intensity: { value: config.intensity }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float time;
            uniform float intensity;
            varying vec2 vUv;

            // Simple hash-based noise
            float hash(vec2 p) {
                vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }

            void main() {
                vec4 texColor = texture2D(tDiffuse, vUv);

                // Animated noise
                float noise = hash(vUv * 1000.0 + time * 100.0);
                noise = (noise - 0.5) * intensity;

                vec3 color = texColor.rgb + vec3(noise);
                color = clamp(color, 0.0, 1.0);

                gl_FragColor = vec4(color, texColor.a);
            }
        `
    };
}

// ============================================================
// Atmospheric Particles
// ============================================================

// Particle state arrays
let ashParticles = null;
let dustParticles = null;
let fogWisps = [];

function createAtmosphere() {
    const ATM = CONSTANTS.ATMOSPHERE;
    const mapWidth = gridManager.gridWidth * CONSTANTS.TILE_SIZE;
    const mapHeight = gridManager.gridHeight * CONSTANTS.TILE_SIZE;

    // ---- Ash / Embers ----
    {
        const count = ATM.ashCount;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const baseColor = new THREE.Color(ATM.ashColor);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = Math.random() * mapWidth;
            positions[i * 3 + 1] = Math.random() * ATM.ashMaxHeight;
            positions[i * 3 + 2] = Math.random() * mapHeight;

            const opacity = ATM.ashOpacity.min + Math.random() * (ATM.ashOpacity.max - ATM.ashOpacity.min);
            colors[i * 3] = baseColor.r * opacity;
            colors[i * 3 + 1] = baseColor.g * opacity;
            colors[i * 3 + 2] = baseColor.b * opacity;

            sizes[i] = ATM.ashSize.min + Math.random() * (ATM.ashSize.max - ATM.ashSize.min);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 0.1,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true
        });

        ashParticles = new THREE.Points(geometry, material);
        ashParticles.userData = {
            speeds: new Float32Array(count),
            phases: new Float32Array(count),
            mapWidth,
            mapHeight
        };

        for (let i = 0; i < count; i++) {
            ashParticles.userData.speeds[i] = ATM.ashSpeed.min + Math.random() * (ATM.ashSpeed.max - ATM.ashSpeed.min);
            ashParticles.userData.phases[i] = Math.random() * Math.PI * 2;
        }

        scene.add(ashParticles);
    }

    // ---- Dust Motes ----
    {
        const count = ATM.dustCount;
        const positions = new Float32Array(count * 3);
        const baseColor = new THREE.Color(ATM.dustColor);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = Math.random() * mapWidth;
            positions[i * 3 + 1] = 0.5 + Math.random() * 4.0;
            positions[i * 3 + 2] = Math.random() * mapHeight;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            size: 0.04,
            color: baseColor,
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true
        });

        dustParticles = new THREE.Points(geometry, material);
        dustParticles.userData = {
            velocities: new Float32Array(count * 3),
            mapWidth,
            mapHeight
        };

        for (let i = 0; i < count; i++) {
            dustParticles.userData.velocities[i * 3] = (Math.random() - 0.5) * ATM.dustSpeed;
            dustParticles.userData.velocities[i * 3 + 1] = (Math.random() - 0.5) * ATM.dustSpeed * 0.5;
            dustParticles.userData.velocities[i * 3 + 2] = (Math.random() - 0.5) * ATM.dustSpeed;
        }

        scene.add(dustParticles);
    }

    // ---- Ground Fog Wisps ----
    {
        const count = ATM.fogWispCount;
        const fogColor = new THREE.Color(ATM.fogWispColor);

        for (let i = 0; i < count; i++) {
            const width = ATM.fogWispWidth * (0.8 + Math.random() * 0.4);
            const height = ATM.fogWispHeight * (0.8 + Math.random() * 0.4);

            const geometry = new THREE.PlaneGeometry(width, height);
            const material = new THREE.MeshBasicMaterial({
                color: fogColor,
                transparent: true,
                opacity: ATM.fogWispOpacity * (0.5 + Math.random() * 0.5),
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.NormalBlending
            });

            const wisp = new THREE.Mesh(geometry, material);

            // Random position on the ground
            wisp.position.x = Math.random() * mapWidth;
            wisp.position.y = 0.05 + Math.random() * 0.1;
            wisp.position.z = Math.random() * mapHeight;

            // Lay flat and randomly rotate
            wisp.rotation.x = -Math.PI / 2;
            wisp.rotation.z = Math.random() * Math.PI * 2;

            wisp.userData.speed = ATM.fogWispSpeed * (0.5 + Math.random() * 0.5);
            wisp.userData.direction = Math.random() * Math.PI * 2;
            wisp.userData.mapWidth = mapWidth;
            wisp.userData.mapHeight = mapHeight;

            scene.add(wisp);
            fogWisps.push(wisp);
        }
    }
}

function updateAtmosphere(deltaTime) {
    const ATM = CONSTANTS.ATMOSPHERE;
    const time = clock.elapsedTime;

    // ---- Ash ----
    if (ashParticles) {
        const positions = ashParticles.geometry.getAttribute('position');
        const data = ashParticles.userData;

        for (let i = 0; i < positions.count; i++) {
            let x = positions.getX(i);
            let y = positions.getY(i);
            let z = positions.getZ(i);

            // Drift upward
            y += data.speeds[i] * deltaTime;

            // Horizontal sway (sinusoidal)
            x += Math.sin(time * ATM.ashSwayFrequency + data.phases[i]) * ATM.ashSwayAmplitude * deltaTime;

            // Wrap around
            if (y > ATM.ashMaxHeight) {
                y = 0;
                x = Math.random() * data.mapWidth;
                z = Math.random() * data.mapHeight;
            }
            if (x < 0) x += data.mapWidth;
            if (x > data.mapWidth) x -= data.mapWidth;
            if (z < 0) z += data.mapHeight;
            if (z > data.mapHeight) z -= data.mapHeight;

            positions.setXYZ(i, x, y, z);
        }

        positions.needsUpdate = true;
    }

    // ---- Dust ----
    if (dustParticles) {
        const positions = dustParticles.geometry.getAttribute('position');
        const vel = dustParticles.userData.velocities;
        const data = dustParticles.userData;

        for (let i = 0; i < positions.count; i++) {
            let x = positions.getX(i) + vel[i * 3] * deltaTime;
            let y = positions.getY(i) + vel[i * 3 + 1] * deltaTime;
            let z = positions.getZ(i) + vel[i * 3 + 2] * deltaTime;

            // Wrap
            if (x < 0) x += data.mapWidth;
            if (x > data.mapWidth) x -= data.mapWidth;
            if (y < 0.2) y = 0.2 + Math.random() * 4.0;
            if (y > 5.0) y = 0.5;
            if (z < 0) z += data.mapHeight;
            if (z > data.mapHeight) z -= data.mapHeight;

            positions.setXYZ(i, x, y, z);
        }

        positions.needsUpdate = true;
    }

    // ---- Fog Wisps ----
    for (const wisp of fogWisps) {
        const data = wisp.userData;
        wisp.position.x += Math.cos(data.direction) * data.speed * deltaTime;
        wisp.position.z += Math.sin(data.direction) * data.speed * deltaTime;

        // Wrap around map
        if (wisp.position.x < -2) wisp.position.x += data.mapWidth + 4;
        if (wisp.position.x > data.mapWidth + 2) wisp.position.x -= data.mapWidth + 4;
        if (wisp.position.z < -2) wisp.position.z += data.mapHeight + 4;
        if (wisp.position.z > data.mapHeight + 2) wisp.position.z -= data.mapHeight + 4;

        // Subtle opacity oscillation
        wisp.material.opacity = CONSTANTS.ATMOSPHERE.fogWispOpacity * (0.7 + 0.3 * Math.sin(time * 0.5 + wisp.id));
    }
}

// ============================================================
// Input Callbacks (Phase 1: basic tile selection)
// ============================================================

function setupInputCallbacks() {
    // Tile click — route to appropriate handler based on game phase
    inputManager.onTileClick((col, row) => {
        console.log('[Main] onTileClick callback fired — col:', col, 'row:', row, 'phase:', gameState.phase);
        if (gameState.phase === CONSTANTS.GAME_PHASES.LOADING) return;

        const tile = gridManager.getTile(col, row);
        if (!tile) {
            console.log('[Main] No tile data at', col, row);
            return;
        }

        // If there's a unit on this tile, emit unit click event
        if (tile.occupant) {
            console.log('[Main] Tile has occupant:', tile.occupant.id, '— emitting unit:clicked');
            EventBus.emit('unit:clicked', tile.occupant);
            return;
        }

        // Emit tile click event — turn manager listens and routes based on phase
        console.log('[Main] Emitting tile:clicked for', col, row);
        EventBus.emit('tile:clicked', { col, row });
    });

    // Unit click via raycasting — emit unit click event
    inputManager.onUnitClick((unit) => {
        console.log('[Main] onUnitClick callback fired — unit:', unit?.id, 'alive:', unit?.alive, 'phase:', gameState.phase);
        if (gameState.phase === CONSTANTS.GAME_PHASES.LOADING) return;
        if (!unit || !unit.alive) return;
        console.log('[Main] Emitting unit:clicked for', unit.id);
        EventBus.emit('unit:clicked', unit);
    });

    // Right-click — clear selection / cancel
    inputManager.onTileRightClick(() => {
        console.log('[Main] Right-click — clearing selection');
        gridManager.clearHighlights();
        EventBus.emit('selection:cleared');
    });

    // Escape — clear selection / cancel
    inputManager.onEscapePress(() => {
        console.log('[Main] Escape — clearing selection');
        gridManager.clearHighlights();
        EventBus.emit('selection:cleared');
    });

    // Settings button
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const settingsClose = document.getElementById('settings-close');

    if (settingsBtn && settingsModal) {
        settingsBtn.addEventListener('click', () => {
            settingsModal.classList.toggle('visible');
        });
    }
    if (settingsClose && settingsModal) {
        settingsClose.addEventListener('click', () => {
            settingsModal.classList.remove('visible');
        });
    }
}

// ============================================================
// UI Helpers
// ============================================================

function updateLoadingProgress(status, progress) {
    if (loadingBarFill) {
        loadingBarFill.style.width = `${Math.floor(progress * 100)}%`;
    }
    if (loadingStatus) {
        loadingStatus.textContent = status;
    }
}

function updatePhaseIndicator() {
    const el = document.getElementById('phase-indicator');
    if (!el) return;

    const phaseNames = {
        [CONSTANTS.GAME_PHASES.LOADING]: 'Loading',
        [CONSTANTS.GAME_PHASES.PLAYER_SELECT_UNIT]: 'Select Unit',
        [CONSTANTS.GAME_PHASES.PLAYER_MOVEMENT]: 'Movement',
        [CONSTANTS.GAME_PHASES.PLAYER_ACTION]: 'Action',
        [CONSTANTS.GAME_PHASES.PLAYER_TARGET_SELECT]: 'Select Target',
        [CONSTANTS.GAME_PHASES.COMBAT_ANIMATION]: 'Combat',
        [CONSTANTS.GAME_PHASES.AI_THINKING]: 'Enemy Thinking',
        [CONSTANTS.GAME_PHASES.AI_ACTING]: 'Enemy Acting',
        [CONSTANTS.GAME_PHASES.TURN_TRANSITION]: 'Turn Transition',
        [CONSTANTS.GAME_PHASES.GAME_OVER]: 'Game Over'
    };

    el.textContent = phaseNames[gameState.phase] || 'Unknown';
}

// ============================================================
// Window Resize
// ============================================================

function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    renderer.setSize(width, height);
    cameraController.resize(width, height);
}

// ============================================================
// Game Loop
// ============================================================

function gameLoop() {
    const deltaTime = Math.min(clock.getDelta(), 0.1); // Cap at 100ms to prevent spiraling

    // Update systems
    inputManager.update();
    cameraController.update(deltaTime);
    if (unitManager) unitManager.update(deltaTime);
    if (vfxManager) vfxManager.update(deltaTime);
    if (uiManager) uiManager.update(deltaTime);
    if (turnManager) turnManager.update(deltaTime);
    updateAtmosphere(deltaTime);

    // Render
    renderer.renderAsync(scene, cameraController.getCamera());
}

// ============================================================
// Export for other modules to access game state and systems
// ============================================================

export {
    gameState,
    scene,
    renderer,
    cameraController,
    gridManager,
    inputManager,
    proceduralGenerator,
    mapLoader,
    unitManager,
    uiManager,
    combatSystem,
    vfxManager,
    turnManager,
    aiController
};

// ============================================================
// Start
// ============================================================

init();
