import {
  Club,
  Player,
  TransferOffer,
  TransferOfferStatus,
  TransferRecord,
} from '@club-director/shared-types';
import { calculateMarketValue } from './valuation';

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

  // Check minimum offer threshold (70% of market value)
  const marketValue = calculateMarketValue(player);
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
      createdAt: new Date(),
    };
    return {
      success: true,
      offer: updatedOffer,
    };
  }

  // Create new offer
  const newOffer: TransferOffer = {
    id: `offer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    playerId: player.id,
    buyingClubId: buyingClub.id,
    sellingClubId: sellingClub.id,
    offerAmount,
    status: 'pending',
    createdAt: new Date(),
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
): {
  updatedBuyingClub: Club;
  updatedSellingClub: Club;
  updatedPlayer: Player;
  transferRecord: TransferRecord;
} | null {
  // Calculate appropriate wage for the player based on ability
  const baseWage = (player.development.currentAbility / 200) * 200000; // 0-200K base
  const wage = Math.round(baseWage + Math.random() * 50000); // Add some variance

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
  const contractYears = 3 + Math.floor(Math.random() * 3); // 3-5 years
  const contractExpiryDate = new Date();
  contractExpiryDate.setFullYear(contractExpiryDate.getFullYear() + contractYears);

  const updatedPlayer: Player = {
    ...player,
    contract: {
      ...player.contract,
      clubId: buyingClub.id,
      wage,
      contractExpiryDate,
      marketValue: calculateMarketValue(player), // Recalculate after transfer
    },
  };

  // Create transfer record
  const transferRecord: TransferRecord = {
    id: `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    playerId: player.id,
    fromClubId: sellingClub.id,
    toClubId: buyingClub.id,
    fee: offer.offerAmount,
    date: new Date(),
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
function calculateWageBill(club: Club, allPlayers: Player[]): number {
  return club.squad.reduce((total, playerId) => {
    const player = allPlayers.find((p) => p.id === playerId);
    return total + (player?.contract.wage || 0);
  }, 0);
}

/**
 * Process AI-to-AI transfer activity during a matchweek.
 * Each AI club has a chance to evaluate and make offers.
 */
export function processAITransferActivity(
  clubs: Club[],
  players: Player[],
  existingOffers: TransferOffer[],
  transferWindowOpen: boolean,
): TransferOffer[] {
  if (!transferWindowOpen) {
    return existingOffers;
  }

  const newOffers: TransferOffer[] = [...existingOffers];
  const transferredPlayerIds = new Set<string>();

  // Track players already transferred from accepted offers
  existingOffers.forEach((offer) => {
    if (offer.status === 'accepted') {
      transferredPlayerIds.add(offer.playerId);
    }
  });

  // Each AI club has ~15% chance to attempt a transfer
  clubs.forEach((buyingClub) => {
    if (Math.random() > 0.15) {
      return; // Skip this club
    }

    // Check if club has budget
    if (buyingClub.finances.transferBudget < 1000000) {
      return; // Not enough budget
    }

    // Find weak position in squad
    const weakPosition = findWeakPosition(buyingClub, players);
    if (!weakPosition) {
      return;
    }

    // Find suitable player from another club
    const targetPlayer = findSuitablePlayer(
      buyingClub,
      weakPosition,
      clubs,
      players,
      buyingClub.finances.transferBudget,
    );

    if (!targetPlayer) {
      return;
    }

    // Check if player has already been transferred
    if (transferredPlayerIds.has(targetPlayer.id)) {
      return;
    }

    const sellingClub = clubs.find((c) => c.id === targetPlayer.contract.clubId);
    if (!sellingClub || sellingClub.id === buyingClub.id) {
      return;
    }

    // Make offer at market value
    const marketValue = calculateMarketValue(targetPlayer);
    const offerAmount = marketValue;

    const result = makeOffer(
      buyingClub,
      sellingClub,
      targetPlayer,
      offerAmount,
      newOffers,
      true,
    );

    if (result.success && result.offer) {
      // For AI-to-AI, resolve immediately
      const resolution = resolveOffer(result.offer, sellingClub, marketValue);
      if (resolution === 'accepted') {
        // Mark player as transferred
        transferredPlayerIds.add(targetPlayer.id);

        // Execute transfer
        const transferResult = executeTransfer(
          result.offer,
          buyingClub,
          sellingClub,
          targetPlayer,
          players,
          [],
        );

        if (transferResult) {
          // Update clubs and players in place (this would normally be handled by the caller)
          // For now, just add the accepted offer
          const acceptedOffer: TransferOffer = {
            ...result.offer,
            status: 'accepted',
            resolvedAt: new Date(),
          };
          newOffers.push(acceptedOffer);
        }
      } else {
        newOffers.push(result.offer);
      }
    }
  });

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
): Player | null {
  const availablePlayers = players.filter(
    (p) =>
      p.primaryPosition === targetPosition &&
      p.contract.clubId !== buyingClub.id &&
      calculateMarketValue(p) <= budget,
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
