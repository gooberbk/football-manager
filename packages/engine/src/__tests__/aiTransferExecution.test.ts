import { processAITransferActivity } from '../transfer/market';
import { generateSeedData } from '../seed/generateSeedData';
import { calculateMarketValue } from '../transfer/valuation';
import {
  Club,
  Player,
  TransferOffer,
  TransferRecord,
} from '@club-director/shared-types';

function buildScenario(clubCount = 6) {
  const seedData = generateSeedData(12345);
  const clubs = seedData.clubs.slice(0, clubCount);
  const players = seedData.players.filter((p) =>
    clubs.some((c) => c.squad.includes(p.id)),
  );
  return { clubs, players };
}

describe('AI Transfer Execution', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should genuinely execute accepted AI transfers', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1); // every club attempts
    const { clubs, players } = buildScenario(6);
    const transferHistory: TransferRecord[] = [];

    const initialBalances = new Map(clubs.map((c) => [c.id, c.finances.balance]));
    const initialBudgets = new Map(clubs.map((c) => [c.id, c.finances.transferBudget]));
    const initialSquads = new Map(clubs.map((c) => [c.id, [...c.squad]]));

    const offers = processAITransferActivity(
      clubs,
      players,
      [],
      true,
      [],
      transferHistory,
    );

    const accepted = offers.filter((o) => o.status === 'accepted');
    expect(accepted.length).toBeGreaterThan(0);
    expect(transferHistory.length).toBe(accepted.length);

    // Fees bought/sold per club
    const feesBought = new Map<string, number>();
    const feesSold = new Map<string, number>();
    accepted.forEach((o) => {
      feesBought.set(o.buyingClubId, (feesBought.get(o.buyingClubId) ?? 0) + o.offerAmount);
      feesSold.set(o.sellingClubId, (feesSold.get(o.sellingClubId) ?? 0) + o.offerAmount);
    });

    clubs.forEach((club) => {
      const expectedBalance =
        (initialBalances.get(club.id) ?? 0) -
        (feesBought.get(club.id) ?? 0) +
        (feesSold.get(club.id) ?? 0);
      expect(club.finances.balance).toBe(expectedBalance);
      expect(club.finances.transferBudget).toBe(
        (initialBudgets.get(club.id) ?? 0) -
          (feesBought.get(club.id) ?? 0) +
          (feesSold.get(club.id) ?? 0),
      );
    });

    accepted.forEach((offer) => {
      const record = transferHistory.find((r) => r.playerId === offer.playerId);
      expect(record).toBeDefined();
      expect(record!.fromClubId).toBe(offer.sellingClubId);
      expect(record!.toClubId).toBe(offer.buyingClubId);
      expect(record!.fee).toBe(offer.offerAmount);

      const updatedPlayer = players.find((p) => p.id === offer.playerId);
      expect(updatedPlayer).toBeDefined();
      expect(updatedPlayer!.contract.clubId).toBe(offer.buyingClubId);

      const buyer = clubs.find((c) => c.id === offer.buyingClubId)!;
      const seller = clubs.find((c) => c.id === offer.sellingClubId)!;
      expect(buyer.squad).toContain(offer.playerId);
      expect(seller.squad).not.toContain(offer.playerId);
      expect(initialSquads.get(seller.id)).toContain(offer.playerId);
    });
  });

  it('should never let an excluded (managed) club buy as an AI club', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const { clubs, players } = buildScenario(6);
    const managedClubId = clubs[0].id;

    const offers = processAITransferActivity(
      clubs,
      players,
      [],
      true,
      [managedClubId],
      [],
    );

    // We passed an empty existing-offers list, so every returned offer was
    // created during this run. The managed club must neither buy nor have
    // its players auto-sold by AI resolution.
    offers.forEach((o) => {
      expect(o.buyingClubId).not.toBe(managedClubId);
      expect(o.sellingClubId).not.toBe(managedClubId);
    });
  });

  it('should produce no activity when all clubs are excluded', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const { clubs, players } = buildScenario(4);
    const snapshot = JSON.stringify({ clubs, players });

    const offers = processAITransferActivity(
      clubs,
      players,
      [],
      true,
      clubs.map((c) => c.id),
      [],
    );

    expect(offers).toHaveLength(0);
    expect(JSON.stringify({ clubs, players })).toBe(snapshot);
  });

  it('should not partially modify state when transfer execution fails', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const { clubs, players } = buildScenario(6);

    // Make every club desperate (low balance, tiny wage budget) so offers are
    // accepted by sellers but executeTransfer() fails on wage affordability.
    clubs.forEach((club: Club) => {
      club.finances.balance = 5000;
      club.finances.wageBudget = 1000;
    });

    const snapshot = JSON.stringify({ clubs, players });
    const transferHistory: TransferRecord[] = [];

    const offers = processAITransferActivity(
      clubs,
      players,
      [],
      true,
      [],
      transferHistory,
    );

    // No accepted offers and no records should exist.
    expect(offers.filter((o) => o.status === 'accepted')).toHaveLength(0);
    expect(transferHistory).toHaveLength(0);

    // Clubs and players must be completely untouched.
    expect(JSON.stringify({ clubs, players })).toBe(snapshot);
  });

  it('marks rejected AI offers as rejected, never pending', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const { clubs, players } = buildScenario(6);

    // Make every club financially secure (balance/wageBudget > 50) so sellers
    // demand 110% of market value while AI offers are made at 100% -> rejected.
    clubs.forEach((club: Club) => {
      club.finances.balance = 1_000_000_000;
      club.finances.wageBudget = 1_000_000;
    });

    const snapshot = JSON.stringify({ clubs, players });
    const transferHistory: TransferRecord[] = [];

    const offers = processAITransferActivity(
      clubs,
      players,
      [],
      true,
      [],
      transferHistory,
    );

    expect(offers.length).toBeGreaterThan(0);
    offers.forEach((offer) => {
      expect(offer.status).toBe('rejected');
      expect(offer.resolvedAt).toBeDefined();
    });
    // No pending offers and no executed transfers.
    expect(offers.some((o) => o.status === 'pending')).toBe(false);
    expect(transferHistory).toHaveLength(0);
    expect(JSON.stringify({ clubs, players })).toBe(snapshot);
  });

  it('never returns pending AI offers — every offer is resolved', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const { clubs, players } = buildScenario(6);

    const offers = processAITransferActivity(
      clubs,
      players,
      [],
      true,
      [],
      [],
    );

    offers.forEach((offer) => {
      expect(['accepted', 'rejected']).toContain(offer.status);
      expect(offer.resolvedAt).toBeDefined();
    });
  });

  it('should record each accepted transfer exactly once', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const { clubs, players } = buildScenario(6);
    const transferHistory: TransferRecord[] = [];

    const offers = processAITransferActivity(
      clubs,
      players,
      [],
      true,
      [],
      transferHistory,
    );

    const acceptedPlayerIds = offers
      .filter((o) => o.status === 'accepted')
      .map((o) => o.playerId);

    // No player transferred twice
    expect(new Set(acceptedPlayerIds).size).toBe(acceptedPlayerIds.length);

    // Squad membership stays consistent: every player belongs to exactly the
    // club that owns their contract.
    const squadMembership = new Map<string, string>();
    clubs.forEach((club) => {
      club.squad.forEach((pid) => {
        expect(squadMembership.has(pid)).toBe(false);
        squadMembership.set(pid, club.id);
      });
    });
    players.forEach((p: Player) => {
      expect(squadMembership.get(p.id)).toBe(p.contract.clubId);
    });
  });
});
