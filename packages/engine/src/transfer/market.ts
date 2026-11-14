import {
  Club,
  Player,
  TransferOffer,
  TransferOfferStatus,
  TransferRecord,
} from '@club-director/shared-types';
import { calculateMarketValue } from './valuation';
import { SeededRNG } from '../match/simulation';

/**
 * Optional determinism context for transfer operations. When `rng`/`now`
 * are supplied (e.g. by advanceMatchweek), IDs, wages, contract lengths
 * and timestamps become fully deterministic; when omitted, behavior is
 * unchanged for interactive callers.
 */
export interface TransferRandomContext {
  rng?: SeededRNG;
  now?: Date;
}

function offerId(prefix: string, ctx?: TransferRandomContext): string {
  const time = ctx?.now ? ctx.now.getTime() : Date.now();
  const suffix = ctx?.rng
    ? ctx.rng.nextInt(0, 4294967296).toString(36)
    : Math.random().toString(36).substr(2, 9);
  return `${prefix}-${time}-${suffix}`;
}

export interface TransferMarketState {
  offers: TransferOffer[];
  transferHistory: TransferRecord[];
}

export interface MakeOfferResult {
  success: boolean;
  offer?: TransferOffer;
  error?: string;
}

/**
 * Make a transfer offer for a player.
 * Validates budget and minimum offer threshold.
 */
export function makeOffer(
  buyingClub: Club,
  sellingClub: Club,
  player: Player,
  offerAmount: number,
  existingOffers: TransferOffer[],
  transferWindowOpen: boolean,
  ctx?: TransferRandomContext,
): MakeOfferResult {
  // Check if transfer window is open
  if (!transferWindowOpen) {
    return {
      success: false,
      error: 'Transfer window is closed',
    };
  }

  // Check if player belongs to selling club
  if (player.contract.clubId !== sellingClub.id) {
    return {
      success: false,
      error: 'Player does not belong to selling club',
    };
  }

  // Check if buying club has sufficient budget
  if (offerAmount > buyingClub.finances.transferBudget) {
    return {
      success: false,
      error: 'Insufficient transfer budget',
    };
  }

  // Check minimum offer threshold (70% of market value). The valuation
  // reference date comes from the deterministic context when present.
  const marketValue = calculateMarketValue(player, ctx?.now);
  const minOffer = marketValue * 0.7;
  if (offerAmount < minOffer) {
    return {
      success: false,
      error: `Offer too low (minimum: ${Math.round(minOffer).toLocaleString()})`,
    };
  }

  // Check for existing pending offer from same buying club
  const existingPendingOffer = existingOffers.find(
    (o) =>
      o.playerId === player.id &&
      o.buyingClubId === buyingClub.id &&
      o.status === 'pending',
  );

  if (existingPendingOffer) {
    // Update existing offer
    const updatedOffer: TransferOffer = {
      ...existingPendingOffer,
      offerAmount,
      createdAt: ctx?.now ?? new Date(),
    };
    return {
      success: true,
      offer: updatedOffer,
    };
  }

  // Create new offer
  const newOffer: TransferOffer = {
    id: offerId('offer', ctx),
    playerId: player.id,
    buyingClubId: buyingClub.id,
    sellingClubId: sellingClub.id,
    offerAmount,
    status: 'pending',
    createdAt: ctx?.now ?? new Date(),
  };

  return {
    success: true,
    offer: newOffer,
  };
}

/**
 * Resolve a transfer offer (AI selling club decision).
 * Accepts if offer is high enough relative to market value and club's financial situation.
 */
export function resolveOffer(
  offer: TransferOffer,
  sellingClub: Club,
  marketValue: number,
): TransferOfferStatus {
  // Selling club acceptance threshold varies by financial need
  let acceptanceThreshold = 1.0; // Default: needs full market value

  const balanceRatio = sellingClub.finances.balance / sellingClub.finances.wageBudget;

  if (balanceRatio < 10) {
    // Desperate for money: accept 80% of market value
    acceptanceThreshold = 0.8;
  } else if (balanceRatio < 20) {
    // Need money: accept 90% of market value
    acceptanceThreshold = 0.9;
  } else if (balanceRatio > 50) {
    // Financially secure: need 110% of market value
    acceptanceThreshold = 1.1;
  }

  const offerRatio = offer.offerAmount / marketValue;

  if (offerRatio >= acceptanceThreshold) {
    return 'accepted';
  } else if (offerRatio >= acceptanceThreshold * 0.8) {
    // Close to threshold - could counter-offer (for now, just reject)
    return 'rejected';
  } else {
    return 'rejected';
  }
}

/**
 * Execute a completed transfer.
 * Updates club finances, player club assignment, and transfer history.
 */
