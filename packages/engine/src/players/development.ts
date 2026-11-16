import type {
  AgeGrowthCurve,
  Player,
  PlayerAttributes,
  Position,
} from '@club-director/shared-types';
import { SeededRNG } from '../match/simulation';

/**
 * Weekly player development engine (Phase 3A-B).
 *
 * Pure and deterministic: every player gets an independent RNG stream
 * derived from (seasonId, week, player.id, 'development'), so results do
 * not depend on the order of the `players` array and identical inputs
 * always replay identically. No clock, no Math.random, no I/O, no
 * mutation of the inputs.
 *
 * Scope: ability + attribute evolution only. Morale, annual aging and
 * retirement are handled by separate systems/phases.
 */

/** Tunable parameters for the weekly development model. */
export interface WeeklyDevelopmentParams {
  /**
   * Weekly probability of +1 currentAbility for a young player at full
   * participation with maximum potential gap. Calibrated so a developed
   * youth gains roughly +2..+5 ability per 30-week season.
   */
  growthBaseChance: number;
  /**
   * Weekly probability of -1 currentAbility for a fully declined
   * veteran at full participation. Calibrated to roughly -1..-3 per
   * season once the decline factor saturates.
   */
  declineBaseChance: number;
  /**
   * Potential gap (potentialAbility - currentAbility) at which growth
   * chance saturates. gap/gapScale is clamped to [0,1], so a player
   * whose gap is small progresses proportionally slower.
   */
  gapScale: number;
  /**
   * Multiplicative factor applied to growth AND decline chances for
   * players who did not participate in any match this week. There is no
   * minutes-played data: participation is binary (>=1 match or none).
   */
  reserveFactor: number;
  /**
   * Signed age factor applied during the prime window: near-stagnation
   * with a small residual growth chance for players far below potential.
   */
  primeFactor: number;
  /**
   * Probability that a +1 ability gain is accompanied by +1 on one
   * position-relevant attribute (integers stay in [1,20]).
   */
  attributeGainChance: number;
  /** Probability that a -1 ability loss is accompanied by a physical decline. */
  physicalDeclineChance: number;
  /**
   * Probability that a -1 ability loss is accompanied by a mental
   * decline — only once the player reaches the curve's mentalDeclineAge.
   */
  mentalDeclineChance: number;
}

export const DEFAULT_WEEKLY_DEVELOPMENT_PARAMS: WeeklyDevelopmentParams = {
  growthBaseChance: 0.14,
  declineBaseChance: 0.05,
  gapScale: 80,
  reserveFactor: 0.25,
  primeFactor: 0.05,
  attributeGainChance: 0.5,
  physicalDeclineChance: 0.6,
  mentalDeclineChance: 0.25,
};

/**
 * Age windows per growth curve. `primeStart`/`declineStart` bound the
 * near-stagnation window; `declineRamp` is the number of years over
 * which the decline factor goes from ~0 to -1 (progressive decline);
 * `mentalDeclineAge` delays mental-attribute decline relative to the
 * physical/ability decline.
 */
interface CurveWindow {
  primeStart: number;
  declineStart: number;
  declineRamp: number;
  mentalDeclineAge: number;
}

const CURVE_WINDOWS: Record<AgeGrowthCurve, CurveWindow> = {
  'early-peak': { primeStart: 21, declineStart: 26, declineRamp: 4, mentalDeclineAge: 31 },
  normal: { primeStart: 23, declineStart: 29, declineRamp: 4, mentalDeclineAge: 34 },
  'late-bloomer': { primeStart: 25, declineStart: 31, declineRamp: 4, mentalDeclineAge: 36 },
};

const ABILITY_FLOOR = 1;
const MAX_RELEVANT_ATTRIBUTES = 8;

/**
 * Position-relevant attributes, ordered by relevance. Primary-position
 * attributes come first, secondary positions append theirs. Categories
 * are resolved at runtime — attribute names are unique across the three
 * groups in PlayerAttributes.
 */
const POSITION_KEY_ATTRIBUTES: Record<Position, string[]> = {
  GK: [
    'positioning', 'concentration', 'anticipation', 'composure',
    'decisions', 'agility', 'jumping', 'balance',
  ],
  CB: [
    'tackling', 'heading', 'positioning', 'strength', 'jumping',
    'anticipation', 'concentration', 'determination',
  ],
  FB: [
    'tackling', 'crossing', 'pace', 'stamina', 'positioning',
    'agility', 'workRate', 'firstTouch',
  ],
  DM: [
    'tackling', 'passing', 'positioning', 'vision', 'stamina',
    'anticipation', 'workRate', 'firstTouch',
  ],
  CM: [
    'passing', 'vision', 'decisions', 'technique', 'stamina',
    'workRate', 'firstTouch', 'positioning',
  ],
  AM: [
    'vision', 'flair', 'passing', 'technique', 'dribbling',
    'decisions', 'composure', 'firstTouch',
  ],
  W: [
    'dribbling', 'pace', 'crossing', 'agility', 'flair',
    'acceleration', 'technique', 'composure',
  ],
  ST: [
    'finishing', 'shooting', 'composure', 'anticipation', 'pace',
    'firstTouch', 'technique', 'heading',
  ],
};

