import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Shared recoverable boot-failure view. Used by the root index gate and the
 * tab layout guard so a database boot error looks and behaves identically on
 * every entry path, including deep links. It never implies "no career" —
 * the underlying data is left untouched and the user can retry.
 */
export function BootErrorView({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.centerContainer,
        { backgroundColor: colors.background },
      ]}
    >
      <Text style={[styles.errorTitle, { color: colors.text }]}>
        Unable to load your career
      </Text>
      <Text style={[styles.errorBody, { color: colors.textSecondary }]}>
        The database could not be read. Your saved data has not been
        modified — please try again.
      </Text>
      <TouchableOpacity
        style={[styles.retryButton, { backgroundColor: colors.primary }]}
        onPress={onRetry}
        accessibilityRole="button"
      >
        <Text style={styles.retryLabel}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
