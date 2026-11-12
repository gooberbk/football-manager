import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { generateSeedData } from '@club-director/engine';
import { createCareer } from '../services/careerCreation';
import { useTheme } from '../theme/useTheme';
import { typography } from '../theme/typography';
import { Card } from '../components/Card';

export default function NewCareerScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const handleStartCareer = async (clubIndex: number) => {
    try {
      await createCareer(clubIndex);
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
