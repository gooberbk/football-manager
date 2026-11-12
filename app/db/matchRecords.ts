import type {
  Club,
  ClubTactics,
  EventType,
  Fixture,
  Formation,
  League,
  MatchResult,
  MatchStats,
  MatchStatus,
  Mentality,
  Season,
} from '@club-director/shared-types';

/**
 * Phase 2C.1 — persistence model and pure mapping for completed matches.
 *
 * `PersistedMatch` is the lossless domain model: it preserves everything
 * `simulateMatch`/`advanceMatchweek` produce, including fields the current
 * SQLite schema cannot store yet.
 *
 * STORAGE NOTES (post migration v3):
 * - `matches` stores fixture_id, stats (JSON), seed and participant_ids
 *   (JSON array); all were added nullable by migration v3. Rows written
 *   before v3 have NULLs and are filtered out by `matchFromDbRows`
 *   rather than backfilled with invented values.
 * - `match_events` stores secondary_player_id (nullable, migration v3);
 *   `team` has no column but is recovered by comparing club_id with the
 *   match's home/away club ids.
 * - `leagueId` has no column either: it is embedded in the deterministic
 *   match id and recovered by `decodeMatchId`, cross-checked against the
 *   stored season_id/fixture_id.
 * - Intra-minute event ordering across DIFFERENT event types is not
 *   fully recoverable from the columns (the engine's generation order
 *   within a minute is not persisted); ordering by (minute, id) is
 *   deterministic and preserves per-type occurrence order.
 *
 * EVENT ORDERING CONTRACT: `MatchResult.events` is produced minute-
 * ascending by the engine (`aggregateResults` sorts by `minute`; the sort
 * is stable, so events sharing a minute keep their generation order).
 * `buildPersistedMatch` orders events chronologically by minute and
 * stably preserves INPUT order for equal-minute events — it does NOT
 * canonicalize the order of equal-minute events, so permuting them in
 * the input can change occurrence-suffix assignment (IDs stay unique,
 * but are only guaranteed reproducible for identical ordered input,
 * which is what the engine produces).
 */

export interface PersistedMatchEvent {
  /** Globally unique, deterministic id: `<matchId>:<minute>:<type>:<occurrence>`. */
  id: string;
  minute: number;
  type: EventType;
  /** Matches `MatchEvent.primaryPlayerId`; nullable per the DB column. */
  primaryPlayerId: string | null;
  /** Matches `MatchEvent.secondaryPlayerId`; NULL when absent. */
  secondaryPlayerId: string | null;
  team: 'home' | 'away';
  /** Club id of the team side (home or away club), resolved at mapping time. */
  clubId: string;
  description: string;
}

export interface PersistedMatch {
  /**
   * Deterministic, collision-free id encoding the tuple
   * `(leagueId, seasonId, fixtureId)` with length-prefixed components:
   * `match-<len>:<leagueId><len>:<seasonId><len>:<fixtureId>`.
   * Length-prefixing makes component boundaries unambiguous even when
   * ids themselves contain `:` or `-` (e.g. `a-b`/`c`/`d` vs
   * `a`/`b-c`/`d` cannot collide). Compatible with SQLite TEXT PKs.
   */
  id: string;
  fixtureId: string;
  seasonId: string;
  leagueId: string;
  date: Date;
  status: MatchStatus;
  homeClubId: string;
  awayClubId: string;
  homeScore: number;
  awayScore: number;
  homeTactics: ClubTactics;
  awayTactics: ClubTactics;
  stats: { home: MatchStats; away: MatchStats };
  seed: number;
  participantIds: string[];
  events: PersistedMatchEvent[];
}

export interface BuildPersistedMatchInput {
  fixture: Fixture;
  season: Season;
  league: League;
  homeClub: Club;
  awayClub: Club;
  result: MatchResult;
}

const MATCH_STATUSES: readonly MatchStatus[] = [
  'scheduled',
  'in-progress',
  'completed',
  'postponed',
];

