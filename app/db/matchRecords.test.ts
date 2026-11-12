import {
  buildPersistedMatch,
  compareMatchEventRows,
  deserializePersistedMatch,
  matchFromDbRows,
  serializePersistedMatch,
  statsFromJson,
  statsToJson,
  tacticsFromJson,
  tacticsToJson,
  toMatchDbRow,
  toMatchEventDbRows,
  type BuildPersistedMatchInput,
  type MatchDbRow,
  type MatchEventDbRow,
  type PersistedMatch,
} from './matchRecords';
import type {
  Club,
  Fixture,
  League,
  MatchResult,
  Season,
} from '@club-director/shared-types';

function buildClub(id: string): Club {
  return {
    id,
    name: `Club ${id}`,
    nickname: `C${id}`,
    foundedYear: 2000,
    reputation: 70,
    finances: {
      balance: 10_000_000,
      transferBudget: 5_000_000,
      wageBudget: 500_000,
      weeklyIncome: 100_000,
    },
    squad: ['p1', 'p2'],
    stadium: { name: 'Stadium', capacity: 30_000 },
    tactics: {
      defaultFormation: '4-4-2',
      mentality: 'balanced',
      pressingIntensity: 10,
      tempo: 10,
      width: 10,
    },
  };
}

function buildInput(overrides?: {
  events?: MatchResult['events'];
  fixtureId?: string;
}): BuildPersistedMatchInput {
  const fixture: Fixture = {
    id: overrides?.fixtureId ?? 'fixture-7',
    homeClubId: 'club-home',
    awayClubId: 'club-away',
    week: 3,
    date: new Date('2024-08-15T14:00:00.000Z'),
    played: true,
    homeScore: 2,
    awayScore: 1,
  };

  const season: Season = {
    id: 'season-1',
    leagueId: 'league-1',
    currentWeek: 4,
    currentDate: new Date('2024-08-22'),
    transferWindowOpen: true,
    fixturesCalendar: [],
  };

  const league: League = {
    id: 'league-1',
    name: 'Test League',
    tier: 1,
    clubIds: ['club-home', 'club-away'],
    standings: { entries: [] },
    fixtures: [fixture],
  };

  const result: MatchResult = {
    homeScore: 2,
    awayScore: 1,
    events: overrides?.events ?? [
      {
        id: 'event-12-goal',
        minute: 12,
        type: 'goal',
        primaryPlayerId: 'p9',
        secondaryPlayerId: 'p4',
        team: 'home',
        description: 'GOAL! p9 scores!',
      },
      {
        id: 'event-55-save',
        minute: 55,
        type: 'save',
        primaryPlayerId: 'gk1',
        secondaryPlayerId: 'p7',
        team: 'away',
        description: 'gk1 makes a save from p7',
      },
    ],
    stats: {
      home: {
        possession: 58,
        shots: 14,
        shotsOnTarget: 6,
        corners: 7,
        fouls: 9,
        yellowCards: 2,
        redCards: 0,
      },
      away: {
        possession: 42,
        shots: 8,
        shotsOnTarget: 4,
        corners: 3,
        fouls: 11,
        yellowCards: 1,
        redCards: 0,
      },
    },
    seed: 123456789,
    participantIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11'],
  };

  return {
    fixture,
    season,
    league,
    homeClub: buildClub('club-home'),
    awayClub: buildClub('club-away'),
    result,
  };
}

