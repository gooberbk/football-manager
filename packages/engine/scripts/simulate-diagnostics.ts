import { simulateMatch } from '../src/match/simulation';
import { generateSeedData } from '../src/seed/generateSeedData';

function runDiagnostics() {
  console.log('Running match simulation diagnostics...\n');

  // Generate two truly equal squads using the same club data
  const seedData = generateSeedData();

  const homeClub = seedData.clubs[0];
  const awayClub = { ...seedData.clubs[0], id: 'away-club', name: 'Away FC' };

  // Create player maps with unique IDs for away team
  const homePlayerMap: any = {};
  seedData.players.filter((p: any) => homeClub.squad.includes(p.id)).forEach((p: any) => {
    homePlayerMap[p.id] = p;
  });

  const awayPlayerMap: any = {};
  seedData.players.filter((p: any) => homeClub.squad.includes(p.id)).forEach((p: any) => {
    const modifiedPlayer = {
      ...p,
      id: p.id.replace('club-0', 'away-club'),
      contract: { ...p.contract, clubId: 'away-club' },
    };
    awayPlayerMap[modifiedPlayer.id] = modifiedPlayer;
  });

  awayClub.squad = seedData.players
    .filter((p: any) => homeClub.squad.includes(p.id))
    .map((p: any) => p.id.replace('club-0', 'away-club'));

  const numSimulations = 500;
  const results: any[] = [];

  console.log(`Simulating ${numSimulations} matches between equal squads...\n`);

  for (let i = 0; i < numSimulations; i++) {
    const result = simulateMatch(homeClub, awayClub, homePlayerMap, awayPlayerMap, i + 1000);
    results.push(result);
  }

  // Calculate statistics
  const totalGoals = results.reduce((sum, r) => sum + r.homeScore + r.awayScore, 0);
  const avgGoalsPerMatch = totalGoals / numSimulations;

  // Goal distribution
  const goalDistribution = {
    '0-1': 0,
    '2-3': 0,
    '4-5': 0,
    '6-7': 0,
    '8+': 0,
  };

  results.forEach((r) => {
    const combinedGoals = r.homeScore + r.awayScore;
    if (combinedGoals <= 1) goalDistribution['0-1']++;
    else if (combinedGoals <= 3) goalDistribution['2-3']++;
    else if (combinedGoals <= 5) goalDistribution['4-5']++;
    else if (combinedGoals <= 7) goalDistribution['6-7']++;
    else goalDistribution['8+']++;
  });

  // Win/draw/loss distribution
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;

  results.forEach((r) => {
    if (r.homeScore > r.awayScore) homeWins++;
    else if (r.homeScore < r.awayScore) awayWins++;
    else draws++;
  });

  // Possession statistics
  const avgHomePossession = results.reduce((sum, r) => sum + r.stats.home.possession, 0) / numSimulations;
  const avgAwayPossession = results.reduce((sum, r) => sum + r.stats.away.possession, 0) / numSimulations;

  // Max goals
  const maxCombinedGoals = Math.max(...results.map((r) => r.homeScore + r.awayScore));

  // Output results
  console.log('=== MATCH SIMULATION DIAGNOSTICS ===\n');
  console.log(`Total matches simulated: ${numSimulations}`);
  console.log(`Average total goals per match: ${avgGoalsPerMatch.toFixed(2)}`);
  console.log(`Max combined goals in a single match: ${maxCombinedGoals}\n`);

  console.log('Goal Distribution:');
  Object.entries(goalDistribution).forEach(([range, count]) => {
    const percentage = (count / numSimulations * 100).toFixed(1);
    console.log(`  ${range} goals: ${count} matches (${percentage}%)`);
  });

  console.log('\nResult Distribution:');
  console.log(`  Home wins: ${homeWins} (${(homeWins / numSimulations * 100).toFixed(1)}%)`);
  console.log(`  Draws: ${draws} (${(draws / numSimulations * 100).toFixed(1)}%)`);
  console.log(`  Away wins: ${awayWins} (${(awayWins / numSimulations * 100).toFixed(1)}%)`);

  console.log('\nPossession (average):');
  console.log(`  Home: ${avgHomePossession.toFixed(1)}%`);
  console.log(`  Away: ${avgAwayPossession.toFixed(1)}%`);

  console.log('\n=== TARGET METRICS ===');
  console.log('Average goals per match: 2.7-3.0');
  console.log('Matches with 6+ goals: < 3%');
  console.log('Home win rate: ~40% (with home advantage)');
  console.log('Away win rate: ~35%');
  console.log('Draw rate: ~25%');
}

runDiagnostics();