const EVENT_TYPES: readonly EventType[] = [
  'goal',
  'own-goal',
  'yellow-card',
  'red-card',
  'substitution',
  'injury',
  'chance',
  'save',
  'miss',
  'corner',
  'foul',
];

const FORMATIONS: readonly Formation[] = [
  '4-4-2',
  '4-3-3',
  '3-5-2',
  '4-2-3-1',
  '5-3-2',
  '4-1-4-1',
  '3-4-3',
  '5-4-1',
];

const MENTALITIES: readonly Mentality[] = ['defensive', 'balanced', 'attacking'];

const MATCH_STAT_FIELDS = [
  'possession',
  'shots',
  'shotsOnTarget',
  'corners',
  'fouls',
  'yellowCards',
  'redCards',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(path: string, expected: string): never {
  throw new Error(`Invalid persisted match data: ${path} must be ${expected}`);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path, 'a string');
  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(path, 'a finite number');
  }
  return value;
}

function requireNullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid(path, 'a string or null');
  return value;
}

// ---------------------------------------------------------------------------
// Domain validators (shared by canonical and JSON deserializers)
// ---------------------------------------------------------------------------

function validateTactics(value: unknown, path: string): asserts value is ClubTactics {
  if (!isRecord(value)) invalid(path, 'an object');
  if (typeof value.defaultFormation !== 'string' || !FORMATIONS.includes(value.defaultFormation as Formation)) {
    invalid(`${path}.defaultFormation`, `one of ${FORMATIONS.join(', ')}`);
  }
  if (typeof value.mentality !== 'string' || !MENTALITIES.includes(value.mentality as Mentality)) {
    invalid(`${path}.mentality`, `one of ${MENTALITIES.join(', ')}`);
  }
  for (const field of ['pressingIntensity', 'tempo', 'width'] as const) {
    requireNumber(value[field], `${path}.${field}`);
  }
}

function validateMatchStats(value: unknown, path: string): asserts value is MatchStats {
  if (!isRecord(value)) invalid(path, 'an object');
  for (const field of MATCH_STAT_FIELDS) {
    requireNumber(value[field], `${path}.${field}`);
  }
}

function validateStatsPair(value: unknown, path: string): asserts value is { home: MatchStats; away: MatchStats } {
  if (!isRecord(value)) invalid(path, 'an object');
  validateMatchStats(value.home, `${path}.home`);
  validateMatchStats(value.away, `${path}.away`);
}

function validateEvent(value: unknown, path: string): asserts value is PersistedMatchEvent {
  if (!isRecord(value)) invalid(path, 'an object');
  requireString(value.id, `${path}.id`);
  requireNumber(value.minute, `${path}.minute`);
  if (typeof value.type !== 'string' || !EVENT_TYPES.includes(value.type as EventType)) {
    invalid(`${path}.type`, `one of ${EVENT_TYPES.join(', ')}`);
  }
  requireNullableString(value.primaryPlayerId, `${path}.primaryPlayerId`);
  requireNullableString(value.secondaryPlayerId, `${path}.secondaryPlayerId`);
  if (value.team !== 'home' && value.team !== 'away') {
    invalid(`${path}.team`, "'home' or 'away'");
  }
  requireString(value.clubId, `${path}.clubId`);
  requireString(value.description, `${path}.description`);
}

// Exact format emitted by Date.prototype.toISOString():
// YYYY-MM-DDTHH:mm:ss.sssZ — no date-only, locale, or offset variants.
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Strict ISO-8601 check: must match the canonical `toISOString()` shape
 * AND round-trip identically, which rejects impossible calendar dates
 * (e.g. month 13) that parse but canonicalize differently.
 */
function parseIsoDate(value: unknown, path: string): Date {
  if (typeof value !== 'string' || !ISO_8601_PATTERN.test(value)) {
    invalid(path, 'an ISO-8601 date-time string (YYYY-MM-DDTHH:mm:ss.sssZ)');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    invalid(path, 'a valid canonical ISO-8601 date-time');
  }
  return date;
}