describe('buildPersistedMatch', () => {
  it('preserves the complete match identity and result', () => {
    const match = buildPersistedMatch(buildInput());

    expect(match.id).toBe('match-8:league-18:season-19:fixture-7');
    expect(match.fixtureId).toBe('fixture-7');
    expect(match.seasonId).toBe('season-1');
    expect(match.leagueId).toBe('league-1');
    expect(match.date).toEqual(new Date('2024-08-15T14:00:00.000Z'));
    expect(match.status).toBe('completed');
    expect(match.homeClubId).toBe('club-home');
    expect(match.awayClubId).toBe('club-away');
    expect(match.homeScore).toBe(2);
    expect(match.awayScore).toBe(1);
    expect(match.homeTactics).toEqual(buildClub('club-home').tactics);
    expect(match.awayTactics).toEqual(buildClub('club-away').tactics);
    expect(match.stats.home.possession).toBe(58);
    expect(match.stats.away.shots).toBe(8);
    expect(match.seed).toBe(123456789);
    expect(match.participantIds).toHaveLength(22);
  });

  it('resolves event clubId from the team side', () => {
    const match = buildPersistedMatch(buildInput());

    expect(match.events[0].clubId).toBe('club-home'); // team: 'home'
    expect(match.events[1].clubId).toBe('club-away'); // team: 'away'
    expect(match.events[0].team).toBe('home');
    expect(match.events[1].team).toBe('away');
  });

  it('preserves primary and secondary player ids', () => {
    const match = buildPersistedMatch(buildInput());

    expect(match.events[0].primaryPlayerId).toBe('p9');
    expect(match.events[0].secondaryPlayerId).toBe('p4');
    expect(match.events[1].secondaryPlayerId).toBe('p7');
  });

  it('maps absent player ids to null', () => {
    const match = buildPersistedMatch(
      buildInput({
        events: [
          {
            id: 'event-1-corner',
            minute: 1,
            type: 'corner',
            primaryPlayerId: 'p1',
            team: 'home',
            description: 'Corner',
          },
        ],
      }),
    );

    expect(match.events[0].secondaryPlayerId).toBeNull();
  });

  it('handles an empty event list', () => {
    const match = buildPersistedMatch(buildInput({ events: [] }));
    expect(match.events).toEqual([]);
  });

  it('produces unique deterministic event ids for same minute+type collisions', () => {
    const events: MatchResult['events'] = [
      { id: 'event-34-goal', minute: 34, type: 'goal', primaryPlayerId: 'a', team: 'home', description: 'g1' },
      { id: 'event-34-goal', minute: 34, type: 'goal', primaryPlayerId: 'b', team: 'home', description: 'g2' },
      { id: 'event-34-goal', minute: 34, type: 'goal', primaryPlayerId: 'c', team: 'away', description: 'g3' },
      { id: 'event-34-save', minute: 34, type: 'save', primaryPlayerId: 'd', secondaryPlayerId: 'e', team: 'away', description: 's1' },
      { id: 'event-34-save', minute: 34, type: 'save', primaryPlayerId: 'f', team: 'home', description: 's2' },
    ];

    const matchA = buildPersistedMatch(buildInput({ events }));
    const matchB = buildPersistedMatch(buildInput({ events }));

    const idsA = matchA.events.map((e) => e.id);
    expect(new Set(idsA).size).toBe(idsA.length); // all unique
    expect(idsA).toEqual(matchB.events.map((e) => e.id)); // deterministic

    // Same fixture → same match id embedded in event ids.
    expect(idsA[0]).toContain('match-8:league-18:season-19:fixture-7');
    expect(idsA[0]).not.toBe(idsA[1]);
    expect(idsA[1]).not.toBe(idsA[2]);
    expect(idsA[3]).not.toBe(idsA[4]);
  });

  it('produces different event ids for different fixtures', () => {
    const events: MatchResult['events'] = [
      { id: 'event-10-goal', minute: 10, type: 'goal', primaryPlayerId: 'a', team: 'home', description: 'g' },
    ];
    const matchA = buildPersistedMatch(buildInput({ events, fixtureId: 'fixture-1' }));
    const matchB = buildPersistedMatch(buildInput({ events, fixtureId: 'fixture-2' }));

    expect(matchA.events[0].id).not.toBe(matchB.events[0].id);
    expect(matchA.id).not.toBe(matchB.id);
  });
});

describe('canonical serialization', () => {
  it('round-trips a PersistedMatch losslessly', () => {
    const match = buildPersistedMatch(buildInput());
    const restored = deserializePersistedMatch(serializePersistedMatch(match));

    expect(restored).toEqual(match);
    expect(restored.date).toBeInstanceOf(Date);
    expect(restored.date.getTime()).toBe(match.date.getTime());
  });

  it('round-trips an empty-events match', () => {
    const match = buildPersistedMatch(buildInput({ events: [] }));
    const restored = deserializePersistedMatch(serializePersistedMatch(match));
    expect(restored).toEqual(match);
  });

  it('serializes the date explicitly as ISO-8601', () => {
    const match = buildPersistedMatch(buildInput());
    const raw = JSON.parse(serializePersistedMatch(match));
    expect(raw.date).toBe('2024-08-15T14:00:00.000Z');
  });

  it('rejects a payload with an invalid date', () => {
    const match = buildPersistedMatch(buildInput());
    const raw = JSON.parse(serializePersistedMatch(match));
    raw.date = 'not-a-date';
    expect(() => deserializePersistedMatch(JSON.stringify(raw))).toThrow(
      /date/,
    );
  });
});

