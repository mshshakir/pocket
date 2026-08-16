/**
 * SpaceBar — which book you are looking at, and how to change it.
 *
 * Mobile counterpart of the web app's space switcher. Renders nothing at all
 * when nobody shares anything with you: a solo user should never meet a control
 * for a concept they do not have.
 *
 * Inside someone else's space it is deliberately loud. The whole screen is
 * showing another person's money, and that must never be ambiguous — on a phone
 * there is no browser chrome or second panel to carry that context.
 *
 * Mounted once in App.js above the navigator, so it appears over every tab and
 * every pushed screen without each one having to opt in.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { colors } from './theme.js';

export function SpaceBar() {
  const { services, space, inGuestSpace, revision } = useAppState();
  const [open, setOpen] = useState(false);
  const registry = services?.spaces;

  // `revision` is in the dependency chain only so this re-renders when a pull
  // adds or removes a share.
  void revision;

  if (!registry?.hasGuestSpaces) return null;

  const all = registry.all();

  const choose = (id) => {
    setOpen(false);
    if (!registry.activate(id)) return;
    services.store.flush();   // repaint every screen through the new projection
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          paddingHorizontal: 14, paddingVertical: 9,
          backgroundColor: inGuestSpace ? '#818cf815' : colors.card,
          borderBottomWidth: 1,
          borderBottomColor: inGuestSpace ? '#818cf855' : colors.border,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }} numberOfLines={1}>
          {space?.label || 'My money'}
        </Text>
        {inGuestSpace ? (
          <Text style={{ fontSize: 11, color: colors.subtle }} numberOfLines={1}>
            · {space.canAddAnywhere ? 'you can add here' : 'view only'}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 12, color: inGuestSpace ? '#818cf8' : colors.subtle }}>
          Switch ▾
        </Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.5)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} style={{
            backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18,
            paddingTop: 14, paddingBottom: 28, maxHeight: '70%',
          }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, paddingHorizontal: 16 }}>
              Spaces
            </Text>
            <Text style={{ fontSize: 12, color: colors.subtle, paddingHorizontal: 16, marginTop: 2, marginBottom: 8 }}>
              Switch between your own money and what others share with you.
            </Text>
            <ScrollView>
              {all.map((sp) => {
                const active = (sp.id ?? null) === (registry.activeId ?? null);
                const n = sp.accounts.length;
                return (
                  <TouchableOpacity
                    key={sp.id || 'home'}
                    onPress={() => choose(sp.id)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 10,
                      paddingHorizontal: 16, paddingVertical: 12,
                      backgroundColor: active ? colors.card : 'transparent',
                    }}
                  >
                    <View style={{
                      width: 30, height: 30, borderRadius: 10,
                      alignItems: 'center', justifyContent: 'center',
                      backgroundColor: sp.isHome ? '#0ea5e922' : '#818cf822',
                    }}>
                      <Text style={{ fontSize: 14 }}>{sp.isHome ? '👛' : '👥'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: active ? '700' : '500' }} numberOfLines={1}>
                        {sp.label}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.subtle }} numberOfLines={1}>
                        {n} account{n === 1 ? '' : 's'}{sp.isHome ? ' · your own book' : ' shared with you'}
                      </Text>
                    </View>
                    {active ? <Text style={{ color: colors.primary, fontWeight: '700' }}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
