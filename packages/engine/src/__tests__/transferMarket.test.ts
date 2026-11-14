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

  describe('Offer Validation', () => {
    function offerScenario() {
      const seedData = generateSeedData(12345);
      const buyingClub = seedData.clubs[0];
      const sellingClub = seedData.clubs[1];
      const player = seedData.players.find(
        (p) => p.contract.clubId === sellingClub.id,
      )!;
      buyingClub.finances.transferBudget = 100_000_000;
      return { buyingClub, sellingClub, player, seedData };
    }

    it.each([0, -5, NaN, Infinity, -Infinity, 100.5])(
      'rejects invalid offer amount %p',
      (amount) => {
        const { buyingClub, sellingClub, player } = offerScenario();
        const result = makeOffer(
          buyingClub, sellingClub, player, amount, [], true,
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('positive whole number');
        expect(result.offer).toBeUndefined();
      },
    );

    it('accepts a valid positive integer offer', () => {
      const { buyingClub, sellingClub, player } = offerScenario();
      const amount = Math.ceil(calculateMarketValue(player, new Date('2025-01-01')));
      const result = makeOffer(
        buyingClub, sellingClub, player, amount, [], true,
      );
      expect(result.success).toBe(true);
      expect(result.offer?.offerAmount).toBe(amount);
      expect(result.offer?.status).toBe('pending');
    });

    it('rejects an offer from a club to itself', () => {
      const { buyingClub, player } = offerScenario();
      // Player belongs to sellingClub; reuse buyingClub as both sides.
      const result = makeOffer(
        buyingClub, buyingClub, player, 10_000_000, [], true,
      );
      // The player-belongs check would also fire, but the self-transfer
      // guard must reject first with its own message.
      expect(result.success).toBe(false);
      expect(result.error).toContain('own club');
    });

    it('rejects a self-transfer even when the player belongs to that club', () => {
      const seedData = generateSeedData(12345);
      const club = seedData.clubs[0];
      const player = seedData.players.find(
        (p) => p.contract.clubId === club.id,
      )!;
      const result = makeOffer(club, club, player, 10_000_000, [], true);
      expect(result.success).toBe(false);
      expect(result.error).toContain('own club');
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

    it('rejects execution when cumulative accepted offers exceed the transfer budget', () => {
      const seedData = generateSeedData(12345);
      const buyingClub = seedData.clubs[0];
      const sellingClubs = seedData.clubs.slice(1, 3);
      const players = [...seedData.players];

      // Two players, one per selling club. Each offer is individually
      // below the budget, but their sum exceeds it — the exact gap that
      // submission-time validation cannot catch.
      const playerA = players.find((p) => p.contract.clubId === sellingClubs[0].id)!;
      const playerB = players.find((p) => p.contract.clubId === sellingClubs[1].id)!;
      const offerAmount = 15_000_000;
      buyingClub.finances.transferBudget = 20_000_000; // each offer OK, both not
      buyingClub.finances.wageBudget = 100_000_000;   // isolate the budget check

      const offerA: TransferOffer = {
        id: 'offer-a', playerId: playerA.id,
        buyingClubId: buyingClub.id, sellingClubId: sellingClubs[0].id,
        offerAmount, status: 'accepted',
        createdAt: new Date(), resolvedAt: new Date(),
      };
      const offerB: TransferOffer = {
        id: 'offer-b', playerId: playerB.id,
        buyingClubId: buyingClub.id, sellingClubId: sellingClubs[1].id,
        offerAmount, status: 'accepted',
        createdAt: new Date(), resolvedAt: new Date(),
      };

      // First transfer succeeds and consumes £15M of the £20M budget.
      const first = executeTransfer(
        offerA, buyingClub, sellingClubs[0], playerA, players, [],
      );
      expect(first).not.toBeNull();

      // Second transfer must be refused at execution time.
      const clubsBefore = JSON.stringify(sellingClubs[1]);
      const playersBefore = JSON.stringify(players);
      const second = executeTransfer(
        offerB, first!.updatedBuyingClub, sellingClubs[1], playerB, players, [],
      );
      expect(second).toBeNull();

      // The refusal mutates nothing: seller club, player and the buyer's
      // already-updated finances are exactly as they were.
      expect(JSON.stringify(sellingClubs[1])).toBe(clubsBefore);
      expect(JSON.stringify(players)).toBe(playersBefore);
      expect(first!.updatedBuyingClub.finances.transferBudget).toBe(5_000_000);
    });

    it('executes normally when the offer fits the remaining budget', () => {
      const seedData = generateSeedData(12345);
      const buyingClub = seedData.clubs[0];
      const sellingClub = seedData.clubs[1];
      const player = seedData.players.find((p) => p.contract.clubId === sellingClub.id)!;

      buyingClub.finances.transferBudget = 20_000_000;
      buyingClub.finances.wageBudget = 100_000_000;

      const offer: TransferOffer = {
        id: 'offer-ok', playerId: player.id,
        buyingClubId: buyingClub.id, sellingClubId: sellingClub.id,
        offerAmount: 15_000_000, status: 'accepted',
        createdAt: new Date(), resolvedAt: new Date(),
      };

      const result = executeTransfer(offer, buyingClub, sellingClub, player, seedData.players, []);
      expect(result).not.toBeNull();
      expect(result!.updatedBuyingClub.finances.transferBudget).toBe(5_000_000);
    });
  });

  describe('Debt Repayment on Sale', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    function debtScenario() {
      const seedData = generateSeedData(12345);
      const buyingClub = seedData.clubs[0];
      const sellingClub = seedData.clubs[1];
      const player = seedData.players.find(
        (p) => p.contract.clubId === sellingClub.id,
      )!;
      // Generous budgets isolate the debt-repayment assertions.
      buyingClub.finances.transferBudget = 100_000_000;
      buyingClub.finances.wageBudget = 100_000_000;
      return {
        buyingClub,
        sellingClub,
        player,
        players: seedData.players,
      };
    }

    function acceptedOffer(
      buyingClub: Club,
      sellingClub: Club,
      player: Player,
      offerAmount: number,
      id = 'offer-debt',
    ): TransferOffer {
      return {
        id,
        playerId: player.id,
        buyingClubId: buyingClub.id,
        sellingClubId: sellingClub.id,
        offerAmount,
        status: 'accepted',
        createdAt: new Date(),
        resolvedAt: new Date(),
      };
    }

    it('A. debt greater than the fee: the whole proceeds repay debt', () => {
      const { buyingClub, sellingClub, player, players } = debtScenario();
      const fee = 1_000_000;
      sellingClub.finances.debt = 2_000_000;
      const balanceBefore = sellingClub.finances.balance;
      const budgetBefore = sellingClub.finances.transferBudget;

      const result = executeTransfer(
        acceptedOffer(buyingClub, sellingClub, player, fee),
        buyingClub, sellingClub, player, players, [],
      );

      expect(result).not.toBeNull();
      expect(result!.updatedSellingClub.finances.debt).toBe(1_000_000);
      expect(result!.updatedSellingClub.finances.balance).toBe(balanceBefore);
      expect(result!.updatedSellingClub.finances.transferBudget).toBe(budgetBefore);
    });

    it('B. debt smaller than the fee: remainder goes to balance and transfer budget', () => {
      const { buyingClub, sellingClub, player, players } = debtScenario();
      const fee = 1_000_000;
      sellingClub.finances.debt = 400_000;
      const balanceBefore = sellingClub.finances.balance;
      const budgetBefore = sellingClub.finances.transferBudget;

      const result = executeTransfer(
        acceptedOffer(buyingClub, sellingClub, player, fee),
        buyingClub, sellingClub, player, players, [],
      );

      expect(result).not.toBeNull();
      expect(result!.updatedSellingClub.finances.debt).toBe(0);
      expect(result!.updatedSellingClub.finances.balance).toBe(balanceBefore + 600_000);
      expect(result!.updatedSellingClub.finances.transferBudget).toBe(budgetBefore + 600_000);
    });

    it('C. zero debt keeps the exact previous financial behavior', () => {
      const { buyingClub, sellingClub, player, players } = debtScenario();
      const fee = 1_000_000;
      sellingClub.finances.debt = 0;
      const balanceBefore = sellingClub.finances.balance;
      const budgetBefore = sellingClub.finances.transferBudget;

      const result = executeTransfer(
        acceptedOffer(buyingClub, sellingClub, player, fee),
        buyingClub, sellingClub, player, players, [],
      );

      expect(result).not.toBeNull();
      expect(result!.updatedSellingClub.finances.debt).toBe(0);
      expect(result!.updatedSellingClub.finances.balance).toBe(balanceBefore + fee);
      expect(result!.updatedSellingClub.finances.transferBudget).toBe(budgetBefore + fee);
    });

    it('D. debt exactly equal to the fee: fully repaid, nothing credited', () => {
      const { buyingClub, sellingClub, player, players } = debtScenario();
      const fee = 1_000_000;
      sellingClub.finances.debt = fee;
      const balanceBefore = sellingClub.finances.balance;
      const budgetBefore = sellingClub.finances.transferBudget;

      const result = executeTransfer(
        acceptedOffer(buyingClub, sellingClub, player, fee),
        buyingClub, sellingClub, player, players, [],
      );

      expect(result).not.toBeNull();
      expect(result!.updatedSellingClub.finances.debt).toBe(0);
      expect(result!.updatedSellingClub.finances.balance).toBe(balanceBefore);
      expect(result!.updatedSellingClub.finances.transferBudget).toBe(budgetBefore);
    });

    it('E. successive sales repay the remaining debt then credit remainders', () => {
      const { buyingClub, sellingClub, players } = debtScenario();
      const fee = 1_000_000;
      sellingClub.finances.debt = 1_500_000;
      const balanceBefore = sellingClub.finances.balance;
      const budgetBefore = sellingClub.finances.transferBudget;

      // Two distinct players from the same selling club.
      const playerA = players.find((p) => p.contract.clubId === sellingClub.id)!;
      const playerB = players.find(
        (p) => p.contract.clubId === sellingClub.id && p.id !== playerA.id,
      )!;

      const first = executeTransfer(
        acceptedOffer(buyingClub, sellingClub, playerA, fee, 'offer-e1'),
        buyingClub, sellingClub, playerA, players, [],
      );
      expect(first).not.toBeNull();
      // First sale: 1M against 1.5M debt -> debt 500k, no proceeds.
      expect(first!.updatedSellingClub.finances.debt).toBe(500_000);
      expect(first!.updatedSellingClub.finances.balance).toBe(balanceBefore);

      const second = executeTransfer(
        acceptedOffer(
          first!.updatedBuyingClub,
          first!.updatedSellingClub,
          playerB,
          fee,
          'offer-e2',
        ),
        first!.updatedBuyingClub,
        first!.updatedSellingClub,
        playerB,
        players,
        [],
      );
      expect(second).not.toBeNull();
      // Second sale: 500k repays the rest of the debt, 500k is proceeds.
      expect(second!.updatedSellingClub.finances.debt).toBe(0);
      expect(second!.updatedSellingClub.finances.balance).toBe(balanceBefore + 500_000);
      expect(second!.updatedSellingClub.finances.transferBudget).toBe(budgetBefore + 500_000);
    });

    it('F. negative seller balance: debt repaid, remainder keeps balance negative', () => {
      const { buyingClub, sellingClub, player, players } = debtScenario();
      const fee = 1_000_000;
      sellingClub.finances.debt = 300_000;
      sellingClub.finances.balance = -900_000;

      const result = executeTransfer(
        acceptedOffer(buyingClub, sellingClub, player, fee),
        buyingClub, sellingClub, player, players, [],
      );

      expect(result).not.toBeNull();
      expect(result!.updatedSellingClub.finances.debt).toBe(0);
      // Remainder 700k applied to -900k -> still negative, not converted to debt.
      expect(result!.updatedSellingClub.finances.balance).toBe(-200_000);
    });

    it('G. a refused execution leaves every financial field untouched', () => {
      const { buyingClub, sellingClub, player, players } = debtScenario();
      sellingClub.finances.debt = 800_000;
      // Buyer cannot cover the fee: execution returns null before any write.
      buyingClub.finances.transferBudget = 10;

      const sellerBefore = JSON.stringify(sellingClub.finances);
      const buyerBefore = JSON.stringify(buyingClub.finances);

      const result = executeTransfer(
        acceptedOffer(buyingClub, sellingClub, player, 1_000_000),
        buyingClub, sellingClub, player, players, [],
      );

      expect(result).toBeNull();
      expect(JSON.stringify(sellingClub.finances)).toBe(sellerBefore);
      expect(JSON.stringify(buyingClub.finances)).toBe(buyerBefore);
      expect(sellingClub.finances.debt).toBe(800_000);
    });

    it('H. the buyer debt is never modified by a purchase', () => {
      const { buyingClub, sellingClub, player, players } = debtScenario();
      sellingClub.finances.debt = 600_000;
      buyingClub.finances.debt = 123_456;

      const result = executeTransfer(
        acceptedOffer(buyingClub, sellingClub, player, 1_000_000),
        buyingClub, sellingClub, player, players, [],
      );

      expect(result).not.toBeNull();
      expect(result!.updatedBuyingClub.finances.debt).toBe(123_456);
      expect(result!.updatedSellingClub.finances.debt).toBe(0);
    });

    it('I. AI-driven sales go through the same repayment rule', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.1); // every club attempts
      const seedData = generateSeedData(12345);
      const clubs = seedData.clubs.slice(0, 6);
      const players = seedData.players.filter((p) =>
        clubs.some((c) => c.squad.includes(p.id)),
      );
      // Debt far above any possible fee: every sale proceeds fully to debt.
      clubs.forEach((c) => {
        c.finances.debt = 1_000_000_000_000;
      });
      const initialDebt = new Map(clubs.map((c) => [c.id, c.finances.debt]));
      const initialBalance = new Map(clubs.map((c) => [c.id, c.finances.balance]));
      const initialBudget = new Map(clubs.map((c) => [c.id, c.finances.transferBudget]));

      const offers = processAITransferActivity(clubs, players, [], true, []);
      const accepted = offers.filter((o) => o.status === 'accepted');
      expect(accepted.length).toBeGreaterThan(0);

      const feesSold = new Map<string, number>();
      const feesBought = new Map<string, number>();
      accepted.forEach((o) => {
        feesSold.set(o.sellingClubId, (feesSold.get(o.sellingClubId) ?? 0) + o.offerAmount);
        feesBought.set(o.buyingClubId, (feesBought.get(o.buyingClubId) ?? 0) + o.offerAmount);
      });

      clubs.forEach((club) => {
        const sold = feesSold.get(club.id) ?? 0;
        const bought = feesBought.get(club.id) ?? 0;
        // Every sold pound repaid debt; nothing reached balance/budget.
        expect(club.finances.debt).toBe(initialDebt.get(club.id)! - sold);
        expect(club.finances.balance).toBe(initialBalance.get(club.id)! - bought);
        expect(club.finances.transferBudget).toBe(
          initialBudget.get(club.id)! - bought,
        );
      });
    });
  });

  describe('Execution Boundary Validation', () => {
    function executionScenario(offerAmount: number) {
      const seedData = generateSeedData(12345);
      const buyingClub = seedData.clubs[0];
      const sellingClub = seedData.clubs[1];
      const player = seedData.players.find(
        (p) => p.contract.clubId === sellingClub.id,
      )!;
      buyingClub.finances.transferBudget = 100_000_000;
      buyingClub.finances.wageBudget = 100_000_000;
      const offer: TransferOffer = {
        id: 'offer-x',
        playerId: player.id,
        buyingClubId: buyingClub.id,
        sellingClubId: sellingClub.id,
        offerAmount,
        status: 'accepted',
        createdAt: new Date('2025-01-01'),
        resolvedAt: new Date('2025-01-01'),
      };
      return { seedData, buyingClub, sellingClub, player, offer };
    }

    it.each([0, -5, NaN, Infinity, -Infinity, 100.5])(
      'rejects offerAmount %p without mutating anything',
      (amount) => {
        const { seedData, buyingClub, sellingClub, player, offer } =
          executionScenario(amount);
        const clubsBefore = JSON.stringify([buyingClub, sellingClub]);
        const playersBefore = JSON.stringify(seedData.players);
        const history: TransferRecord[] = [];

        const result = executeTransfer(
          offer, buyingClub, sellingClub, player, seedData.players, history,
        );

        expect(result).toBeNull();
        expect(JSON.stringify([buyingClub, sellingClub])).toBe(clubsBefore);
        expect(JSON.stringify(seedData.players)).toBe(playersBefore);
        expect(history).toHaveLength(0);
      },
    );

    it('rejects a self-transfer at execution', () => {
      const seedData = generateSeedData(12345);
      const club = seedData.clubs[0];
      const player = seedData.players.find(
        (p) => p.contract.clubId === club.id,
      )!;
      club.finances.transferBudget = 100_000_000;
      club.finances.wageBudget = 100_000_000;
      const offer: TransferOffer = {
        id: 'offer-self',
        playerId: player.id,
        buyingClubId: club.id,
        sellingClubId: club.id,
        offerAmount: 10_000_000,
        status: 'accepted',
        createdAt: new Date('2025-01-01'),
        resolvedAt: new Date('2025-01-01'),
      };
      const squadBefore = [...club.squad];

      const result = executeTransfer(
        offer, club, club, player, seedData.players, [],
      );

      expect(result).toBeNull();
      expect(club.squad).toEqual(squadBefore);
    });

    it('does not consume RNG values for rejected offers', () => {
      const FIXED_NOW = new Date('2025-01-01T00:00:00Z');
      const build = () => {
        const seedData = generateSeedData(12345);
        const buyingClub = seedData.clubs[0];
        const sellingClub = seedData.clubs[1];
        const player = seedData.players.find(
          (p) => p.contract.clubId === sellingClub.id,
        )!;
        buyingClub.finances.transferBudget = 100_000_000;
        buyingClub.finances.wageBudget = 100_000_000;
        return { seedData, buyingClub, sellingClub, player };
      };
      const validOffer = (b: Club, s: Club, p: Player): TransferOffer => ({
        id: 'offer-rng', playerId: p.id,
        buyingClubId: b.id, sellingClubId: s.id,
        offerAmount: 10_000_000, status: 'accepted',
        createdAt: FIXED_NOW, resolvedAt: FIXED_NOW,
      });

      // Run A: rejected offer consumes the first RNG draws, then a valid
      // transfer uses whatever remains.
      const a = build();
      const rngA = new SeededRNG(777);
      const badOffer = { ...validOffer(a.buyingClub, a.sellingClub, a.player), offerAmount: NaN };
      expect(
        executeTransfer(badOffer, a.buyingClub, a.sellingClub, a.player, a.seedData.players, [], { rng: rngA, now: FIXED_NOW }),
      ).toBeNull();
      const resultA = executeTransfer(
        validOffer(a.buyingClub, a.sellingClub, a.player),
        a.buyingClub, a.sellingClub, a.player, a.seedData.players, [],
        { rng: rngA, now: FIXED_NOW },
      );

      // Run B: identical inputs but no rejected call — the valid transfer
      // must consume the RNG stream from the very first draw.
      const b = build();
      const rngB = new SeededRNG(777);
      const resultB = executeTransfer(
        validOffer(b.buyingClub, b.sellingClub, b.player),
        b.buyingClub, b.sellingClub, b.player, b.seedData.players, [],
        { rng: rngB, now: FIXED_NOW },
      );

      // Identical wage and contract expiry prove the rejected call
      // consumed zero RNG values.
      expect(resultA).not.toBeNull();
      expect(resultB).not.toBeNull();
      expect(resultA!.updatedPlayer.contract.wage).toBe(
        resultB!.updatedPlayer.contract.wage,
      );
      expect(resultA!.updatedPlayer.contract.contractExpiryDate.getTime()).toBe(
        resultB!.updatedPlayer.contract.contractExpiryDate.getTime(),
      );
    });

    it('does not consume RNG values when rejected for exceeding the transfer budget', () => {
      const FIXED_NOW = new Date('2025-01-01T00:00:00Z');
      const build = () => {
        const seedData = generateSeedData(12345);
        const buyingClub = seedData.clubs[0];
        const sellingClub = seedData.clubs[1];
        const player = seedData.players.find(
          (p) => p.contract.clubId === sellingClub.id,
        )!;
        buyingClub.finances.transferBudget = 5_000_000;
        buyingClub.finances.wageBudget = 100_000_000;
        return { seedData, buyingClub, sellingClub, player };
      };
      const makeOffer = (b: Club, s: Club, p: Player, amount: number): TransferOffer => ({
        id: `offer-${amount}`, playerId: p.id,
        buyingClubId: b.id, sellingClubId: s.id,
        offerAmount: amount, status: 'accepted',
        createdAt: FIXED_NOW, resolvedAt: FIXED_NOW,
      });

      // Scenario A: over-budget offer rejected, then a valid offer on the
      // same RNG stream.
      const a = build();
      const rngA = new SeededRNG(999);
      const clubsBeforeA = JSON.stringify([a.buyingClub, a.sellingClub]);
      const playersBeforeA = JSON.stringify(a.seedData.players);
      const historyA: TransferRecord[] = [];
      const overBudget = makeOffer(a.buyingClub, a.sellingClub, a.player, 10_000_000);
      expect(
        executeTransfer(overBudget, a.buyingClub, a.sellingClub, a.player, a.seedData.players, historyA, { rng: rngA, now: FIXED_NOW }),
      ).toBeNull();
      expect(JSON.stringify([a.buyingClub, a.sellingClub])).toBe(clubsBeforeA);
      expect(JSON.stringify(a.seedData.players)).toBe(playersBeforeA);
      expect(historyA).toHaveLength(0);
      const resultA = executeTransfer(
        makeOffer(a.buyingClub, a.sellingClub, a.player, 1_000_000),
        a.buyingClub, a.sellingClub, a.player, a.seedData.players, [],
        { rng: rngA, now: FIXED_NOW },
      );

      // Scenario B: identical seed, valid offer only — RNG untouched by
      // any prior rejection.
      const b = build();
      const rngB = new SeededRNG(999);
      const resultB = executeTransfer(
        makeOffer(b.buyingClub, b.sellingClub, b.player, 1_000_000),
        b.buyingClub, b.sellingClub, b.player, b.seedData.players, [],
        { rng: rngB, now: FIXED_NOW },
      );

      expect(resultA).not.toBeNull();
      expect(resultB).not.toBeNull();
      expect(resultA!.updatedPlayer.contract.wage).toBe(
        resultB!.updatedPlayer.contract.wage,
      );
      expect(resultA!.updatedPlayer.contract.contractExpiryDate.getTime()).toBe(
        resultB!.updatedPlayer.contract.contractExpiryDate.getTime(),
      );
    });

    it('still executes a valid offer normally', () => {
      const { seedData, buyingClub, sellingClub, player, offer } =
        executionScenario(10_000_000);
      const result = executeTransfer(
        offer, buyingClub, sellingClub, player, seedData.players, [],
      );
      expect(result).not.toBeNull();
      expect(result!.updatedBuyingClub.finances.transferBudget).toBe(90_000_000);
      expect(result!.transferRecord.fee).toBe(10_000_000);
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