describe('JSON field helpers', () => {
  it('round-trips tactics', () => {
    const tactics = buildClub('x').tactics;
    expect(tacticsFromJson(tacticsToJson(tactics))).toEqual(tactics);
  });

  it('round-trips match stats', () => {
    const match = buildPersistedMatch(buildInput());
    const stats = { home: match.stats.home, away: match.stats.away };
    expect(statsFromJson(statsToJson(stats))).toEqual(stats);
  });
});

describe('DB row mapping', () => {
  it('maps match fields to matches-table values with epoch-ms date', () => {
    const match = buildPersistedMatch(buildInput());
    const row = toMatchDbRow(match);

    expect(row).toEqual({
      id: 'match-8:league-18:season-19:fixture-7',
      homeClubId: 'club-home',
      awayClubId: 'club-away',
      seasonId: 'season-1',
      date: new Date('2024-08-15T14:00:00.000Z').getTime(),
      status: 'completed',
      homeScore: 2,
      awayScore: 1,
      homeTactics: tacticsToJson(match.homeTactics),
      awayTactics: tacticsToJson(match.awayTactics),
      fixtureId: 'fixture-7',
      stats: statsToJson(match.stats),
      seed: 123456789,
      participantIds: JSON.stringify(match.participantIds),
    });
  });

  it('maps events to match_events-table values', () => {
    const match = buildPersistedMatch(buildInput());
    const rows = toMatchEventDbRows(match);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: match.events[0].id,
      matchId: 'match-8:league-18:season-19:fixture-7',
      minute: 12,
      type: 'goal',
      playerId: 'p9',
      secondaryPlayerId: 'p4',
      clubId: 'club-home',
      description: 'GOAL! p9 scores!',
    });
    expect(rows[1].playerId).toBe('gk1');
    expect(rows[1].secondaryPlayerId).toBe('p7');
    expect(rows[1].clubId).toBe('club-away');
  });

  it('keeps null player ids null in rows', () => {
    const match = buildPersistedMatch(
      buildInput({
        events: [
          {
            id: 'e1',
            minute: 5,
            type: 'foul',
            primaryPlayerId: undefined as unknown as string,
            team: 'home',
            description: 'Foul',
          },
        ],
      }),
    );
    const rows = toMatchEventDbRows(match);
    expect(rows[0].playerId).toBeNull();
    expect(rows[0].secondaryPlayerId).toBeNull();
  });
});

describe('matchFromDbRows', () => {
  function dbRowsFor(match: PersistedMatch) {
    return {
      matchRow: toMatchDbRow(match) as MatchDbRow,
      eventRows: toMatchEventDbRows(match) as MatchEventDbRow[],
    };
  }

  it('rebuilds a PersistedMatch losslessly from its rows', () => {
    const match = buildPersistedMatch(buildInput());
    const { matchRow, eventRows } = dbRowsFor(match);
    const restored = matchFromDbRows(matchRow, eventRows);

    expect(restored).toEqual(match);
    expect(restored!.date).toBeInstanceOf(Date);
  });

  it('round-trips through real serialization helpers', () => {
    const match = buildPersistedMatch(buildInput());
    const row = toMatchDbRow(match);
    // Simulate the actual DB storage format: JSON strings for tactics,
    // stats and participant_ids (already produced by the row mapper).
    const restored = matchFromDbRows(row as MatchDbRow, toMatchEventDbRows(match) as MatchEventDbRow[]);
    expect(restored).toEqual(match);
  });

  it('returns null for pre-v3 rows with NULL persistence columns', () => {
    const match = buildPersistedMatch(buildInput());
    const { matchRow, eventRows } = dbRowsFor(match);

    for (const field of ['fixtureId', 'stats', 'seed', 'participantIds'] as const) {
      const legacyRow = { ...matchRow, [field]: null };
      expect(matchFromDbRows(legacyRow, eventRows)).toBeNull();
    }
  });

  it('recovers team from clubId and maps NULL secondary_player_id to null', () => {
    const match = buildPersistedMatch(
      buildInput({
        events: [
          {
            id: 'e1',
            minute: 30,
            type: 'save',
            primaryPlayerId: 'gk',
            team: 'away',
            description: 'save',
          },
        ],
      }),
    );
    const { matchRow, eventRows } = dbRowsFor(match);
    const restored = matchFromDbRows(matchRow, eventRows)!;

    expect(restored.events[0].team).toBe('away');
    expect(restored.events[0].clubId).toBe('club-away');
    expect(restored.events[0].secondaryPlayerId).toBeNull();
  });

  it('throws when an event clubId matches neither match club', () => {
    const match = buildPersistedMatch(buildInput());
    const { matchRow, eventRows } = dbRowsFor(match);
    const badEvents = [{ ...eventRows[0], clubId: 'club-stranger' }];
    expect(() => matchFromDbRows(matchRow, badEvents)).toThrow(/clubId/);
  });

  it('throws when the match id is inconsistent with stored columns', () => {
    const match = buildPersistedMatch(buildInput());
    const { matchRow, eventRows } = dbRowsFor(match);
    const corrupt = { ...matchRow, fixtureId: 'fixture-other' };
    expect(() => matchFromDbRows(corrupt, eventRows)).toThrow(/matches\.id/);
  });

  it('recovers leagueId from the deterministic match id', () => {
    const match = buildPersistedMatch(buildInput());
    const { matchRow, eventRows } = dbRowsFor(match);
    const restored = matchFromDbRows(matchRow, eventRows)!;
    expect(restored.leagueId).toBe('league-1');
    expect(restored.fixtureId).toBe('fixture-7');
    expect(restored.seasonId).toBe('season-1');
  });
});

