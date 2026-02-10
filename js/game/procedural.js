// Slimline Tactical — Procedural Generator
// Generates cover objects: boulders, rock clusters, columns, ruined walls, barricades, craters
// All geometry is procedural with seeded RNG and PBR materials

import * as THREE from 'three';
import { CONSTANTS } from '../shared/constants.js';
import { seededRandom } from '../shared/utils.js';

export class ProceduralGenerator {
    /**
     * @param {object} textureCache — { rock_2: { map, normalMap, roughnessMap, ... }, rock_face: { ... }, ... }
     */
    constructor(textureCache) {
        this.textureCache = textureCache || {};

        // Pre-create reusable materials
        this.rockMaterial = null;
        this.rockFaceMaterial = null;
        this.charredMaterial = null;

        this._createMaterials();
    }

    _createMaterials() {
        // Rock material (for boulders, clusters, barricades)
        if (this.textureCache.rock_2) {
            const tex = this.textureCache.rock_2;
            this.rockMaterial = new THREE.MeshStandardMaterial({
                map: tex.map || null,
                normalMap: tex.normalMap || null,
                roughnessMap: tex.roughnessMap || null,
                displacementMap: tex.displacementMap || null,
                displacementScale: 0.05,
                roughness: 0.85,
                metalness: 0.05
            });
        } else {
            // Fallback: dark grey rock material without textures
            this.rockMaterial = new THREE.MeshStandardMaterial({
                color: 0x554433,
                roughness: 0.9,
                metalness: 0.05
            });
        }

        // Rock face material (for columns, walls)
        if (this.textureCache.rock_face) {
            const tex = this.textureCache.rock_face;
            this.rockFaceMaterial = new THREE.MeshStandardMaterial({
                map: tex.map || null,
                normalMap: tex.normalMap || null,
                roughnessMap: tex.roughnessMap || null,
                displacementMap: tex.displacementMap || null,
                displacementScale: 0.03,
                roughness: 0.8,
                metalness: 0.1
            });
        } else {
            this.rockFaceMaterial = new THREE.MeshStandardMaterial({
                color: 0x665544,
                roughness: 0.85,
                metalness: 0.1
            });
        }

        // Charred material (for craters)
        this.charredMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1008,
            roughness: 0.95,
            metalness: 0.0
        });
    }

    /**
     * Create a cover object mesh from type specification.
     * @param {string} type — 'boulder' | 'rock_cluster' | 'column' | 'ruined_wall' | 'barricade' | 'crater'
     * @param {number} seed — deterministic RNG seed
     * @param {number} scale — size multiplier
     * @param {number} rotation — degrees around Y axis
     * @param {string} coverType — 'none' | 'half' | 'full'
     * @returns {THREE.Object3D}
     */
    createObjectFromType(type, seed, scale = 1.0, rotation = 0, coverType = 'half') {
        let object;

        switch (type) {
            case 'boulder':
                object = this.generateBoulder(seed, scale, coverType);
                break;
            case 'rock_cluster':
                object = this.generateRockCluster(seed, scale);
                break;
            case 'column':
                object = this.generateColumn(seed, scale);
                break;
            case 'ruined_wall':
                object = this.generateRuinedWall(seed, rotation);
                break;
            case 'barricade':
                object = this.generateBarricade(seed, rotation);
                break;
            case 'crater':
                object = this.generateCrater(seed, scale);
                break;
            default:
                console.warn(`ProceduralGenerator: Unknown object type "${type}"`);
                object = this._generateFallbackBox(seed, scale);
                break;
        }

        // Apply rotation if specified (for non-wall/barricade types that don't handle it internally)
        if (type !== 'ruined_wall' && type !== 'barricade' && rotation !== 0) {
            object.rotation.y = THREE.MathUtils.degToRad(rotation);
        }

        // Store metadata
        object.userData.objectType = type;
        object.userData.coverType = coverType;
        object.userData.seed = seed;

        return object;
    }

    // ============================================================
    // Boulder
    // ============================================================

    /**
     * Generate a procedural boulder from a displaced icosahedron.
     * @param {number} seed
     * @param {number} scale
     * @param {string} coverType
     * @returns {THREE.Mesh}
     */
    generateBoulder(seed, scale, coverType) {
        const rng = seededRandom(seed);
        const baseRadius = 0.5 * scale;
        const detail = 2;

        const geometry = new THREE.IcosahedronGeometry(baseRadius, detail);
        const posAttr = geometry.getAttribute('position');

        // Displace vertices with seeded noise for organic shape
        const normal = new THREE.Vector3();
        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const y = posAttr.getY(i);
            const z = posAttr.getZ(i);

            normal.set(x, y, z).normalize();
            const displacement = (rng() - 0.5) * 0.4 * baseRadius;

            posAttr.setXYZ(
                i,
                x + normal.x * displacement,
                y + normal.y * displacement,
                z + normal.z * displacement
            );
        }

        // Non-uniform scale for natural look
        const scaleX = scale * (0.8 + rng() * 0.4);
        const scaleY = scale * (coverType === 'full' ? (0.8 + rng() * 0.4) : (0.4 + rng() * 0.3));
        const scaleZ = scale * (0.8 + rng() * 0.4);

        geometry.computeVertexNormals();

        const material = this.rockMaterial.clone();
        const mesh = new THREE.Mesh(geometry, material);

        mesh.scale.set(scaleX, scaleY, scaleZ);

        // Position base at ground level
        mesh.position.y = scaleY * 0.35;

        mesh.castShadow = true;
        mesh.receiveShadow = true;

        return mesh;
    }

    // ============================================================
    // Rock Cluster
    // ============================================================

    /**
     * Generate a cluster of 3-5 small displaced spheres.
     * @param {number} seed
     * @param {number} scale
     * @returns {THREE.Group}
     */
    generateRockCluster(seed, scale) {
        const rng = seededRandom(seed);
        const group = new THREE.Group();
        const count = 3 + Math.floor(rng() * 3); // 3-5 rocks

        for (let i = 0; i < count; i++) {
            const radius = (0.15 + rng() * 0.2) * scale;
            const geometry = new THREE.SphereGeometry(radius, 6, 5);
            const posAttr = geometry.getAttribute('position');

            // Displace vertices
            const normal = new THREE.Vector3();
            for (let j = 0; j < posAttr.count; j++) {
                const x = posAttr.getX(j);
                const y = posAttr.getY(j);
                const z = posAttr.getZ(j);

                normal.set(x, y, z).normalize();
                const disp = (rng() - 0.5) * 0.3 * radius;

                posAttr.setXYZ(
                    j,
                    x + normal.x * disp,
                    y + normal.y * disp,
                    z + normal.z * disp
                );
            }

            geometry.computeVertexNormals();

            const material = this.rockMaterial.clone();
            const rock = new THREE.Mesh(geometry, material);

            // Position within tile area
            rock.position.x = (rng() - 0.5) * 0.7 * scale;
            rock.position.z = (rng() - 0.5) * 0.7 * scale;
            rock.position.y = radius * 0.4;

            // Slight random rotation
            rock.rotation.x = rng() * Math.PI * 0.3;
            rock.rotation.y = rng() * Math.PI * 2;
            rock.rotation.z = rng() * Math.PI * 0.3;

            rock.castShadow = true;
            rock.receiveShadow = true;

            group.add(rock);
        }

        group.scale.set(scale, scale, scale);
        return group;
    }

    // ============================================================
    // Column
    // ============================================================

    /**
     * Generate a procedural column (cylinder with optional broken top).
     * @param {number} seed
     * @param {number} scale
     * @returns {THREE.Mesh}
     */
    generateColumn(seed, scale) {
        const rng = seededRandom(seed);
        const radiusBottom = 0.35 * scale;
        const radiusTop = 0.3 * scale;
        const height = 2.5 * scale;
        const segments = 8;
        const heightSegments = 6;

        const geometry = new THREE.CylinderGeometry(
            radiusTop, radiusBottom, height, segments, heightSegments
        );
        const posAttr = geometry.getAttribute('position');

        // Add subtle surface noise
        const normal = new THREE.Vector3();
        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const y = posAttr.getY(i);
            const z = posAttr.getZ(i);

            // Only displace surface vertices (not top/bottom caps)
            const distFromCenter = Math.sqrt(x * x + z * z);
            if (distFromCenter > 0.01) {
                normal.set(x, 0, z).normalize();
                const disp = (rng() - 0.5) * 0.06 * scale;

                posAttr.setXYZ(
                    i,
                    x + normal.x * disp,
                    y,
                    z + normal.z * disp
                );
            }
        }

        // Broken top: if RNG > 0.5, displace top-row vertices downward
        if (rng() > 0.5) {
            for (let i = 0; i < posAttr.count; i++) {
                const y = posAttr.getY(i);
                if (y > height * 0.35) {
                    const topFactor = (y - height * 0.35) / (height * 0.15);
                    const breakDisp = -rng() * 0.5 * scale * topFactor;
                    posAttr.setY(i, y + breakDisp);
                }
            }
        }

        geometry.computeVertexNormals();

        const material = this.rockFaceMaterial.clone();
        const mesh = new THREE.Mesh(geometry, material);

        // Position base at ground level
        mesh.position.y = height * 0.5;

        mesh.castShadow = true;
        mesh.receiveShadow = true;

        return mesh;
    }

    // ============================================================
    // Ruined Wall
    // ============================================================

    /**
     * Generate a ruined wall segment with jagged top.
     * @param {number} seed
     * @param {number} rotation — degrees
     * @returns {THREE.Mesh}
     */
    generateRuinedWall(seed, rotation) {
        const rng = seededRandom(seed);
        const width = 1.8;
        const height = 2.0;
        const depth = 0.3;
        const wSegs = 8;
        const hSegs = 6;
        const dSegs = 1;

        const geometry = new THREE.BoxGeometry(width, height, depth, wSegs, hSegs, dSegs);
        const posAttr = geometry.getAttribute('position');

        // Displace vertices for weathered look
        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const y = posAttr.getY(i);
            const z = posAttr.getZ(i);

            // Top vertices: jagged broken edge
            if (y > height * 0.25) {
                const topFactor = (y - height * 0.25) / (height * 0.25);
                const breakDisp = -rng() * 0.6 * topFactor;
                posAttr.setY(i, y + breakDisp);
            }

            // General surface weathering
            const surfaceDisp = (rng() - 0.5) * 0.04;
            posAttr.setXYZ(
                i,
                x + surfaceDisp,
                posAttr.getY(i),
                z + surfaceDisp
            );
        }

        geometry.computeVertexNormals();

        const material = this.rockFaceMaterial.clone();
        const mesh = new THREE.Mesh(geometry, material);

        // Position base at ground level
        mesh.position.y = height * 0.5;

        // Apply rotation
        mesh.rotation.y = THREE.MathUtils.degToRad(rotation);

        mesh.castShadow = true;
        mesh.receiveShadow = true;

        return mesh;
    }

    // ============================================================
    // Barricade
    // ============================================================

    /**
     * Generate a barricade (2-3 stacked deformed boxes).
     * @param {number} seed
     * @param {number} rotation — degrees
     * @returns {THREE.Group}
     */
    generateBarricade(seed, rotation) {
        const rng = seededRandom(seed);
        const group = new THREE.Group();
        const count = 2 + Math.floor(rng() * 2); // 2-3 pieces

        let yOffset = 0;

        for (let i = 0; i < count; i++) {
            const w = 1.2 + rng() * 0.6;
            const h = 0.25 + rng() * 0.2;
            const d = 0.3 + rng() * 0.2;

            const geometry = new THREE.BoxGeometry(w, h, d, 4, 2, 1);
            const posAttr = geometry.getAttribute('position');

            // Slight vertex displacement for rough look
            for (let j = 0; j < posAttr.count; j++) {
                const x = posAttr.getX(j);
                const y = posAttr.getY(j);
                const z = posAttr.getZ(j);

                posAttr.setXYZ(
                    j,
                    x + (rng() - 0.5) * 0.05,
                    y + (rng() - 0.5) * 0.03,
                    z + (rng() - 0.5) * 0.03
                );
            }

            geometry.computeVertexNormals();

            const material = this.rockMaterial.clone();
            const piece = new THREE.Mesh(geometry, material);

            piece.position.y = yOffset + h * 0.5;
            piece.position.x = (rng() - 0.5) * 0.1;
            piece.position.z = (rng() - 0.5) * 0.05;
            piece.rotation.y = (rng() - 0.5) * 0.1;

            piece.castShadow = true;
            piece.receiveShadow = true;

            group.add(piece);
            yOffset += h;
        }

        // Apply rotation
        group.rotation.y = THREE.MathUtils.degToRad(rotation);

        return group;
    }

    // ============================================================
    // Crater
    // ============================================================

    /**
     * Generate a crater (inverted hemisphere depression in the ground).
     * @param {number} seed
     * @param {number} scale
     * @returns {THREE.Mesh}
     */
    generateCrater(seed, scale) {
        const rng = seededRandom(seed);
        const radius = 0.8 * scale;
        const widthSegments = 12;
        const heightSegments = 8;

        // Create hemisphere
        const geometry = new THREE.SphereGeometry(
            radius, widthSegments, heightSegments,
            0, Math.PI * 2,
            0, Math.PI * 0.5
        );
        const posAttr = geometry.getAttribute('position');

        // Invert (flip Y to create depression) and add noise
        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const y = posAttr.getY(i);
            const z = posAttr.getZ(i);

            // Negate Y to create depression
            const newY = -y;

            // Add subtle edge variation
            const edgeFactor = Math.sqrt(x * x + z * z) / radius;
            const edgeNoise = (rng() - 0.5) * 0.1 * scale * edgeFactor;

            posAttr.setXYZ(
                i,
                x + (rng() - 0.5) * 0.05 * scale,
                newY + edgeNoise,
                z + (rng() - 0.5) * 0.05 * scale
            );
        }

        geometry.computeVertexNormals();

        // Flip face winding since we inverted Y
        const indexAttr = geometry.getIndex();
        if (indexAttr) {
            const indices = indexAttr.array;
            for (let i = 0; i < indices.length; i += 3) {
                const tmp = indices[i];
                indices[i] = indices[i + 2];
                indices[i + 2] = tmp;
            }
            indexAttr.needsUpdate = true;
        }

        geometry.computeVertexNormals();

        const material = this.charredMaterial.clone();
        const mesh = new THREE.Mesh(geometry, material);

        // Slightly sunken into the ground
        mesh.position.y = -0.05;

        mesh.receiveShadow = true;
        mesh.castShadow = false;

        return mesh;
    }

    // ============================================================
    // Fallback
    // ============================================================

    _generateFallbackBox(seed, scale) {
        const geometry = new THREE.BoxGeometry(0.8 * scale, 0.8 * scale, 0.8 * scale);
        const material = new THREE.MeshStandardMaterial({ color: 0xff00ff, roughness: 0.9 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 0.4 * scale;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    // ============================================================
    // Cleanup
    // ============================================================

    dispose() {
        if (this.rockMaterial) this.rockMaterial.dispose();
        if (this.rockFaceMaterial) this.rockFaceMaterial.dispose();
        if (this.charredMaterial) this.charredMaterial.dispose();
    }
}
