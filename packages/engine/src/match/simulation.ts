import type {
  Club,
  Player,
  PlayerMap,
  MatchResult,
  MatchEvent,
  MatchStats,
  ClubTactics,
  Position,
  EventType,
  Formation,
} from '@club-director/shared-types';

// Seeded PRNG using mulberry32 algorithm
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  // Returns a random float between 0 and 1
  next(): number {
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Returns a random integer between min (inclusive) and max (exclusive)
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  // Returns a random element from an array
  nextChoice<T>(array: T[]): T {
    return array[this.nextInt(0, array.length)];
  }

  // Returns true with given probability (0-1)
  nextBool(probability: number): boolean {
    return this.next() < probability;
  }

  // Returns a normally distributed random number (Box-Muller transform)
  nextNormal(mean: number = 0, stdDev: number = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return num * stdDev + mean;
  }
}

interface TeamStrength {
  attackRating: number;
  midfieldRating: number;
  defenseRating: number;
  gkRating: number;
  averageFitness: number;
  averageForm: number;
  averageMorale: number;
}

interface StartingXI {
  players: Player[];
  gk: Player;
  defenders: Player[];
  midfielders: Player[];
  forwards: Player[];
}

interface PhaseResult {
  minute: number;
  possession: 'home' | 'away';
  events: MatchEvent[];
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeCorners: number;
  awayCorners: number;
  homeFouls: number;
  awayFouls: number;
}

export function simulateMatch(
  homeClub: Club,
  awayClub: Club,
  homePlayers: PlayerMap,
  awayPlayers: PlayerMap,
  seed?: number,
): MatchResult {
  const actualSeed = seed ?? Math.floor(Math.random() * 4294967296);
  const rng = new SeededRNG(actualSeed);

  const homeStrength = calculateTeamStrength(homeClub, homePlayers, rng);
  const awayStrength = calculateTeamStrength(awayClub, awayPlayers, rng);

  // Apply moderate home advantage
  homeStrength.attackRating *= 1.15;
  homeStrength.midfieldRating *= 1.10;
  homeStrength.defenseRating *= 1.08;

  // Apply tactical modifiers
  applyTacticalModifiers(homeStrength, homeClub.tactics);
  applyTacticalModifiers(awayStrength, awayClub.tactics);

  const homeStartingXI = selectStartingXI(homeClub, homePlayers, homeClub.tactics.defaultFormation);
  const awayStartingXI = selectStartingXI(awayClub, awayPlayers, awayClub.tactics.defaultFormation);

  const phases = simulatePhases(
    homeStrength,
    awayStrength,
    homeStartingXI,
    awayStartingXI,
    homeClub.id,
    awayClub.id,
    rng,
  );

  const result = aggregateResults(phases, homeClub.id, awayClub.id, actualSeed);
  return result;
}

function calculateTeamStrength(club: Club, players: PlayerMap, rng: SeededRNG): TeamStrength {
  const squadPlayers = club.squad.map((id) => players[id]).filter((p) => p !== undefined);

  if (squadPlayers.length === 0) {
    return {
      attackRating: 50,
      midfieldRating: 50,
      defenseRating: 50,
      gkRating: 50,
      averageFitness: 75,
      averageForm: 7,
      averageMorale: 75,
    };
  }

  const forwards = squadPlayers.filter((p) => ['ST', 'W', 'AM'].includes(p.primaryPosition));
  const midfielders = squadPlayers.filter((p) => ['CM', 'DM', 'AM'].includes(p.primaryPosition));
  const defenders = squadPlayers.filter((p) => ['CB', 'FB', 'DM'].includes(p.primaryPosition));
  const goalkeepers = squadPlayers.filter((p) => p.primaryPosition === 'GK');

  const attackRating = calculateAttributeAverage(forwards, [
    'shooting',
    'finishing',
    'dribbling',
    'technique',
    'pace',
    'crossing',
  ]);

  const midfieldRating = calculateAttributeAverage(midfielders, [
    'passing',
    'vision',
    'workRate',
    'positioning',
  ]);

  const defenseRating = calculateAttributeAverage(defenders, [
    'tackling',
    'positioning',
    'heading',
    'strength',
  ]);

  const gkRating = goalkeepers.length > 0
    ? calculateAttributeAverage(goalkeepers, ['positioning', 'concentration', 'anticipation'])
    : 50;

  const averageFitness = squadPlayers.reduce((sum, p) => sum + p.status.fitness, 0) / squadPlayers.length;
  const averageForm =
    squadPlayers.reduce((sum, p) => {
      const formSum = p.status.recentForm.reduce((a, b) => a + b, 0);
      return sum + formSum / p.status.recentForm.length;
    }, 0) / squadPlayers.length;
  const averageMorale = squadPlayers.reduce((sum, p) => sum + p.status.morale, 0) / squadPlayers.length;

  return {
    attackRating,
    midfieldRating,
    defenseRating,
    gkRating,
    averageFitness,
    averageForm,
    averageMorale,
  };
}