describe('event ordering contract', () => {
  const unsortedEvents: MatchResult['events'] = [
    { id: 'e3', minute: 70, type: 'goal', primaryPlayerId: 'c', team: 'away', description: 'late goal' },
    { id: 'e1', minute: 10, type: 'corner', primaryPlayerId: 'a', team: 'home', description: 'early corner' },
    { id: 'e2', minute: 10, type: 'goal', primaryPlayerId: 'b', team: 'home', description: 'early goal' },
    { id: 'e4', minute: 10, type: 'injury', primaryPlayerId: 'd', team: 'away', description: 'early injury' },
  ];

  it('orders events by minute while preserving engine order within a minute', () => {
    const match = buildPersistedMatch(buildInput({ events: unsortedEvents }));

    expect(match.events.map((e) => e.minute)).toEqual([10, 10, 10, 70]);
    // Within minute 10, the input (engine) order is preserved: corner,
    // goal, injury — the stable sort does not reorder equal minutes.
    expect(match.events.slice(0, 3).map((e) => e.type)).toEqual([
      'corner',
      'goal',
      'injury',
    ]);
  });

  it('keeps event ids unique under input permutation; ids reproduce only for identical ordered input', () => {
    const matchA = buildPersistedMatch(buildInput({ events: unsortedEvents }));
    const reversed = [...unsortedEvents].reverse();
    const matchB = buildPersistedMatch(buildInput({ events: reversed }));

    const idsA = matchA.events.map((e) => e.id);
    const idsB = matchB.events.map((e) => e.id);
    expect(new Set(idsA).size).toBe(idsA.length);
    expect(new Set(idsB).size).toBe(idsB.length);

    // Both outputs are chronologically ordered by minute; equal-minute
    // events keep their respective INPUT order (stable sort), so the
    // reversed input yields a different equal-minute ordering — this is
    // expected: occurrence suffixes follow input order, ids stay unique
    // but are only reproducible for identical ordered input.
    expect(matchB.events.map((e) => e.minute)).toEqual(
      matchA.events.map((e) => e.minute),
    );
    expect(matchB.events.map((e) => e.type)).not.toEqual(
      matchA.events.map((e) => e.type),
    );
    // Identical ordered input → identical ids (reproducibility).
    const matchC = buildPersistedMatch(buildInput({ events: unsortedEvents }));
    expect(matchC.events.map((e) => e.id)).toEqual(idsA);
  });
});

