import {
  previewStartingXI,
  previewTeamStrength,
  countEligiblePlayers,
  simulateMatch,
} from '../match/simulation';
import { generateSeedData } from '../seed/generateSeedData';
import type { Club, Player, PlayerMap } from '@club-director/shared-types';

function toPlayerMap(players: readonly Player[]): PlayerMap {
  const map: PlayerMap = {};
  for (const p of players) map[p.id] = p;
  return map;
}

function seedFixture() {
  const { clubs, players } = generateSeedData(12345);
  return { clubs, players, playerMap: toPlayerMap(players) };
}

function xiIds(preview: ReturnType<typeof previewStartingXI>): string[] {
  if (!preview.ok) throw new Error('expected ok preview');
  return preview.players.map((p) => p.id);
}

describe('previewStartingXI', () => {
  it('is deterministic: same inputs produce the same XI in the same order', () => {
    const { clubs, playerMap } = seedFixture();
    const club = clubs[0];

    const first = previewStartingXI(club, playerMap);
    const second = previewStartingXI(club, playerMap);

    expect(first.ok).toBe(true);
    expect(xiIds(first)).toEqual(xiIds(second));
  });

  it('does not depend on PlayerMap insertion order', () => {
    const { clubs, players } = seedFixture();
    const club = clubs[0];
    const reversed = toPlayerMap([...players].reverse());

    expect(xiIds(previewStartingXI(club, toPlayerMap(players)))).toEqual(
      xiIds(previewStartingXI(club, reversed)),
    );
  });

  it('selects exactly 11 players with a goalkeeper for the club formation', () => {
    const { clubs, playerMap } = seedFixture();
    const club = clubs[0];

    for (const formation of [
      '4-4-2', '4-3-3', '3-5-2', '4-2-3-1', '5-3-2', '4-1-4-1', '3-4-3', '5-4-1',
    ] as const) {
      const preview = previewStartingXI(club, playerMap, formation);
      expect(preview.ok).toBe(true);
      if (!preview.ok) continue;
      expect(preview.players).toHaveLength(11);
      expect(preview.gk.primaryPosition).toBe('GK');
      expect(preview.eligibleCount).toBe(countEligiblePlayers(club, playerMap));
      expect(preview.squadSize).toBe(club.squad.length);
    }
  });

  it('excludes injured players following the engine eligibility rule', () => {
    const { clubs, playerMap } = seedFixture();
    const club = clubs[0];

    const baseline = previewStartingXI(club, playerMap);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;

    const victim = baseline.players[5];
    const injuredMap: PlayerMap = { ...playerMap };
    injuredMap[victim.id] = {
      ...victim,
      status: {
        ...victim.status,
        injury: { type: 'test injury', daysRemaining: 10, severity: 'moderate' },
      },
    };

    const after = previewStartingXI(club, injuredMap);
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    expect(after.players.map((p) => p.id)).not.toContain(victim.id);
    expect(after.players).toHaveLength(11);
    expect(countEligiblePlayers(club, injuredMap)).toBe(
      countEligiblePlayers(club, playerMap) - 1,
    );
  });

  it('treats a healed injury (daysRemaining <= 0) as eligible', () => {
    const { clubs, players, playerMap } = seedFixture();
    const club = clubs[0];
    const victim = club.squad
      .map((id) => playerMap[id])
      .find((p) => p !== undefined)!;

    const healedMap: PlayerMap = {
      ...playerMap,
      [victim.id]: {
        ...victim,
        status: {
          ...victim.status,
          injury: { type: 'healed', daysRemaining: 0, severity: 'minor' },
        },
      },
    };

    expect(xiIds(previewStartingXI(club, healedMap))).toEqual(
      xiIds(previewStartingXI(club, playerMap)),
    );
    expect(players.length).toBeGreaterThan(0);
  });

  it('returns insufficient_players for a squad below 11 eligible', () => {
    const { clubs, playerMap } = seedFixture();
    const club: Club = { ...clubs[0], squad: clubs[0].squad.slice(0, 10) };

    const preview = previewStartingXI(club, playerMap);

    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.reason).toBe('insufficient_players');
    expect(preview.eligibleCount).toBe(10);
    expect(preview.squadSize).toBe(10);
    expect(preview.message).toContain('cannot field a starting XI');
  });

  it('returns insufficient_players when injuries drop eligibility below 11', () => {
    const { clubs, playerMap } = seedFixture();
    const club = clubs[0];
    const baseline = previewStartingXI(club, playerMap);
    if (!baseline.ok) throw new Error('expected ok preview');

    // Injure every squad player not needed is complex; instead build a
    // squad of exactly 11 and injure one of them.
    const eleven = club.squad.slice(0, 11);
    const smallClub: Club = { ...club, squad: eleven };
    const map: PlayerMap = { ...playerMap };
    const first = map[eleven[0]];
    map[first.id] = {
      ...first,
      status: {
        ...first.status,
        injury: { type: 'test', daysRemaining: 5, severity: 'serious' },
      },
    };

    const preview = previewStartingXI(smallClub, map);
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.reason).toBe('insufficient_players');
    expect(preview.eligibleCount).toBe(10);
  });

  it('breaks ability ties deterministically by squad order', () => {
    const { clubs, playerMap } = seedFixture();
    const club = clubs[0];

    // Give every squad player the same currentAbility: selection must then
    // follow squad order deterministically.
    const equalMap: PlayerMap = {};
    for (const id of club.squad) {
      const p = playerMap[id];
      equalMap[id] = {
        ...p,
        development: { ...p.development, currentAbility: 10 },
      };
    }
    const a = previewStartingXI(club, equalMap);
    const b = previewStartingXI(club, equalMap);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.players.map((p) => p.id)).toEqual(b.players.map((p) => p.id));
    // GK is picked by positioning among GKs; with equal everything the
    // first GK in squad order wins.
    const firstGkInSquad = club.squad.find((id) => equalMap[id]?.primaryPosition === 'GK');
    expect(a.gk.id).toBe(firstGkInSquad);
  });

  it('does not mutate club, players map, or player objects', () => {
    const { clubs, playerMap } = seedFixture();
    const club = clubs[0];
    const snapshot = JSON.stringify({ club, playerMap });

    previewStartingXI(club, playerMap);
    previewTeamStrength(club, playerMap);
    countEligiblePlayers(club, playerMap);

    expect(JSON.stringify({ club, playerMap })).toBe(snapshot);
  });

  it('matches the XI actually used by simulateMatch', () => {
    const { clubs, playerMap } = seedFixture();
    const home = clubs[0];
    const away = clubs[1];

    const preview = previewStartingXI(home, playerMap);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = simulateMatch(home, away, playerMap, playerMap, 999);
    // participantIds = [...homeXI.players, ...awayXI.players]
    const matchHomeIds = result.participantIds.slice(0, 11);
    expect(matchHomeIds).toEqual(preview.players.map((p) => p.id));
  });
});

