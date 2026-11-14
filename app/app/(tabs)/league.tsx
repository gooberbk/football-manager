import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { useGameState } from '../../store/useGameState';
import { useTheme } from '../../theme/useTheme';
import { typography } from '../../theme/typography';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { buildRolloverAction, buildSeasonSummary } from '../../services/seasonSummary';
import { rolloverSeason } from '../../services/seasonRollover';
import { simulateMatchweek } from '../../services/matchweekSimulation';

export default function LeagueScreen() {
  const { league, season, clubs, players, isLoading, managedClubId, resultsHistory, transferHistory, matches, saveState } = useGameState();
  const { colors } = useTheme();
  const [isRollingOver, setIsRollingOver] = useState(false);
  const [rolloverError, setRolloverError] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  // Synchronous locks: state updates are not visible to a same-tick
  // second invocation, so refs guard reentrancy directly.
  const simulatingRef = useRef(false);
  const rolloverBusyRef = useRef(false);

  // Autosave after state changes
  useEffect(() => {
    saveState();
  }, [league, season, clubs, players, resultsHistory, transferHistory, matches, saveState]);

  // The rollover service is the single authority: it validates the
  // completed season, persists atomically, guards against concurrent
  // calls and publishes the new season only after success. This
  // handler only reflects its result — no fixtures or standings are
  // generated here.
  const handleStartNextSeason = async () => {
    if (isRollingOver || rolloverBusyRef.current || simulatingRef.current) {
      return;
    }
    rolloverBusyRef.current = true;
    setIsRollingOver(true);
    setRolloverError(null);
    try {
      const result = await rolloverSeason();
      if (!result.ok) {
        // Keep the completed season visible; surface the real reason
        // (incomplete season, anomalies, persistence or consistency
        // failure) so the user can retry.
        setRolloverError(result.error);
      }
      // On success the service already published the new league/season;
      // seasonComplete recomputes to false and this card disappears.
    } catch (error) {
      setRolloverError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      rolloverBusyRef.current = false;
      setIsRollingOver(false);
    }
  };

  // All advancement logic lives in services/matchweekSimulation.ts,
  // which also holds a module-level lock against same-tick duplicate
  // invocations. This handler adds the UI-side synchronous lock and
  // the mutual exclusion with rollover.
  const handleSimulateMatchweek = async () => {
    if (
      simulatingRef.current ||
      isSimulating ||
      isRollingOver ||
      rolloverBusyRef.current
    ) {
      return;
    }
    simulatingRef.current = true;
    setIsSimulating(true);
    try {
      await simulateMatchweek();
    } finally {
      simulatingRef.current = false;
      setIsSimulating(false);
    }
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
  // Single source of truth for season completion (engine predicate).
  const seasonSummary = buildSeasonSummary(league, season, clubs);
  const seasonComplete = seasonSummary.complete;
  const rolloverAction = buildRolloverAction(seasonComplete, isRollingOver);

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>League</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Season {season.currentWeek} • {season.currentDate.toLocaleDateString()}
        </Text>
      </View>

      {seasonComplete && (
        <Card style={styles.card}>
          <View style={styles.seasonCompleteHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Season Complete</Text>
            <Badge variant="success">Champion</Badge>
          </View>
          <Text style={[styles.championText, { color: colors.text }]}>
            {seasonSummary.championClubName ?? '—'} wins the league
          </Text>
          {rolloverError && (
            <Text style={[styles.rolloverErrorText, { color: colors.danger }]}>
              {rolloverError}
            </Text>
          )}
          <Button
            onPress={handleStartNextSeason}
            disabled={rolloverAction.disabled}
            style={{ marginTop: 12 }}
          >
            {rolloverAction.label}
          </Button>
        </Card>
      )}

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {seasonComplete ? 'Final Standings' : 'League Table'}
        </Text>
        <ScrollView horizontal>
          <View style={styles.tableContainer}>
            <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
              {seasonComplete && (
                <Text style={[styles.tableCell, { color: colors.text }]}>Pos</Text>
              )}
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
            {seasonSummary.standings.map((entry) => {
              const isManagedClub = entry.clubId === managedClubId;
              return (
                <View
                  key={entry.clubId}
                  style={[
                    styles.tableRow,
                    { borderBottomColor: colors.border },
                    entry.isChampion && { backgroundColor: `${colors.primary}1A` },
                  ]}
                >
                  {seasonComplete && (
                    <Text style={[styles.tableCell, { color: colors.text }]}>{entry.position}.</Text>
                  )}
                  <Text style={[styles.tableCell, { color: colors.text, fontWeight: isManagedClub || entry.isChampion ? 'bold' : 'normal' }]}>
                    {entry.clubName}{entry.isChampion ? ' — Champion' : ''}
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
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {seasonComplete ? 'Season Status' : 'Upcoming Fixture'}
        </Text>
        {seasonComplete ? (
          <Text style={[styles.noFixtureText, { color: colors.textMuted }]}>
            The season is complete — see the final standings above.
          </Text>
        ) : nextFixture ? (
          <View style={styles.fixtureContent}>
            <Text style={[styles.fixtureText, { color: colors.text }]}>
              {clubs.find((c) => c.id === nextFixture.homeClubId)?.name} vs{' '}
              {clubs.find((c) => c.id === nextFixture.awayClubId)?.name}
            </Text>
            <Text style={[styles.fixtureDate, { color: colors.textSecondary }]}>{nextFixture.date.toLocaleDateString()}</Text>
            <Button
              onPress={handleSimulateMatchweek}
              disabled={isSimulating || isRollingOver}
            >
              {isSimulating ? 'Simulating…' : 'Simulate Matchweek'}
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
  seasonCompleteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  championText: {
    ...typography.bodyLarge,
    fontWeight: 'bold',
  },
  rolloverErrorText: {
    ...typography.body,
    marginTop: 8,
    marginBottom: 12,
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