function validatePersistedMatch(value: unknown): asserts value is Omit<PersistedMatch, 'date'> & { date: string } {
  if (!isRecord(value)) invalid('match', 'an object');
  requireString(value.id, 'id');
  requireString(value.fixtureId, 'fixtureId');
  requireString(value.seasonId, 'seasonId');
  requireString(value.leagueId, 'leagueId');
  requireString(value.date, 'date');
  if (typeof value.status !== 'string' || !MATCH_STATUSES.includes(value.status as MatchStatus)) {
    invalid('status', `one of ${MATCH_STATUSES.join(', ')}`);
  }
  requireString(value.homeClubId, 'homeClubId');
  requireString(value.awayClubId, 'awayClubId');
  requireNumber(value.homeScore, 'homeScore');
  requireNumber(value.awayScore, 'awayScore');
  validateTactics(value.homeTactics, 'homeTactics');
  validateTactics(value.awayTactics, 'awayTactics');
  validateStatsPair(value.stats, 'stats');
  requireNumber(value.seed, 'seed');
  if (!Array.isArray(value.participantIds) || value.participantIds.some((p) => typeof p !== 'string')) {
    invalid('participantIds', 'an array of strings');
  }
  if (!Array.isArray(value.events)) invalid('events', 'an array');
  value.events.forEach((event, i) => validateEvent(event, `events[${i}]`));
}

// ---------------------------------------------------------------------------
// Builder — detached, deterministic output
// ---------------------------------------------------------------------------

/**
 * Build a detached PersistedMatch from one simulated fixture result.
 *
 * - The returned model shares NO references with the inputs: tactics,
 *   stats, participantIds and every event field are cloned, so later
 *   mutations of inputs cannot leak into the model.
 * - `fixture.date` must be a valid Date or the call throws.
 * - Events are ordered by minute (stable — engine generation order is
 *   preserved for equal minutes) and receive deterministic unique ids:
 *   `<matchId>:<minute>:<type>:<occurrence>` where `occurrence` counts
 *   prior events with the same minute+type.
 * - Match id embeds league + season + fixture identity via a
 *   length-prefixed encoding so it cannot collide across seasons or
 *   leagues even when component ids contain delimiter characters (the
 *   DB `matches.id` is a global primary key and match history
 *   accumulates over a career).
 */
export function buildPersistedMatch(input: BuildPersistedMatchInput): PersistedMatch {
  const { fixture, season, league, homeClub, awayClub, result } = input;

  if (!(fixture.date instanceof Date) || Number.isNaN(fixture.date.getTime())) {
    throw new Error(
      `Cannot build persisted match for fixture ${fixture.id}: invalid fixture date`,
    );
  }

  // Referential integrity: refuse to build a match from mismatched
  // objects rather than silently persisting an inconsistent record.
  if (fixture.homeClubId !== homeClub.id) {
    throw new Error(
      `Cannot build persisted match for fixture ${fixture.id}: fixture.homeClubId '${fixture.homeClubId}' does not match home club '${homeClub.id}'`,
    );
  }
  if (fixture.awayClubId !== awayClub.id) {
    throw new Error(
      `Cannot build persisted match for fixture ${fixture.id}: fixture.awayClubId '${fixture.awayClubId}' does not match away club '${awayClub.id}'`,
    );
  }
  if (season.leagueId !== league.id) {
    throw new Error(
      `Cannot build persisted match for fixture ${fixture.id}: season.leagueId '${season.leagueId}' does not match league '${league.id}'`,
    );
  }
  if (!league.clubIds.includes(homeClub.id) || !league.clubIds.includes(awayClub.id)) {
    const missing = [homeClub.id, awayClub.id].filter((id) => !league.clubIds.includes(id));
    throw new Error(
      `Cannot build persisted match for fixture ${fixture.id}: club(s) ${missing.join(', ')} are not members of league '${league.id}'`,
    );
  }
  if (!league.fixtures.some((f) => f.id === fixture.id)) {
    throw new Error(
      `Cannot build persisted match: fixture '${fixture.id}' does not belong to league '${league.id}' fixtures`,
    );
  }

  const matchId = `match-${league.id.length}:${league.id}${season.id.length}:${season.id}${fixture.id.length}:${fixture.id}`;

  // Stable minute sort: canonical chronological order while preserving
  // the engine's generation order for events sharing a minute.
  const orderedEvents = [...result.events].sort((a, b) => a.minute - b.minute);

  const occurrenceCounts = new Map<string, number>();
  const events: PersistedMatchEvent[] = orderedEvents.map((event) => {
    const key = `${event.minute}:${event.type}`;
    const occurrence = occurrenceCounts.get(key) ?? 0;
    occurrenceCounts.set(key, occurrence + 1);

    return {
      id: `${matchId}:${event.minute}:${event.type}:${occurrence}`,
      minute: event.minute,
      type: event.type,
      primaryPlayerId: event.primaryPlayerId ?? null,
      secondaryPlayerId: event.secondaryPlayerId ?? null,
      team: event.team,
      clubId: event.team === 'home' ? homeClub.id : awayClub.id,
      description: event.description,
    };
  });

  return {
    id: matchId,
    fixtureId: fixture.id,
    seasonId: season.id,
    leagueId: league.id,
    date: new Date(fixture.date.getTime()),
    status: 'completed',
    homeClubId: homeClub.id,
    awayClubId: awayClub.id,
    homeScore: result.homeScore,
    awayScore: result.awayScore,
    homeTactics: JSON.parse(JSON.stringify(homeClub.tactics)) as ClubTactics,
    awayTactics: JSON.parse(JSON.stringify(awayClub.tactics)) as ClubTactics,
    stats: JSON.parse(JSON.stringify(result.stats)),
    seed: result.seed,
    participantIds: [...result.participantIds],
    events,
  };
}

