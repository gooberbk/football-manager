import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { generateSeedData, generateFixtures, scheduledFixturesToLeagueFixtures } from '@club-director/engine';
import { saveCareer, initializeDatabase } from '../db';
import type { League, Season } from '@club-director/shared-types';
import { useGameState } from '../store/useGameState';
import { useTheme } from '../theme/useTheme';
import { typography } from '../theme/typography';
import { Card } from '../components/Card';

export default function NewCareerScreen() {
  const router = useRouter();
  const { setLeague, setSeason, setClubs, setPlayers, setManagedClubId, setIsLoading, setTransferHistory, setTransferOffers, setResultsHistory } = useGameState();
  const { colors } = useTheme();

  const handleStartCareer = async (clubIndex: number) => {
    try {
      await initializeDatabase();

      const seedData = generateSeedData(12345);
      const clubs = seedData.clubs;
      const players = seedData.players;

      const selectedClub = clubs[clubIndex];

      const league: League = {
        id: 'league-1',
        name: 'Premier Division',
        tier: 1,
        clubIds: clubs.map((c) => c.id),
        standings: {
          entries: clubs.map((club) => ({
            clubId: club.id,
            played: 0,
            won: 0,
            drawn: 0,
            lost: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            goalDifference: 0,
            points: 0,
          })),
        },
        fixtures: [],
      };

      const season: Season = {
        id: 'season-1',
        leagueId: 'league-1',
        currentWeek: 1,
        currentDate: new Date('2024-08-01'),
        transferWindowOpen: true,
        fixturesCalendar: [],
      };

      // Generate fixtures
      const scheduledFixtures = generateFixtures(clubs.map((c) => c.id), new Date('2024-08-01'));
      league.fixtures = scheduledFixturesToLeagueFixtures(scheduledFixtures);

      const careerState = {
        career: {
          id: 'active',
          managerName: 'Player',
          managedClubId: selectedClub.id,
          createdAt: new Date(),
          lastPlayedAt: new Date(),
          schemaVersion: 1,
        },
        clubs,
        players,
        league,
        season,
        transferHistory: [],
      };

      await saveCareer(careerState);

      // Update Zustand store
      setLeague(league);
      setSeason(season);
      setClubs(clubs);
      setPlayers(players);
      setManagedClubId(selectedClub.id);
      setTransferHistory([]);
      setTransferOffers([]);
      setResultsHistory([]);
      setIsLoading(false);

      router.replace('/dashboard');
    } catch (error) {
      console.error('Failed to start career:', error);
    }
  };

  const generateSeedDataSync = () => {
    const seedData = generateSeedData(12345);
    return seedData.clubs;
  };

  const clubs = generateSeedDataSync();

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Start New Career</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Choose a club to manage</Text>
      </View>

      {clubs.map((club, index) => (
        <Card key={club.id} style={styles.clubCard}>
          <TouchableOpacity onPress={() => handleStartCareer(index)}>
            <Text style={[styles.clubName, { color: colors.text }]}>{club.name}</Text>
            <Text style={[styles.clubNickname, { color: colors.textSecondary }]}>{club.nickname}</Text>
            <View style={styles.clubDetails}>
              <Text style={[styles.detailText, { color: colors.textSecondary }]}>Reputation: {club.reputation}</Text>
              <Text style={[styles.detailText, { color: colors.textSecondary }]}>Stadium: {club.stadium.capacity.toLocaleString()}</Text>
              <Text style={[styles.detailText, { color: colors.textSecondary }]}>Balance: £{(club.finances.balance / 1000000).toFixed(1)}M</Text>
            </View>
          </TouchableOpacity>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    ...typography.headingLarge,
  },
  subtitle: {
    ...typography.body,
  },
  clubCard: {
    marginBottom: 12,
  },
  clubName: {
    ...typography.headingSmall,
    marginBottom: 4,
  },
  clubNickname: {
    ...typography.body,
    marginBottom: 12,
  },
  clubDetails: {
    gap: 4,
  },
  detailText: {
    ...typography.bodySmall,
  },
});
