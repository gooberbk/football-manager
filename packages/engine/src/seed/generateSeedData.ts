import type {
  Player,
  Club,
  Position,
  PlayerAttributes,
  PlayerDevelopment,
  PlayerStatus,
  PlayerContract,
  PreferredFoot,
  AgeGrowthCurve,
  InjurySeverity,
  ClubTactics,
  Mentality,
  Formation,
} from '@club-director/shared-types';
import { SeededRNG } from '../match/simulation';

const FIRST_NAMES = [
  'Alex',
  'Jordan',
  'Taylor',
  'Morgan',
  'Casey',
  'Riley',
  'Jamie',
  'Quinn',
  'Avery',
  'Peyton',
  'Cameron',
  'Skyler',
  'Dakota',
  'Reese',
  'Rowan',
  'Emerson',
  'Finley',
  'Sage',
  'Phoenix',
  'River',
];

const LAST_NAMES = [
  'Anderson',
  'Martinez',
  'Thompson',
  'Garcia',
  'Robinson',
  'Clark',
  'Rodriguez',
  'Lewis',
  'Lee',
  'Walker',
  'Hall',
  'Allen',
  'Young',
  'King',
  'Wright',
  'Scott',
  'Green',
  'Baker',
  'Adams',
  'Nelson',
];

const NATIONALITIES = ['England', 'Spain', 'Germany', 'France', 'Italy', 'Brazil', 'Argentina'];

const CLUB_NAMES = [
  { name: 'Riverside City', nickname: 'The Blues', founded: 1920 },
  { name: 'Oakwood United', nickname: 'The Greens', founded: 1915 },
  { name: 'Westfield Rangers', nickname: 'The Lions', founded: 1908 },
  { name: 'Eastbourne Athletic', nickname: 'The Whites', founded: 1925 },
  { name: 'Northgate Town', nickname: 'The Spurs', founded: 1912 },
  { name: 'Southport City', nickname: 'The Sailors', founded: 1930 },
  { name: 'Hillside FC', nickname: 'The Highlanders', founded: 1918 },
  { name: 'Valley Rovers', nickname: 'The Vikings', founded: 1922 },
  { name: 'Coastal United', nickname: 'The Waves', founded: 1935 },
  { name: 'Metropolis FC', nickname: 'The Royals', founded: 1910 },
  { name: 'Cedar Park', nickname: 'The Oaks', founded: 1928 },
  { name: 'Lakeside Wanderers', nickname: 'The Mariners', founded: 1917 },
  { name: 'Summit City', nickname: 'The Eagles', founded: 1923 },
  { name: 'Grove Athletic', nickname: 'The Rangers', founded: 1914 },
  { name: 'Meadowbrook Town', nickname: 'The Foxes', founded: 1932 },
  { name: 'Bridgeport United', nickname: 'The Irons', founded: 1911 },
];

function randomInt(min: number, max: number, rng: SeededRNG): number {
  return rng.nextInt(min, max + 1);
}

function randomChoice<T>(array: T[], rng: SeededRNG): T {
  return rng.nextChoice(array);
}