function calculateAttributeAverage(players: Player[], attributes: (keyof Player['attributes']['technical'] | keyof Player['attributes']['mental'] | keyof Player['attributes']['physical'])[]): number {
  if (players.length === 0) return 50;

  let total = 0;
  let count = 0;

  players.forEach((player) => {
    attributes.forEach((attr) => {
      if (attr in player.attributes.technical) {
        total += player.attributes.technical[attr as keyof typeof player.attributes.technical];
      } else if (attr in player.attributes.mental) {
        total += player.attributes.mental[attr as keyof typeof player.attributes.mental];
      } else if (attr in player.attributes.physical) {
        total += player.attributes.physical[attr as keyof typeof player.attributes.physical];
      }
      count++;
    });
  });

  return count > 0 ? total / count : 50;
}

function applyTacticalModifiers(strength: TeamStrength, tactics: ClubTactics): void {
  const mentalityMultiplier = tactics.mentality === 'attacking' ? 1.1 : tactics.mentality === 'defensive' ? 0.9 : 1.0;

  strength.attackRating *= mentalityMultiplier;
  strength.defenseRating *= (2 - mentalityMultiplier); // Inverse for defense

  const tempoModifier = 1 + (tactics.tempo - 10) * 0.01;
  const pressingModifier = 1 + (tactics.pressingIntensity - 10) * 0.01;

  strength.attackRating *= tempoModifier;
  strength.midfieldRating *= pressingModifier;

  // Fitness and morale adjustments
  const fitnessModifier = strength.averageFitness / 85;
  const formModifier = strength.averageForm / 7.5;
  const moraleModifier = strength.averageMorale / 75;

  strength.attackRating *= fitnessModifier * formModifier * moraleModifier;
  strength.midfieldRating *= fitnessModifier * formModifier * moraleModifier;
  strength.defenseRating *= fitnessModifier * moraleModifier;
}

