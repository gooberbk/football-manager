import { ActivityIndicator, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ensureCareerBoot } from '../../services/careerBoot';
import { useGameState } from '../../store/useGameState';
import { useTheme } from '../../theme/useTheme';
import { BootErrorView } from '../../components/BootErrorView';

export default function TabsLayout() {
  const bootStatus = useGameState((state) => state.bootStatus);
  const { colors } = useTheme();

  // Deep links can land here without passing through the index gate, so
  // this layout must honor the shared boot status on every entry path:
  // 'pending' shows a loader (same as the index gate), 'error' shows the
  // shared recoverable error — never the tabs' "No career data found"
  // empty state. 'loaded'/'empty' render the tabs normally.
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

  if (bootStatus === 'error') {
    return <BootErrorView onRetry={() => ensureCareerBoot()} />;
  }

  return (
    <Tabs
      initialRouteName="dashboard"
      screenOptions={{
        tabBarActiveTintColor: '#4a90e2',
        tabBarInactiveTintColor: '#999',
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="squad"
        options={{
          title: 'Squad',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tactics"
        options={{
          title: 'Tactics',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="options" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="transfers"
        options={{
          title: 'Transfers',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="swap-horizontal" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="league"
        options={{
          title: 'League',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