describe('match id uniqueness', () => {
  it('differs across seasons and leagues even with identical fixture ids', () => {
    const base = buildInput();
    const sameFixtureDifferentSeason = buildPersistedMatch({
      ...base,
      season: { ...base.season, id: 'season-2' },
    });
    const sameFixtureDifferentLeague = buildPersistedMatch({
      ...base,
      league: { ...base.league, id: 'league-2' },
      season: { ...base.season, leagueId: 'league-2' },
    });
    const baseMatch = buildPersistedMatch(base);

    const ids = new Set([
      baseMatch.id,
      sameFixtureDifferentSeason.id,
      sameFixtureDifferentLeague.id,
    ]);
    expect(ids.size).toBe(3);

    // Event ids embed the match id, so they are unique too.
    const eventIds = [
      ...baseMatch.events.map((e) => e.id),
      ...sameFixtureDifferentSeason.events.map((e) => e.id),
      ...sameFixtureDifferentLeague.events.map((e) => e.id),
    ];
    expect(new Set(eventIds).size).toBe(eventIds.length);
  });

  it('cannot collide when id components contain the delimiter', () => {
    // Length-prefixed encoding: "a-b"/"c"/"d" and "a"/"b-c"/"d" are
    // distinct tuples that a naive `a-b-c-d` join would collapse.
    const base = buildInput();
    const fixtureD = { ...base.fixture, id: 'd' };
    const match1 = buildPersistedMatch({
      ...base,
      league: { ...base.league, id: 'a-b', fixtures: [fixtureD] },
      season: { ...base.season, id: 'c', leagueId: 'a-b' },
      fixture: fixtureD,
    });
    const match2 = buildPersistedMatch({
      ...base,
      league: { ...base.league, id: 'a', fixtures: [fixtureD] },
      season: { ...base.season, id: 'b-c', leagueId: 'a' },
      fixture: fixtureD,
    });

    expect(match1.id).not.toBe(match2.id);
    expect(match1.id).toBe('match-3:a-b1:c1:d');
    expect(match2.id).toBe('match-1:a3:b-c1:d');

    const eventIds = [
      ...match1.events.map((e) => e.id),
      ...match2.events.map((e) => e.id),
    ];
    expect(new Set(eventIds).size).toBe(eventIds.length);
  });
});

