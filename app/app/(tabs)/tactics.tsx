import { useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useGameState } from '../../store/useGameState';
import { useTheme } from '../../theme/useTheme';
import { typography } from '../../theme/typography';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import {
  TACTIC_FORMATIONS,
  TACTIC_INTENSITY_RANGE,
  TACTIC_MENTALITIES,
  countManagedEligiblePlayers,
  getManagedClub,
  previewManagedStartingXI,
  previewManagedTeamStrength,
  updateClubTactics,
  type TacticsPatch,
} from '../../services/tacticsView';
import type { Player } from '@club-director/shared-types';

function playerName(player: Player): string {
  return `${player.firstName} ${player.lastName}`;
}

interface XiGroupProps {
  title: string;
  players: Player[];
}

function XiGroup({ title, players }: XiGroupProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.xiGroup}>
      <Text style={[styles.xiGroupTitle, { color: colors.textSecondary }]}>{title}</Text>
      {players.map((player) => (
        <View key={player.id} style={styles.xiRow}>
          <Badge variant="default">{player.primaryPosition}</Badge>
          <Text style={[styles.xiName, { color: colors.text }]} numberOfLines={1}>
            {playerName(player)}
          </Text>
          <Text style={[styles.xiAbility, { color: colors.textSecondary }]}>
            CAT {player.development.currentAbility}
          </Text>
        </View>
      ))}
    </View>
  );
}

interface IntensityStepperProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

