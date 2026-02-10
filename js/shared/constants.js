// Slimline Tactical — Shared Constants
// All game configuration values in one place

export const CONSTANTS = {
    // Grid & Map
    TILE_SIZE: 2.0,
    DEFAULT_GRID_SIZE: [20, 16],

    // Unit Stats (mirrored for both factions)
    UNIT_STATS: {
        hp: 10,
        ap: 2,
        movement: 4,
        rangedDamage: 4,
        meleeDamage: 5,
        rangedAccuracy: 0.70,
        meleeAccuracy: 0.85,
        rangedRange: 8,
        meleeRange: 1
    },

    // Combat Modifiers
    COVER_BONUS: {
        half: -0.25,
        full: -0.50
    },
    HIGH_GROUND_BONUS: 0.10,
    FLANKING_BONUS: 0.15,
    MIN_HIT_CHANCE: 0.05,
    MAX_HIT_CHANCE: 0.95,

    // Factions
    FACTIONS: {
        orderOfTheAbyss: {
            id: 'orderOfTheAbyss',
            name: 'Order of the Abyss',
            unitType: 'acolyte',
            unitLabel: 'Acolyte',
            modelPath: 'assets/models/order-of-the-abyss/acolyte/',
            modelPrefix: 'acolyte',
            unitLightColor: 0x4466ff,
            spawnColor: 0x4466ff,
            squadSize: 5
        },
        germani: {
            id: 'germani',
            name: 'Germani',
            unitType: 'shock_troops',
            unitLabel: 'Shock Trooper',
            modelPath: 'assets/models/germani/shock_troops/',
            modelPrefix: 'shock',
            unitLightColor: 0xff6633,
            spawnColor: 0xff6633,
            squadSize: 5
        }
    },

    // Animation names matching GLB filenames: prefix_animName.glb
    ANIMATIONS: ['idle', 'walk', 'run', 'attack_range', 'attack_melee', 'hit_reaction', 'death'],

    // Camera
    CAMERA: {
        tiltAngle: 65,
        defaultZoom: 16,
        minZoom: 3,
        maxZoom: 40,
        panSpeed: 0.02,
        zoomSpeed: 0.5,
        zoomLerpSpeed: 8.0,
        panLerpSpeed: 8.0,
        combatZoomFactor: 0.4,
        combatTweenDuration: 0.6,
        combatHoldDuration: 0.3
    },

    // Lighting
    LIGHTING: {
        keyLight: {
            color: 0xfff0dd,
            intensity: 3.0,
            elevation: 35,
            azimuth: -30,
            shadowMapSize: 2048,
            shadowRadius: 2,
            shadowBias: -0.0002
        },
        rimLight: {
            color: 0xaabbff,
            intensity: 2.5
        },
        ambient: {
            skyColor: 0x556677,
            groundColor: 0x443322,
            intensity: 1.2
        },
        unitLightIntensity: 1.0,
        unitLightRadius: 4.0,
        unitLightDecay: 2
    },

    // Post-Processing
    POSTPROCESSING: {
        bloom: {
            threshold: 0.85,
            strength: 0.4,
            radius: 0.6
        },
        ssao: {
            kernelRadius: 8,
            minDistance: 0.005,
            maxDistance: 0.1,
            intensity: 0.5
        },
        colorGrading: {
            saturation: 0.75,
            contrast: 1.1,
            shadowTint: [0.12, 0.12, 0.18],
            highlightTint: [1.0, 0.92, 0.75],
            midtoneTint: [0.92, 0.95, 0.88]
        },
        vignette: {
            darkness: 0.35,
            offset: 1.2
        },
        filmGrain: {
            intensity: 0.03
        }
    },

    // Texture configs — keys map to groundTexture in map JSON
    TEXTURES: {
        dirt: {
            path: 'assets/textures/polyhaven/dirt/',
            prefix: 'dirt',
            diffuse: 'dirt_diff_4k.jpg',
            normal: 'dirt_nor_gl_4k.exr',
            roughness: 'dirt_rough_4k.exr',
            displacement: 'dirt_disp_4k.png'
        },
        rock_2: {
            path: 'assets/textures/polyhaven/rock_2/',
            prefix: 'rock_2',
            diffuse: 'rock_2_diff_4k.jpg',
            normal: 'rock_2_nor_gl_4k.exr',
            roughness: 'rock_2_rough_4k.jpg',
            displacement: 'rock_2_disp_4k.png'
        },
        rock_face: {
            path: 'assets/textures/polyhaven/rock_face/',
            prefix: 'rock_face',
            diffuse: 'rock_face_diff_4k.jpg',
            normal: 'rock_face_nor_gl_4k.exr',
            roughness: 'rock_face_rough_4k.exr',
            displacement: 'rock_face_disp_4k.png'
        },
        sparse_grass: {
            path: 'assets/textures/polyhaven/sparse_grass/',
            prefix: 'sparse_grass',
            diffuse: 'sparse_grass_diff_4k.jpg',
            normal: 'sparse_grass_nor_gl_4k.exr',
            roughness: 'sparse_grass_rough_4k.exr',
            displacement: 'sparse_grass_disp_4k.png'
        }
    },

    // AI
    AI: {
        decisionDelay: 0.75,
        cameraFollowSpeed: 2.0,
        targetScoreWeights: {
            lowHp: 40,
            close: 30,
            noCover: 30
        },
        preferredRangedDistance: { min: 4, max: 6 },
        coverPreferenceWeight: 50
    },

    // VFX
    VFX: {
        muzzleFlashDuration: 0.05,
        muzzleFlashIntensity: 3.0,
        muzzleFlashColor: 0xffaa44,
        tracerSpeed: 80,
        tracerWidth: 0.04,
        tracerColor: 0xffddaa,
        missOffsetRange: 0.8,
        particleCount: 12,
        particleLifetime: 0.4,
        particleSpeed: 4.0,
        particleGravity: -9.8,
        sparkColor: 0xffaa44,
        dustColor: 0x886644,
        bloodColor: 0x661111,
        meleeTrailDuration: 0.2,
        meleeFlashIntensity: 2.0,
        deathDustCount: 8,
        deathDustDuration: 0.5
    },

    // Atmospheric particles
    ATMOSPHERE: {
        ashCount: 80,
        ashColor: 0xffccaa,
        ashSize: { min: 0.05, max: 0.15 },
        ashSpeed: { min: 0.2, max: 0.5 },
        ashOpacity: { min: 0.1, max: 0.3 },
        ashSwayAmplitude: 0.3,
        ashSwayFrequency: 0.5,
        ashMaxHeight: 8.0,
        dustCount: 40,
        dustColor: 0xcccccc,
        dustSize: { min: 0.02, max: 0.08 },
        dustSpeed: 0.1,
        dustOpacity: { min: 0.05, max: 0.15 },
        fogWispCount: 15,
        fogWispColor: 0xcccccc,
        fogWispOpacity: 0.08,
        fogWispSpeed: 0.15,
        fogWispWidth: 3.0,
        fogWispHeight: 0.3
    },

    // Movement
    MOVEMENT: {
        walkSpeed: 4.0,
        runSpeed: 7.0,
        rotationSpeed: 8.0,
        arrivalThreshold: 0.05,
        animCrossFadeDuration: 0.2
    },

    // Game phases / state machine
    GAME_PHASES: {
        LOADING: 'loading',
        PLAYER_SELECT_UNIT: 'player_select_unit',
        PLAYER_MOVEMENT: 'player_movement',
        PLAYER_ACTION: 'player_action',
        PLAYER_TARGET_SELECT: 'player_target_select',
        COMBAT_ANIMATION: 'combat_animation',
        AI_THINKING: 'ai_thinking',
        AI_ACTING: 'ai_acting',
        TURN_TRANSITION: 'turn_transition',
        GAME_OVER: 'game_over'
    },

    // Unit statuses
    UNIT_STATUS: {
        READY: 'ready',
        ACTIVATED: 'activated',
        OVERWATCH: 'overwatch',
        HUNKERED: 'hunkered',
        DEAD: 'dead'
    },

    // Cover object types for procedural generation
    COVER_OBJECTS: {
        boulder: { label: 'Boulder', defaultCover: 'half', defaultScale: 1.0 },
        rock_cluster: { label: 'Rock Cluster', defaultCover: 'half', defaultScale: 0.8 },
        column: { label: 'Column', defaultCover: 'full', defaultScale: 1.0 },
        ruined_wall: { label: 'Ruined Wall', defaultCover: 'full', defaultScale: 1.0 },
        barricade: { label: 'Barricade', defaultCover: 'half', defaultScale: 1.0 },
        crater: { label: 'Crater', defaultCover: 'none', defaultScale: 1.0 }
    },

    // Renderer
    RENDERER: {
        toneMapping: 'ACESFilmic',
        toneMappingExposure: 2.0,
        antialias: true,
        shadowMapType: 'PCFSoft',
        backgroundColor: 0x0d0d12
    },

    // Overwatch
    OVERWATCH: {
        range: 8,
        coneAngle: 180,
        reactionDelay: 0.3,
        flashDuration: 0.15
    },

    // UI timing
    UI: {
        damageNumberDuration: 1.0,
        damageNumberRiseDistance: 40,
        turnTransitionDuration: 1.5,
        unitCardFadeDuration: 0.3
    }
};