export function executeTransfer(
  offer: TransferOffer,
  buyingClub: Club,
  sellingClub: Club,
  player: Player,
  allPlayers: Player[],
  transferHistory?: TransferRecord[],
  ctx?: TransferRandomContext,
): {
  updatedBuyingClub: Club;
  updatedSellingClub: Club;
  updatedPlayer: Player;
  transferRecord: TransferRecord;
} | null {
  // Calculate appropriate wage for the player based on ability
  const baseWage = (player.development.currentAbility / 200) * 200000; // 0-200K base
  const wageVariance = ctx?.rng ? ctx.rng.next() : Math.random();
  const wage = Math.round(baseWage + wageVariance * 50000); // Add some variance

  // Check if buyer has sufficient wage budget
  const currentWageBill = calculateWageBill(buyingClub, allPlayers);
  if (currentWageBill + wage > buyingClub.finances.wageBudget) {
    return null; // Cannot afford wage
  }

  // Update buying club
  const updatedBuyingClub: Club = {
    ...buyingClub,
    finances: {
      ...buyingClub.finances,
      balance: buyingClub.finances.balance - offer.offerAmount,
      transferBudget: buyingClub.finances.transferBudget - offer.offerAmount,
      wageBudget: buyingClub.finances.wageBudget - wage,
    },
    squad: [...buyingClub.squad, player.id],
  };

  // Update selling club
  const updatedSellingClub: Club = {
    ...sellingClub,
    finances: {
      ...sellingClub.finances,
      balance: sellingClub.finances.balance + offer.offerAmount,
      transferBudget: sellingClub.finances.transferBudget + offer.offerAmount,
      wageBudget: sellingClub.finances.wageBudget + wage,
    },
    squad: sellingClub.squad.filter((id) => id !== player.id),
  };

  // Update player
  const contractYears = 3 + (ctx?.rng ? ctx.rng.nextInt(0, 3) : Math.floor(Math.random() * 3)); // 3-5 years
  const contractExpiryDate = new Date(ctx?.now ?? Date.now());
  contractExpiryDate.setFullYear(contractExpiryDate.getFullYear() + contractYears);

  const updatedPlayer: Player = {
    ...player,
    contract: {
      ...player.contract,
      clubId: buyingClub.id,
      wage,
      contractExpiryDate,
      marketValue: calculateMarketValue(player, ctx?.now), // Recalculate after transfer
    },
  };

  // Create transfer record
  const transferRecord: TransferRecord = {
    id: offerId('transfer', ctx),
    playerId: player.id,
    fromClubId: sellingClub.id,
    toClubId: buyingClub.id,
    fee: offer.offerAmount,
    date: ctx?.now ?? new Date(),
  };

  return {
    updatedBuyingClub,
    updatedSellingClub,
    updatedPlayer,
    transferRecord,
  };
}

/**
 * Calculate the total wage bill for a club.
 */
export function calculateWageBill(club: Club, allPlayers: Player[]): number {
  return club.squad.reduce((total, playerId) => {
    const player = allPlayers.find((p) => p.id === playerId);
    return total + (player?.contract.wage || 0);
  }, 0);
}

/**
 * Process AI-to-AI transfer activity during a matchweek.
 * Each AI club has a chance to evaluate and make offers.
 *
 * Accepted offers are genuinely executed: the buying/selling clubs' finances
 * and squads, the player's contract, and (when provided) the transfer history
 * are updated. The `clubs` and `players` arrays are mutated in place so
 * callers observe the post-transfer state.
 *
 * @param excludedClubIds clubs that must not participate in AI transfers at
 *                        all (e.g. the human-managed club): they neither buy
 *                        nor have players auto-sold
 * @param transferHistory optional array that completed TransferRecords are
 *                        appended to
 */