function selectStartingXI(club: Club, players: PlayerMap, formation: Formation): StartingXI {
  const squadPlayers = club.squad.map((id) => players[id]).filter((p) => p !== undefined);

  const getPositionRequirements = (formation: Formation): { [key: string]: number } => {
    switch (formation) {
      case '4-4-2':
        return { GK: 1, CB: 2, FB: 2, CM: 2, W: 2, ST: 2 };
      case '4-3-3':
        return { GK: 1, CB: 2, FB: 2, CM: 3, W: 2, ST: 1 };
      case '3-5-2':
        return { GK: 1, CB: 3, FB: 2, CM: 3, ST: 2 };
      case '4-2-3-1':
        return { GK: 1, CB: 2, FB: 2, DM: 2, AM: 3, ST: 1 };
      case '5-3-2':
        return { GK: 1, CB: 3, FB: 2, CM: 3, ST: 2 };
      case '4-1-4-1':
        return { GK: 1, CB: 2, FB: 2, DM: 1, CM: 2, W: 2, ST: 1 };
      case '3-4-3':
        return { GK: 1, CB: 3, CM: 4, W: 2, ST: 1 };
      case '5-4-1':
        return { GK: 1, CB: 3, FB: 2, CM: 2, W: 2, ST: 1 };
      default:
        return { GK: 1, CB: 2, FB: 2, CM: 2, W: 2, ST: 2 };
    }
  };

  const requirements = getPositionRequirements(formation);
  const selected: Player[] = [];
  const available = [...squadPlayers];

  // Select goalkeeper first
  const gks = available.filter((p) => p.primaryPosition === 'GK');
  if (gks.length > 0) {
    const gk = gks.reduce((best, current) =>
      current.attributes.mental.positioning > best.attributes.mental.positioning ? current : best,
    );
    selected.push(gk);
    available.splice(available.indexOf(gk), 1);
  }

  // Select players for each position
  Object.entries(requirements).forEach(([position, count]) => {
    if (position === 'GK') return;

    for (let i = 0; i < count; i++) {
      const candidates = available.filter((p) =>
        p.primaryPosition === position || p.secondaryPositions.includes(position as Position),
      );

      if (candidates.length > 0) {
        const player = candidates.reduce((best, current) => {
          const bestScore = current.development.currentAbility;
          const currentScore = current.development.currentAbility;
          return currentScore > bestScore ? current : best;
        });
        selected.push(player);
        available.splice(available.indexOf(player), 1);
      } else if (available.length > 0) {
        // Fill with best available if no position match
        const player = available.reduce((best, current) =>
          current.development.currentAbility > best.development.currentAbility ? current : best,
        );
        selected.push(player);
        available.splice(available.indexOf(player), 1);
      }
    }
  });

  // Fill remaining spots with best available
  while (selected.length < 11 && available.length > 0) {
    const player = available.reduce((best, current) =>
      current.development.currentAbility > best.development.currentAbility ? current : best,
    );
    selected.push(player);
    available.splice(available.indexOf(player), 1);
  }

  const gk = selected.find((p) => p.primaryPosition === 'GK') || selected[0];
  const defenders = selected.filter((p) => ['CB', 'FB'].includes(p.primaryPosition));
  const midfielders = selected.filter((p) => ['CM', 'DM', 'AM'].includes(p.primaryPosition));
  const forwards = selected.filter((p) => ['ST', 'W'].includes(p.primaryPosition));

  return {
    players: selected,
    gk,
    defenders,
    midfielders,
    forwards,
  };
}

function simulatePhases(
  homeStrength: TeamStrength,
  awayStrength: TeamStrength,
  homeXI: StartingXI,
  awayXI: StartingXI,
  homeClubId: string,
  awayClubId: string,
  rng: SeededRNG,
): PhaseResult[] {
  const phases: PhaseResult[] = [];
  const numPhases = 30;

  for (let i = 0; i < numPhases; i++) {
    // Weight minutes toward end of match
    const minuteWeight = i / numPhases;
    const minute = Math.floor(1 + minuteWeight * 89);

    const phase = simulatePhase(
      minute,
      homeStrength,
      awayStrength,
      homeXI,
      awayXI,
      homeClubId,
      awayClubId,
      rng,
    );
    phases.push(phase);
  }

  return phases;
}

