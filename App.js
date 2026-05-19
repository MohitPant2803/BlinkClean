import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import HomeScreen from './screens/HomeScreen';

export default function App() {
  return (
    <View style={styles.container}>
      {/* Light status bar for the dark background */}
      <StatusBar style="light" />
      <HomeScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A', // Deep, calming dark background
  },
});