const PHYSICAL_ATTRIBUTE_NAMES = [
  'pace', 'acceleration', 'stamina', 'strength', 'agility',
  'balance', 'jumping', 'naturalFitness',
];
const MENTAL_ATTRIBUTE_NAMES = [
  'vision', 'decisions', 'composure', 'anticipation', 'positioning',
  'workRate', 'determination', 'leadership', 'concentration', 'flair',
];

/**
 * Deterministic 32-bit FNV-1a hash — same construction as
 * advanceMatchweek.hashSeed, kept local so this module stays
 * self-contained.
 */
function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Signed age factor in [-1, +1]:
 *  +1 before primeStart (full youth development window),
 *  +primeFactor during the prime window (near-stagnation),
 *  linear ramp from ~0 to -1 across declineRamp years after
 *  declineStart (progressive veteran decline).
 */
function ageFactor(age: number, curve: AgeGrowthCurve, params: WeeklyDevelopmentParams): number {
  // Unknown runtime values (e.g. corrupt persisted data) degrade to the
  // 'normal' curve rather than crashing the whole matchweek.
  const window = CURVE_WINDOWS[curve] ?? CURVE_WINDOWS.normal;
  if (age < window.primeStart) return 1;
  if (age < window.declineStart) return params.primeFactor;
  return -Math.min(1, (age - window.declineStart + 1) / window.declineRamp);
}

function attributeCategory(attrs: PlayerAttributes, name: string): keyof PlayerAttributes | null {
  if (name in attrs.technical) return 'technical';
  if (name in attrs.mental) return 'mental';
  if (name in attrs.physical) return 'physical';
  return null;
}

function readAttribute(attrs: PlayerAttributes, name: string): number {
  const category = attributeCategory(attrs, name);
  if (!category) return NaN;
  return (attrs[category] as unknown as Record<string, number>)[name];
}

/**
 * Return new attributes with `name` shifted by `delta`, clamped to
 * [1,20]. Unknown names are returned unchanged.
 */
function adjustAttribute(
  attrs: PlayerAttributes,
  name: string,
  delta: number,
): PlayerAttributes {
  const category = attributeCategory(attrs, name);
  if (!category) return attrs;
  const group = attrs[category] as unknown as Record<string, number>;
  const current = group[name];
  if (!Number.isFinite(current)) return attrs;
  const next = clamp(Math.round(current) + delta, 1, 20);
  if (next === current) return attrs;
  return {
    ...attrs,
    [category]: { ...attrs[category], [name]: next },
  } as PlayerAttributes;
}

/**
 * Ordered, deduplicated position-relevant attribute names: primary
 * position first, then secondary positions, capped at
 * MAX_RELEVANT_ATTRIBUTES.
 */
function relevantAttributes(player: Player): string[] {
  const names: string[] = [];
  const add = (position: Position) => {
    for (const name of POSITION_KEY_ATTRIBUTES[position] ?? []) {
      if (!names.includes(name)) names.push(name);
    }
  };
  add(player.primaryPosition);
  for (const position of player.secondaryPositions ?? []) {
    add(position);
  }
  return names.slice(0, MAX_RELEVANT_ATTRIBUTES);
}

/**
 * Weighted pick favouring weaker attributes for growth
 * (weight = 20 - value, so a 20-rated attribute is never picked and
 * low attributes are preferred). Returns null when every candidate is
 * already at the ceiling.
 */
function pickGrowthAttribute(
  player: Player,
  candidates: string[],
  rng: SeededRNG,
): string | null {
  const options = candidates
    .map((name) => ({ name, weight: 20 - readAttribute(player.attributes, name) }))
    .filter((o) => Number.isFinite(o.weight) && o.weight > 0);
  if (options.length === 0) return null;
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = rng.next() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option.name;
  }
  return options[options.length - 1].name;
}

/**
 * Weighted pick favouring stronger attributes for decline
 * (weight = value), restricted to values above the floor.
 */
function pickDeclineAttribute(
  player: Player,
  candidates: string[],
  rng: SeededRNG,
): string | null {
  const options = candidates
    .map((name) => ({ name, weight: readAttribute(player.attributes, name) }))
    .filter((o) => Number.isFinite(o.weight) && o.weight > 1);
  if (options.length === 0) return null;
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = rng.next() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option.name;
  }
  return options[options.length - 1].name;
}

function physicalCandidates(player: Player): string[] {
  const relevant = relevantAttributes(player).filter((name) =>
    PHYSICAL_ATTRIBUTE_NAMES.includes(name),
  );
  return relevant.length > 0 ? relevant : PHYSICAL_ATTRIBUTE_NAMES;
}