export function processAITransferActivity(
  clubs: Club[],
  players: Player[],
  existingOffers: TransferOffer[],
  transferWindowOpen: boolean,
  excludedClubIds: string[] = [],
  transferHistory?: TransferRecord[],
  ctx?: TransferRandomContext,
): TransferOffer[] {
  if (!transferWindowOpen) {
    return existingOffers;
  }

  const newOffers: TransferOffer[] = [...existingOffers];
  const transferredPlayerIds = new Set<string>();
  const excluded = new Set(excludedClubIds);

  // Track players already transferred from accepted offers
  existingOffers.forEach((offer) => {
    if (offer.status === 'accepted') {
      transferredPlayerIds.add(offer.playerId);
    }
  });

  // Each AI club has ~15% chance to attempt a transfer
  for (const club of clubs) {
    // Always work from the latest in-place state (earlier transfers this
    // run may have replaced this club's object).
    const buyingClub = clubs.find((c) => c.id === club.id) ?? club;

    if (excluded.has(buyingClub.id)) {
      continue; // Managed club never participates as an AI buyer
    }

    const gateRoll = ctx?.rng ? ctx.rng.next() : Math.random();
    if (gateRoll > 0.15) {
      continue; // Skip this club
    }

    // Check if club has budget
    if (buyingClub.finances.transferBudget < 1000000) {
      continue; // Not enough budget
    }

    // Find weak position in squad
    const weakPosition = findWeakPosition(buyingClub, players);
    if (!weakPosition) {
      continue;
    }

    // Find suitable player from another club
    const targetPlayer = findSuitablePlayer(
      buyingClub,
      weakPosition,
      clubs,
      players,
      buyingClub.finances.transferBudget,
      ctx?.now,
    );

    if (!targetPlayer) {
      continue;
    }

    // Check if player has already been transferred
    if (transferredPlayerIds.has(targetPlayer.id)) {
      continue;
    }

    const sellingClub = clubs.find((c) => c.id === targetPlayer.contract.clubId);
    if (
      !sellingClub ||
      sellingClub.id === buyingClub.id ||
      excluded.has(sellingClub.id)
    ) {
      // The managed club never sells players through automated AI resolution;
      // the user must decide those transfers manually.
      continue;
    }

    // Make offer at market value — valued at the deterministic
    // simulation date so AI decisions replay identically.
    const marketValue = calculateMarketValue(targetPlayer, ctx?.now);
    const offerAmount = marketValue;

    const result = makeOffer(
      buyingClub,
      sellingClub,
      targetPlayer,
      offerAmount,
      newOffers,
      true,
      ctx,
    );

    if (!result.success || !result.offer) {
      continue;
    }

    // For AI-to-AI, resolve immediately
    const resolution = resolveOffer(result.offer, sellingClub, marketValue);

    if (resolution !== 'accepted') {
      // Record the truthful outcome: the offer was resolved and rejected,
      // not left pending.
      newOffers.push({
        ...result.offer,
        status: 'rejected',
        resolvedAt: ctx?.now ?? new Date(),
      });
      continue;
    }

    // Execute the transfer for real and apply the returned state.
    const transferResult = executeTransfer(
      result.offer,
      buyingClub,
      sellingClub,
      targetPlayer,
      players,
      transferHistory,
      ctx,
    );

    if (!transferResult) {
      // Execution failed (e.g. wage budget) - do not record an accepted
      // offer and leave game state untouched.
      continue;
    }

    const buyerIndex = clubs.findIndex((c) => c.id === transferResult.updatedBuyingClub.id);
    if (buyerIndex !== -1) {
      clubs[buyerIndex] = transferResult.updatedBuyingClub;
    }
    const sellerIndex = clubs.findIndex((c) => c.id === transferResult.updatedSellingClub.id);
    if (sellerIndex !== -1) {
      clubs[sellerIndex] = transferResult.updatedSellingClub;
    }
    const playerIndex = players.findIndex((p) => p.id === transferResult.updatedPlayer.id);
    if (playerIndex !== -1) {
      players[playerIndex] = transferResult.updatedPlayer;
    }
    if (transferHistory) {
      transferHistory.push(transferResult.transferRecord);
    }

    transferredPlayerIds.add(targetPlayer.id);

    newOffers.push({
      ...result.offer,
      status: 'accepted',
      resolvedAt: ctx?.now ?? new Date(),
    });
  }

  return newOffers;
}

/**
 * Find the weakest position in a club's squad.
 */
function findWeakPosition(club: Club, players: Player[]): string | null {
  const squadPlayers = players.filter((p) => club.squad.includes(p.id));

  if (squadPlayers.length === 0) {
    return null;
  }

  // Calculate average ability per position
  const positionGroups = new Map<string, number[]>();

  squadPlayers.forEach((player) => {
    const position = player.primaryPosition;
    const ability = player.development.currentAbility;
    if (!positionGroups.has(position)) {
      positionGroups.set(position, []);
    }
    positionGroups.get(position)!.push(ability);
  });

  // Find position with lowest average ability and fewest players
  let weakestPosition: string | null = null;
  let lowestScore = Infinity;

  positionGroups.forEach((abilities, position) => {
    const avgAbility = abilities.reduce((a, b) => a + b, 0) / abilities.length;
    const playerCount = abilities.length;
    const score = avgAbility / playerCount; // Lower = weaker

    if (score < lowestScore) {
      lowestScore = score;
      weakestPosition = position;
    }
  });

  return weakestPosition;
}

/**
 * Find a suitable player for transfer from another club.
 */
function findSuitablePlayer(
  buyingClub: Club,
  targetPosition: string,
  clubs: Club[],
  players: Player[],
  budget: number,
  now?: Date,
): Player | null {
  const availablePlayers = players.filter(
    (p) =>
      p.primaryPosition === targetPosition &&
      p.contract.clubId !== buyingClub.id &&
      calculateMarketValue(p, now) <= budget,
  );

  if (availablePlayers.length === 0) {
    return null;
  }

  // Prefer higher-ability players within budget
  availablePlayers.sort((a, b) => b.development.currentAbility - a.development.currentAbility);

  return availablePlayers[0];
}

/**
 * Check if a player has already been transferred in the current set of offers.
 */
function isPlayerTransferred(playerId: string, offers: TransferOffer[]): boolean {
  return offers.some(
    (o) => o.playerId === playerId && o.status === 'accepted',
  );
}