function IntensityStepper({ label, value, onChange }: IntensityStepperProps) {
  const { colors } = useTheme();
  const { min, max } = TACTIC_INTENSITY_RANGE;
  return (
    <View style={styles.stepperRow}>
      <Text style={[styles.stepperLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.stepperControls}>
        <TouchableOpacity
          onPress={() => onChange(value - 1)}
          disabled={value <= min}
          style={[styles.stepperButton, { borderColor: colors.border, opacity: value <= min ? 0.4 : 1 }]}
        >
          <Text style={[styles.stepperButtonText, { color: colors.text }]}>−</Text>
        </TouchableOpacity>
        <Text style={[styles.stepperValue, { color: colors.text }]}>{value}</Text>
        <TouchableOpacity
          onPress={() => onChange(value + 1)}
          disabled={value >= max}
          style={[styles.stepperButton, { borderColor: colors.border, opacity: value >= max ? 0.4 : 1 }]}
        >
          <Text style={[styles.stepperButtonText, { color: colors.text }]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function TacticsScreen() {
  const { clubs, players, managedClubId, isLoading, setClubs, saveState } = useGameState();
  const { colors } = useTheme();

  const club = getManagedClub(clubs, managedClubId);
  const tactics = club?.tactics ?? null;

  const xiPreview = useMemo(
    () => previewManagedStartingXI(clubs, players, managedClubId),
    [clubs, players, managedClubId],
  );
  const eligibleCount = useMemo(
    () => countManagedEligiblePlayers(clubs, players, managedClubId),
    [clubs, players, managedClubId],
  );
  // Squad-wide ratings (all squad players, tactical modifiers applied,
  // home advantage excluded) — NOT a rating of the previewed XI.
  const strength = useMemo(
    () => previewManagedTeamStrength(clubs, players, managedClubId),
    [clubs, players, managedClubId],
  );

  useEffect(() => {
    saveState();
  }, [clubs, saveState]);

  const update = (patch: TacticsPatch) => {
    if (!managedClubId) return;
    setClubs(updateClubTactics(clubs, managedClubId, patch));
  };

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading tactics...</Text>
      </View>
    );
  }

  if (!club || !tactics) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          No managed club selected
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>{club.name}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {eligibleCount} eligible players
        </Text>
      </View>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Formation</Text>
        <View style={styles.chipRow}>
          {TACTIC_FORMATIONS.map((formation) => {
            const active = tactics.defaultFormation === formation;
            return (
              <TouchableOpacity
                key={formation}
                onPress={() => update({ defaultFormation: formation })}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: active ? colors.primary : colors.surface },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? '#fff' : colors.text }]}>
                  {formation}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Mentality</Text>
        <View style={styles.chipRow}>
          {TACTIC_MENTALITIES.map((mentality) => {
            const active = tactics.mentality === mentality;
            return (
              <TouchableOpacity
                key={mentality}
                onPress={() => update({ mentality })}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: active ? colors.primary : colors.surface },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? '#fff' : colors.text }]}>
                  {mentality}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Intensity</Text>
        <IntensityStepper
          label="Pressing"
          value={tactics.pressingIntensity}
          onChange={(v) => update({ pressingIntensity: v })}
        />
        <IntensityStepper
          label="Tempo"
          value={tactics.tempo}
          onChange={(v) => update({ tempo: v })}
        />
        <Text style={[styles.noteText, { color: colors.textSecondary }]}>
          Width is saved with your tactics but has no effect in the current match engine.
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Projected XI</Text>
        {xiPreview === null ? (
          <Text style={[styles.noteText, { color: colors.textSecondary }]}>
            Select a managed club to preview the starting eleven.
          </Text>
        ) : xiPreview.ok ? (
          <View>
            <XiGroup title="Goalkeeper" players={[xiPreview.gk]} />
            <XiGroup title="Defenders" players={xiPreview.defenders} />
            <XiGroup title="Midfielders" players={xiPreview.midfielders} />
            <XiGroup title="Forwards" players={xiPreview.forwards} />
          </View>
        ) : (
          <View style={styles.warningBox}>
            <Badge variant="warning">Cannot field a XI</Badge>
            <Text style={[styles.warningText, { color: colors.textSecondary }]}>
              {xiPreview.message}
            </Text>
          </View>
        )}
      </Card>

      {strength && (
        <Card style={styles.card}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Squad strength</Text>
          <Text style={[styles.noteText, { color: colors.textSecondary }]}>
            Based on all squad players with tactical modifiers applied. Home
            advantage is excluded — this is not a rating of the projected XI.
          </Text>
          <View style={styles.strengthGrid}>
            {(
              [
                ['Attack', strength.attackRating],
                ['Midfield', strength.midfieldRating],
                ['Defense', strength.defenseRating],
                ['Goalkeeping', strength.gkRating],
                ['Avg fitness', strength.averageFitness],
                ['Avg form', strength.averageForm],
                ['Avg morale', strength.averageMorale],
              ] as const
            ).map(([label, value]) => (
              <View key={label} style={styles.strengthRow}>
                <Text style={[styles.strengthLabel, { color: colors.textSecondary }]}>{label}</Text>
                <Text style={[styles.strengthValue, { color: colors.text }]}>
                  {label.startsWith('Avg') ? value.toFixed(1) : Math.round(value)}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      )}

      <View style={styles.bottomSpacer} />
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
    marginTop: 4,
  },
  card: {
    marginBottom: 12,
  },
  sectionTitle: {
    ...typography.headingSmall,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: {
    ...typography.body,
    fontWeight: '600',
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  stepperLabel: {
    ...typography.bodyLarge,
    fontWeight: '600',
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  stepperValue: {
    ...typography.bodyLarge,
    fontWeight: 'bold',
    minWidth: 28,
    textAlign: 'center',
  },
  noteText: {
    ...typography.body,
    marginTop: 8,
    fontSize: 12,
  },
  xiGroup: {
    marginTop: 8,
  },
  xiGroupTitle: {
    ...typography.body,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  xiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    gap: 8,
  },
  xiName: {
    ...typography.body,
    flex: 1,
  },
  xiAbility: {
    ...typography.body,
    fontSize: 12,
  },
  warningBox: {
    marginTop: 8,
    gap: 8,
  },
  warningText: {
    ...typography.body,
    fontSize: 12,
  },
  strengthGrid: {
    marginTop: 8,
  },
  strengthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  strengthLabel: {
    ...typography.body,
  },
  strengthValue: {
    ...typography.body,
    fontWeight: 'bold',
  },
  bottomSpacer: {
    height: 24,
  },
});