function mentalCandidates(player: Player): string[] {
  const relevant = relevantAttributes(player).filter((name) =>
    MENTAL_ATTRIBUTE_NAMES.includes(name),
  );
  return relevant.length > 0 ? relevant : MENTAL_ATTRIBUTE_NAMES;
}

function developPlayer(
  player: Player,
  participated: boolean,
  seasonId: string,
  week: number,
  params: WeeklyDevelopmentParams,
): Player {
  const { currentAbility, potentialAbility } = player.development;
  if (
    !Number.isFinite(player.age) ||
    !Number.isFinite(currentAbility) ||
    !Number.isFinite(potentialAbility)
  ) {
    throw new Error(
      `applyWeeklyDevelopment: player ${player.id} has invalid ` +
        'age/development data.',
    );
  }

  const rng = new SeededRNG(
    hashSeed(`${seasonId}|${week}|development|${player.id}`),
  );

  const participationFactor = participated ? 1 : params.reserveFactor;
  const factor = ageFactor(player.age, player.development.ageGrowthCurve, params);
  // A negative gap (currentAbility above potential — atypical persisted
  // data) yields no growth but still allows decline; currentAbility is
  // never lowered to "repair" the inconsistency.
  const gap = Math.max(0, potentialAbility - currentAbility);
  const gapFactor = clamp(gap / params.gapScale, 0, 1);

  let delta = 0;
  if (factor >= 0) {
    const chance =
      params.growthBaseChance * factor * gapFactor * participationFactor;
    if (rng.next() < chance) delta = 1;
  } else {
    const chance =
      params.declineBaseChance * -factor * participationFactor;
    if (rng.next() < chance) delta = -1;
  }

  if (delta === 0) return player;

  const nextAbility = clamp(
    currentAbility + delta,
    ABILITY_FLOOR,
    potentialAbility,
  );
  // Ability clamped at the potential ceiling: no effective change, so
  // no attribute growth either — return the player untouched.
  if (nextAbility === currentAbility) return player;

  let attributes = player.attributes;
  let attributesChanged = false;
  const applyAttribute = (name: string | null) => {
    if (!name) return;
    const next = adjustAttribute(attributes, name, delta);
    if (next !== attributes) {
      attributes = next;
      attributesChanged = true;
    }
  };

  if (delta > 0) {
    if (rng.next() < params.attributeGainChance) {
      applyAttribute(pickGrowthAttribute(player, relevantAttributes(player), rng));
    }
  } else {
    if (rng.next() < params.physicalDeclineChance) {
      applyAttribute(pickDeclineAttribute(player, physicalCandidates(player), rng));
    }
    const window = CURVE_WINDOWS[player.development.ageGrowthCurve] ?? CURVE_WINDOWS.normal;
    if (
      player.age >= window.mentalDeclineAge &&
      rng.next() < params.mentalDeclineChance
    ) {
      applyAttribute(pickDeclineAttribute(player, mentalCandidates(player), rng));
    }
  }

  if (!attributesChanged && nextAbility === currentAbility) return player;

  return {
    ...player,
    attributes,
    development: {
      ...player.development,
      currentAbility: nextAbility,
    },
  };
}

/**
 * Apply one week of player development to every player.
 *
 * @param players        Full player list (managed and AI clubs alike —
 *                       identical rules for everyone).
 * @param participation  Set of player ids that played at least one
 *                       match this week. Anyone absent gets
 *                       `params.reserveFactor` on growth/decline
 *                       chances. Injured reserves are indistinguishable
 *                       from other non-participants — the model has no
 *                       minutes-played or injury-awareness data.
 * @param seasonId       Stable season identifier (seed material).
 * @param week           Current matchweek number (seed material, >= 1).
 * @param params         Optional parameter overrides (tests/calibration).
 *
 * Returns a new array; unchanged players keep their original object
 * reference, changed players are new objects. Inputs are never mutated.
 */
export function applyWeeklyDevelopment(
  players: Player[],
  participation: ReadonlySet<string>,
  seasonId: string,
  week: number,
  params: WeeklyDevelopmentParams = DEFAULT_WEEKLY_DEVELOPMENT_PARAMS,
): Player[] {
  if (!Array.isArray(players)) {
    throw new Error('applyWeeklyDevelopment: players must be an array.');
  }
  if (typeof seasonId !== 'string' || seasonId.trim() === '') {
    throw new Error('applyWeeklyDevelopment: seasonId must be non-blank.');
  }
  if (!Number.isInteger(week) || week < 1) {
    throw new Error(
      `applyWeeklyDevelopment: week must be an integer >= 1, got ${week}.`,
    );
  }
  if (
    !participation ||
    typeof (participation as ReadonlySet<string>).has !== 'function'
  ) {
    throw new Error(
      'applyWeeklyDevelopment: participation must be a ReadonlySet<string>.',
    );
  }

  return players.map((player) =>
    developPlayer(player, participation.has(player.id), seasonId, week, params),
  );
}
