import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';
import { useGameState } from '../../store/useGameState';
import { useTheme } from '../../theme/useTheme';
import { typography } from '../../theme/typography';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { advanceMatchweek } from '@club-director/engine';
import { buildPersistedMatch } from '../../db/matchRecords';
import type { PersistedMatch } from '../../db/matchRecords';

export default function LeagueScreen() {
  const { league, season, clubs, players, isLoading, managedClubId, resultsHistory, transferOffers, transferHistory, matches, setLeague, setSeason, setClubs, setPlayers, setTransferOffers, setTransferHistory, setMatches, addResult, saveState } = useGameState();
  const { colors } = useTheme();

  // Autosave after state changes
  useEffect(() => {
    saveState();
  }, [league, season, clubs, players, resultsHistory, transferHistory, matches, saveState]);

  const handleSimulateMatchweek = async () => {
    if (!league || !season || !clubs || !players) return;

    const advancement = advanceMatchweek(season, league, clubs, players, {
      managedClubId: managedClubId ?? undefined,
    });

    // Build and validate every PersistedMatch BEFORE touching the store:
    // if construction fails, no setter runs and no partial state can be
    // autosaved (scores without their match history). Records use the
    // post-matchweek objects, which keep the referential integrity
    // buildPersistedMatch validates. Match ids are deterministic, so
    // merging by id makes a repeated simulation of the same week
    // idempotent.
    const newMatches: PersistedMatch[] = advancement.results.map((r) => {
      const fixture = advancement.updatedLeague.fixtures.find(
        (f) => f.id === r.fixtureId,
      );
      const homeClub = advancement.updatedClubs.find(
        (c) => c.id === r.homeClubId,
      );
      const awayClub = advancement.updatedClubs.find(
        (c) => c.id === r.awayClubId,
      );
      if (!fixture || !homeClub || !awayClub) {
        throw new Error(
          `Cannot record match for fixture ${r.fixtureId}: missing fixture or club in advancement result`,
        );
      }
      return buildPersistedMatch({
        fixture,
        season: advancement.updatedSeason,
        league: advancement.updatedLeague,
        homeClub,
        awayClub,
        result: r.result,
      });
    });
    let mergedMatches: PersistedMatch[] | null = null;
    if (newMatches.length > 0) {
      const existingIds = new Set(matches.map((m) => m.id));
      const toAdd = newMatches.filter((m) => !existingIds.has(m.id));
      if (toAdd.length > 0) {
        mergedMatches = [...matches, ...toAdd];
      }
    }

    setLeague(advancement.updatedLeague);
    setSeason(advancement.updatedSeason);
    setClubs(advancement.updatedClubs);
    setPlayers(advancement.updatedPlayers);
    // Keep pending offers involving the managed club (the user's own bids
    // and AI bids for the user's players); AI-vs-AI pending offers are
    // transient and dropped each matchweek.
    const pendingOffers = transferOffers.filter(
      (o) =>
        o.status === 'pending' &&
        (o.buyingClubId === managedClubId || o.sellingClubId === managedClubId),
    );
    const newOfferIds = new Set(advancement.transferOffers.map((o) => o.id));
    setTransferOffers([
      ...pendingOffers.filter((o) => !newOfferIds.has(o.id)),
      ...advancement.transferOffers,
    ]);
    if (advancement.transferRecords.length > 0) {
      setTransferHistory([...transferHistory, ...advancement.transferRecords]);
    }
    if (mergedMatches !== null) {
      setMatches(mergedMatches);
    }

    // Add result to history
    const resultText = advancement.results
      .map(
        (r) =>
          `${r.homeClubId} ${r.homeScore} - ${r.awayScore} ${r.awayClubId}`,
      )
      .join(', ');
    addResult(resultText);
  };

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading career...</Text>
      </View>
    );
  }

  if (!league || !season || !clubs.length) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>No career data found</Text>
      </View>
    );
  }

  const currentWeekFixtures = league.fixtures.filter((f) => f.week === season.currentWeek && !f.played);
  const nextFixture = currentWeekFixtures[0];

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>League</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Season {season.currentWeek} • {season.currentDate.toLocaleDateString()}
        </Text>
      </View>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>League Table</Text>
        <ScrollView horizontal>
          <View style={styles.tableContainer}>
            <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.tableCell, { color: colors.text }]}>Club</Text>
              <Text style={[styles.tableCell, { color: colors.text }]}>P</Text>
              <Text style={[styles.tableCell, { color: colors.text }]}>W</Text>
              <Text style={[styles.tableCell, { color: colors.text }]}>D</Text>
              <Text style={[styles.tableCell, { color: colors.text }]}>L</Text>
              <Text style={[styles.tableCell, { color: colors.text }]}>GF</Text>
              <Text style={[styles.tableCell, { color: colors.text }]}>GA</Text>
              <Text style={[styles.tableCell, { color: colors.text }]}>GD</Text>
              <Text style={[styles.tableCell, { color: colors.text }]}>Pts</Text>
            </View>
            {league.standings.entries.map((entry) => {
              const club = clubs.find((c) => c.id === entry.clubId);
              const isManagedClub = entry.clubId === managedClubId;
              return (
                <View key={entry.clubId} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.tableCell, { color: colors.text, fontWeight: isManagedClub ? 'bold' : 'normal' }]}>
                    {club?.name || entry.clubId}
                  </Text>
                  <Text style={[styles.tableCell, { color: colors.text }]}>{entry.played}</Text>
                  <Text style={[styles.tableCell, { color: colors.text }]}>{entry.won}</Text>
                  <Text style={[styles.tableCell, { color: colors.text }]}>{entry.drawn}</Text>
                  <Text style={[styles.tableCell, { color: colors.text }]}>{entry.lost}</Text>
                  <Text style={[styles.tableCell, { color: colors.text }]}>{entry.goalsFor}</Text>
                  <Text style={[styles.tableCell, { color: colors.text }]}>{entry.goalsAgainst}</Text>
                  <Text style={[styles.tableCell, { color: colors.text }]}>{entry.goalsFor - entry.goalsAgainst}</Text>
                  <Text style={[styles.tableCell, { color: colors.text, fontWeight: 'bold' }]}>{entry.points}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Upcoming Fixture</Text>
        {nextFixture ? (
          <View style={styles.fixtureContent}>
            <Text style={[styles.fixtureText, { color: colors.text }]}>
              {clubs.find((c) => c.id === nextFixture.homeClubId)?.name} vs{' '}
              {clubs.find((c) => c.id === nextFixture.awayClubId)?.name}
            </Text>
            <Text style={[styles.fixtureDate, { color: colors.textSecondary }]}>{nextFixture.date.toLocaleDateString()}</Text>
            <Button onPress={handleSimulateMatchweek}>
              Simulate Matchweek
            </Button>
          </View>
        ) : (
          <Text style={[styles.noFixtureText, { color: colors.textMuted }]}>No fixtures remaining this week</Text>
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Results History</Text>
        {resultsHistory.length === 0 ? (
          <Text style={[styles.noResultsText, { color: colors.textMuted }]}>No results yet</Text>
        ) : (
          resultsHistory.map((result, index) => (
            <View key={index} style={[styles.resultItem, { borderBottomColor: colors.border }]}>
              <Text style={[styles.resultText, { color: colors.text }]}>{result}</Text>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorText: {
    fontSize: 16,
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
  card: {
    marginBottom: 16,
  },
  sectionTitle: {
    ...typography.headingSmall,
    marginBottom: 12,
  },
  tableContainer: {
    minWidth: 600,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingBottom: 8,
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingBottom: 8,
    marginBottom: 8,
  },
  tableCell: {
    flex: 1,
    fontSize: 14,
  },
  fixtureContent: {
    gap: 12,
  },
  fixtureText: {
    ...typography.bodyLarge,
    fontWeight: 'bold',
  },
  fixtureDate: {
    ...typography.body,
  },
  noFixtureText: {
    ...typography.body,
    fontStyle: 'italic',
  },
  noResultsText: {
    ...typography.body,
    fontStyle: 'italic',
  },
  resultItem: {
    borderBottomWidth: 1,
    paddingBottom: 8,
    marginBottom: 8,
  },
  resultText: {
    ...typography.body,
  },
});