function simulatePhase(
  minute: number,
  homeStrength: TeamStrength,
  awayStrength: TeamStrength,
  homeXI: StartingXI,
  awayXI: StartingXI,
  homeClubId: string,
  awayClubId: string,
  rng: SeededRNG,
): PhaseResult {
  const result: PhaseResult = {
    minute,
    possession: 'home',
    events: [],
    homeShots: 0,
    awayShots: 0,
    homeShotsOnTarget: 0,
    awayShotsOnTarget: 0,
    homeCorners: 0,
    awayCorners: 0,
    homeFouls: 0,
    awayFouls: 0,
  };

  // Determine possession (more random to allow away wins)
  const totalMidfield = homeStrength.midfieldRating + awayStrength.midfieldRating;
  const homePossessionChance = homeStrength.midfieldRating / totalMidfield;
  result.possession = rng.nextBool(homePossessionChance) ? 'home' : 'away';

  // Add randomness to possession to prevent one-sided matches
  if (rng.nextBool(0.3)) {
    result.possession = result.possession === 'home' ? 'away' : 'home';
  }

  const attackingTeam = result.possession === 'home' ? { strength: homeStrength, xi: homeXI, clubId: homeClubId } : { strength: awayStrength, xi: awayXI, clubId: awayClubId };
  const defendingTeam = result.possession === 'home' ? { strength: awayStrength, xi: awayXI, clubId: awayClubId } : { strength: homeStrength, xi: homeXI, clubId: homeClubId };

  // Chance creation (increased for more goals)
  const attackVsDefense = attackingTeam.strength.attackRating / (attackingTeam.strength.attackRating + defendingTeam.strength.defenseRating);
  const chanceChance = 0.308 + (attackVsDefense - 0.5) * 0.10; // Tuned for average goals and 6+ rate

  // Add randomness to chance creation to allow away team chances
  const chanceVariation = 0.99 + rng.next() * 0.01; // Narrower variation to reduce high outliers
  const finalChanceChance = Math.min(0.425, chanceChance * chanceVariation);

  if (rng.nextBool(finalChanceChance)) {
    const chanceEvent = simulateChance(
      minute,
      attackingTeam.xi,
      defendingTeam.xi,
      attackingTeam.clubId,
      defendingTeam.clubId,
      attackingTeam.strength.attackRating,
      defendingTeam.strength.defenseRating,
      defendingTeam.strength.gkRating,
      rng,
      result.possession,
    );

    result.events.push(...chanceEvent.events);

    if (result.possession === 'home') {
      result.homeShots += chanceEvent.shots;
      result.homeShotsOnTarget += chanceEvent.shotsOnTarget;
    } else {
      result.awayShots += chanceEvent.shots;
      result.awayShotsOnTarget += chanceEvent.shotsOnTarget;
    }
  }

  // Independent events
  const cornerChance = 0.08;
  const foulChance = 0.12;
  const cardChance = 0.03;
  const injuryChance = 0.005;

  if (rng.nextBool(cornerChance)) {
    const cornerEvent = generateCornerEvent(
      minute,
      attackingTeam.xi,
      attackingTeam.clubId,
      result.possession,
      rng,
    );
    result.events.push(cornerEvent);

    if (result.possession === 'home') {
      result.homeCorners++;
    } else {
      result.awayCorners++;
    }
  }

  if (rng.nextBool(foulChance)) {
    const foulEvent = generateFoulEvent(
      minute,
      attackingTeam.xi,
      defendingTeam.xi,
      attackingTeam.clubId,
      defendingTeam.clubId,
      result.possession,
      rng,
    );
    result.events.push(foulEvent);

    if (result.possession === 'home') {
      result.homeFouls++;
    } else {
      result.awayFouls++;
    }

    // Card chance on foul
    if (rng.nextBool(cardChance)) {
      const cardEvent = generateCardEvent(
        minute,
        foulEvent.primaryPlayerId,
        result.possession,
        rng,
      );
      result.events.push(cardEvent);
    }
  }

  // Injury (scaled by fitness)
  const avgFitness = (attackingTeam.strength.averageFitness + defendingTeam.strength.averageFitness) / 2;
  const adjustedInjuryChance = injuryChance * (1 - avgFitness / 100);

  if (rng.nextBool(adjustedInjuryChance)) {
    const injuredPlayer = rng.nextChoice(attackingTeam.xi.players);
    const injuryEvent = generateInjuryEvent(
      minute,
      injuredPlayer,
      result.possession,
      rng,
    );
    result.events.push(injuryEvent);
  }

  return result;
}

interface ChanceResult {
  events: MatchEvent[];
  shots: number;
  shotsOnTarget: number;
}

