import { advanceMatchweek } from '@club-director/engine';
import { buildPersistedMatch } from '../db/matchRecords';
import type { PersistedMatch } from '../db/matchRecords';
import { useGameState } from '../store/useGameState';

export type MatchweekSimulationResult =
  | { status: 'applied'; resultsCount: number }
  | {
      status: 'skipped';
      reason: 'in-flight' | 'no-career' | 'season-complete';
    };

let simulationInFlight = false;

/**
 * Apply the current matchweek to the loaded career: simulate fixtures,
 * rebuild standings, apply player/transfer effects, persist match
 * records into the store and append the results line — the same steps
 * the League screen used to run inline.
 *
 * Duplicate-invocation guard: the whole advancement is synchronous, so
 * a same-tick second call would replay the same week on stale closures.
 * The module-level flag rejects it; it is released on a microtask so it
 * still covers invocations queued before this turn ends, while never
 * blocking a legitimately later matchweek.
 */
export async function simulateMatchweek(): Promise<MatchweekSimulationResult> {
  if (simulationInFlight) {
    return { status: 'skipped', reason: 'in-flight' };
  }
  simulationInFlight = true;
  try {
    const state = useGameState.getState();
    const {
      league,
      season,
      clubs,
      players,
      managedClubId,
      matches,
      transferOffers,
      transferHistory,
    } = state;

    if (!league || !season || !clubs.length || !players.length) {
      return { status: 'skipped', reason: 'no-career' };
    }

    const advancement = advanceMatchweek(season, league, clubs, players, {
      managedClubId: managedClubId ?? undefined,
    });

    // The engine refuses to advance a completed season: bail out before
    // any setter so no empty result string or stale state is applied.
    if (advancement.seasonComplete) {
      return { status: 'skipped', reason: 'season-complete' };
    }

    // Build and validate every PersistedMatch BEFORE touching the store:
    // if construction fails, no setter runs and no partial state can be
    // autosaved (scores without their match history). Records use the
    // post-matchweek objects, which keep the referential integrity
    // buildPersistedMatch validates. Match ids are deterministic, so
    // merging by id makes a repeated simulation of the same week
    // idempotent.
    const newMatches: PersistedMatch[] = advancement.results.map((r) => {
      const fixture = advancement.updatedLeague.fixtures.find(
        (f) => f.id === r.fixtureId,
      );
      const homeClub = advancement.updatedClubs.find(
        (c) => c.id === r.homeClubId,
      );
      const awayClub = advancement.updatedClubs.find(
        (c) => c.id === r.awayClubId,
      );
      if (!fixture || !homeClub || !awayClub) {
        throw new Error(
          `Cannot record match for fixture ${r.fixtureId}: missing fixture or club in advancement result`,
        );
      }
      return buildPersistedMatch({
        fixture,
        season: advancement.updatedSeason,
        league: advancement.updatedLeague,
        homeClub,
        awayClub,
        result: r.result,
      });
    });
    let mergedMatches: PersistedMatch[] | null = null;
    if (newMatches.length > 0) {
      const existingIds = new Set(matches.map((m) => m.id));
      const toAdd = newMatches.filter((m) => !existingIds.has(m.id));
      if (toAdd.length > 0) {
        mergedMatches = [...matches, ...toAdd];
      }
    }

    state.setLeague(advancement.updatedLeague);
    state.setSeason(advancement.updatedSeason);
    state.setClubs(advancement.updatedClubs);
    state.setPlayers(advancement.updatedPlayers);
    // Keep pending offers involving the managed club (the user's own bids
    // and AI bids for the user's players); AI-vs-AI pending offers are
    // transient and dropped each matchweek.
    const pendingOffers = transferOffers.filter(
      (o) =>
        o.status === 'pending' &&
        (o.buyingClubId === managedClubId || o.sellingClubId === managedClubId),
    );
    const newOfferIds = new Set(advancement.transferOffers.map((o) => o.id));
    state.setTransferOffers([
      ...pendingOffers.filter((o) => !newOfferIds.has(o.id)),
      ...advancement.transferOffers,
    ]);
    if (advancement.transferRecords.length > 0) {
      state.setTransferHistory([...transferHistory, ...advancement.transferRecords]);
    }
    if (mergedMatches !== null) {
      state.setMatches(mergedMatches);
    }

    // Add result to history
    const resultText = advancement.results
      .map(
        (r) =>
          `${r.homeClubId} ${r.homeScore} - ${r.awayScore} ${r.awayClubId}`,
      )
      .join(', ');
    state.addResult(resultText);

    return { status: 'applied', resultsCount: advancement.results.length };
  } finally {
    // Hold the lock through the current synchronous turn: releasing on a
    // microtask keeps same-tick duplicates rejected while never blocking
    // a later legitimate matchweek.
    await Promise.resolve();
    simulationInFlight = false;
  }
}
