/**
 * VoiceOverlay — full-screen feedback for voice entry (mobile).
 *
 * Mirrors the web overlay: a row of bars that rise with the live mic level
 * (`level`, 0..1, fed from expo-av metering by the screen) while "listening",
 * then a spinner while "processing". Purely presentational — the parent owns
 * the recorder and passes level/seconds/phase plus onStop / onCancel.
 */
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { colors } from './theme.js';

const BAR_COUNT = 13;

export default function VoiceOverlay({
  visible,
  phase = 'listening',
  level = 0,
  seconds = 0,
  onStop = () => {},
  onCancel = () => {},
}) {
  // A slow tick keeps the bars alive (a travelling wave) even during silence.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!visible || phase !== 'listening') return undefined;
    const id = setInterval(() => setTick((t) => (t + 1) % 1e6), 90);
    return () => clearInterval(id);
  }, [visible, phase]);

  const heights = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const centre = 1 - Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2); // 0..1
    const wave = 0.5 + 0.5 * Math.sin(tick * 0.5 + i * 0.7);                       // 0..1
    heights.push(6 + 6 * wave + level * 46 * (0.35 + 0.65 * centre) * (0.5 + 0.5 * wave));
  }
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{
          width: 320, maxWidth: '88%', backgroundColor: colors.card, borderColor: colors.border,
          borderWidth: 1, borderRadius: 22, padding: 24, alignItems: 'center',
        }}>
          {phase === 'processing' ? (
            <>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Transcribing…</Text>
              <Text style={{ color: colors.subtle, fontSize: 12.5, marginTop: 4, textAlign: 'center' }}>
                Reading your transaction
              </Text>
              <View style={{ height: 84, marginVertical: 18, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="large" color={colors.green} />
              </View>
            </>
          ) : (
            <>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Listening…</Text>
              <Text style={{ color: colors.subtle, fontSize: 12.5, marginTop: 4, textAlign: 'center' }}>
                Say the transaction, then tap Stop
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 84, marginVertical: 18, gap: 4 }}>
                {heights.map((h, i) => (
                  <View key={i} style={{ width: 6, height: h, borderRadius: 4, backgroundColor: colors.green }} />
                ))}
              </View>
              <Text style={{ color: colors.subtle, fontSize: 13, fontVariant: ['tabular-nums'] }}>{mmss}</Text>
              <TouchableOpacity onPress={onStop} style={{
                marginTop: 16, width: '100%', backgroundColor: colors.green, borderRadius: 14,
                paddingVertical: 13, alignItems: 'center',
              }}>
                <Text style={{ color: '#052e22', fontWeight: '800', fontSize: 15 }}>■ Stop &amp; read</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onCancel} style={{ marginTop: 10, paddingVertical: 6 }}>
                <Text style={{ color: colors.subtle, fontSize: 13 }}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