function simulateChance(
  minute: number,
  attackingXI: StartingXI,
  defendingXI: StartingXI,
  attackingClubId: string,
  defendingClubId: string,
  attackRating: number,
  defenseRating: number,
  gkRating: number,
  rng: SeededRNG,
  attackingTeam: 'home' | 'away',
): ChanceResult {
  const result: ChanceResult = {
    events: [],
    shots: 0,
    shotsOnTarget: 0,
  };

  // Select attacker (weighted by attacking attributes)
  const attackers = [...attackingXI.forwards, ...attackingXI.midfielders];
  const attacker = selectWeightedPlayer(attackers, ['shooting', 'finishing', 'dribbling', 'pace'], rng);

  if (!attacker) return result;

  result.shots++;

  // Shot quality based on attacker attributes vs defense
  const shotQuality = (attacker.attributes.technical.shooting + attacker.attributes.technical.finishing) / 2;
  const defenseFactor = defenseRating / 100;
  const onTargetChance = 0.488 + (shotQuality - 10) * 0.025 - defenseFactor * 0.08; // Reduced from 0.63 to lower 6+ goal rate

  if (rng.nextBool(Math.max(0.1, Math.min(0.9, onTargetChance)))) {
    result.shotsOnTarget++;

    // Save vs goal (reduced GK effectiveness for more goals)
    const saveChance = (gkRating * 0.80) / (shotQuality + gkRating * 0.80);

    if (rng.nextBool(saveChance)) {
      // Save
      const gk = defendingXI.gk;
      const saveEvent: MatchEvent = {
        id: `event-${minute}-save`,
        minute,
        type: 'save',
        primaryPlayerId: gk.id,
        secondaryPlayerId: attacker.id,
        team: attackingTeam,
        description: `${gk.firstName} ${gk.lastName} makes a great save from ${attacker.firstName} ${attacker.lastName}'s shot!`,
      };
      result.events.push(saveEvent);
    } else {
      // Goal
      const goalEvent: MatchEvent = {
        id: `event-${minute}-goal`,
        minute,
        type: 'goal',
        primaryPlayerId: attacker.id,
        team: attackingTeam,
        description: `GOAL! ${attacker.firstName} ${attacker.lastName} finds the back of the net!`,
      };
      result.events.push(goalEvent);
    }
  } else {
    // Miss
    const missEvent: MatchEvent = {
      id: `event-${minute}-miss`,
      minute,
      type: 'miss',
      primaryPlayerId: attacker.id,
      team: attackingTeam,
      description: `${attacker.firstName} ${attacker.lastName} shoots wide!`,
    };
    result.events.push(missEvent);
  }

  return result;
}