describe('previewTeamStrength', () => {
  it('is deterministic and returns finite ratings', () => {
    const { clubs, playerMap } = seedFixture();
    const club = clubs[0];

    const a = previewTeamStrength(club, playerMap);
    const b = previewTeamStrength(club, playerMap);

    expect(a).toEqual(b);
    for (const key of [
      'attackRating', 'midfieldRating', 'defenseRating', 'gkRating',
      'averageFitness', 'averageForm', 'averageMorale',
    ] as const) {
      expect(Number.isFinite(a[key])).toBe(true);
    }
  });

  it('applies tactical modifiers from the given tactics', () => {
    const { clubs, playerMap } = seedFixture();
    const club = clubs[0];

    const attacking = previewTeamStrength(club, playerMap, {
      ...club.tactics,
      mentality: 'attacking',
    });
    const defensive = previewTeamStrength(club, playerMap, {
      ...club.tactics,
      mentality: 'defensive',
    });

    expect(attacking.attackRating).toBeGreaterThan(defensive.attackRating);
    expect(attacking.defenseRating).toBeLessThan(defensive.defenseRating);
  });

  it('returns the engine default ratings for an empty squad', () => {
    const { clubs, playerMap } = seedFixture();
    const emptyClub: Club = { ...clubs[0], squad: [] };

    const strength = previewTeamStrength(emptyClub, playerMap);
    // Tactical modifiers only scale attack/midfield/defense ratings; the
    // unmodified aggregate fields keep the engine's empty-squad defaults.
    expect(strength.gkRating).toBe(50);
    expect(strength.averageFitness).toBe(75);
    expect(strength.averageForm).toBe(7);
    expect(strength.averageMorale).toBe(75);
    for (const key of ['attackRating', 'midfieldRating', 'defenseRating'] as const) {
      expect(Number.isFinite(strength[key])).toBe(true);
    }
  });
});
