// Slimline Tactical — Map Loader
// Loads map JSON, creates ground plane with PBR textures, places cover objects, environment lights

import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { CONSTANTS } from '../shared/constants.js';
import { tileToWorld, parseHexColor } from '../shared/utils.js';

export class MapLoader {
    /**
     * @param {THREE.Scene} scene
     * @param {import('./grid.js').GridManager} gridManager
     * @param {import('./procedural.js').ProceduralGenerator} proceduralGenerator
     */
    constructor(scene, gridManager, proceduralGenerator) {
        this.scene = scene;
        this.gridManager = gridManager;
        this.proceduralGenerator = proceduralGenerator;

        this.textureLoader = new THREE.TextureLoader();
        this.exrLoader = new EXRLoader();

        // Cache for loaded textures
        this.textureCache = {};
    }

    /**
     * Load a complete map from a JSON file.
     * @param {string} jsonPath — path to map JSON file
     * @param {Function} onProgress — optional progress callback (stage, progress)
     * @returns {Promise<{ mapData, groundMesh, coverObjects, envLights }>}
     */
    async loadMap(jsonPath, onProgress) {
        const reportProgress = onProgress || (() => {});

        // 1. Fetch and parse map JSON
        reportProgress('Loading map data...', 0.0);
        const response = await fetch(jsonPath);
        if (!response.ok) {
            throw new Error(`Failed to load map: ${jsonPath} (${response.status})`);
        }
        const mapData = await response.json();

        // 2. Create ground plane with PBR textures
        reportProgress('Loading textures...', 0.15);
        const groundMesh = await this.createGroundPlane(mapData);

        // 3. Load and place cover objects
        reportProgress('Placing cover objects...', 0.5);
        const coverObjects = await this.loadCoverObjects(mapData);

        // 4. Create environment lights from map data
        reportProgress('Setting up lights...', 0.75);
        const envLights = this.createEnvironmentLights(mapData);

        // 5. Set spawn zones on grid tiles
        reportProgress('Configuring spawn zones...', 0.9);
        this.setSpawnZones(mapData);

        reportProgress('Map loaded.', 1.0);

        return { mapData, groundMesh, coverObjects, envLights };
    }

    /**
     * Create the textured ground plane from map data.
     * @param {object} mapData
     * @returns {Promise<THREE.Mesh>}
     */
    async createGroundPlane(mapData) {
        const gridWidth = mapData.gridSize[0];
        const gridHeight = mapData.gridSize[1];
        const tileSize = mapData.tileSize || CONSTANTS.TILE_SIZE;
        const worldWidth = gridWidth * tileSize;
        const worldHeight = gridHeight * tileSize;

        // Simple plane — no displacement subdivisions, no PBR textures
        const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight);
        geometry.rotateX(-Math.PI / 2);

        // Use ONLY the diffuse texture (JPG) — skip EXR normal/roughness and displacement entirely
        let diffuseMap = null;
        const texConfig = CONSTANTS.TEXTURES[mapData.groundTexture];
        if (texConfig && texConfig.diffuse) {
            try {
                diffuseMap = await new Promise((resolve, reject) => {
                    this.textureLoader.load(
                        texConfig.path + texConfig.diffuse,
                        (tex) => {
                            tex.wrapS = THREE.RepeatWrapping;
                            tex.wrapT = THREE.RepeatWrapping;
                            tex.repeat.set(gridWidth * 0.5, gridHeight * 0.5);
                            tex.colorSpace = THREE.SRGBColorSpace;
                            resolve(tex);
                        },
                        undefined,
                        () => resolve(null)
                    );
                });
            } catch (e) {
                console.warn('Failed to load ground diffuse texture, using flat color');
            }
        }

        const material = new THREE.MeshStandardMaterial({
            color: 0x9B8365,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        });