function selectWeightedPlayer(
  players: Player[],
  attributes: (keyof Player['attributes']['technical'] | keyof Player['attributes']['mental'] | keyof Player['attributes']['physical'])[],
  rng: SeededRNG,
): Player | null {
  if (players.length === 0) return null;

  const weights = players.map((player) => {
    let total = 0;
    attributes.forEach((attr) => {
      if (attr in player.attributes.technical) {
        total += player.attributes.technical[attr as keyof typeof player.attributes.technical];
      } else if (attr in player.attributes.mental) {
        total += player.attributes.mental[attr as keyof typeof player.attributes.mental];
      } else if (attr in player.attributes.physical) {
        total += player.attributes.physical[attr as keyof typeof player.attributes.physical];
      }
    });
    return total;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = rng.next() * totalWeight;

  for (let i = 0; i < players.length; i++) {
    random -= weights[i];
    if (random <= 0) return players[i];
  }

  return players[players.length - 1];
}

function generateCornerEvent(
  minute: number,
  xi: StartingXI,
  clubId: string,
  team: 'home' | 'away',
  rng: SeededRNG,
): MatchEvent {
  const taker = rng.nextChoice([...xi.midfielders, ...xi.forwards]);
  return {
    id: `event-${minute}-corner`,
    minute,
    type: 'corner',
    primaryPlayerId: taker.id,
    team,
    description: `Corner kick to be taken by ${taker.firstName} ${taker.lastName}.`,
  };
}

function generateFoulEvent(
  minute: number,
  attackingXI: StartingXI,
  defendingXI: StartingXI,
  attackingClubId: string,
  defendingClubId: string,
  team: 'home' | 'away',
  rng: SeededRNG,
): MatchEvent {
  const attacker = rng.nextChoice([...attackingXI.forwards, ...attackingXI.midfielders]);
  const defender = rng.nextChoice(defendingXI.defenders);

  return {
    id: `event-${minute}-foul`,
    minute,
    type: 'foul',
    primaryPlayerId: defender.id,
    secondaryPlayerId: attacker.id,
    team,
    description: `Foul by ${defender.firstName} ${defender.lastName} on ${attacker.firstName} ${attacker.lastName}.`,
  };
}

function generateCardEvent(
  minute: number,
  playerId: string,
  team: 'home' | 'away',
  rng: SeededRNG,
): MatchEvent {
  const isRed = rng.nextBool(0.15); // 15% chance of red on card
  const type: EventType = isRed ? 'red-card' : 'yellow-card';

  return {
    id: `event-${minute}-${type}`,
    minute,
    type,
    primaryPlayerId: playerId,
    team,
    description: isRed ? 'RED CARD! The player is sent off!' : 'Yellow card shown.',
  };
}

function generateInjuryEvent(
  minute: number,
  player: Player,
  team: 'home' | 'away',
  rng: SeededRNG,
): MatchEvent {
  const injuryTypes = ['Hamstring strain', 'Ankle sprain', 'Knee injury', 'Muscle pull'];
  const injuryType = rng.nextChoice(injuryTypes);

  return {
    id: `event-${minute}-injury`,
    minute,
    type: 'injury',
    primaryPlayerId: player.id,
    team,
    description: `${player.firstName} ${player.lastName} goes down injured - looks like a ${injuryType}.`,
  };
}

function aggregateResults(
  phases: PhaseResult[],
  homeClubId: string,
  awayClubId: string,
  seed: number,
): MatchResult {
  const events: MatchEvent[] = [];
  let homeScore = 0;
  let awayScore = 0;
  let homePossessionCount = 0;
  let awayPossessionCount = 0;
  let homeShots = 0;
  let awayShots = 0;
  let homeShotsOnTarget = 0;
  let awayShotsOnTarget = 0;
  let homeCorners = 0;
  let awayCorners = 0;
  let homeFouls = 0;
  let awayFouls = 0;
  let homeYellowCards = 0;
  let awayYellowCards = 0;
  let homeRedCards = 0;
  let awayRedCards = 0;

  phases.forEach((phase) => {
    events.push(...phase.events);

    if (phase.possession === 'home') {
      homePossessionCount++;
    } else {
      awayPossessionCount++;
    }

    homeShots += phase.homeShots;
    awayShots += phase.awayShots;
    homeShotsOnTarget += phase.homeShotsOnTarget;
    awayShotsOnTarget += phase.awayShotsOnTarget;
    homeCorners += phase.homeCorners;
    awayCorners += phase.awayCorners;
    homeFouls += phase.homeFouls;
    awayFouls += phase.awayFouls;

    phase.events.forEach((event) => {
      if (event.type === 'goal') {
        if (event.team === 'home') {
          homeScore++;
        } else {
          awayScore++;
        }
      }
      if (event.type === 'yellow-card') {
        if (event.team === 'home') {
          homeYellowCards++;
        } else {
          awayYellowCards++;
        }
      }
      if (event.type === 'red-card') {
        if (event.team === 'home') {
          homeRedCards++;
        } else {
          awayRedCards++;
        }
      }
    });
  });

  const totalPossession = homePossessionCount + awayPossessionCount;
  const homePossession = totalPossession > 0 ? (homePossessionCount / totalPossession) * 100 : 50;
  const awayPossession = 100 - homePossession;

  const homeStats: MatchStats = {
    possession: Math.round(homePossession),
    shots: homeShots,
    shotsOnTarget: homeShotsOnTarget,
    corners: homeCorners,
    fouls: homeFouls,
    yellowCards: homeYellowCards,
    redCards: homeRedCards,
  };

  const awayStats: MatchStats = {
    possession: Math.round(awayPossession),
    shots: awayShots,
    shotsOnTarget: awayShotsOnTarget,
    corners: awayCorners,
    fouls: awayFouls,
    yellowCards: awayYellowCards,
    redCards: awayRedCards,
  };

  return {
    homeScore,
    awayScore,
    events: events.sort((a, b) => a.minute - b.minute),
    stats: {
      home: homeStats,
      away: awayStats,
    },
    seed,
  };
}
