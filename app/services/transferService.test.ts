import { generateSeedData, calculateMarketValue } from '@club-director/engine';
import type {
  Club,
  League,
  Player,
  Season,
  TransferOffer,
  TransferRecord,
} from '@club-director/shared-types';
import {
  submitOffer,
  resolvePendingOffer,
  withdrawPendingOffer,
} from './transferService';
import { saveCareer, loadCareer } from '../db/careerPersistence';
import { getTestDatabase, resetTestDatabase } from '../db/testDatabase';
import { careerLandingRoute } from './careerRouting';

function freshState() {
  const seedData = generateSeedData(12345);
  return {
    clubs: seedData.clubs,
    players: seedData.players,
  };
}

function makePendingOffer(
  buyingClub: Club,
  sellingClub: Club,
  player: Player,
  offerAmount: number,
): TransferOffer {
  return {
    id: `offer-${player.id}`,
    playerId: player.id,
    buyingClubId: buyingClub.id,
    sellingClubId: sellingClub.id,
    offerAmount,
    status: 'pending',
    createdAt: new Date(),
  };
}

describe('transferService.submitOffer', () => {
  it('creates a pending offer for a valid amount', () => {
    const { clubs, players } = freshState();
    const buyingClub = clubs[0];
    const sellingClub = clubs[1];
    const player = players.find((p) => p.contract.clubId === sellingClub.id)!;
    const amount = calculateMarketValue(player);

    const result = submitOffer({
      buyingClub,
      sellingClub,
      player,
      amount,
      offers: [],
      transferWindowOpen: true,
    });

    expect(result.success).toBe(true);
    expect(result.offers).toHaveLength(1);
    expect(result.offers![0].status).toBe('pending');
    expect(result.offers![0].playerId).toBe(player.id);
    expect(result.offers![0].buyingClubId).toBe(buyingClub.id);
    expect(result.offers![0].sellingClubId).toBe(sellingClub.id);
    expect(result.offers![0].offerAmount).toBe(amount);
  });

  it.each([0, -100, NaN, 1.5])('rejects invalid offer amount %s', (amount) => {
    const { clubs, players } = freshState();
    const player = players.find((p) => p.contract.clubId === clubs[1].id)!;

    const result = submitOffer({
      buyingClub: clubs[0],
      sellingClub: clubs[1],
      player,
      amount,
      offers: [],
      transferWindowOpen: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.offers).toBeUndefined();
  });

  it('rejects offers exceeding the transfer budget', () => {
    const { clubs, players } = freshState();
    const buyingClub = { ...clubs[0], finances: { ...clubs[0].finances, transferBudget: 1000 } };
    const player = players.find((p) => p.contract.clubId === clubs[1].id)!;

    const result = submitOffer({
      buyingClub,
      sellingClub: clubs[1],
      player,
      amount: calculateMarketValue(player),
      offers: [],
      transferWindowOpen: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('budget');
  });

  it('rejects offers below the minimum threshold', () => {
    const { clubs, players } = freshState();
    const player = players.find((p) => p.contract.clubId === clubs[1].id)!;
    const lowAmount = calculateMarketValue(player) * 0.5;

    const result = submitOffer({
      buyingClub: clubs[0],
      sellingClub: clubs[1],
      player,
      amount: lowAmount,
      offers: [],
      transferWindowOpen: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('too low');
  });

  it('rejects offers when the transfer window is closed', () => {
    const { clubs, players } = freshState();
    const player = players.find((p) => p.contract.clubId === clubs[1].id)!;

    const result = submitOffer({
      buyingClub: clubs[0],
      sellingClub: clubs[1],
      player,
      amount: calculateMarketValue(player),
      offers: [],
      transferWindowOpen: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('window');
  });

  it('updates the existing pending offer instead of duplicating it', () => {
    const { clubs, players } = freshState();
    const richBuyer: Club = {
      ...clubs[0],
      finances: { ...clubs[0].finances, transferBudget: 1_000_000_000 },
    };
    const player = players.find((p) => p.contract.clubId === clubs[1].id)!;
    const mv = calculateMarketValue(player);

    const first = submitOffer({
      buyingClub: richBuyer,
      sellingClub: clubs[1],
      player,
      amount: mv,
      offers: [],
      transferWindowOpen: true,
    });
    expect(first.success).toBe(true);

    const second = submitOffer({
      buyingClub: richBuyer,
      sellingClub: clubs[1],
      player,
      amount: Math.ceil(mv * 1.1),
      offers: first.offers!,
      transferWindowOpen: true,
    });
    expect(second.success).toBe(true);
    expect(second.offers).toHaveLength(1);
    expect(second.offers![0].offerAmount).toBe(Math.ceil(mv * 1.1));
  });
});

describe('transferService.resolvePendingOffer', () => {
  function acceptedScenario() {
    const { clubs, players } = freshState();
    const buyingClub = clubs[0];
    const sellingClub = clubs[1];
    const player = players.find((p) => p.contract.clubId === sellingClub.id)!;
    const marketValue = calculateMarketValue(player);
    const offerAmount = Math.ceil(marketValue * 1.2);

    // Ensure the buyer can afford the fee and the wage.
    buyingClub.finances.transferBudget = 1_000_000_000;
    buyingClub.finances.wageBudget = 100_000_000;

    const offer = makePendingOffer(buyingClub, sellingClub, player, offerAmount);
    return { clubs, players, offer, offerAmount, marketValue };
  }

  it('executes an accepted offer: ownership, squads, finances, history', () => {
    const { clubs, players, offer, offerAmount } = acceptedScenario();
    const buyer = clubs[0];
    const seller = clubs[1];
    const player = players.find((p) => p.id === offer.playerId)!;

    const initialBuyerBalance = buyer.finances.balance;
    const initialSellerBalance = seller.finances.balance;
    const initialBuyerSquadSize = buyer.squad.length;
    const initialSellerSquadSize = seller.squad.length;

    const result = resolvePendingOffer({
      offerId: offer.id,
      offers: [offer],
      clubs,
      players,
      transferHistory: [],
    });

    expect(result.success).toBe(true);
    expect(result.offers![0].status).toBe('accepted');

    // Ownership
    const updatedPlayer = result.players!.find((p) => p.id === player.id)!;
    expect(updatedPlayer.contract.clubId).toBe(buyer.id);

    // Squads
    const updatedBuyer = result.clubs!.find((c) => c.id === buyer.id)!;
    const updatedSeller = result.clubs!.find((c) => c.id === seller.id)!;
    expect(updatedBuyer.squad).toContain(player.id);
    expect(updatedBuyer.squad.length).toBe(initialBuyerSquadSize + 1);
    expect(updatedSeller.squad).not.toContain(player.id);
    expect(updatedSeller.squad.length).toBe(initialSellerSquadSize - 1);

    // Finances
    expect(updatedBuyer.finances.balance).toBe(initialBuyerBalance - offerAmount);
    expect(updatedBuyer.finances.transferBudget).toBe(
      1_000_000_000 - offerAmount,
    );
    expect(updatedSeller.finances.balance).toBe(initialSellerBalance + offerAmount);

    // History
    expect(result.transferHistory).toHaveLength(1);
    expect(result.transferHistory![0].playerId).toBe(player.id);
    expect(result.transferHistory![0].fromClubId).toBe(seller.id);
    expect(result.transferHistory![0].toClubId).toBe(buyer.id);
    expect(result.transferHistory![0].fee).toBe(offerAmount);
  });

  it('marks low offers as rejected without changing game state', () => {
    const { clubs, players } = freshState();
    const buyer = clubs[0];
    const seller = clubs[1];
    const player = players.find((p) => p.contract.clubId === seller.id)!;
    const marketValue = calculateMarketValue(player);

    // Make the seller financially secure so it demands 110% of market value.
    seller.finances.balance = 200_000_000;
    seller.finances.wageBudget = 1_000_000;

    const offer = makePendingOffer(buyer, seller, player, Math.ceil(marketValue * 0.75));
    const clubsSnapshot = JSON.stringify(clubs);
    const playersSnapshot = JSON.stringify(players);

    const result = resolvePendingOffer({
      offerId: offer.id,
      offers: [offer],
      clubs,
      players,
      transferHistory: [],
    });

    expect(result.success).toBe(true);
    expect(result.offers![0].status).toBe('rejected');
    expect(result.clubs).toBeUndefined();
    expect(result.players).toBeUndefined();
    expect(result.transferHistory).toBeUndefined();
    expect(JSON.stringify(clubs)).toBe(clubsSnapshot);
    expect(JSON.stringify(players)).toBe(playersSnapshot);
  });

  it('rejects resolving an offer that is not pending', () => {
    const { clubs, players } = freshState();
    const player = players.find((p) => p.contract.clubId === clubs[1].id)!;
    const offer: TransferOffer = {
      ...makePendingOffer(clubs[0], clubs[1], player, 1_000_000),
      status: 'accepted',
    };

    const result = resolvePendingOffer({
      offerId: offer.id,
      offers: [offer],
      clubs,
      players,
      transferHistory: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already');
  });

  it('does not modify inputs when execution fails (wage budget)', () => {
    const { clubs, players, offer } = acceptedScenario();
    // Buyer cannot cover the wage bill.
    clubs[0].finances.wageBudget = 1;

    const clubsSnapshot = JSON.stringify(clubs);
    const playersSnapshot = JSON.stringify(players);

    const result = resolvePendingOffer({
      offerId: offer.id,
      offers: [offer],
      clubs,
      players,
      transferHistory: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('wage');
    expect(result.clubs).toBeUndefined();
    expect(result.players).toBeUndefined();
    expect(result.transferHistory).toBeUndefined();
    expect(JSON.stringify(clubs)).toBe(clubsSnapshot);
    expect(JSON.stringify(players)).toBe(playersSnapshot);
  });

  it('never reports an accepted offer when execution fails', () => {
    const { clubs, players, offer } = acceptedScenario();
    clubs[0].finances.wageBudget = 1;

    const result = resolvePendingOffer({
      offerId: offer.id,
      offers: [offer],
      clubs,
      players,
      transferHistory: [],
    });

    expect(result.success).toBe(false);
    // The UI-facing result must not contain any offer marked accepted.
    const reportedOffers = result.offers ?? [offer];
    expect(reportedOffers.find((o) => o.id === offer.id)!.status).not.toBe(
      'accepted',
    );
    // With no offers returned, the caller's pending offer remains pending.
    expect(result.offers).toBeUndefined();
  });
});

describe('transferService.withdrawPendingOffer', () => {
  it('marks a pending offer as withdrawn', () => {
    const { clubs, players } = freshState();
    const player = players.find((p) => p.contract.clubId === clubs[1].id)!;
    const offer = makePendingOffer(clubs[0], clubs[1], player, 5_000_000);

    const updated = withdrawPendingOffer([offer], offer.id);
    expect(updated[0].status).toBe('withdrawn');
    expect(updated[0].resolvedAt).toBeDefined();
  });

  it('does not withdraw a resolved offer', () => {
    const { clubs, players } = freshState();
    const player = players.find((p) => p.contract.clubId === clubs[1].id)!;
    const offer: TransferOffer = {
      ...makePendingOffer(clubs[0], clubs[1], player, 5_000_000),
      status: 'accepted',
    };

    const updated = withdrawPendingOffer([offer], offer.id);
    expect(updated[0].status).toBe('accepted');
  });
});

describe('career save/load after a transfer', () => {
  let testDb: any;

  beforeEach(() => {
    testDb = getTestDatabase();
    resetTestDatabase();
  });

  afterEach(async () => {
    const { deleteCareer } = await import('../db/careerPersistence');
    await deleteCareer(testDb);
  });

  it('persists transfer results through save/load', async () => {
    const { clubs, players } = freshState();
    const buyer = clubs[0];
    const seller = clubs[1];
    const player = players.find((p) => p.contract.clubId === seller.id)!;
    const marketValue = calculateMarketValue(player);
    const offerAmount = Math.ceil(marketValue * 1.2);

    buyer.finances.transferBudget = 1_000_000_000;
    buyer.finances.wageBudget = 100_000_000;

    const offer = makePendingOffer(buyer, seller, player, offerAmount);
    const initialBuyerBalance = buyer.finances.balance;
    const initialSellerBalance = seller.finances.balance;

    const result = resolvePendingOffer({
      offerId: offer.id,
      offers: [offer],
      clubs,
      players,
      transferHistory: [],
    });
    expect(result.success).toBe(true);

    const league: League = {
      id: 'league-1',
      name: 'Test League',
      tier: 1,
      clubIds: clubs.map((c) => c.id),
      standings: {
        entries: clubs.map((club) => ({
          clubId: club.id,
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0,
          points: 0,
        })),
      },
      fixtures: [],
    };

    const season: Season = {
      id: 'season-1',
      leagueId: 'league-1',
      currentWeek: 1,
      currentDate: new Date('2024-08-01'),
      transferWindowOpen: true,
      fixturesCalendar: [],
    };

    await saveCareer(
      {
        career: {
          id: 'active',
          managerName: 'Test Manager',
          managedClubId: buyer.id,
          createdAt: new Date('2024-08-01'),
          lastPlayedAt: new Date(),
          schemaVersion: 1,
        },
        clubs: result.clubs!,
        players: result.players!,
        league,
        season,
        transferHistory: result.transferHistory!,
        transferOffers: [],
      },
      testDb,
    );

    const loaded = await loadCareer(testDb);
    expect(loaded).not.toBeNull();

    const loadedBuyer = loaded!.clubs.find((c) => c.id === buyer.id)!;
    const loadedSeller = loaded!.clubs.find((c) => c.id === seller.id)!;
    const loadedPlayer = loaded!.players.find((p) => p.id === player.id)!;

    // Ownership survived reload
    expect(loadedPlayer.contract.clubId).toBe(buyer.id);
    // Squads reconstructed consistently
    expect(loadedBuyer.squad).toContain(player.id);
    expect(loadedSeller.squad).not.toContain(player.id);
    // Finances survived reload
    expect(loadedBuyer.finances.balance).toBe(initialBuyerBalance - offerAmount);
    expect(loadedSeller.finances.balance).toBe(initialSellerBalance + offerAmount);
    // Transfer history survived
    expect(loaded!.transferHistory).toHaveLength(1);
    expect(loaded!.transferHistory[0].playerId).toBe(player.id);
  });
});

describe('careerLandingRoute', () => {
  it('routes to dashboard when a career exists', () => {
    expect(careerLandingRoute(true)).toBe('/dashboard');
  });

  it('routes to new-career when no career exists', () => {
    expect(careerLandingRoute(false)).toBe('/new-career');
  });
});
