import {
  calculateMarketValue,
  updatePlayerMarketValue,
} from '../transfer/valuation';
import {
  makeOffer,
  resolveOffer,
  executeTransfer,
  processAITransferActivity,
} from '../transfer/market';
import { generateSeedData } from '../seed/generateSeedData';
import { SeededRNG } from '../match/simulation';
import {
  Club,
  Player,
  TransferOffer,
  TransferRecord,
} from '@club-director/shared-types';

describe('Transfer Market', () => {
  describe('Player Valuation', () => {
    it('should value a 24-year-old higher than a near-identical 34-year-old', () => {
      const seedData = generateSeedData(12345);
      const basePlayer = seedData.players[0];

      const youngPlayer: Player = {
        ...basePlayer,
        age: 24,
        contract: {
          ...basePlayer.contract,
          contractExpiryDate: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
        },
      };

      const oldPlayer: Player = {
        ...basePlayer,
        age: 34,
        contract: {
          ...basePlayer.contract,
          contractExpiryDate: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
        },
      };

      const youngValue = calculateMarketValue(youngPlayer);
      const oldValue = calculateMarketValue(oldPlayer);

      expect(youngValue).toBeGreaterThan(oldValue);
    });

    it('should value a player with 1 month left on contract lower than identical player with 3 years', () => {
      const seedData = generateSeedData(12345);
      const basePlayer = seedData.players[0];

      const shortContractPlayer: Player = {
        ...basePlayer,
        contract: {
          ...basePlayer.contract,
          contractExpiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      };

      const longContractPlayer: Player = {
        ...basePlayer,
        contract: {
          ...basePlayer.contract,
          contractExpiryDate: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
        },
      };

      const shortValue = calculateMarketValue(shortContractPlayer);
      const longValue = calculateMarketValue(longContractPlayer);

      expect(shortValue).toBeLessThan(longValue);
    });

    it('should update player market value', () => {
      const seedData = generateSeedData(12345);
      const player = seedData.players[0];

      const updatedPlayer = updatePlayerMarketValue(player);

      expect(updatedPlayer.contract.marketValue).toBeGreaterThan(0);
      expect(updatedPlayer.contract.marketValue).toBeLessThanOrEqual(200000000);
    });
  });

  describe('Budget Enforcement', () => {
    it('should reject offers exceeding transfer budget', () => {
      const seedData = generateSeedData(12345);
      const buyingClub = seedData.clubs[0];
      const sellingClub = seedData.clubs[1];
      const player = seedData.players.find((p) => p.contract.clubId === sellingClub.id);

      if (!player) {
        throw new Error('Player not found');
      }

      // Set budget to a low value
      buyingClub.finances.transferBudget = 1000000;

      const result = makeOffer(
        buyingClub,
        sellingClub,
        player,
        5000000, // Offer exceeds budget
        [],
        true,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient transfer budget');
    });

    it('should reject offers below 70% of market value', () => {
      const seedData = generateSeedData(12345);
      const buyingClub = seedData.clubs[0];
      const sellingClub = seedData.clubs[1];
      const player = seedData.players.find((p) => p.contract.clubId === sellingClub.id);

      if (!player) {
        throw new Error('Player not found');
      }

      const marketValue = calculateMarketValue(player);
      const lowOffer = marketValue * 0.5; // Below 70% threshold

      buyingClub.finances.transferBudget = marketValue * 2;

      const result = makeOffer(
        buyingClub,
        sellingClub,
        player,
        lowOffer,
        [],
        true,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('too low');
    });
  });

  describe('Transfer Execution', () => {
    it('should correctly update buyer and seller finances and squads on accepted offer', () => {
      const seedData = generateSeedData(12345);
      const buyingClub = seedData.clubs[0];
      const sellingClub = seedData.clubs[1];
      const player = seedData.players.find((p) => p.contract.clubId === sellingClub.id);

      if (!player) {
        throw new Error('Player not found');
      }

      // Increase wage budget to ensure transfer can proceed
      buyingClub.finances.wageBudget = 5000000;

      const offerAmount = 10000000;

      const offer: TransferOffer = {
        id: 'offer-1',
        playerId: player.id,
        buyingClubId: buyingClub.id,
        sellingClubId: sellingClub.id,
        offerAmount,
        status: 'accepted',
        createdAt: new Date(),
        resolvedAt: new Date(),
      };

      const initialBuyerBalance = buyingClub.finances.balance;
      const initialSellerBalance = sellingClub.finances.balance;
      const initialBuyerSquad = buyingClub.squad.length;
      const initialSellerSquad = sellingClub.squad.length;

      const result = executeTransfer(offer, buyingClub, sellingClub, player, seedData.players, []);

      expect(result).not.toBeNull();

      if (result) {
        const { updatedBuyingClub, updatedSellingClub, updatedPlayer } = result;

        // Buyer balance decreased
        expect(updatedBuyingClub.finances.balance).toBe(initialBuyerBalance - offerAmount);
        // Seller balance increased
        expect(updatedSellingClub.finances.balance).toBe(initialSellerBalance + offerAmount);
        // Buyer squad increased
        expect(updatedBuyingClub.squad.length).toBe(initialBuyerSquad + 1);
        // Seller squad decreased
        expect(updatedSellingClub.squad.length).toBe(initialSellerSquad - 1);
        // Player's club updated
        expect(updatedPlayer.contract.clubId).toBe(buyingClub.id);
        // Player in buyer's squad
        expect(updatedBuyingClub.squad).toContain(player.id);
        // Player not in seller's squad
        expect(updatedSellingClub.squad).not.toContain(player.id);
      }
    });

    it('should enforce wage budget when buying multiple players in sequence', () => {
      const seedData = generateSeedData(12345);
      const buyingClub = seedData.clubs[0];
      const sellingClubs = seedData.clubs.slice(1, 5);
      let players = [...seedData.players];

      // Set a higher wage budget to allow multiple transfers
      buyingClub.finances.wageBudget = 3000000;
      buyingClub.finances.transferBudget = 100000000;

      // Find 4 players from different selling clubs
      const playersToBuy = [];
      for (let i = 0; i < 4; i++) {
        const player = players.find((p) => p.contract.clubId === sellingClubs[i].id);
        if (player) {
          playersToBuy.push(player);
        }
      }

      if (playersToBuy.length < 4) {
        return; // Skip if we can't find enough players
      }

      // Buy players in sequence
      let transferCount = 0;
      for (const player of playersToBuy) {
        const sellingClub = sellingClubs.find((c) => c.id === player.contract.clubId);
        if (!sellingClub) continue;

        const marketValue = calculateMarketValue(player);
        const offer: TransferOffer = {
          id: `offer-${transferCount}`,
          playerId: player.id,
          buyingClubId: buyingClub.id,
          sellingClubId: sellingClub.id,
          offerAmount: marketValue,
          status: 'accepted',
          createdAt: new Date(),
          resolvedAt: new Date(),
        };

        const result = executeTransfer(offer, buyingClub, sellingClub, player, players, []);

        if (result) {
          transferCount++;
          // Update buying club and players for next iteration
          const updatedClub = result.updatedBuyingClub;
          const updatedPlayer = result.updatedPlayer;

          buyingClub.finances = updatedClub.finances;
          buyingClub.squad = updatedClub.squad;

          // Update players array with new player state
          players = players.map((p) => (p.id === updatedPlayer.id ? updatedPlayer : p));
        }
      }

      // At least some transfers should succeed
      expect(transferCount).toBeGreaterThan(0);

      // Final wage bill should not exceed budget
      const finalWageBill = buyingClub.squad.reduce((total, playerId) => {
        const player = players.find((p) => p.id === playerId);
        return total + (player?.contract.wage || 0);
      }, 0);

      expect(finalWageBill).toBeLessThanOrEqual(buyingClub.finances.wageBudget);
    });
  });

  describe('AI Transfer Activity', () => {
    it('should process AI-to-AI transfers over 10-week window', () => {
      const seedData = generateSeedData(12345);
      const clubs = seedData.clubs.slice(0, 8); // Use 8 clubs for testing
      const players = seedData.players;

      let transferOffers: any[] = [];
      let activityOccurred = false;

      for (let week = 1; week <= 10; week++) {
        transferOffers = processAITransferActivity(
          clubs,
          players,
          transferOffers,
          true, // Transfer window open
        );

        if (transferOffers.length > 0) {
          activityOccurred = true;
        }
      }

      // Some AI activity should have occurred
      expect(activityOccurred).toBe(true);
    });

    it('should not allow two AI clubs to bid for the same player in the same week', () => {
      const seedData = generateSeedData(12345);
      const clubs = seedData.clubs.slice(0, 6);
      const players = seedData.players;

      // Find a player with high value that multiple clubs might want
      const targetPlayer = players.sort((a, b) => b.development.currentAbility - a.development.currentAbility)[0];
      const sellingClub = clubs.find((c) => c.id === targetPlayer.contract.clubId);

      if (!sellingClub) {
        return; // Skip if we can't set up the scenario
      }

      // Mark player as already transferred
      const existingOffer: TransferOffer = {
        id: 'offer-1',
        playerId: targetPlayer.id,
        buyingClubId: clubs[0].id,
        sellingClubId: sellingClub.id,
        offerAmount: calculateMarketValue(targetPlayer),
        status: 'accepted',
        createdAt: new Date(),
        resolvedAt: new Date(),
      };

      const existingOffers = [existingOffer];

      // Process AI activity - should not create another offer for the same player
      const newOffers = processAITransferActivity(clubs, players, existingOffers, true);

      // Count pending offers for the same player
      const pendingOffersForPlayer = newOffers.filter(
        (o) => o.playerId === targetPlayer.id && o.status === 'pending',
      );

      // Should be 0 since player is already transferred
      expect(pendingOffersForPlayer.length).toBe(0);
    });

    it('should not allow negative club balances from AI transfers', () => {
      const seedData = generateSeedData(12345);
      const clubs = seedData.clubs.slice(0, 6);
      const players = seedData.players;

      const initialBalances = clubs.map((c) => c.finances.balance);

      // Process AI activity
      const transferOffers = processAITransferActivity(clubs, players, [], true);

      // Check no club has negative balance
      clubs.forEach((club, index) => {
        expect(club.finances.balance).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Transfer Window', () => {
    it('should reject offers when transfer window is closed', () => {
      const seedData = generateSeedData(12345);
      const buyingClub = seedData.clubs[0];
      const sellingClub = seedData.clubs[1];
      const player = seedData.players.find((p) => p.contract.clubId === sellingClub.id);

      if (!player) {
        throw new Error('Player not found');
      }

      const marketValue = calculateMarketValue(player);
      buyingClub.finances.transferBudget = marketValue * 2;

      const result = makeOffer(
        buyingClub,
        sellingClub,
        player,
        marketValue,
        [],
        false, // Transfer window closed
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Transfer window is closed');
    });

    it('should not process AI transfers when window is closed', () => {
      const seedData = generateSeedData(12345);
      const clubs = seedData.clubs.slice(0, 6);
      const players = seedData.players;

      const transferOffers = processAITransferActivity(
        clubs,
        players,
        [],
        false, // Transfer window closed
      );

      // No new offers should be created
      expect(transferOffers.length).toBe(0);
    });
  });

  describe('Offer Resolution', () => {
    it('should accept offers above acceptance threshold', () => {
      const seedData = generateSeedData(12345);
      const sellingClub = seedData.clubs[1];
      const player = seedData.players[0];

      const marketValue = calculateMarketValue(player);

      const offer: TransferOffer = {
        id: 'offer-1',
        playerId: player.id,
        buyingClubId: 'buyer-1',
        sellingClubId: sellingClub.id,
        offerAmount: marketValue * 1.2, // 120% of market value
        status: 'pending',
        createdAt: new Date(),
      };

      const resolution = resolveOffer(offer, sellingClub, marketValue);

      expect(resolution).toBe('accepted');
    });

    it('should reject offers below acceptance threshold', () => {
      const seedData = generateSeedData(12345);
      const sellingClub = seedData.clubs[1];
      const player = seedData.players[0];

      const marketValue = calculateMarketValue(player);

      const offer: TransferOffer = {
        id: 'offer-1',
        playerId: player.id,
        buyingClubId: 'buyer-1',
        sellingClubId: sellingClub.id,
        offerAmount: marketValue * 0.5, // 50% of market value
        status: 'pending',
        createdAt: new Date(),
      };

      const resolution = resolveOffer(offer, sellingClub, marketValue);

      expect(resolution).toBe('rejected');
    });

    it('should be more willing to sell when balance is low', () => {
      const seedData = generateSeedData(12345);
      const player = seedData.players[0];
      const marketValue = calculateMarketValue(player);

      const offer: TransferOffer = {
        id: 'offer-1',
        playerId: player.id,
        buyingClubId: 'buyer-1',
        sellingClubId: 'seller-1',
        offerAmount: marketValue * 0.85, // 85% of market value
        status: 'pending',
        createdAt: new Date(),
      };

      // Poor club (low balance)
      const poorClub: Club = {
        ...seedData.clubs[0],
        finances: {
          ...seedData.clubs[0].finances,
          balance: 1000000,
          wageBudget: 500000,
        },
      };

      // Rich club (high balance)
      const richClub: Club = {
        ...seedData.clubs[1],
        finances: {
          ...seedData.clubs[1].finances,
          balance: 100000000,
          wageBudget: 1000000,
        },
      };

      const poorResolution = resolveOffer(offer, poorClub, marketValue);
      const richResolution = resolveOffer(offer, richClub, marketValue);

      // Poor club should be more likely to accept
      expect(poorResolution).toBe('accepted');
      // Rich club should reject
      expect(richResolution).toBe('rejected');
    });
  });

  describe('Deterministic Valuation', () => {
    const FIXED_NOW = new Date('2025-01-15T00:00:00Z');

    it('produces identical market values for identical player and explicit date', () => {
      const seedData = generateSeedData(12345);
      const player = seedData.players[0];

      const first = calculateMarketValue(player, FIXED_NOW);
      const second = calculateMarketValue(player, FIXED_NOW);

      expect(first).toBe(second);
      expect(first).toBeGreaterThan(0);
    });

    it('produces different values for different explicit dates when contract duration changes', () => {
      const seedData = generateSeedData(12345);
      const basePlayer = seedData.players[0];

      // Contract expires 2025-06-01: ~4.5 months remain at FIXED_NOW
      // (50% penalty) vs ~12 months at 2024-06-01 (no penalty).
      const player: Player = {
        ...basePlayer,
        contract: {
          ...basePlayer.contract,
          contractExpiryDate: new Date('2025-06-01T00:00:00Z'),
        },
      };

      const nearExpiry = calculateMarketValue(player, FIXED_NOW);
      const distantExpiry = calculateMarketValue(
        player,
        new Date('2024-06-01T00:00:00Z'),
      );

      expect(nearExpiry).toBeLessThan(distantExpiry);
    });

    it('replays identical seeded AI transfer activity with an injected date', () => {
      const run = () => {
        const seedData = generateSeedData(12345);
        const clubs = seedData.clubs.slice(0, 8);
        const players = seedData.players;
        const history: TransferRecord[] = [];
        const offers = processAITransferActivity(
          clubs,
          players,
          [],
          true,
          [],
          history,
          { rng: new SeededRNG(4242), now: FIXED_NOW },
        );
        return { offers, history, clubs, players };
      };

      const a = run();
      const b = run();

      expect(a.offers).toEqual(b.offers);
      expect(a.history).toEqual(b.history);
      // Club finances and squads must be identical too — valuation feeds
      // offer amounts and execution.
      expect(
        a.clubs.map((c) => ({
          id: c.id,
          finances: c.finances,
          squad: [...c.squad].sort(),
        })),
      ).toEqual(
        b.clubs.map((c) => ({
          id: c.id,
          finances: c.finances,
          squad: [...c.squad].sort(),
        })),
      );
      expect(
        a.players.map((p) => ({ id: p.id, contract: p.contract })),
      ).toEqual(b.players.map((p) => ({ id: p.id, contract: p.contract })));
    });
  });
});
