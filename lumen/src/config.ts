/**
 * LUMEN — all gameplay tuning lives here.
 *
 * World units: the SHORTER side of the screen always spans `world.shortSide` units,
 * so gameplay distances are identical on a phone, an iPad in either
 * orientation and a narrow Split View window. Extra length on the long side
 * is just a bigger window onto the same world.
 */
export const CFG = {
  world: {
    shortSide: 840,
    /** Obstacles spawn on a circle of this radius around the arena center (same for every format = fair). */
    spawnRadius: 1100,
    /** Objects further than this from the center, and moving away, are recycled. */
    cullRadius: 1700,
  },

  sim: {
    /** Fixed physics rate (Hz). Rendering is interpolated, so 60 Hz and 120 Hz screens play identically. */
    hz: 120,
    /** Max simulated steps per frame (avoids spiral of death after a stall). */
    maxSteps: 12,
  },

  spark: {
    radius: 16,
    /** Reference radius: start height and the radius at which maxOmega applies. */
    orbitRadius: 172,
    /**
     * Angular speed (rad/s) while holding, at orbitRadius. Clockwise on screen. Further out the
     * spark keeps roughly the same linear speed, so it does not whip around at the rim.
     */
    maxOmega: 5.6,
    maxOmegaCap: 8.5,
    /** Ease-in rate when pressing (1/s, exponential approach). */
    accel: 7.5,
    /** Inertia when releasing (1/s); lower = longer glide. */
    release: 3.2,
    /** Extra "kick" at press start so the first millisecond feels responsive. */
    pressKick: 0.9,
    trailLength: 44,
    tetherSegments: 14,
    tetherStiffness: 0.55,

    // ---- gravity & bounces: the core pulls the spark in; light things bounce it back out
    /** Pull towards the core (units/s²) at the start of a run … */
    gravity: 430,
    /** … rising by this much per phase, up to gravityMax. */
    gravityPerPhase: 34,
    gravityMax: 620,
    /** Gentler pull during the first seconds of a run (teaches the bounce). */
    gravityIntroTime: 18,
    gravityIntroScale: 0.55,
    /** Outward speed (units/s) given by a bounce. */
    bounceOrb: 330,
    bounceSmash: 420,
    bounceThread: 470,
    bounceBooster: 390,
    bounceCore: 500,
    /**
     * Lowest flight ceiling. The real ceiling follows the screen edges (the whole map is in play,
     * further along the long side); incoming hazards are announced by arrows at the edge.
     */
    maxRadius: 285,
    /** Gap kept between the spark and the screen edge (world units); more at the top for the HUD. */
    edgeMargin: 46,
    edgeMarginTop: 150,
    edgeMarginBottom: 70,
    /** The spark dies when its centre gets this close to the core centre. */
    deathRadius: 58,
    /** Under this radius the core starts glowing red as a warning. */
    dangerRadius: 128,
  },

  core: {
    radius: 50,
    spikes: 14,
    /** The core stays in the centre; it only breathes slightly (identical everywhere). */
    driftExtent: 0,
    driftSpeed: 0.075,
    /** Heated core (late phases). */
    heatInterval: [13, 18] as const,
    heatWarn: 1.7,
    heatActive: 0.95,
    heatSpikeLen: 238,
    heatSpikeWidth: 15,
  },

  /** Hitboxes are smaller than visuals (forgiving). */
  hitbox: {
    darkScale: 0.85,
    lightScale: 1.0,
    /** cos-space tolerance at the light/dark boundary — ties go to the player. */
    boundaryEps: 0.12,
    nearMissDist: 18,
  },

  orb: {
    radius: 11,
    pickupPad: 9,
    value: 10,
    life: 9,
    anchoredLife: 5.5,
  },

  score: {
    smashSmall: 30,
    smashMedium: 50,
    smashLarge: 80,
    smashFalling: 150,
    shard: 45,
    ringRim: 40,
    ringThread: 120,
    mineDefuse: 100,
    voidSmash: 150,
    cometSmash: 140,
    bladeSmash: 120,
    seekerSmash: 90,
    holeSmash: 200,
    nearMiss: 25,
    /** Chain bonuses for DOUBLE, TRIPLE, MEGA, ULTRA, HYPER, LUMEN… */
    chainBonus: [0, 0, 10, 20, 40, 80, 160, 320],
    chainWindow: 1.15,
  },

  multiplier: {
    max: 10,
    comboTimeout: 2.0,
    /** Bar points required to reach the next level: base + perLevel * level */
    barBase: 14,
    barPerLevel: 6,
    orbFill: 1,
    smashFill: 2.5,
    survivalFill: 0.35,
  },

  phases: {
    /** Peak multiplier that starts each phase (index = phase number - 1). */
    byMultiplier: [1, 3, 5, 6, 7, 9, 10],
    /** Survival time fallback (s) that starts each phase anyway. */
    byTime: [0, 32, 70, 110, 150, 195, 245],
    /** After the last listed phase a new one starts every N seconds. */
    extraEvery: 55,
    tempoPerPhase: 0.075,
    tempoMax: 1.75,
    transition: 2.6,
  },

  spawn: {
    tutorialOrbsOnly: 7,
    firstHalfOrb: 8,
    secondHalfOrb: 14,
    orbPattern: [1.3, 2.0] as const,
    halfOrb: [4.2, 6.4] as const,
    falling: [7, 10] as const,
    shardSwarm: [8, 12] as const,
    ring: [5.5, 8.0] as const,
    mine: [9, 14] as const,
    void: [8, 13] as const,
    comet: [6.5, 10] as const,
    blade: [7, 11] as const,
    seeker: [8, 12] as const,
    laser: [7, 10] as const,
    hole: [13, 18] as const,
    booster: [13, 20] as const,
    firstBooster: 22,
    /** Interval multiplier floor for late phases. */
    densityFloor: 0.42,
    densityPerPhase: 0.085,
  },

  obstacle: {
    halfOrbRadius: [34, 82] as const,
    halfOrbSpeed: [100, 175] as const,
    halfOrbSpin: [0.25, 1.15] as const,
    /** max radius keeps a safe spot on the orbit (orbit radius - spark radius - margin) */
    fallingRadius: [70, 92] as const,
    fallingSpeed: [210, 300] as const,
    fallingWarn: 1.05,
    shardSize: [19, 26] as const,
    shardSpin: [1.8, 3.6] as const,
    shardSpeed: [170, 260] as const,
    ringRadius: [54, 70] as const,
    ringThickness: 9,
    mineRadius: 40,
    mineFuse: [3.0, 3.8] as const,
    mineWaveRadius: 300,
    mineWaveTime: 0.62,
    mineWaveBand: 26,
    voidRadius: [17, 23] as const,
    cometRadius: 24,
    cometSpeed: [1000, 1250] as const,
    cometWarn: 1.0,
    bladeHalfLen: [80, 120] as const,
    bladeWidth: 14,
    bladeSpin: [1.4, 2.4] as const,
    bladeSpeed: [90, 150] as const,
    seekerRadius: 15,
    seekerSpeed: 210,
    seekerTurn: 1.5,
    seekerLife: 6.5,
    holeRadius: 34,
    holePull: 260,
    holeStrength: 820,
    holeLife: 7,
    holeSpeed: [35, 60] as const,
    laserWarn: 1.15,
    laserActive: 0.9,
    laserWidth: 20,
  },

  booster: {
    radius: 30,
    life: 11,
    prism: 6.0,
    prismScale: 1.55,
    rocket: 1.6,
    rocketOmega: 2.3,
    lightning: 10,
    lightningRange: 400,
    lightningJumps: 4,
    magnet: 8,
    magnetRange: 520,
    shieldInvuln: 1.25,
    slowmo: 4,
    slowmoScale: 0.45,
    /** Spring: bounces are this much stronger. */
    spring: 7,
    springScale: 1.45,
    /** Double points. */
    double: 8,
    /** Ghost: passes through dark sides, hazards and the core. */
    ghost: 5,
    /** Levitation: gravity off, the spark hovers. */
    levit: 5,
    /** Light shower: number of orbs scattered over the whole map. */
    showerOrbs: 36,
    /** Freeze: obstacles stop moving and turning. */
    freeze: 5,
    /** Twin: a second spark on the opposite side collects and smashes too. */
    twin: 8,
    /** Long tether: for 8 s the taut tether catches the spark at this radius (a safety rope). */
    longTether: 8,
    longTetherRadius: 175,
    supernovaTime: 0.8,
  },

  juice: {
    hitStopSmall: 0,
    hitStopBig: 0.045,
    hitStopDeath: 0.06,
    shakeMax: 22,
    deathSlowmo: 0.12,
    gameOverDelay: 1.15,
  },

  meta: {
    /** Okruchy (light crumbs) earned per run. */
    crumbsPerOrb: 0.2,
    crumbsPerSmash: 0.34,
    crumbsPerScore: 0.001,
  },
} as const;

export type Range = readonly [number, number];
