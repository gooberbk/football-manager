import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { ensureCareerBoot } from '../services/careerBoot';

export default function RootLayout() {
  // Kick off career loading for every entry point (including deep links);
  // the index screen uses the same singleton to decide where to redirect.
  useEffect(() => {
    ensureCareerBoot();
  }, []);

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="new-career" options={{ title: 'Start New Career' }} />
    </Stack>
  );
}
