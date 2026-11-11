import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

interface StatBarProps {
  value: number; // 1-20
  max?: number;
  color?: string;
}

export function StatBar({ value, max = 20, color }: StatBarProps) {
  const { colors } = useTheme();
  const barColor = color || colors.primary;
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <View style={styles.container}>
      <View style={[styles.background, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${percentage}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  background: {
    flex: 1,
    borderRadius: 4,
  },
  fill: {
    height: '100%',
    borderRadius: 4,
  },
});
