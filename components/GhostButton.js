import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

export default function GhostButton({ title, onPress }) {
  return (
    <TouchableOpacity 
      style={styles.button} 
      activeOpacity={0.6} 
      onPress={onPress}
    >
      <Text style={styles.text}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)', // Faint translucent border
    borderRadius: 12, // Softer Apple-like rounding
  },
  text: {
    fontSize: 13,
    fontWeight: '300', // Thin, soft font weight
    color: '#888888',  // Muted text color
    letterSpacing: 2.5,
    textAlign: 'center',
  }
});
