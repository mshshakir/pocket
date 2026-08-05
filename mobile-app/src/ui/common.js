/**
 * common — small shared UI pieces so screens stay declarative.
 */
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, radius } from './theme.js';

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function Row({ children, style, onPress }) {
  const inner = <View style={[styles.row, style]}>{children}</View>;
  return onPress
    ? <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{inner}</TouchableOpacity>
    : inner;
}

export function Dot({ color, size = 10 }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: /^#[0-9a-fA-F]{3,8}$/.test(color || '') ? color : colors.faint,
      marginRight: 10,
    }} />
  );
}

export function Chip({ label, tone = colors.subtle }) {
  return (
    <View style={[styles.chip, { borderColor: tone }]}>
      <Text style={{ fontSize: 11, color: tone }}>{label}</Text>
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', style, disabled }) {
  const isPrimary = kind === 'primary';
  const isDanger  = kind === 'danger';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={[
        styles.btn,
        isPrimary && styles.btnPrimary,
        isDanger && styles.btnDanger,
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      <Text style={[
        styles.btnText,
        isPrimary && { color: colors.primaryFg },
        isDanger && { color: colors.red },
      ]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}

export function Field({ label, children }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

export function Input(props) {
  return (
    <TextInput
      placeholderTextColor={colors.faint}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

/**
 * Segmented control — the expense/income/transfer switch and friends.
 * @param {{options:Array<{id:string,label:string}>, value:string, onChange:(id:string)=>void}} props
 */
export function Segmented({ options, value, onChange }) {
  return (
    <View style={styles.segmentWrap}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <TouchableOpacity
            key={o.id}
            style={[styles.segment, on && styles.segmentOn]}
            onPress={() => onChange(o.id)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, on && { color: colors.primaryFg }]}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function EmptyState({ title, subtitle }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
      <Text style={{ fontWeight: '600', color: colors.text }}>{title}</Text>
      {subtitle ? <Text style={{ color: colors.subtle, marginTop: 4, fontSize: 13 }}>{subtitle}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 14,
    marginBottom: 12,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, marginTop: 4 },
  sectionTitle: {
    fontSize: 12, letterSpacing: 1, color: colors.subtle,
    textTransform: 'uppercase', fontWeight: '600',
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
  },
  chip: {
    borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8,
  },
  btn: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.control,
    paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center',
    backgroundColor: colors.card,
  },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnDanger:  { borderColor: colors.red },
  btnText:    { fontWeight: '600', color: colors.text },
  fieldLabel: { fontSize: 12, color: colors.subtle, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.control,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    color: colors.text, backgroundColor: colors.card,
  },
  segmentWrap: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  segment: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.control,
    backgroundColor: colors.card,
  },
  segmentOn:   { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { fontWeight: '600', color: colors.text, fontSize: 13 },
});