describe('deserializer validation', () => {
  const validMatch = buildPersistedMatch(buildInput());
  const validJson = serializePersistedMatch(validMatch);

  function mutate(fn: (raw: Record<string, unknown>) => void): string {
    const raw = JSON.parse(validJson) as Record<string, unknown>;
    fn(raw);
    return JSON.stringify(raw);
  }

  it('rejects malformed JSON', () => {
    expect(() => deserializePersistedMatch('{not json')).toThrow(
      /malformed JSON/,
    );
  });

  it('rejects a non-object payload', () => {
    expect(() => deserializePersistedMatch('42')).toThrow(/must be an object/);
    expect(() => deserializePersistedMatch('null')).toThrow(/must be an object/);
  });

  it('rejects missing or wrongly-typed identity fields', () => {
    for (const field of ['id', 'fixtureId', 'seasonId', 'leagueId', 'homeClubId', 'awayClubId']) {
      expect(() => deserializePersistedMatch(mutate((r) => delete r[field]))).toThrow(
        new RegExp(field),
      );
      expect(() =>
        deserializePersistedMatch(mutate((r) => { r[field] = 123; })),
      ).toThrow(new RegExp(field));
    }
  });

  it('rejects non-ISO-8601 and invalid-calendar dates', () => {
    const badDates = [
      'not-a-date',
      1723713600000, // epoch number, not a string
      '2024-08-15', // date-only
      '15/08/2024', // locale style
      'August 15, 2024', // locale style
      '2024-08-15 14:00:00', // parseable but not ISO T/Z format
      '2024-08-15T14:00:00+02:00', // offset variant, not canonical Z
      '2024-13-40T25:61:61.999Z', // invalid calendar fields
      '2024-02-30T10:00:00.000Z', // Feb 30 does not exist
      '2024-08-15T14:00:00Z', // missing milliseconds
    ];
    for (const date of badDates) {
      expect(() =>
        deserializePersistedMatch(mutate((r) => { r.date = date; })),
      ).toThrow(/date/);
    }
  });

  it('rejects an invalid status', () => {
    expect(() =>
      deserializePersistedMatch(mutate((r) => { r.status = 'finished'; })),
    ).toThrow(/status/);
  });

  it('rejects non-numeric scores and seed', () => {
    expect(() =>
      deserializePersistedMatch(mutate((r) => { r.homeScore = '2'; })),
    ).toThrow(/homeScore/);
    expect(() =>
      deserializePersistedMatch(mutate((r) => { r.seed = 'abc'; })),
    ).toThrow(/seed/);
  });

  it('rejects malformed tactics', () => {
    expect(() =>
      deserializePersistedMatch(mutate((r) => { r.homeTactics = 'x'; })),
    ).toThrow(/homeTactics/);
    expect(() =>
      deserializePersistedMatch(
        mutate((r) => {
          (r.homeTactics as Record<string, unknown>).mentality = 'wild';
        }),
      ),
    ).toThrow(/mentality/);
    expect(() =>
      deserializePersistedMatch(
        mutate((r) => {
          (r.homeTactics as Record<string, unknown>).tempo = 'fast';
        }),
      ),
    ).toThrow(/tempo/);
    expect(() =>
      deserializePersistedMatch(
        mutate((r) => {
          (r.homeTactics as Record<string, unknown>).defaultFormation = '9-9-9';
        }),
      ),
    ).toThrow(/defaultFormation/);
  });

  it('rejects malformed stats', () => {
    expect(() =>
      deserializePersistedMatch(mutate((r) => { r.stats = []; })),
    ).toThrow(/stats/);
    expect(() =>
      deserializePersistedMatch(
        mutate((r) => {
          ((r.stats as Record<string, Record<string, unknown>>).home).shots = 'many';
        }),
      ),
    ).toThrow(/shots/);
    expect(() =>
      deserializePersistedMatch(
        mutate((r) => { delete (r.stats as Record<string, unknown>).away; }),
      ),
    ).toThrow(/away/);
  });

  it('rejects a non-array or non-string participantIds', () => {
    expect(() =>
      deserializePersistedMatch(mutate((r) => { r.participantIds = 'p1'; })),
    ).toThrow(/participantIds/);
    expect(() =>
      deserializePersistedMatch(mutate((r) => { r.participantIds = ['p1', 7]; })),
    ).toThrow(/participantIds/);
  });

  it('rejects malformed events', () => {
    expect(() =>
      deserializePersistedMatch(mutate((r) => { r.events = 'none'; })),
    ).toThrow(/events/);
    expect(() =>
      deserializePersistedMatch(
        mutate((r) => {
          (r.events as unknown[])[0] = { id: 'x' };
        }),
      ),
    ).toThrow(/events\[0\]/);
    expect(() =>
      deserializePersistedMatch(
        mutate((r) => {
          ((r.events as Record<string, unknown>[])[0]).team = 'neutral';
        }),
      ),
    ).toThrow(/team/);
    expect(() =>
      deserializePersistedMatch(
        mutate((r) => {
          ((r.events as Record<string, unknown>[])[0]).type = 'teleport';
        }),
      ),
    ).toThrow(/type/);
    expect(() =>
      deserializePersistedMatch(
        mutate((r) => {
          ((r.events as Record<string, unknown>[])[0]).primaryPlayerId = 42;
        }),
      ),
    ).toThrow(/primaryPlayerId/);
  });

  it('accepts null player ids in events', () => {
    const restored = deserializePersistedMatch(
      mutate((r) => {
        ((r.events as Record<string, unknown>[])[0]).primaryPlayerId = null;
        ((r.events as Record<string, unknown>[])[0]).secondaryPlayerId = null;
      }),
    );
    expect(restored.events[0].primaryPlayerId).toBeNull();
    expect(restored.events[0].secondaryPlayerId).toBeNull();
  });
});

describe('JSON helper validation', () => {
  it('rejects malformed tactics JSON', () => {
    expect(() => tacticsFromJson('{oops')).toThrow(/malformed JSON/);
    expect(() => tacticsFromJson('"str"')).toThrow(/tactics/);
    expect(() => tacticsFromJson('{"mentality":"wild"}')).toThrow(/tactics/);
    expect(() => tacticsFromJson('{"pressingIntensity":"high"}')).toThrow(/tactics/);
  });

  it('rejects malformed stats JSON', () => {
    expect(() => statsFromJson('{oops')).toThrow(/malformed JSON/);
    expect(() => statsFromJson('{"home":{}}')).toThrow(/stats/);
    expect(() =>
      statsFromJson('{"home":{"possession":1,"shots":2,"shotsOnTarget":1,"corners":0,"fouls":0,"yellowCards":0,"redCards":0},"away":{"possession":"x"}}'),
    ).toThrow(/stats/);
  });
});

