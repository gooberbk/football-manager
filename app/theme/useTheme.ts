import { useColorScheme } from 'react-native';
import { colors } from './colors';

export function useTheme() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return {
    colors: {
      primary: colors.primary,
      primaryDark: colors.primaryDark,
      primaryLight: colors.primaryLight,
      background: isDark ? colors.backgroundDark : colors.background,
      surface: isDark ? colors.surfaceDark : colors.surface,
      text: isDark ? colors.textDark : colors.text,
      textSecondary: isDark ? colors.textSecondaryDark : colors.textSecondary,
      textMuted: isDark ? colors.textMutedDark : colors.textMuted,
      success: colors.success,
      warning: colors.warning,
      danger: colors.danger,
      info: colors.info,
      border: isDark ? colors.borderDark : colors.border,
    },
    isDark,
  };
}