function generatePlayerAttributes(position: Position, strengthModifier: number = 0, rng: SeededRNG): PlayerAttributes {
  // Apply strength modifier to the base range, not as a post-roll addition
  const baseMin = 8 + strengthModifier;
  const baseMax = 14 + strengthModifier;
  const base = randomInt(baseMin, baseMax, rng);
  const variance = () => randomInt(-3, 3, rng);

  const technical = {
    passing: base + variance(),
    shooting: base + variance(),
    dribbling: base + variance(),
    tackling: base + variance(),
    heading: base + variance(),
    crossing: base + variance(),
    finishing: base + variance(),
    technique: base + variance(),
    longShots: base + variance(),
    freeKicks: base + variance(),
    firstTouch: base + variance(),
  };

  const mental = {
    vision: base + variance(),
    decisions: base + variance(),
    composure: base + variance(),
    anticipation: base + variance(),
    positioning: base + variance(),
    workRate: base + variance(),
    determination: base + variance(),
    leadership: base + variance(),
    concentration: base + variance(),
    flair: base + variance(),
  };

  const physical = {
    pace: base + variance(),
    acceleration: base + variance(),
    stamina: base + variance(),
    strength: base + variance(),
    agility: base + variance(),
    balance: base + variance(),
    jumping: base + variance(),
    naturalFitness: base + variance(),
  };

  // Position-specific boosts
  switch (position) {
    case 'GK':
      mental.positioning += 6;
      mental.concentration += 5;
      physical.jumping += 3;
      physical.strength += 2;
      technical.passing -= 2;
      technical.shooting -= 3;
      break;
    case 'CB':
      technical.tackling += 4;
      technical.heading += 4;
      mental.positioning += 3;
      physical.strength += 3;
      physical.jumping += 2;
      technical.dribbling -= 2;
      break;
    case 'FB':
      technical.tackling += 3;
      technical.crossing += 3;
      physical.stamina += 3;
      physical.pace += 2;
      mental.positioning += 2;
      break;
    case 'DM':
      technical.tackling += 3;
      technical.passing += 3;
      mental.vision += 2;
      mental.positioning += 3;
      physical.stamina += 3;
      technical.finishing -= 2;
      break;
    case 'CM':
      technical.passing += 4;
      mental.vision += 3;
      mental.decisions += 2;
      physical.stamina += 3;
      technical.technique += 2;
      break;
    case 'AM':
      technical.passing += 3;
      technical.dribbling += 3;
      mental.vision += 4;
      mental.flair += 3;
      technical.technique += 2;
      physical.strength -= 2;
      break;
    case 'W':
      technical.dribbling += 4;
      technical.crossing += 3;
      physical.pace += 4;
      physical.agility += 3;
      mental.flair += 2;
      physical.strength -= 2;
      break;
    case 'ST':
      technical.finishing += 4;
      technical.shooting += 3;
      physical.pace += 3;
      mental.anticipation += 3;
      mental.composure += 2;
      technical.passing -= 2;
      break;
  }

  // Clamp all values to 1-20
  const clamp = (val: number) => Math.max(1, Math.min(20, val));

  return {
    technical: {
      passing: clamp(technical.passing),
      shooting: clamp(technical.shooting),
      dribbling: clamp(technical.dribbling),
      tackling: clamp(technical.tackling),
      heading: clamp(technical.heading),
      crossing: clamp(technical.crossing),
      finishing: clamp(technical.finishing),
      technique: clamp(technical.technique),
      longShots: clamp(technical.longShots),
      freeKicks: clamp(technical.freeKicks),
      firstTouch: clamp(technical.firstTouch),
    },
    mental: {
      vision: clamp(mental.vision),
      decisions: clamp(mental.decisions),
      composure: clamp(mental.composure),
      anticipation: clamp(mental.anticipation),
      positioning: clamp(mental.positioning),
      workRate: clamp(mental.workRate),
      determination: clamp(mental.determination),
      leadership: clamp(mental.leadership),
      concentration: clamp(mental.concentration),
      flair: clamp(mental.flair),
    },
    physical: {
      pace: clamp(physical.pace),
      acceleration: clamp(physical.acceleration),
      stamina: clamp(physical.stamina),
      strength: clamp(physical.strength),
      agility: clamp(physical.agility),
      balance: clamp(physical.balance),
      jumping: clamp(physical.jumping),
      naturalFitness: clamp(physical.naturalFitness),
    },
  };
}

