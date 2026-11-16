import {
  buildPlayerMap,
  clampTacticValue,
  countManagedEligiblePlayers,
  getManagedClub,
  previewManagedStartingXI,
  previewManagedTeamStrength,
  TACTIC_INTENSITY_RANGE,
  updateClubTactics,
} from './tacticsView';
import { generateSeedData } from '@club-director/engine';
import type { Club, Player } from '@club-director/shared-types';

function seedFixture() {
  const { clubs, players } = generateSeedData(12345);
  return { clubs, players };
}

describe('updateClubTactics', () => {
  it('updates only the managed club tactics and preserves other fields', () => {
    const { clubs } = seedFixture();
    const managedId = clubs[0].id;
    const before = clubs[0];

    const next = updateClubTactics(clubs, managedId, {
      defaultFormation: '4-3-3',
      mentality: 'attacking',
      pressingIntensity: 12,
      tempo: 8,
    });

    expect(next).not.toBe(clubs);
    const updated = next.find((c) => c.id === managedId)!;
    expect(updated.tactics).toEqual({
      ...before.tactics,
      defaultFormation: '4-3-3',
      mentality: 'attacking',
      pressingIntensity: 12,
      tempo: 8,
    });
    // Every non-tactics field preserved.
    const { tactics: _t, ...rest } = updated;
    const { tactics: _bt, ...beforeRest } = before;
    expect(rest).toEqual(beforeRest);
  });

  it('preserves other clubs by reference and leaves width untouched', () => {
    const { clubs } = seedFixture();
    const managedId = clubs[0].id;
    const widthBefore = clubs[0].tactics.width;

    const next = updateClubTactics(clubs, managedId, { tempo: 15 });

    for (const club of next) {
      if (club.id !== managedId) {
        expect(club).toBe(clubs.find((c) => c.id === club.id));
      }
    }
    expect(next.find((c) => c.id === managedId)!.tactics.width).toBe(widthBefore);
  });

  it('does not mutate the input clubs array or club objects', () => {
    const { clubs } = seedFixture();
    const snapshot = JSON.stringify(clubs);

    updateClubTactics(clubs, clubs[0].id, { mentality: 'defensive', tempo: 3 });

    expect(JSON.stringify(clubs)).toBe(snapshot);
  });

  it('clamps intensity values to the modeled 5-15 range', () => {
    const { clubs } = seedFixture();
    const id = clubs[0].id;

    const low = updateClubTactics(clubs, id, { pressingIntensity: 0, tempo: -4 });
    expect(low[0].tactics.pressingIntensity).toBe(TACTIC_INTENSITY_RANGE.min);
    expect(low[0].tactics.tempo).toBe(TACTIC_INTENSITY_RANGE.min);

    const high = updateClubTactics(clubs, id, { pressingIntensity: 99, tempo: 40 });
    expect(high[0].tactics.pressingIntensity).toBe(TACTIC_INTENSITY_RANGE.max);
    expect(high[0].tactics.tempo).toBe(TACTIC_INTENSITY_RANGE.max);

    expect(clampTacticValue(10.6)).toBe(11);
  });

  it('returns clubs unchanged when managedClubId is missing or unknown', () => {
    const { clubs } = seedFixture();

    expect(updateClubTactics(clubs, null, { tempo: 10 })).toEqual(clubs);
    expect(updateClubTactics(clubs, 'nope', { tempo: 10 })).toEqual(clubs);
  });
});

describe('managed previews', () => {
  it('previews the managed club XI through the engine', () => {
    const { clubs, players } = seedFixture();
    const club = clubs[0];

    const preview = previewManagedStartingXI(clubs, players, club.id);

    expect(preview).not.toBeNull();
    expect(preview!.ok).toBe(true);
    if (preview!.ok) {
      expect(preview!.players).toHaveLength(11);
    }
    expect(countManagedEligiblePlayers(clubs, players, club.id)).toBeGreaterThanOrEqual(11);
  });

  it('returns null previews when no managed club is selected', () => {
    const { clubs, players } = seedFixture();

    expect(previewManagedStartingXI(clubs, players, null)).toBeNull();
    expect(previewManagedStartingXI(clubs, players, 'unknown')).toBeNull();
    expect(countManagedEligiblePlayers(clubs, players, null)).toBe(0);
    expect(previewManagedTeamStrength(clubs, players, null)).toBeNull();
  });

  it('reflects a formation change in the previewed XI', () => {
    const { clubs, players } = seedFixture();
    const club = clubs[0];

    const before = previewManagedStartingXI(clubs, players, club.id);
    const updatedClubs = updateClubTactics(clubs, club.id, { defaultFormation: '3-5-2' });
    const after = previewManagedStartingXI(updatedClubs, players, club.id);

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    if (!before || !after || !before.ok || !after.ok) return;
    expect(after.players).toHaveLength(11);

    // The preview reads club.tactics.defaultFormation: a club configured
    // directly with '3-5-2' must yield the identical XI.
    const directClubs = clubs.map((c) =>
      c.id === club.id
        ? { ...c, tactics: { ...c.tactics, defaultFormation: '3-5-2' as const } }
        : c,
    );
    const direct = previewManagedStartingXI(directClubs, players, club.id);
    expect(direct).not.toBeNull();
    if (!direct || !direct.ok) return;
    expect(direct.players.map((p) => p.id)).toEqual(after.players.map((p) => p.id));
  });

  it('reports insufficient_players for a tiny squad', () => {
    const { clubs, players } = seedFixture();
    const club: Club = { ...clubs[0], squad: clubs[0].squad.slice(0, 5) };
    const smallClubs = clubs.map((c) => (c.id === club.id ? club : c));

    const preview = previewManagedStartingXI(smallClubs, players, club.id);

    expect(preview!.ok).toBe(false);
    if (!preview!.ok) {
      expect(preview!.reason).toBe('insufficient_players');
    }
  });

  it('strength preview returns squad-wide ratings and does not mutate inputs', () => {
    const { clubs, players } = seedFixture();
    const club = clubs[0];
    const snapshot = JSON.stringify({ clubs, players });

    const strength = previewManagedTeamStrength(clubs, players, club.id);

    expect(strength).not.toBeNull();
    expect(Number.isFinite(strength!.attackRating)).toBe(true);
    expect(JSON.stringify({ clubs, players })).toBe(snapshot);
    expect(buildPlayerMap(players)[players[0].id]).toBe(players[0]);
  });
});
