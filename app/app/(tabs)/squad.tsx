import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useGameState } from '../../store/useGameState';
import { useTheme } from '../../theme/useTheme';
import { typography } from '../../theme/typography';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { StatBar } from '../../components/StatBar';
import { renewContract } from '../../services/contractService';
import {
  isRenewalOfferedFor,
  parseRenewalWageInput,
  renewalDemandFor,
  renewalRejectionMessage,
  RENEWAL_DURATION_OPTIONS,
  type RenewalDuration,
} from '../../services/contractRenewalView';
import {
  buildSquadView,
  isPlayerInjured,
  squadSummary,
  SQUAD_POSITIONS,
  SQUAD_SORT_KEYS,
  SQUAD_SORT_LABELS,
  type SquadFilters,
  type SquadSortKey,
} from '../../services/squadView';
import type { Player, Position } from '@club-director/shared-types';

function formatMoney(value: number): string {
  return `£${value.toLocaleString()}`;
}

function playerDisplayName(player: Player): string {
  return `${player.firstName} ${player.lastName}`;
}

interface AttributeRowProps {
  name: string;
  value: number;
}

function AttributeRow({ name, value }: AttributeRowProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.attributeRow}>
      <Text style={[styles.attributeName, { color: colors.textSecondary }]}>{name}</Text>
      <View style={styles.attributeBar}>
        <StatBar value={value} />
      </View>
      <Text style={[styles.attributeValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

interface AttributeGroupProps {
  title: string;
  attributes: object;
}

function AttributeGroup({ title, attributes }: AttributeGroupProps) {
  const { colors } = useTheme();
  const entries = Object.entries(attributes as Record<string, number>).sort(([a], [b]) => a.localeCompare(b));
  return (
    <View style={styles.attributeGroup}>
      <Text style={[styles.attributeGroupTitle, { color: colors.text }]}>{title}</Text>
      {entries.map(([name, value]) => (
        <AttributeRow key={name} name={name} value={value} />
      ))}
    </View>
  );
}

interface ContractRenewalSectionProps {
  player: Player;
  managedClubId: string | null;
  now: Date | null;
}

/**
 * Renewal form inside the Contract detail section. All business rules
 * live in contractService.renewContract — this component only collects
 * input, displays the engine demand and renders the typed result.
 * Mounted with key={player.id} so its state resets per player.
 */
function ContractRenewalSection({
  player,
  managedClubId,
  now,
}: ContractRenewalSectionProps) {
  const { colors } = useTheme();
  const demand = now ? renewalDemandFor(player, now) : null;
  const [wageText, setWageText] = useState<string>(() =>
    String(demand ?? player.contract.wage),
  );
  const [years, setYears] = useState<RenewalDuration>(1);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  if (!isRenewalOfferedFor(player, managedClubId)) {
    return null;
  }

  const parsedWage = parseRenewalWageInput(wageText);
  const canSubmit = !busy && !completed && parsedWage !== null;

  const onSubmit = async () => {
    if (parsedWage === null || busy || completed) return;
    setBusy(true);
    setMessage(null);
    const result = await renewContract(player.id, parsedWage, years);
    setBusy(false);
    if (result.status === 'renewed') {
      // The new expiry is beyond the renewal window: hide the form so
      // no immediate second submission is possible.
      setCompleted(true);
      setMessage({
        kind: 'success',
        text: `Contract renewed — ${formatMoney(result.player.contract.wage)}/wk until ${result.player.contract.contractExpiryDate.toLocaleDateString()}.`,
      });
    } else {
      setMessage({
        kind: 'error',
        text: renewalRejectionMessage(result.reason, result.wageDemand),
      });
    }
  };

  return (
    <View style={[styles.renewalBlock, { borderTopColor: colors.border }]}>
      <Text style={[styles.renewalTitle, { color: colors.text }]}>Renewal</Text>

      {demand !== null && (
        <Text style={[styles.renewalHint, { color: colors.textSecondary }]}>
          Player asks at least {formatMoney(demand)}/wk
        </Text>
      )}

      {!completed && (
        <>
          <TextInput
            style={[styles.renewalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            value={wageText}
            onChangeText={setWageText}
            keyboardType="numeric"
            placeholder="Weekly wage"
            placeholderTextColor={colors.textMuted}
            editable={!busy}
          />
          <View style={styles.chipRow}>
            {RENEWAL_DURATION_OPTIONS.map((option) => {
              const active = years === option;
              return (
                <TouchableOpacity
                  key={option}
                  onPress={() => setYears(option)}
                  disabled={busy}
                  style={[
                    styles.chip,
                    { borderColor: colors.border, backgroundColor: active ? colors.primary : colors.surface },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? '#fff' : colors.text }]}>
                    {option}y
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Button
            onPress={onSubmit}
            disabled={!canSubmit}
            style={styles.renewalButton}
          >
            {busy ? 'Offering…' : 'Offer renewal'}
          </Button>
        </>
      )}

      {message && (
        <Text
          style={[
            styles.renewalMessage,
            { color: message.kind === 'success' ? colors.success : colors.danger },
          ]}
        >
          {message.text}
        </Text>
      )}
    </View>
  );
}

export default function SquadScreen() {
  const { clubs, players, managedClubId, season, isLoading } = useGameState();
  const { colors } = useTheme();
  const [filters, setFilters] = useState<SquadFilters>({
    position: 'all',
    availableOnly: false,
  });
  const [sortKey, setSortKey] = useState<SquadSortKey>('ability');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const managedClub = clubs.find((c) => c.id === managedClubId) ?? null;
  const squadPlayers = useMemo(
    () => buildSquadView(clubs, players, managedClubId, filters, sortKey),
    [clubs, players, managedClubId, filters, sortKey],
  );
  const allSquadPlayers = useMemo(
    () => buildSquadView(clubs, players, managedClubId, { position: 'all', availableOnly: false }, 'ability'),
    [clubs, players, managedClubId],
  );
  const summary = squadSummary(allSquadPlayers);
  const selectedPlayer = players.find((p) => p.id === selectedPlayerId) ?? null;

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading squad...</Text>
      </View>
    );
  }

  if (!managedClubId || !managedClub) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          No managed club selected
        </Text>
      </View>
    );
  }

  const avgForm = selectedPlayer
    ? selectedPlayer.status.recentForm.reduce((a, b) => a + b, 0) / selectedPlayer.status.recentForm.length
    : 0;

  const positionOptions: Array<Position | 'all'> = ['all', ...SQUAD_POSITIONS];

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>{managedClub.name}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {summary.total} players • {summary.injured} injured • {summary.available} available
        </Text>
      </View>

      <Card style={styles.card}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipRow}>
            {positionOptions.map((position) => {
              const active = filters.position === position;
              return (
                <TouchableOpacity
                  key={position}
                  onPress={() => setFilters((f) => ({ ...f, position }))}
                  style={[
                    styles.chip,
                    { borderColor: colors.border, backgroundColor: active ? colors.primary : colors.surface },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? '#fff' : colors.text }]}>
                    {position === 'all' ? 'All' : position}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              onPress={() => setFilters((f) => ({ ...f, availableOnly: !f.availableOnly }))}
              style={[
                styles.chip,
                {
                  borderColor: colors.border,
                  backgroundColor: filters.availableOnly ? colors.success : colors.surface,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: filters.availableOnly ? '#fff' : colors.text }]}>
                Available
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Sort by</Text>
        <View style={styles.chipRow}>
          {SQUAD_SORT_KEYS.map((key) => {
            const active = sortKey === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setSortKey(key)}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: active ? colors.primaryDark : colors.surface },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? '#fff' : colors.text }]}>
                  {SQUAD_SORT_LABELS[key]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {squadPlayers.length === 0 ? (
        <Card style={styles.card}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No players match the current filters.
          </Text>
        </Card>
      ) : (
        squadPlayers.map((player) => {
          const injured = isPlayerInjured(player);
          const selected = player.id === selectedPlayerId;
          return (
            <TouchableOpacity key={player.id} onPress={() => setSelectedPlayerId(selected ? null : player.id)}>
              <Card style={selected ? { ...styles.playerCard, borderColor: colors.primary, borderWidth: 2 } : styles.playerCard}>
                <View style={styles.playerRow}>
                  <View style={styles.playerMain}>
                    <Text style={[styles.playerName, { color: colors.text }]}>
                      {playerDisplayName(player)}
                    </Text>
                    <Text style={[styles.playerMeta, { color: colors.textSecondary }]}>
                      {player.primaryPosition} • {player.age}y • CAT {player.development.currentAbility}
                    </Text>
                  </View>
                  <View style={styles.playerStats}>
                    <Text style={[styles.statText, { color: colors.text }]}>Morale {Math.round(player.status.morale)}</Text>
                    <Text style={[styles.statText, { color: colors.text }]}>Fit {Math.round(player.status.fitness)}</Text>
                  </View>
                </View>
                {injured && (
                  <Badge variant="danger" style={styles.injuryBadge}>
                    {player.status.injury!.type} • {player.status.injury!.daysRemaining}d
                  </Badge>
                )}
              </Card>
            </TouchableOpacity>
          );
        })
      )}

      {selectedPlayer && (
        <Card style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <View style={styles.playerMain}>
              <Text style={[styles.detailName, { color: colors.text }]}>
                {playerDisplayName(selectedPlayer)}
              </Text>
              <Text style={[styles.playerMeta, { color: colors.textSecondary }]}>
                {selectedPlayer.nationality} • {selectedPlayer.age} years • {selectedPlayer.preferredFoot} foot
              </Text>
              <Text style={[styles.playerMeta, { color: colors.textSecondary }]}>
                {selectedPlayer.primaryPosition}
                {selectedPlayer.secondaryPositions.length > 0 &&
                  ` • also ${selectedPlayer.secondaryPositions.join(', ')}`}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedPlayerId(null)}>
              <Text style={[styles.closeText, { color: colors.primary }]}>Close</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.detailSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Overview</Text>
            <View style={styles.detailGrid}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Current ability</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>{selectedPlayer.development.currentAbility}</Text>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Potential</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>{selectedPlayer.development.potentialAbility}</Text>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Growth curve</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>{selectedPlayer.development.ageGrowthCurve}</Text>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Morale</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>{Math.round(selectedPlayer.status.morale)}</Text>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Fitness</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>{Math.round(selectedPlayer.status.fitness)}</Text>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Avg form</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>{avgForm.toFixed(1)}</Text>
            </View>
          </View>

          {isPlayerInjured(selectedPlayer) && (
            <View style={styles.detailSection}>
              <Text style={[styles.sectionTitle, { color: colors.danger }]}>Injury</Text>
              <Text style={[styles.detailValue, { color: colors.danger }]}>
                {selectedPlayer.status.injury!.type} — {selectedPlayer.status.injury!.severity},{' '}
                {selectedPlayer.status.injury!.daysRemaining} days remaining
              </Text>
            </View>
          )}

          <View style={styles.detailSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent form</Text>
            <View style={styles.formRow}>
              {selectedPlayer.status.recentForm.map((rating, i) => (
                <View key={i} style={[styles.formChip, { borderColor: colors.border }]}>
                  <Text style={[styles.formChipText, { color: colors.text }]}>{rating.toFixed(1)}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.detailSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Contract</Text>
            <View style={styles.detailGrid}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Wage</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>{formatMoney(selectedPlayer.contract.wage)}/wk</Text>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Expires</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                {selectedPlayer.contract.contractExpiryDate.toLocaleDateString()}
              </Text>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Market value</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                {formatMoney(selectedPlayer.contract.marketValue)}
              </Text>
            </View>
            {/* key remounts the section per player: form state never leaks
                between players. */}
            <ContractRenewalSection
              key={selectedPlayer.id}
              player={selectedPlayer}
              managedClubId={managedClubId}
              now={season?.currentDate ?? null}
            />
          </View>

          <View style={styles.detailSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Attributes</Text>
            <AttributeGroup title="Technical" attributes={selectedPlayer.attributes.technical} />
            <AttributeGroup title="Mental" attributes={selectedPlayer.attributes.mental} />
            <AttributeGroup title="Physical" attributes={selectedPlayer.attributes.physical} />
          </View>
        </Card>
      )}
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
  chipRow: {
    flexDirection: 'row',
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
  sectionTitle: {
    ...typography.headingSmall,
    marginBottom: 8,
  },
  playerCard: {
    marginBottom: 8,
  },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  playerMain: {
    flex: 1,
  },
  playerName: {
    ...typography.bodyLarge,
    fontWeight: 'bold',
  },
  playerMeta: {
    ...typography.body,
    marginTop: 2,
  },
  playerStats: {
    alignItems: 'flex-end',
  },
  statText: {
    ...typography.body,
    fontSize: 12,
  },
  injuryBadge: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  emptyText: {
    ...typography.body,
    fontStyle: 'italic',
  },
  detailCard: {
    marginTop: 8,
    marginBottom: 24,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  detailName: {
    ...typography.headingSmall,
  },
  closeText: {
    ...typography.body,
    fontWeight: '600',
  },
  detailSection: {
    marginTop: 12,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  detailLabel: {
    ...typography.body,
    width: '45%',
    paddingVertical: 2,
  },
  detailValue: {
    ...typography.body,
    width: '55%',
    paddingVertical: 2,
    fontWeight: '600',
  },
  formRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  formChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  formChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  attributeGroup: {
    marginTop: 8,
  },
  attributeGroupTitle: {
    ...typography.body,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  attributeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  attributeName: {
    ...typography.body,
    width: '38%',
    fontSize: 12,
  },
  attributeBar: {
    flex: 1,
    marginHorizontal: 6,
  },
  attributeValue: {
    ...typography.body,
    width: '12%',
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '600',
  },
  renewalBlock: {
    marginTop: 12,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  renewalTitle: {
    ...typography.bodyLarge,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  renewalHint: {
    ...typography.body,
    marginBottom: 8,
  },
  renewalInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    marginBottom: 8,
  },
  renewalButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  renewalMessage: {
    ...typography.body,
    marginTop: 8,
    fontWeight: '600',
  },
});