// ---------------------------------------------------------------------------
// Canonical lossless serialization (explicit and reversible)
// ---------------------------------------------------------------------------

interface SerializedPersistedMatch extends Omit<PersistedMatch, 'date'> {
  date: string; // ISO-8601
}

export function serializePersistedMatch(match: PersistedMatch): string {
  const serialized: SerializedPersistedMatch = {
    ...match,
    date: match.date.toISOString(),
  };
  return JSON.stringify(serialized);
}

export function deserializePersistedMatch(json: string): PersistedMatch {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Invalid persisted match data: malformed JSON');
  }
  validatePersistedMatch(raw);

  const date = parseIsoDate(raw.date, 'date');

  return {
    ...raw,
    date,
    events: raw.events.map((event) => ({
      ...event,
      primaryPlayerId: event.primaryPlayerId ?? null,
      secondaryPlayerId: event.secondaryPlayerId ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// JSON field helpers (explicit, reversible, validated)
// ---------------------------------------------------------------------------

export function tacticsToJson(tactics: ClubTactics): string {
  return JSON.stringify(tactics);
}

export function tacticsFromJson(json: string): ClubTactics {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Invalid tactics JSON: malformed JSON');
  }
  validateTactics(raw, 'tactics');
  return raw;
}

export interface MatchStatsPair {
  home: MatchStats;
  away: MatchStats;
}

export function statsToJson(stats: MatchStatsPair): string {
  return JSON.stringify(stats);
}

export function statsFromJson(json: string): MatchStatsPair {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Invalid match stats JSON: malformed JSON');
  }
  validateStatsPair(raw, 'stats');
  return raw;
}

// ---------------------------------------------------------------------------
// Row mappers — current schema columns only (see incompatibility notes above)
// ---------------------------------------------------------------------------

/** Values for a `matches` table insert (Drizzle column names). */
export interface MatchDbRowValues {
  id: string;
  homeClubId: string;
  awayClubId: string;
  seasonId: string;
  /** Epoch milliseconds. */
  date: number;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  homeTactics: string;
  awayTactics: string;
  fixtureId: string;
  stats: string;
  seed: number;
  participantIds: string;
}

export function toMatchDbRow(match: PersistedMatch): MatchDbRowValues {
  return {
    id: match.id,
    homeClubId: match.homeClubId,
    awayClubId: match.awayClubId,
    seasonId: match.seasonId,
    date: match.date.getTime(),
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeTactics: tacticsToJson(match.homeTactics),
    awayTactics: tacticsToJson(match.awayTactics),
    fixtureId: match.fixtureId,
    stats: statsToJson(match.stats),
    seed: match.seed,
    participantIds: JSON.stringify(match.participantIds),
  };
}

/** Values for a `match_events` table insert (Drizzle column names). */
export interface MatchEventDbRowValues {
  id: string;
  matchId: string;
  minute: number;
  type: string;
  playerId: string | null;
  secondaryPlayerId: string | null;
  clubId: string;
  description: string;
}

/**
 * Map every event of a match to `match_events` rows. `team` has no column
 * — it is recovered at load time by comparing `clubId` with the match's
 * home/away club ids.
 */
export function toMatchEventDbRows(match: PersistedMatch): MatchEventDbRowValues[] {
  return match.events.map((event) => ({
    id: event.id,
    matchId: match.id,
    minute: event.minute,
    type: event.type,
    playerId: event.primaryPlayerId,
    secondaryPlayerId: event.secondaryPlayerId,
    clubId: event.clubId,
    description: event.description,
  }));
}

// ---------------------------------------------------------------------------
// Inverse mapping — DB rows back to the domain model
// ---------------------------------------------------------------------------

/** A `matches` row as returned by Drizzle (camelCase properties). */
export interface MatchDbRow {
  id: string;
  homeClubId: string;
  awayClubId: string;
  seasonId: string;
  /** Epoch milliseconds. */
  date: number;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  homeTactics: string;
  awayTactics: string;
  fixtureId: string | null;
  stats: string | null;
  seed: number | null;
  participantIds: string | null;
}

/** A `match_events` row as returned by Drizzle (camelCase properties). */
export interface MatchEventDbRow {
  id: string;
  matchId: string;
  minute: number;
  type: string;
  playerId: string | null;
  secondaryPlayerId: string | null;
  clubId: string;
  description: string;
}

const MATCH_ID_PREFIX = 'match-';

/**
 * Decode the length-prefixed `(leagueId, seasonId, fixtureId)` tuple
 * embedded in a deterministic match id, or return null if the id does
 * not follow the `buildPersistedMatch` encoding.
 */
export function decodeMatchId(
  id: string,
): { leagueId: string; seasonId: string; fixtureId: string } | null {
  if (!id.startsWith(MATCH_ID_PREFIX)) return null;
  const parts: string[] = [];
  let i = MATCH_ID_PREFIX.length;
  for (let n = 0; n < 3; n++) {
    const colon = id.indexOf(':', i);
    if (colon === -1) return null;
    const len = Number(id.slice(i, colon));
    if (!Number.isInteger(len) || len < 0) return null;
    const start = colon + 1;
    const end = start + len;
    if (end > id.length) return null;
    parts.push(id.slice(start, end));
    i = end;
  }
  if (i !== id.length) return null; // trailing garbage
  return { leagueId: parts[0], seasonId: parts[1], fixtureId: parts[2] };
}

interface EventRowSortKey {
  minute: number;
  id: string;
}

/**
 * Parsed `<minute>:<type>:<occurrence>` suffix of a deterministic event
 * id, or null when the id does not structurally end with three
 * colon-separated non-empty segments. Located from the END of the string
 * so ':' characters inside the length-prefixed match id are harmless.
 */
function parseEventIdSuffix(
  id: string,
): { minute: string; type: string; occurrence: string } | null {
  const occStart = id.lastIndexOf(':');
  if (occStart <= 0 || occStart === id.length - 1) return null;
  const typeEnd = occStart;
  const typeStart = id.lastIndexOf(':', typeEnd - 1);
  if (typeStart <= 0 || typeStart === typeEnd - 1) return null;
  const minuteEnd = typeStart;
  const minuteStart = id.lastIndexOf(':', minuteEnd - 1);
  if (minuteStart < 0 || minuteStart === minuteEnd - 1) return null;
  const minute = id.slice(minuteStart + 1, minuteEnd);
  const type = id.slice(typeStart + 1, typeEnd);
  const occurrence = id.slice(occStart + 1);
  if (minute === '' || type === '' || occurrence === '') return null;
  return { minute, type, occurrence };
}

/** Sort-key fields; compared lexicographically top to bottom. */
interface EventSortKey {
  minute: number;
  /** 0 = recognized deterministic suffix, 1 = unrecognized id. */
  category: 0 | 1;
  /** Event type for recognized ids; '' for unrecognized. */
  type: string;
  /** 0 = numeric occurrence, 1 = non-numeric occurrence, 2 = unrecognized. */
  occurrenceKind: 0 | 1 | 2;
  /** Numeric occurrence value (occurrenceKind 0 only). */
  occurrenceNum: number;
  /** Occurrence string for lexicographic comparison (occurrenceKind 1). */
  occurrenceStr: string;
  /** Full id — final deterministic tiebreak. */
  id: string;
}

/**
 * Build the total-order sort key for a persisted event row.
 *
 * A suffix is RECOGNIZED only when it is structurally valid AND its
 * embedded minute equals `row.minute` — an id whose minute disagrees
 * with the column is treated as unrecognized rather than trusted.
 * Nothing here throws: any malformed id degrades to the unrecognized
 * category.
 */
function eventSortKey(row: EventRowSortKey): EventSortKey {
  const suffix = parseEventIdSuffix(row.id);
  const minuteMatches =
    suffix !== null && /^\d+$/.test(suffix.minute) && Number(suffix.minute) === row.minute;

  if (suffix === null || !minuteMatches) {
    return {
      minute: row.minute,
      category: 1,
      type: '',
      occurrenceKind: 2,
      occurrenceNum: 0,
      occurrenceStr: '',
      id: row.id,
    };
  }

  const occNum = Number(suffix.occurrence);
  const numeric = /^\d+$/.test(suffix.occurrence) && Number.isSafeInteger(occNum);
  return {
    minute: row.minute,
    category: 0,
    type: suffix.type,
    occurrenceKind: numeric ? 0 : 1,
    occurrenceNum: numeric ? occNum : 0,
    occurrenceStr: numeric ? '' : suffix.occurrence,
    id: row.id,
  };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic TOTAL order for persisted match events — a lexicographic
 * comparison of a fixed-shape key, so it is transitive, antisymmetric and
 * stable for Array.prototype.sort():
 *
 * 1. `minute` ascending (chronological).
 * 2. Category: recognized deterministic ids before unrecognized ids.
 * 3. `type` lexicographic (recognized ids only).
 * 4. Occurrence: numeric occurrences (ascending) before non-numeric
 *    occurrences (lexicographic). This preserves the per-(minute, type)
 *    occurrence order produced by `buildPersistedMatch` — a plain
 *    lexicographic id sort would order 0, 1, 10, 11, 2, ...
 * 5. Full `id` lexicographic — final tiebreak, always defined.
 *
 * The engine's exact cross-type intra-minute generation order is NOT
 * persisted and is NOT restored; grouping by type is deterministic.
 */
export function compareMatchEventRows(a: EventRowSortKey, b: EventRowSortKey): number {
  const ka = eventSortKey(a);
  const kb = eventSortKey(b);

  if (ka.minute !== kb.minute) return ka.minute - kb.minute;
  if (ka.category !== kb.category) return ka.category - kb.category;
  if (ka.type !== kb.type) return compareStrings(ka.type, kb.type);
  if (ka.occurrenceKind !== kb.occurrenceKind) {
    return ka.occurrenceKind - kb.occurrenceKind;
  }
  if (ka.occurrenceKind === 0 && ka.occurrenceNum !== kb.occurrenceNum) {
    return ka.occurrenceNum - kb.occurrenceNum;
  }
  if (ka.occurrenceKind === 1) {
    const byOccurrence = compareStrings(ka.occurrenceStr, kb.occurrenceStr);
    if (byOccurrence !== 0) return byOccurrence;
  }
  return compareStrings(ka.id, kb.id);
}

function parseParticipantIds(json: string, matchId: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error(
      `Invalid persisted match data: matches.participant_ids for '${matchId}' is not valid JSON`,
    );
  }
  if (!Array.isArray(raw) || raw.some((p) => typeof p !== 'string')) {
    invalid(`matches.participant_ids for '${matchId}'`, 'a JSON array of strings');
  }
  return raw as string[];
}

/**
 * Rebuild a PersistedMatch from its DB rows, or return null when the row
 * predates migration v3 and lacks fixture_id/stats/seed/participant_ids.
 * Incomplete rows are NEVER backfilled with invented values — callers
 * decide how to treat them (the loader filters them out of the domain
 * collection while leaving the DB rows untouched).
 *
 * Event `team` is recovered by comparing the event's club_id with the
 * match's home/away club ids; a club_id matching neither is corruption
 * and throws. `secondaryPlayerId` NULL maps to null per the domain
 * contract.
 */
export function matchFromDbRows(
  matchRow: MatchDbRow,
  eventRows: MatchEventDbRow[],
): PersistedMatch | null {
  if (
    matchRow.fixtureId === null ||
    matchRow.fixtureId === undefined ||
    matchRow.stats === null ||
    matchRow.stats === undefined ||
    matchRow.seed === null ||
    matchRow.seed === undefined ||
    matchRow.participantIds === null ||
    matchRow.participantIds === undefined
  ) {
    return null;
  }

  if (typeof matchRow.status !== 'string' || !MATCH_STATUSES.includes(matchRow.status as MatchStatus)) {
    invalid(`matches.status for '${matchRow.id}'`, `one of ${MATCH_STATUSES.join(', ')}`);
  }
  if (matchRow.homeScore === null || matchRow.awayScore === null) {
    invalid(`matches scores for '${matchRow.id}'`, 'non-null numbers for a completed match');
  }

  const events: PersistedMatchEvent[] = eventRows.map((row, i) => {
    const team =
      row.clubId === matchRow.homeClubId
        ? 'home'
        : row.clubId === matchRow.awayClubId
          ? 'away'
          : null;
    if (team === null) {
      invalid(
        `match_events[${i}].clubId for '${row.id}'`,
        `the home or away club id of match '${matchRow.id}'`,
      );
    }
    const event: PersistedMatchEvent = {
      id: row.id,
      minute: row.minute,
      type: row.type as EventType,
      primaryPlayerId: row.playerId,
      secondaryPlayerId: row.secondaryPlayerId,
      team,
      clubId: row.clubId,
      description: row.description,
    };
    validateEvent(event, `match_events[${i}] for '${row.id}'`);
    return event;
  });

  const date = new Date(matchRow.date);
  if (Number.isNaN(date.getTime())) {
    invalid(`matches.date for '${matchRow.id}'`, 'a valid epoch-milliseconds timestamp');
  }

  // leagueId has no column: it is recovered from the deterministic match
  // id, which is cross-checked against the stored season/fixture ids —
  // a mismatch means the row is corrupt, not merely incomplete.
  const decoded = decodeMatchId(matchRow.id);
  if (
    decoded === null ||
    decoded.seasonId !== matchRow.seasonId ||
    decoded.fixtureId !== matchRow.fixtureId
  ) {
    invalid(
      `matches.id for '${matchRow.id}'`,
      'a deterministic match id consistent with season_id and fixture_id',
    );
  }

  const match: PersistedMatch = {
    id: matchRow.id,
    fixtureId: matchRow.fixtureId,
    seasonId: matchRow.seasonId,
    leagueId: decoded.leagueId,
    date,
    status: matchRow.status as MatchStatus,
    homeClubId: matchRow.homeClubId,
    awayClubId: matchRow.awayClubId,
    homeScore: matchRow.homeScore,
    awayScore: matchRow.awayScore,
    homeTactics: tacticsFromJson(matchRow.homeTactics),
    awayTactics: tacticsFromJson(matchRow.awayTactics),
    stats: statsFromJson(matchRow.stats),
    seed: matchRow.seed,
    participantIds: parseParticipantIds(matchRow.participantIds, matchRow.id),
    events,
  };
  return match;
}
