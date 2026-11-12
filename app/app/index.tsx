import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { ensureCareerBoot } from '../services/careerBoot';
import { careerLandingRoute } from '../services/careerRouting';
import { useGameState } from '../store/useGameState';
import { useTheme } from '../theme/useTheme';
import { BootErrorView } from '../components/BootErrorView';

/**
 * Root gate: waits for the career boot (database init + career load, which
 * also runs from the root layout for deep links), then redirects to the
 * dashboard or the new-career screen. Boot status comes from the shared
 * store so this gate and the tab-layout guard can never disagree; a boot
 * failure is an explicit, recoverable error — never "no career".
 */
export default function IndexGate() {
  const bootStatus = useGameState((state) => state.bootStatus);
  const { colors } = useTheme();

  useEffect(() => {
    ensureCareerBoot();
  }, []);

  const handleRetry = () => {
    ensureCareerBoot();
  };

  if (bootStatus === 'error') {
    return <BootErrorView onRetry={handleRetry} />;
  }

  if (bootStatus === 'pending') {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <Redirect href={careerLandingRoute(bootStatus === 'loaded')} />;
}
