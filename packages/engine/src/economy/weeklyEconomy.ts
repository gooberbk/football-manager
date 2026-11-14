import { Club, Player } from '@club-director/shared-types';
import { calculateWageBill } from '../transfer/market';

/**
 * Apply one week of club economics to every club (managed and AI alike).
 *
 * For each club, in order:
 *   1. credit the fixed `weeklyIncome` (independent of match results);
 *   2. pay as much of the weekly wage bill as the available cash covers;
 *   3. accumulate any unpaid wages into `debt` — existing debt is preserved,
 *      never reset or repaid here (repayment/settlement: later phases).
 *
 * `balance` can never be driven negative BY payroll: wages are only paid
 * up to the cash actually available. A balance that is already negative
 * before the week (e.g. after a transfer fee) is preserved as-is — the
 * engine does not silently erase historical balances, and payroll itself
 * never increases the deficit.
 *
 * Pure and deterministic: no RNG, no Date usage, inputs are not mutated.
 * `players` must be the post-transfer player list so wages reflect the
 * contracts resulting from this matchweek's transfer activity.
 */
export function applyWeeklyEconomy(clubs: Club[], players: Player[]): Club[] {
  return clubs.map((club) => {
    const wageBill = calculateWageBill(club, players);
    const availableCash = club.finances.balance + club.finances.weeklyIncome;
    const paidWages = Math.min(Math.max(availableCash, 0), wageBill);
    const unpaidWages = wageBill - paidWages;

    return {
      ...club,
      finances: {
        ...club.finances,
        balance: availableCash - paidWages,
        debt: club.finances.debt + unpaidWages,
      },
    };
  });
}
