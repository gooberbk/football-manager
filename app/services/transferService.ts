import type {
  Club,
  Player,
  TransferOffer,
  TransferRecord,
} from '@club-director/shared-types';
import {
  makeOffer,
  resolveOffer,
  executeTransfer,
  calculateMarketValue,
} from '@club-director/engine';

export interface TransferActionResult {
  success: boolean;
  error?: string;
  /** Updated offer list when offers changed. */
  offers?: TransferOffer[];
  /** Updated club list when a transfer was executed. */
  clubs?: Club[];
  /** Updated player list when a transfer was executed. */
  players?: Player[];
  /** Updated transfer history when a transfer was executed. */
  transferHistory?: TransferRecord[];
}

export interface SubmitOfferParams {
  buyingClub: Club;
  sellingClub: Club;
  player: Player;
  amount: number;
  offers: TransferOffer[];
  transferWindowOpen: boolean;
}

/**
 * Submit a transfer offer on behalf of the managed club.
 * Wraps the engine's makeOffer() and returns the updated offer list.
 */
export function submitOffer(params: SubmitOfferParams): TransferActionResult {
  const { buyingClub, sellingClub, player, amount, offers, transferWindowOpen } = params;

  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    return { success: false, error: 'Offer amount must be a positive whole number' };
  }

  if (buyingClub.id === sellingClub.id) {
    return { success: false, error: 'Cannot buy a player from your own club' };
  }

  if (player.contract.clubId !== sellingClub.id) {
    return { success: false, error: 'Player does not belong to the selling club' };
  }

  const result = makeOffer(
    buyingClub,
    sellingClub,
    player,
    amount,
    offers,
    transferWindowOpen,
  );

  if (!result.success || !result.offer) {
    return { success: false, error: result.error || 'Failed to create offer' };
  }

  // makeOffer returns a new/updated offer object but does not mutate the
  // existing list, so reconcile it into the offers array here.
  const offerIndex = offers.findIndex(
    (o) =>
      o.id === result.offer!.id ||
      (o.playerId === result.offer!.playerId &&
        o.buyingClubId === result.offer!.buyingClubId &&
        o.status === 'pending'),
  );

  const updatedOffers = [...offers];
  if (offerIndex !== -1) {
    updatedOffers[offerIndex] = result.offer;
  } else {
    updatedOffers.push(result.offer);
  }

  return { success: true, offers: updatedOffers };
}

export interface ResolveOfferParams {
  offerId: string;
  offers: TransferOffer[];
  clubs: Club[];
  players: Player[];
  transferHistory: TransferRecord[];
}

/**
 * Resolve a pending offer. The selling club's acceptance is decided by the
 * engine's resolveOffer(); accepted offers are executed via executeTransfer()
 * and the resulting club/player/history updates are returned.
 */
export function resolvePendingOffer(params: ResolveOfferParams): TransferActionResult {
  const { offerId, offers, clubs, players, transferHistory } = params;

  const offer = offers.find((o) => o.id === offerId);
  if (!offer) {
    return { success: false, error: 'Offer not found' };
  }
  if (offer.status !== 'pending') {
    return { success: false, error: `Offer already ${offer.status}` };
  }

  const buyingClub = clubs.find((c) => c.id === offer.buyingClubId);
  const sellingClub = clubs.find((c) => c.id === offer.sellingClubId);
  const player = players.find((p) => p.id === offer.playerId);

  if (!buyingClub || !sellingClub || !player) {
    return { success: false, error: 'Offer references missing club or player' };
  }

  // Single real-time reference for this interactive resolution: market
  // valuation and resolution timestamps share it.
  const now = new Date();

  // Guard against stale offers: the player must still be at the selling club.
  if (player.contract.clubId !== offer.sellingClubId) {
    const resolvedOffer: TransferOffer = {
      ...offer,
      status: 'rejected',
      resolvedAt: now,
    };
    return {
      success: false,
      error: 'Player is no longer at the selling club',
      offers: offers.map((o) => (o.id === offerId ? resolvedOffer : o)),
    };
  }

  const marketValue = calculateMarketValue(player, now);
  const status = resolveOffer(offer, sellingClub, marketValue);
  const resolvedOffer: TransferOffer = {
    ...offer,
    status,
    resolvedAt: now,
  };
  const updatedOffers = offers.map((o) => (o.id === offerId ? resolvedOffer : o));

  if (status !== 'accepted') {
    return { success: true, offers: updatedOffers };
  }

  const execution = executeTransfer(
    resolvedOffer,
    buyingClub,
    sellingClub,
    player,
    players,
    transferHistory,
    // Pin the same date captured above so valuation, resolution
    // timestamp, post-transfer market value, contract expiry and the
    // transfer record all share one reference instant. `rng` stays
    // undefined: interactive wage variance keeps using Math.random().
    { now },
  );

  if (!execution) {
    // Execution failed (e.g. wage budget). The offer must NOT be reported as
    // accepted: omit `offers` so the caller keeps the offer pending and it
    // can be retried if the buyer's finances change.
    return {
      success: false,
      error: 'Transfer could not be completed (insufficient wage budget)',
    };
  }

  const updatedClubs = clubs.map((club) => {
    if (club.id === execution.updatedBuyingClub.id) return execution.updatedBuyingClub;
    if (club.id === execution.updatedSellingClub.id) return execution.updatedSellingClub;
    return club;
  });

  const updatedPlayers = players.map((p) =>
    p.id === execution.updatedPlayer.id ? execution.updatedPlayer : p,
  );

  return {
    success: true,
    offers: updatedOffers,
    clubs: updatedClubs,
    players: updatedPlayers,
    transferHistory: [...transferHistory, execution.transferRecord],
  };
}

/**
 * Withdraw a pending offer. The domain model supports a 'withdrawn' status,
 * so the offer is marked rather than deleted.
 */
export function withdrawPendingOffer(
  offers: TransferOffer[],
  offerId: string,
): TransferOffer[] {
  return offers.map((o) =>
    o.id === offerId && o.status === 'pending'
      ? { ...o, status: 'withdrawn' as const, resolvedAt: new Date() }
      : o,
  );
}
