import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useGameState } from '../../store/useGameState';
import { useTheme } from '../../theme/useTheme';
import { typography } from '../../theme/typography';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { submitOffer, resolvePendingOffer, withdrawPendingOffer } from '../../services/transferService';
import type { TransferOffer } from '@club-director/shared-types';

const OFFER_STATUS_LABELS: Record<TransferOffer['status'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export default function TransfersScreen() {
  const { league, season, clubs, players, isLoading, managedClubId, transferOffers, transferHistory, setClubs, setPlayers, setTransferHistory, setTransferOffers, saveState } = useGameState();
  const { colors } = useTheme();
  const [offerAmounts, setOfferAmounts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Autosave after state changes
  useEffect(() => {
    saveState();
  }, [transferOffers, transferHistory, clubs, players, saveState]);

  const handleMakeOffer = (playerId: string) => {
    if (!clubs || !players || !league || !season || !managedClubId || isProcessing) return;

    const player = players.find((p) => p.id === playerId);
    if (!player) return;

    const buyingClub = clubs.find((c) => c.id === managedClubId);
    const sellingClub = clubs.find((c) => c.id === player.contract.clubId);
    if (!buyingClub || !sellingClub) return;

    const amount = parseInt(offerAmounts[playerId] || '', 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice({ type: 'error', text: 'Enter a valid offer amount' });
      return;
    }

    setIsProcessing(true);
    const result = submitOffer({
      buyingClub,
      sellingClub,
      player,
      amount,
      offers: transferOffers,
      transferWindowOpen: season.transferWindowOpen,
    });
    setIsProcessing(false);

    if (result.success && result.offers) {
      setTransferOffers(result.offers);
      setNotice({ type: 'success', text: `Offer of £${amount.toLocaleString()} submitted for ${player.firstName} ${player.lastName}` });
    } else {
      setNotice({ type: 'error', text: result.error || 'Failed to submit offer' });
    }
  };

  const handleResolveOffer = (offerId: string) => {
    if (!clubs || !players || isProcessing) return;

    setIsProcessing(true);
    const result = resolvePendingOffer({
      offerId,
      offers: transferOffers,
      clubs,
      players,
      transferHistory,
    });
    setIsProcessing(false);

    if (result.offers) {
      setTransferOffers(result.offers);
    }

    if (result.success) {
      if (result.clubs) setClubs(result.clubs);
      if (result.players) setPlayers(result.players);
      if (result.transferHistory) setTransferHistory(result.transferHistory);

      const offer = transferOffers.find((o) => o.id === offerId);
      const playerName = offer
        ? `${players.find((p) => p.id === offer.playerId)?.firstName ?? ''} ${players.find((p) => p.id === offer.playerId)?.lastName ?? ''}`.trim()
        : 'player';
      const resolvedStatus = result.offers?.find((o) => o.id === offerId)?.status;
      setNotice({
        type: 'success',
        text: resolvedStatus === 'accepted'
          ? `Transfer completed: ${playerName} joined your club`
          : `Offer for ${playerName} was ${resolvedStatus ?? 'resolved'}`,
      });
    } else {
      setNotice({ type: 'error', text: result.error || 'Failed to resolve offer' });
    }
  };

  const handleWithdrawOffer = (offerId: string) => {
    if (isProcessing) return;
    setTransferOffers(withdrawPendingOffer(transferOffers, offerId));
    setNotice({ type: 'success', text: 'Offer withdrawn' });
  };

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading career...</Text>
      </View>
    );
  }

  if (!league || !season || !clubs.length || !players.length) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>No career data found</Text>
      </View>
    );
  }

  const availablePlayers = players.filter(
    (p) => p.contract.clubId !== null && p.contract.clubId !== managedClubId,
  );
  const managedClub = clubs.find((c) => c.id === managedClubId);

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Transfers</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Season {season.currentWeek} • {season.currentDate.toLocaleDateString()}
        </Text>
      </View>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Transfer Market</Text>
        <View style={styles.marketInfo}>
          <Text style={[styles.budgetText, { color: colors.primary }]}>
            Budget: £{(managedClub?.finances.transferBudget || 0).toLocaleString()}
          </Text>
          <Badge variant={season.transferWindowOpen ? 'success' : 'warning'}>
            {season.transferWindowOpen ? 'Window Open' : 'Window Closed'}
          </Badge>
        </View>
      </Card>

      {notice && (
        <Card style={styles.card}>
          <Text style={[styles.noticeText, { color: notice.type === 'success' ? colors.primary : colors.danger }]}>
            {notice.text}
          </Text>
        </Card>
      )}

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Available Players</Text>
        <ScrollView>
          {availablePlayers.map((player) => (
            <View key={player.id} style={[styles.playerCard, { borderBottomColor: colors.border }]}>
              <Text style={[styles.playerName, { color: colors.text }]}>
                {player.firstName} {player.lastName}
              </Text>
              <Text style={[styles.playerClub, { color: colors.textSecondary }]}>
                {clubs.find((c) => c.id === player.contract.clubId)?.name}
              </Text>
              <Text style={[styles.playerValue, { color: colors.primary }]}>
                Value: £{player.contract.marketValue.toLocaleString()}
              </Text>
              <TextInput
                style={[styles.offerInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                placeholder="Offer amount"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={offerAmounts[player.id] ?? ''}
                onChangeText={(text) => setOfferAmounts((prev) => ({ ...prev, [player.id]: text }))}
              />
              <Button
                onPress={() => handleMakeOffer(player.id)}
                disabled={!season.transferWindowOpen || isProcessing}
              >
                Make Offer
              </Button>
            </View>
          ))}
        </ScrollView>
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Pending Offers</Text>
        {transferOffers.length === 0 ? (
          <Text style={[styles.noResultsText, { color: colors.textMuted }]}>No offers yet</Text>
        ) : (
          transferOffers.map((offer) => (
            <View key={offer.id} style={[styles.offerCard, { borderBottomColor: colors.border }]}>
              <View style={styles.offerHeader}>
                <Text style={[styles.offerText, { color: colors.text, flex: 1 }]}>
                  {offer.buyingClubId === managedClubId ? 'Your club' : clubs.find((c) => c.id === offer.buyingClubId)?.name} offered £{offer.offerAmount.toLocaleString()} for{' '}
                  {players.find((p) => p.id === offer.playerId)?.firstName}{' '}
                  {players.find((p) => p.id === offer.playerId)?.lastName}
                </Text>
                <Badge variant={offer.status === 'accepted' ? 'success' : offer.status === 'pending' ? 'warning' : 'default'}>
                  {OFFER_STATUS_LABELS[offer.status]}
                </Badge>
              </View>
              {offer.status === 'pending' && (
                <View style={styles.offerActions}>
                  <Button
                    variant="primary"
                    onPress={() => handleResolveOffer(offer.id)}
                    style={styles.actionButton}
                    disabled={isProcessing}
                  >
                    Resolve
                  </Button>
                  <Button
                    variant="danger"
                    onPress={() => handleWithdrawOffer(offer.id)}
                    style={styles.actionButton}
                    disabled={isProcessing}
                  >
                    Withdraw
                  </Button>
                </View>
              )}
            </View>
          ))
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Transfer History</Text>
        {transferHistory.length === 0 ? (
          <Text style={[styles.noResultsText, { color: colors.textMuted }]}>No transfers yet</Text>
        ) : (
          transferHistory.map((transfer, index) => (
            <View key={index} style={[styles.historyItem, { borderBottomColor: colors.border }]}>
              <Text style={[styles.historyText, { color: colors.text }]}>
                {transfer.date.toLocaleDateString()}: {players.find((p) => p.id === transfer.playerId)?.firstName}{' '}
                {players.find((p) => p.id === transfer.playerId)?.lastName} ({clubs.find((c) => c.id === transfer.fromClubId)?.name} →{' '}
                {clubs.find((c) => c.id === transfer.toClubId)?.name}) - £{transfer.fee.toLocaleString()}
              </Text>
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
  marketInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  budgetText: {
    ...typography.bodyLarge,
    fontWeight: 'bold',
  },
  playerCard: {
    borderBottomWidth: 1,
    paddingBottom: 12,
    marginBottom: 12,
  },
  playerName: {
    ...typography.bodyLarge,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  playerClub: {
    ...typography.body,
    marginBottom: 4,
  },
  playerValue: {
    ...typography.body,
    marginBottom: 8,
  },
  offerInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    fontSize: 16,
  },
  offerCard: {
    borderBottomWidth: 1,
    paddingBottom: 12,
    marginBottom: 12,
  },
  offerText: {
    ...typography.body,
    marginBottom: 8,
  },
  offerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  noticeText: {
    ...typography.body,
    fontWeight: '600',
  },
  offerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
  },
  noResultsText: {
    ...typography.body,
    fontStyle: 'italic',
  },
  historyItem: {
    borderBottomWidth: 1,
    paddingBottom: 8,
    marginBottom: 8,
  },
  historyText: {
    ...typography.body,
  },
});