        if (diffuseMap) {
            material.map = diffuseMap;
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(worldWidth * 0.5, 0, worldHeight * 0.5);
        mesh.receiveShadow = true;

        this.scene.add(mesh);

        // Debug: confirm ground mesh was created and added
        console.log('[MapLoader] Ground mesh created:', {
            worldSize: `${worldWidth} x ${worldHeight}`,
            position: `(${mesh.position.x}, ${mesh.position.y}, ${mesh.position.z})`,
            hasDiffuseMap: !!diffuseMap,
            materialColor: `#${material.color.getHexString()}`,
            vertexCount: geometry.attributes.position.count,
            inScene: this.scene.children.includes(mesh)
        });

        // Still load rock textures for cover objects in background (non-blocking)
        this._ensureRockTextures().catch(() => {});

        return mesh;
    }

    /**
     * Load PBR texture set for a given texture key.
     * @param {string} textureKey — key from CONSTANTS.TEXTURES
     * @param {number} tilesX — grid columns (for repeat)
     * @param {number} tilesZ — grid rows (for repeat)
     * @returns {Promise<{ map, normalMap, roughnessMap, displacementMap }>}
     */
    async loadPBRTextures(textureKey, tilesX, tilesZ) {
        const texConfig = CONSTANTS.TEXTURES[textureKey];
        if (!texConfig) {
            console.warn(`MapLoader: Unknown texture key "${textureKey}"`);
            return {};
        }

        const basePath = texConfig.path;
        const result = {};

        // Calculate repeat to tile the texture across the grid
        // Each tile should show roughly 1 texture repeat, adjusted for visual density
        const repeatX = tilesX * 0.5;
        const repeatZ = tilesZ * 0.5;

        // Helper to configure texture wrapping and repeat
        const configureTexture = (tex) => {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(repeatX, repeatZ);
            return tex;
        };

        // Load textures in parallel
        const loadPromises = [];

        // Diffuse map (always JPG or PNG)
        if (texConfig.diffuse) {
            loadPromises.push(
                this._loadTexture(basePath + texConfig.diffuse)
                    .then(tex => {
                        if (tex) {
                            tex.colorSpace = THREE.SRGBColorSpace;
                            result.map = configureTexture(tex);
                        }
                    })
            );
        }

        // Normal map (may be EXR or JPG)
        if (texConfig.normal) {
            const isEXR = texConfig.normal.endsWith('.exr');
            loadPromises.push(
                this._loadTexture(basePath + texConfig.normal, isEXR)
                    .then(tex => {
                        if (tex) result.normalMap = configureTexture(tex);
                    })
            );
        }

        // Roughness map (may be EXR or JPG)
        if (texConfig.roughness) {
            const isEXR = texConfig.roughness.endsWith('.exr');
            loadPromises.push(
                this._loadTexture(basePath + texConfig.roughness, isEXR)
                    .then(tex => {
                        if (tex) result.roughnessMap = configureTexture(tex);
                    })
            );
        }

        // Displacement map (always PNG)
        if (texConfig.displacement) {
            loadPromises.push(
                this._loadTexture(basePath + texConfig.displacement)
                    .then(tex => {
                        if (tex) result.displacementMap = configureTexture(tex);
                    })
            );
        }

        await Promise.all(loadPromises);

        return result;
    }

    /**
     * Load a single texture file (regular or EXR).
     * @param {string} path
     * @param {boolean} isEXR
     * @returns {Promise<THREE.Texture|null>}
     */
    _loadTexture(path, isEXR = false) {
        return new Promise(resolve => {
            const loader = isEXR ? this.exrLoader : this.textureLoader;

            loader.load(
                path,
                (texture) => {
                    resolve(texture);
                },
                undefined,
                (err) => {
                    console.warn(`MapLoader: Failed to load texture "${path}":`, err);
                    resolve(null);
                }
            );
        });
    }

