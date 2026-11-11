import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { ensureCareerBoot } from '../services/careerBoot';
import { careerLandingRoute } from '../services/careerRouting';
import { useTheme } from '../theme/useTheme';

/**
 * Root gate: waits for the career boot (database init + career load, which
 * also runs from the root layout for deep links), then redirects to the
 * dashboard or the new-career screen.
 */
export default function IndexGate() {
  const [hasCareer, setHasCareer] = useState<boolean | null>(null);
  const { colors } = useTheme();

  useEffect(() => {
    let cancelled = false;
    ensureCareerBoot().then((loaded) => {
      if (!cancelled) {
        setHasCareer(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (hasCareer === null) {
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

  return <Redirect href={careerLandingRoute(hasCareer)} />;
}