describe('builder input validation and detachment', () => {
  it('rejects an invalid fixture date', () => {
    const input = buildInput();
    input.fixture = { ...input.fixture, date: new Date('invalid') };
    expect(() => buildPersistedMatch(input)).toThrow(/invalid fixture date/);

    const input2 = buildInput();
    input2.fixture = { ...input2.fixture, date: '2024-08-15' as unknown as Date };
    expect(() => buildPersistedMatch(input2)).toThrow(/invalid fixture date/);
  });

  it('is not affected by later mutations of the input objects', () => {
    const input = buildInput();
    const match = buildPersistedMatch(input);

    // Mutate every shared-reference source after construction.
    input.homeClub.tactics.mentality = 'attacking';
    input.awayClub.tactics.tempo = 99;
    input.result.stats.home.possession = 99;
    input.result.stats.away.shots = 99;
    input.result.participantIds.push('injected');
    input.fixture.date = new Date('1999-01-01');

    expect(match.homeTactics.mentality).toBe('balanced');
    expect(match.awayTactics.tempo).toBe(10);
    expect(match.stats.home.possession).toBe(58);
    expect(match.stats.away.shots).toBe(8);
    expect(match.participantIds).toHaveLength(22);
    expect(match.participantIds).not.toContain('injected');
    expect(match.date).toEqual(new Date('2024-08-15T14:00:00.000Z'));
  });
});

