// Slimline Tactical — VFX Manager
// Muzzle flash, tracer, impact particles, melee trail, death effect, overwatch flash

import * as THREE from 'three';
import { CONSTANTS } from '../shared/constants.js';
import { lerp } from '../shared/utils.js';

const VFX = CONSTANTS.VFX;

export class VFXManager {
    /**
     * @param {THREE.Scene} scene
     */
    constructor(scene) {
        this.scene = scene;
        this.activeEffects = []; // { type, mesh/meshes, lifetime, age, updateFn, onComplete }

        // Pre-create reusable assets
        this._initReusableAssets();
    }

    _initReusableAssets() {
        // Muzzle flash sprite material
        this.muzzleFlashMaterial = new THREE.SpriteMaterial({
            color: VFX.muzzleFlashColor,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // Tracer material
        this.tracerMaterial = new THREE.MeshBasicMaterial({
            color: VFX.tracerColor,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        // Particle materials
        this.sparkMaterial = new THREE.SpriteMaterial({
            color: VFX.sparkColor,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.dustMaterial = new THREE.SpriteMaterial({
            color: VFX.dustColor,
            transparent: true,
            opacity: 0.6,
            blending: THREE.NormalBlending,
            depthWrite: false
        });

        this.bloodMaterial = new THREE.SpriteMaterial({
            color: VFX.bloodColor,
            transparent: true,
            opacity: 0.8,
            blending: THREE.NormalBlending,
            depthWrite: false
        });

        // Melee flash material
        this.meleeFlashMaterial = new THREE.SpriteMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
    }

    // ============================================================
    // Muzzle Flash
    // ============================================================

    /**
     * Play a muzzle flash at the attacker position.
     * @param {{ x: number, y: number, z: number }} position — attacker world pos
     * @param {{ x: number, y: number, z: number }} targetPos — for calculating direction
     */
    playMuzzleFlash(position, targetPos) {
        // Sprite
        const sprite = new THREE.Sprite(this.muzzleFlashMaterial.clone());
        sprite.position.set(position.x, 1.2, position.z);

        // Offset slightly toward target
        const dx = targetPos.x - position.x;
        const dz = targetPos.z - position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 0) {
            sprite.position.x += (dx / dist) * 0.5;
            sprite.position.z += (dz / dist) * 0.5;
        }

        sprite.scale.set(0.6, 0.6, 1);
        this.scene.add(sprite);

        // Point light flash
        const light = new THREE.PointLight(VFX.muzzleFlashColor, VFX.muzzleFlashIntensity, 5, 2);
        light.position.copy(sprite.position);
        this.scene.add(light);

        // Track effect
        this.activeEffects.push({
            type: 'muzzleFlash',
            objects: [sprite, light],
            lifetime: VFX.muzzleFlashDuration,
            age: 0,
            updateFn: (effect, dt) => {
                const t = effect.age / effect.lifetime;
                sprite.material.opacity = 1.0 - t;
                sprite.scale.setScalar(0.6 + t * 0.4);
                light.intensity = VFX.muzzleFlashIntensity * (1.0 - t);
            }
        });
    }

    // ============================================================
    // Tracer
    // ============================================================

    /**
     * Play a tracer projectile from start to end position.
     * Returns a promise that resolves when the tracer arrives.
     * @param {{ x: number, y: number, z: number }} startPos
     * @param {{ x: number, y: number, z: number }} endPos
     * @returns {Promise}
     */
    playTracer(startPos, endPos) {
        return new Promise(resolve => {
            const dx = endPos.x - startPos.x;
            const dz = endPos.z - startPos.z;
            const totalDist = Math.sqrt(dx * dx + dz * dz);
            const travelTime = totalDist / VFX.tracerSpeed;

            // Create tracer mesh (thin stretched plane)
            const tracerLength = 1.0;
            const geometry = new THREE.PlaneGeometry(VFX.tracerWidth, tracerLength);
            const material = this.tracerMaterial.clone();
            const tracer = new THREE.Mesh(geometry, material);

            // Position at start
            tracer.position.set(startPos.x, 1.2, startPos.z);

            // Rotate to face direction of travel
            const angle = Math.atan2(dx, dz);
            tracer.rotation.y = angle;
            tracer.rotation.x = -Math.PI / 2; // lay along travel direction

            // Actually rotate so the plane faces upward and stretches along travel
            // Use a better approach: orient the plane
            tracer.rotation.set(0, 0, 0);
            tracer.lookAt(endPos.x, 1.2, endPos.z);
            tracer.rotateX(Math.PI / 2);

            this.scene.add(tracer);

            // Small point light on tracer
            const tracerLight = new THREE.PointLight(VFX.tracerColor, 1.5, 3, 2);
            tracerLight.position.copy(tracer.position);
            this.scene.add(tracerLight);

            this.activeEffects.push({
                type: 'tracer',
                objects: [tracer, tracerLight],
                lifetime: travelTime,
                age: 0,
                updateFn: (effect, dt) => {
                    const t = clampValue(effect.age / effect.lifetime, 0, 1);

                    // Move along path
                    tracer.position.x = lerp(startPos.x, endPos.x, t);
                    tracer.position.z = lerp(startPos.z, endPos.z, t);
                    tracer.position.y = 1.2;

                    tracerLight.position.copy(tracer.position);

                    // Fade near end
                    if (t > 0.8) {
                        const fadeT = (t - 0.8) / 0.2;
                        material.opacity = 0.9 * (1.0 - fadeT);
                        tracerLight.intensity = 1.5 * (1.0 - fadeT);
                    }
                },
                onComplete: resolve
            });
        });
    }

    /**
     * Play a miss tracer (offset trajectory).
     * @param {{ x: number, y: number, z: number }} startPos
     * @param {{ x: number, y: number, z: number }} targetPos
     */
    playMissTracer(startPos, targetPos) {
        // Calculate offset end position (slightly past and beside target)
        const dx = targetPos.x - startPos.x;
        const dz = targetPos.z - startPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Perpendicular offset
        const offsetRange = VFX.missOffsetRange;
        const perpX = -dz / dist;
        const perpZ = dx / dist;
        const side = Math.random() > 0.5 ? 1 : -1;
        const offsetDist = (0.3 + Math.random() * 0.5) * offsetRange * side;

        const missEnd = {
            x: targetPos.x + (dx / dist) * 1.5 + perpX * offsetDist,
            y: 0,
            z: targetPos.z + (dz / dist) * 1.5 + perpZ * offsetDist
        };

        // Fire tracer to offset position
        this.playTracer(startPos, missEnd).then(() => {
            // Ground impact particles
            this.playImpactParticles(missEnd, 'dust');
        });
    }

    // ============================================================
    // Impact Particles
    // ============================================================

    /**
     * Play impact particle burst at a position.
     * @param {{ x: number, y: number, z: number }} position
     * @param {string} type — 'spark' | 'dust' | 'blood'
     */
    playImpactParticles(position, type = 'spark') {
        const count = VFX.particleCount;
        const particles = [];

        let baseMaterial;
        switch (type) {
            case 'spark': baseMaterial = this.sparkMaterial; break;
            case 'dust': baseMaterial = this.dustMaterial; break;
            case 'blood': baseMaterial = this.bloodMaterial; break;
            default: baseMaterial = this.sparkMaterial;
        }

        for (let i = 0; i < count; i++) {
            const sprite = new THREE.Sprite(baseMaterial.clone());
            const size = 0.05 + Math.random() * 0.1;
            sprite.scale.set(size, size, 1);

            sprite.position.set(
                position.x + (Math.random() - 0.5) * 0.2,
                (position.y || 1.0) + Math.random() * 0.3,
                position.z + (Math.random() - 0.5) * 0.2
            );

            this.scene.add(sprite);

            // Random velocity
            const speed = VFX.particleSpeed * (0.5 + Math.random() * 0.5);
            const angle = Math.random() * Math.PI * 2;
            const upSpeed = 1.0 + Math.random() * 2.0;

            particles.push({
                sprite,
                vx: Math.cos(angle) * speed,
                vy: upSpeed,
                vz: Math.sin(angle) * speed
            });
        }

        this.activeEffects.push({
            type: 'impactParticles',
            objects: particles.map(p => p.sprite),
            lifetime: VFX.particleLifetime,
            age: 0,
            updateFn: (effect, dt) => {
                const t = effect.age / effect.lifetime;

                for (const p of particles) {
                    p.sprite.position.x += p.vx * dt;
                    p.sprite.position.y += p.vy * dt;
                    p.sprite.position.z += p.vz * dt;

                    // Gravity
                    p.vy += VFX.particleGravity * dt;

                    // Fade out
                    p.sprite.material.opacity = 1.0 - t;

                    // Shrink
                    const scale = p.sprite.scale.x * (1.0 - t * 0.3);
                    p.sprite.scale.set(scale, scale, 1);
                }
            }
        });
    }

    // ============================================================
    // Melee Trail
    // ============================================================

    /**
     * Play a melee attack trail/flash effect.
     * @param {{ x: number, y: number, z: number }} attackerPos
     * @param {{ x: number, y: number, z: number }} targetPos
     */
    playMeleeTrail(attackerPos, targetPos) {
        const midX = (attackerPos.x + targetPos.x) * 0.5;
        const midZ = (attackerPos.z + targetPos.z) * 0.5;
        const midPos = { x: midX, y: 1.0, z: midZ };

        // Bright flash at impact
        const flash = new THREE.Sprite(this.meleeFlashMaterial.clone());
        flash.position.set(targetPos.x, 1.0, targetPos.z);
        flash.scale.set(0.8, 0.8, 1);
        this.scene.add(flash);

        // Impact point light
        const impactLight = new THREE.PointLight(0xffffff, VFX.meleeFlashIntensity, 4, 2);
        impactLight.position.set(targetPos.x, 1.0, targetPos.z);
        this.scene.add(impactLight);

        // Arc trail — a series of sprites from attacker to target
        const trailSprites = [];
        const trailCount = 6;
        for (let i = 0; i < trailCount; i++) {
            const t = i / (trailCount - 1);
            const sprite = new THREE.Sprite(this.sparkMaterial.clone());
            const s = 0.1 + (1.0 - Math.abs(t - 0.5) * 2) * 0.15;
            sprite.scale.set(s, s, 1);

            // Arc path
            const arcHeight = 0.3 * Math.sin(t * Math.PI);
            sprite.position.set(
                lerp(attackerPos.x, targetPos.x, t),
                1.0 + arcHeight,
                lerp(attackerPos.z, targetPos.z, t)
            );

            this.scene.add(sprite);
            trailSprites.push(sprite);
        }

        this.activeEffects.push({
            type: 'meleeTrail',
            objects: [flash, impactLight, ...trailSprites],
            lifetime: VFX.meleeTrailDuration,
            age: 0,
            updateFn: (effect, dt) => {
                const t = effect.age / effect.lifetime;

                flash.material.opacity = 1.0 - t;
                flash.scale.setScalar(0.8 + t * 0.5);
                impactLight.intensity = VFX.meleeFlashIntensity * (1.0 - t);

                for (const sprite of trailSprites) {
                    sprite.material.opacity = 1.0 - t;
                }
            }
        });

        // Also spawn sparks at the impact point
        this.playImpactParticles(targetPos, 'spark');
    }

    // ============================================================
    // Death Effect
    // ============================================================

    /**
     * Play a death dust cloud effect.
     * @param {{ x: number, y: number, z: number }} position
     */
    playDeathEffect(position) {
        const count = VFX.deathDustCount;
        const particles = [];

        for (let i = 0; i < count; i++) {
            const sprite = new THREE.Sprite(this.dustMaterial.clone());
            const size = 0.15 + Math.random() * 0.2;
            sprite.scale.set(size, size, 1);

            sprite.position.set(
                position.x + (Math.random() - 0.5) * 0.5,
                0.1 + Math.random() * 0.3,
                position.z + (Math.random() - 0.5) * 0.5
            );

            this.scene.add(sprite);

            const angle = Math.random() * Math.PI * 2;
            const speed = 0.5 + Math.random() * 1.0;
            particles.push({
                sprite,
                vx: Math.cos(angle) * speed,
                vy: 0.5 + Math.random() * 0.5,
                vz: Math.sin(angle) * speed
            });
        }

        this.activeEffects.push({
            type: 'deathDust',
            objects: particles.map(p => p.sprite),
            lifetime: VFX.deathDustDuration,
            age: 0,
            updateFn: (effect, dt) => {
                const t = effect.age / effect.lifetime;

                for (const p of particles) {
                    p.sprite.position.x += p.vx * dt;
                    p.sprite.position.y += p.vy * dt;
                    p.sprite.position.z += p.vz * dt;

                    // Slow down
                    p.vx *= 0.95;
                    p.vz *= 0.95;
                    p.vy *= 0.92;

                    // Fade and expand
                    p.sprite.material.opacity = 0.6 * (1.0 - t);
                    const s = p.sprite.scale.x * (1.0 + dt * 2);
                    p.sprite.scale.set(s, s, 1);
                }
            }
        });
    }

    // ============================================================
    // Overwatch Flash
    // ============================================================

    /**
     * Play a brief overwatch indicator flash at a unit position.
     * @param {{ x: number, y: number, z: number }} position
     */
    playOverwatchFlash(position) {
        const light = new THREE.PointLight(0x4488cc, 3.0, 6, 2);
        light.position.set(position.x, 2.0, position.z);
        this.scene.add(light);

        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            color: 0x4488cc,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        sprite.position.set(position.x, 2.0, position.z);
        sprite.scale.set(1.0, 1.0, 1);
        this.scene.add(sprite);

        this.activeEffects.push({
            type: 'overwatchFlash',
            objects: [light, sprite],
            lifetime: CONSTANTS.OVERWATCH.flashDuration,
            age: 0,
            updateFn: (effect, dt) => {
                const t = effect.age / effect.lifetime;
                light.intensity = 3.0 * (1.0 - t);
                sprite.material.opacity = 0.8 * (1.0 - t);
                sprite.scale.setScalar(1.0 + t * 0.5);
            }
        });
    }

    // ============================================================
    // Update Loop
    // ============================================================

    /**
     * Update all active effects each frame.
     * @param {number} deltaTime
     */
    update(deltaTime) {
        const toRemove = [];

        for (let i = 0; i < this.activeEffects.length; i++) {
            const effect = this.activeEffects[i];
            effect.age += deltaTime;

            // Run update function
            if (effect.updateFn) {
                effect.updateFn(effect, deltaTime);
            }

            // Check lifetime
            if (effect.age >= effect.lifetime) {
                toRemove.push(i);

                // Remove objects from scene
                for (const obj of effect.objects) {
                    this.scene.remove(obj);
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) {
                        if (obj.material.dispose) obj.material.dispose();
                    }
                }

                // Call completion callback
                if (effect.onComplete) {
                    effect.onComplete();
                }
            }
        }

        // Remove expired effects (reverse order to preserve indices)
        for (let i = toRemove.length - 1; i >= 0; i--) {
            this.activeEffects.splice(toRemove[i], 1);
        }
    }

    // ============================================================
    // Cleanup
    // ============================================================

    dispose() {
        // Remove all active effects
        for (const effect of this.activeEffects) {
            for (const obj of effect.objects) {
                this.scene.remove(obj);
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material && obj.material.dispose) obj.material.dispose();
            }
        }
        this.activeEffects = [];

        // Dispose base materials
        this.muzzleFlashMaterial.dispose();
        this.tracerMaterial.dispose();
        this.sparkMaterial.dispose();
        this.dustMaterial.dispose();
        this.bloodMaterial.dispose();
        this.meleeFlashMaterial.dispose();
    }
}

// Helper (avoid importing clamp just for this)
function clampValue(v, min, max) {
    return Math.max(min, Math.min(max, v));
}
