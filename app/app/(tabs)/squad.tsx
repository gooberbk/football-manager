import { View, Text, StyleSheet } from 'react-native';

export default function SquadScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Squad</Text>
      <Text style={styles.subtitle}>Full roster list with player detail views</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
});