    /**
     * Load and place all cover objects from map data.
     * @param {object} mapData
     * @returns {Promise<Array<THREE.Object3D>>}
     */
    async loadCoverObjects(mapData) {
        if (!mapData.objects || mapData.objects.length === 0) return [];

        // Load rock textures for procedural generator if not already loaded
        await this._ensureRockTextures();

        const coverObjects = [];

        for (const objData of mapData.objects) {
            const col = objData.tile[0];
            const row = objData.tile[1];
            const worldPos = tileToWorld(col, row, mapData.tileSize || CONSTANTS.TILE_SIZE);

            // Generate procedural mesh
            const mesh = this.proceduralGenerator.createObjectFromType(
                objData.type,
                objData.seed || 0,
                objData.scale || 1.0,
                objData.rotation || 0,
                objData.cover || 'half'
            );

            // Position at tile center
            mesh.position.x = worldPos.x;
            mesh.position.z = worldPos.z;
            // Y position is set by the generator based on object type

            this.scene.add(mesh);
            coverObjects.push(mesh);

            // Update grid tile data
            this.gridManager.setObject(col, row, objData.type, mesh, objData.cover || 'half');
        }

        return coverObjects;
    }

    /**
     * Ensure rock textures are loaded for the procedural generator.
     */
    async _ensureRockTextures() {
        const rockTextures = {};

        // Load rock_2 textures
        if (CONSTANTS.TEXTURES.rock_2 && !this.textureCache.rock_2) {
            const tex = await this.loadPBRTextures('rock_2', 1, 1);
            this.textureCache.rock_2 = tex;
            rockTextures.rock_2 = tex;
        } else if (this.textureCache.rock_2) {
            rockTextures.rock_2 = this.textureCache.rock_2;
        }

        // Load rock_face textures
        if (CONSTANTS.TEXTURES.rock_face && !this.textureCache.rock_face) {
            const tex = await this.loadPBRTextures('rock_face', 1, 1);
            this.textureCache.rock_face = tex;
            rockTextures.rock_face = tex;
        } else if (this.textureCache.rock_face) {
            rockTextures.rock_face = this.textureCache.rock_face;
        }

        // Update procedural generator's texture cache
        if (rockTextures.rock_2 || rockTextures.rock_face) {
            this.proceduralGenerator.textureCache = {
                ...this.proceduralGenerator.textureCache,
                ...rockTextures
            };
            this.proceduralGenerator._createMaterials();
        }
    }

    /**
     * Create environment lights from map data.
     * @param {object} mapData
     * @returns {Array<THREE.PointLight>}
     */
    createEnvironmentLights(mapData) {
        if (!mapData.lights || mapData.lights.length === 0) return [];

        const lights = [];
        const tileSize = mapData.tileSize || CONSTANTS.TILE_SIZE;

        for (const lightData of mapData.lights) {
            if (lightData.type === 'point') {
                const col = lightData.tile[0];
                const row = lightData.tile[1];
                const worldPos = tileToWorld(col, row, tileSize);

                const color = parseHexColor(lightData.color);
                const intensity = lightData.intensity || 1.0;
                const distance = lightData.radius || 5.0;
                const height = lightData.height || 0.5;

                const light = new THREE.PointLight(color, intensity, distance, 2);
                light.position.set(worldPos.x, height, worldPos.z);

                // Point lights don't cast shadows by default (too expensive for many lights)
                // But we can enable it for a few key lights if needed
                light.castShadow = false;

                this.scene.add(light);
                lights.push(light);

                // Optional: add a small emissive sprite at the light position for visibility
                const sprite = this._createLightSprite(color, intensity * 0.3);
                sprite.position.copy(light.position);
                this.scene.add(sprite);
            }
        }

        return lights;
    }

    /**
     * Create a small emissive sprite to visualize a point light source.
     * @param {number} color
     * @param {number} size
     * @returns {THREE.Sprite}
     */
    _createLightSprite(color, size) {
        const spriteMaterial = new THREE.SpriteMaterial({
            color: color,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(size, size, 1);

        return sprite;
    }

    /**
     * Set spawn zones on grid tiles from map data.
     * @param {object} mapData
     */
    setSpawnZones(mapData) {
        if (!mapData.spawnZones) return;

        for (const [factionId, tiles] of Object.entries(mapData.spawnZones)) {
            for (const tile of tiles) {
                this.gridManager.setSpawnZone(tile[0], tile[1], factionId);
            }
        }
    }

    /**
     * Get the full texture cache (for passing to other systems).
     * @returns {object}
     */
    getTextureCache() {
        return this.textureCache;
    }
}