function generatePlayer(
  id: string,
  clubId: string,
  position: Position,
  preferredPositions: Position[],
  strengthModifier: number = 0,
  rng: SeededRNG,
  baseDate: number,
): Player {
  const age = randomInt(18, 35, rng);
  const attributes = generatePlayerAttributes(position, strengthModifier, rng);

  const currentAbility = randomInt(100, 160, rng) + strengthModifier * 10;
  const development: PlayerDevelopment = {
    currentAbility,
    potentialAbility: randomInt(currentAbility, 200, rng),
    ageGrowthCurve: randomChoice<AgeGrowthCurve>(['early-peak', 'normal', 'late-bloomer'], rng),
  };

  const status: PlayerStatus = {
    morale: randomInt(50, 100, rng),
    recentForm: Array.from({ length: 5 }, () => randomInt(4, 10, rng)),
    fitness: randomInt(70, 100, rng),
    injury: rng.next() > 0.9
      ? {
          type: 'Hamstring Strain',
          daysRemaining: randomInt(7, 30, rng),
          severity: randomChoice<InjurySeverity>(['minor', 'moderate', 'serious', 'severe'], rng),
        }
      : null,
  };

  const contract: PlayerContract = {
    clubId,
    wage: randomInt(5000, 100000, rng),
    contractExpiryDate: new Date(baseDate + randomInt(180, 1825, rng) * 24 * 60 * 60 * 1000),
    marketValue: randomInt(100000, 50000000, rng),
  };

  return {
    id,
    firstName: randomChoice(FIRST_NAMES, rng),
    lastName: randomChoice(LAST_NAMES, rng),
    nationality: randomChoice(NATIONALITIES, rng),
    age,
    preferredFoot: randomChoice<PreferredFoot>(['left', 'right', 'both'], rng),
    primaryPosition: position,
    secondaryPositions: preferredPositions,
    attributes,
    development,
    status,
    contract,
  };
}

function generateSquad(clubId: string, squadNumber: number, strengthModifier: number = 0, rng: SeededRNG, baseDate: number): Player[] {
  const players: Player[] = [];
  let playerIndex = 0;

  // Goalkeepers (2)
  for (let i = 0; i < 2; i++) {
    players.push(
      generatePlayer(
        `player-${squadNumber}-${playerIndex++}`,
        clubId,
        'GK',
        [],
        strengthModifier,
        rng,
        baseDate,
      ),
    );
  }

  // Center Backs (4)
  for (let i = 0; i < 4; i++) {
    players.push(
      generatePlayer(
        `player-${squadNumber}-${playerIndex++}`,
        clubId,
        'CB',
        ['FB'],
        strengthModifier,
        rng,
        baseDate,
      ),
    );
  }

  // Full Backs (4)
  for (let i = 0; i < 4; i++) {
    players.push(
      generatePlayer(
        `player-${squadNumber}-${playerIndex++}`,
        clubId,
        'FB',
        ['CB'],
        strengthModifier,
        rng,
        baseDate,
      ),
    );
  }

  // Defensive Midfielders (2)
  for (let i = 0; i < 2; i++) {
    players.push(
      generatePlayer(
        `player-${squadNumber}-${playerIndex++}`,
        clubId,
        'DM',
        ['CM'],
        strengthModifier,
        rng,
        baseDate,
      ),
    );
  }

  // Central Midfielders (3)
  for (let i = 0; i < 3; i++) {
    players.push(
      generatePlayer(
        `player-${squadNumber}-${playerIndex++}`,
        clubId,
        'CM',
        ['DM', 'AM'],
        strengthModifier,
        rng,
        baseDate,
      ),
    );
  }

  // Attacking Midfielders (1)
  players.push(
    generatePlayer(
      `player-${squadNumber}-${playerIndex++}`,
      clubId,
      'AM',
      ['CM', 'W'],
      strengthModifier,
      rng,
      baseDate,
    ),
  );

  // Wingers (2)
  for (let i = 0; i < 2; i++) {
    players.push(
      generatePlayer(
        `player-${squadNumber}-${playerIndex++}`,
        clubId,
        'W',
        ['AM', 'ST'],
        strengthModifier,
        rng,
        baseDate,
      ),
    );
  }

  // Strikers (2)
  for (let i = 0; i < 2; i++) {
    players.push(
      generatePlayer(
        `player-${squadNumber}-${playerIndex++}`,
        clubId,
        'ST',
        ['W', 'AM'],
        strengthModifier,
        rng,
        baseDate,
      ),
    );
  }

  return players;
}