describe('referential integrity', () => {
  it('builds successfully for a consistent input', () => {
    const match = buildPersistedMatch(buildInput());
    expect(match.fixtureId).toBe('fixture-7');
    expect(match.homeClubId).toBe('club-home');
    expect(match.awayClubId).toBe('club-away');
  });

  it('rejects a fixture whose homeClubId does not match the home club', () => {
    const input = buildInput();
    input.fixture = { ...input.fixture, homeClubId: 'club-other' };
    expect(() => buildPersistedMatch(input)).toThrow(
      /fixture\.homeClubId 'club-other' does not match home club 'club-home'/,
    );
  });

  it('rejects a fixture whose awayClubId does not match the away club', () => {
    const input = buildInput();
    input.fixture = { ...input.fixture, awayClubId: 'club-other' };
    expect(() => buildPersistedMatch(input)).toThrow(
      /fixture\.awayClubId 'club-other' does not match away club 'club-away'/,
    );
  });

  it('rejects a season whose leagueId does not match the league', () => {
    const input = buildInput();
    input.season = { ...input.season, leagueId: 'league-other' };
    expect(() => buildPersistedMatch(input)).toThrow(
      /season\.leagueId 'league-other' does not match league 'league-1'/,
    );
  });

  it('rejects clubs that are not members of the league', () => {
    const input = buildInput();
    input.league = { ...input.league, clubIds: ['club-home'] };
    expect(() => buildPersistedMatch(input)).toThrow(
      /club\(s\) club-away are not members of league 'league-1'/,
    );
  });

  it('rejects multiple non-member clubs in the error', () => {
    const input = buildInput();
    input.league = { ...input.league, clubIds: [] };
    expect(() => buildPersistedMatch(input)).toThrow(
      /club-home, club-away/,
    );
  });

  it('rejects a fixture that does not belong to the league fixtures', () => {
    const input = buildInput();
    input.league = { ...input.league, fixtures: [] };
    expect(() => buildPersistedMatch(input)).toThrow(
      /fixture 'fixture-7' does not belong to league 'league-1'/,
    );
  });

describe('compareMatchEventRows', () => {
  const mid = 'match-8:league-18:season-19:fixture-7';
  const ev = (minute: number, type: string, occ: number | string) => ({
    minute,
    id: `${mid}:${minute}:${type}:${occ}`,
  });

  it('orders numeric occurrences numerically, not lexicographically', () => {
    const rows = [ev(30, 'goal', 10), ev(30, 'goal', 2), ev(30, 'goal', 1), ev(30, 'goal', 11), ev(30, 'goal', 0)];
    const sorted = [...rows].sort(compareMatchEventRows);
    expect(sorted.map((r) => r.id.split(':').pop())).toEqual(['0', '1', '2', '10', '11']);
  });

  it('keeps chronological order across minutes', () => {
    const rows = [ev(90, 'goal', 0), ev(10, 'goal', 0), ev(45, 'goal', 0)];
    const sorted = [...rows].sort(compareMatchEventRows);
    expect(sorted.map((r) => r.minute)).toEqual([10, 45, 90]);
  });

  it('groups different types deterministically within the same minute', () => {
    const rows = [ev(30, 'injury', 0), ev(30, 'goal', 0), ev(30, 'corner', 0)];
    const sorted = [...rows].sort(compareMatchEventRows);
    expect(sorted.map((r) => r.id)).toEqual([
      `${mid}:30:corner:0`,
      `${mid}:30:goal:0`,
      `${mid}:30:injury:0`,
    ]);
  });

  it('orders non-numeric occurrences lexicographically after numeric ones', () => {
    const rows = [
      ev(30, 'goal', 'b'),
      ev(30, 'goal', 2),
      ev(30, 'goal', 'a'),
      ev(30, 'goal', 10),
      ev(30, 'goal', 1),
    ];
    const sorted = [...rows].sort(compareMatchEventRows);
    expect(sorted.map((r) => r.id.split(':').pop())).toEqual(['1', '2', '10', 'a', 'b']);
  });

  it('treats ids with fewer than three trailing segments as unrecognized', () => {
    const rows = [
      { minute: 5, id: 'legacy-event' },
      { minute: 5, id: 'a:b' },
      ev(5, 'goal', 0),
      { minute: 5, id: 'x:y:z' }, // three segments but minute 'y' is not numeric/matching
    ];
    const sorted = [...rows].sort(compareMatchEventRows);
    expect(sorted).toHaveLength(4);
    // The recognized id sorts before all unrecognized ones at minute 5.
    expect(sorted[0].id).toBe(`${mid}:5:goal:0`);
    // Deterministic: same input → same output.
    const again = [...rows].sort(compareMatchEventRows);
    expect(again.map((r) => r.id)).toEqual(sorted.map((r) => r.id));
  });

  it('treats an id whose embedded minute disagrees with the column as unrecognized', () => {
    const rows = [
      { minute: 30, id: `${mid}:10:goal:0` }, // says minute 10, column says 30
      ev(30, 'goal', 0),
      { minute: 30, id: `${mid}:30:goal:0` },
    ];
    const sorted = [...rows].sort(compareMatchEventRows);
    // Both well-formed minute-30 ids come before the mismatched one.
    expect(sorted.map((r) => r.id)).toEqual([
      `${mid}:30:goal:0`,
      `${mid}:30:goal:0`,
      `${mid}:10:goal:0`,
    ]);
  });

  it('is a total order: transitive, antisymmetric and deterministic on a mixed set', () => {
    const rows = [
      ev(30, 'goal', 10),
      { minute: 30, id: 'legacy-x' },
      ev(30, 'goal', 2),
      { minute: 5, id: 'other:5:save:0' },
      ev(30, 'injury', 'zz'),
      { minute: 30, id: `${mid}:30:goal:abc` },
      ev(30, 'goal', 1),
      { minute: 30, id: `${mid}:30:goal:10` }, // duplicate id, different object
      ev(45, 'corner', 0),
      { minute: 30, id: 'plain' },
      ev(30, 'goal', 'a1'),
      { minute: 30, id: `${mid}:30:goal:2` },
    ];

    const cmp = compareMatchEventRows;
    // Antisymmetry: cmp(a,b) + cmp(b,a) === 0 for every pair.
    for (const a of rows) {
      for (const b of rows) {
        expect(cmp(a, b) + cmp(b, a)).toBe(0);
        // Reflexivity: cmp(a,a) === 0.
        expect(cmp(a, a)).toBe(0);
      }
    }
    // Transitivity over all ordered triplets.
    for (const a of rows) {
      for (const b of rows) {
        for (const c of rows) {
          if (cmp(a, b) <= 0 && cmp(b, c) <= 0) {
            expect(cmp(a, c)).toBeLessThanOrEqual(0);
          }
        }
      }
    }
    // Determinism: repeated sorts produce identical sequences.
    const s1 = [...rows].sort(cmp).map((r) => r.id);
    const s2 = [...rows].sort(cmp).map((r) => r.id);
    const s3 = [...rows].sort(cmp).map((r) => r.id);
    expect(s2).toEqual(s1);
    expect(s3).toEqual(s1);
    // Sanity: sorted output is non-decreasing under the comparator.
    for (let i = 1; i < s1.length; i++) {
      const prev = rows.find((r) => r.id === s1[i - 1])!;
      const cur = rows.find((r) => r.id === s1[i])!;
      expect(cmp(prev, cur)).toBeLessThanOrEqual(0);
    }
  });
});

});