function generateClub(index: number, rng: SeededRNG): Club {
  const clubInfo = CLUB_NAMES[index];
  const clubId = `club-${index}`;

  // Calculate strength modifier based on club index
  // Top 4 clubs: +2 strength, Middle 8 clubs: 0 strength, Bottom 4 clubs: -2 strength
  let strengthModifier = 0;
  if (index < 4) {
    strengthModifier = 2; // Contenders
  } else if (index >= 12) {
    strengthModifier = -2; // Strugglers
  }
  // Middle clubs have 0 modifier

  const tactics: ClubTactics = {
    defaultFormation: randomChoice<Formation>(['4-4-2', '4-3-3', '4-2-3-1', '3-5-2'], rng),
    mentality: randomChoice<Mentality>(['defensive', 'balanced', 'attacking'], rng),
    pressingIntensity: randomInt(5, 15, rng),
    tempo: randomInt(5, 15, rng),
    width: randomInt(5, 15, rng),
  };

  // Adjust finances based on strength
  const baseBalance = strengthModifier > 0 ? 80000000 : strengthModifier < 0 ? 20000000 : 50000000;
  const baseTransferBudget = strengthModifier > 0 ? 40000000 : strengthModifier < 0 ? 5000000 : 20000000;
  const baseWageBudget = strengthModifier > 0 ? 800000 : strengthModifier < 0 ? 300000 : 500000;
  const baseWeeklyIncome = strengthModifier > 0 ? 1500000 : strengthModifier < 0 ? 500000 : 1000000;

  return {
    id: clubId,
    name: clubInfo.name,
    nickname: clubInfo.nickname,
    foundedYear: clubInfo.founded,
    reputation: randomInt(55 + strengthModifier * 5, 85 + strengthModifier * 10, rng),
    finances: {
      balance: randomInt(baseBalance - 10000000, baseBalance + 20000000, rng),
      transferBudget: randomInt(baseTransferBudget - 5000000, baseTransferBudget + 10000000, rng),
      wageBudget: randomInt(baseWageBudget - 100000, baseWageBudget + 200000, rng),
      weeklyIncome: randomInt(baseWeeklyIncome - 200000, baseWeeklyIncome + 500000, rng),
      debt: 0,
    },
    squad: [], // Will be populated after squad generation
    stadium: {
      name: `${clubInfo.name} Stadium`,
      capacity: randomInt(30000 + strengthModifier * 10000, 60000 + strengthModifier * 15000, rng),
    },
    tactics,
  };
}

export function generateSeedData(seed: number = Date.now()): { clubs: Club[]; players: Player[] } {
  const rng = new SeededRNG(seed);
  const baseDate = new Date('2024-01-01').getTime(); // Fixed base date for determinism
  const clubs: Club[] = [];
  const players: Player[] = [];

  for (let i = 0; i < CLUB_NAMES.length; i++) {
    const club = generateClub(i, rng);
    clubs.push(club);

    // Calculate strength modifier for squad generation
    let strengthModifier = 0;
    if (i < 4) {
      strengthModifier = 2;
    } else if (i >= 12) {
      strengthModifier = -2;
    }

    const squad = generateSquad(club.id, i, strengthModifier, rng, baseDate);
    players.push(...squad);

    // Update club's squad reference
    clubs[i].squad = squad.map((p) => p.id);

    // Set the wage budget from the actual squad wage bill so that the
    // engine's wage-affordability check in executeTransfer() can succeed.
    // The previous fixed budgets were smaller than the wage bill itself,
    // which made every transfer execution fail.
    const wageBill = squad.reduce((total, p) => total + p.contract.wage, 0);
    clubs[i].finances.wageBudget = Math.round((wageBill * 1.5) / 10000) * 10000;
  }

  return { clubs, players };
}
