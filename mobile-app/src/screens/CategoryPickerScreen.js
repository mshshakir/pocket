/**
 * CategoryPickerScreen — the two-step category picker, ported from the web's
 * CategoryPickerSheet. Same rules:
 *
 *   step 1 parents only · step 2 that parent's children · search spans both ·
 *   quick-add derives icon/colour from the name · in single mode a parent with
 *   children is a group header (drill in), a childless parent is selectable ·
 *   multi mode offers "whole group" and commits with Done.
 *
 * Params: { token, mode?='single', type?=null, selected?=[] } — token resolves
 * via PickerBus with the chosen id array.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { PickerBus } from '../state/PickerBus.js';
import { makeCategorySource } from '../state/categorySource.js';
import { Row, Dot, Input, Button } from '../ui/common.js';
import { colors } from '../ui/theme.js';

export default function CategoryPickerScreen({ navigation, route }) {
  const { token, mode = 'single', type = null, selected: initial = [], categories: ownerCats = null } = route.params || {};
  const { state, services } = useAppState();
  // When browsing a shared account owner's categories, use a read-only source
  // over their snapshot instead of the local book. Quick-add is disabled there.
  const cats = ownerCats ? makeCategorySource(ownerCats) : services.categories;
  const readOnly = !!ownerCats;

  const [parentId, setParentId] = useState(() => {
    // Deep-link into the parent of the current selection, like the web.
    const first = (initial || [])[0];
    const cat = first ? cats.find(first) : null;
    return cat?.parentId && (!type || cat.type === type) ? cat.parentId : null;
  });
  const [selected, setSelected] = useState(() => new Set((initial || []).filter(Boolean)));
  const [query, setQuery]       = useState('');
  const [adding, setAdding]     = useState(false);
  const [newName, setNewName]   = useState('');
  const [error, setError]       = useState('');

  const finish = (ids) => {
    PickerBus.resolve(token, ids);
    navigation.goBack();
  };

  const choose = (id) => {
    if (mode === 'multi') {
      setSelected((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
      return;
    }
    finish([id]);
  };

  const submitAdd = () => {
    const res = cats.quickCreate(newName, { parentId, type: type || 'expense' });
    if (!res.ok) { setError(res.reason); return; }
    setError('');
    setAdding(false);
    setNewName('');
    if (mode === 'multi') {
      setSelected((prev) => new Set(prev).add(res.category.id));
    } else if (parentId) {
      finish([res.category.id]);
    } else {
      // New parent from step 1 → drill in so its first subcategory is one tap away.
      setParentId(res.category.id);
    }
  };

  // ── Rows for the current view ─────────────────────────────────────────
  const rows = useMemo(() => {
    const q = query.trim();
    if (q) {
      return cats.search(q, type).map((c) => {
        const isGroup = !c.parentId && cats.hasChildren(c.id, type);
        return { kind: isGroup && mode === 'single' ? 'group' : 'leaf', cat: c, showPath: true };
      });
    }
    if (parentId) {
      const parent = cats.find(parentId);
      const out = [];
      if (mode === 'multi' && parent) out.push({ kind: 'wholeGroup', cat: parent });
      for (const c of cats.visibleChildren(parentId, type)) out.push({ kind: 'leaf', cat: c });
      return out;
    }
    const out = [];
    if (mode === 'single') out.push({ kind: 'none' });
    for (const root of cats.visibleRoots(type)) {
      const kids = cats.visibleChildren(root.id, type);
      out.push({ kind: kids.length ? 'group' : 'leaf', cat: root, count: kids.length });
    }
    for (const orphan of cats.orphans(type)) out.push({ kind: 'leaf', cat: orphan });
    return out;
    // services.store.revision makes quick-add re-list immediately
  }, [query, parentId, type, mode, services.store.revision, selected]);

  const parent = parentId ? cats.find(parentId) : null;

  const renderRow = ({ item }) => {
    if (item.kind === 'none') {
      return (
        <Row onPress={() => finish([])} style={{ paddingHorizontal: 12 }}>
          <Dot color={colors.faint} />
          <Text style={{ flex: 1, color: colors.subtle }}>Uncategorised</Text>
          {selected.size === 0 ? <Check /> : null}
        </Row>
      );
    }
    const c  = item.cat;
    const on = selected.has(c.id);
    if (item.kind === 'group') {
      const pickedIn = cats.visibleChildren(c.id, type).filter((k) => selected.has(k.id)).length;
      return (
        <Row onPress={() => { setParentId(c.id); setQuery(''); }} style={{ paddingHorizontal: 12 }}>
          <Dot color={c.color} />
          <Text style={{ flex: 1, color: colors.text, fontWeight: '500' }}>{c.name}</Text>
          <Text style={{ fontSize: 12, color: colors.faint, marginRight: 6 }}>
            {pickedIn ? `${pickedIn} of ${item.count ?? ''}` : item.count ?? ''}
          </Text>
          <Text style={{ color: colors.faint }}>›</Text>
        </Row>
      );
    }
    if (item.kind === 'wholeGroup') {
      return (
        <Row onPress={() => choose(c.id)} style={{ paddingHorizontal: 12 }}>
          <Dot color={c.color} />
          <Text style={{ flex: 1, color: colors.text, fontWeight: '500' }}>
            Whole group · {c.name}
          </Text>
          {on ? <Check /> : null}
        </Row>
      );
    }
    const path = item.showPath && c.parentId ? cats.find(c.parentId)?.name : null;
    return (
      <Row onPress={() => choose(c.id)} style={{ paddingHorizontal: 12 }}>
        <Dot color={c.color} />
        <Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>
          {path ? <Text style={{ color: colors.subtle }}>{path} / </Text> : null}
          {c.name}
        </Text>
        {on ? <Check /> : null}
      </Row>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        {parent && !query ? (
          <TouchableOpacity onPress={() => setParentId(null)} style={{ marginBottom: 8 }}>
            <Text style={{ color: colors.subtle }}>‹ All categories</Text>
          </TouchableOpacity>
        ) : null}
        <Input
          placeholder="Search all categories…"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item, i) => item.cat?.id || `row_${i}`}
        renderItem={renderRow}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: colors.subtle, marginTop: 24 }}>
            {query ? `Nothing matches “${query.trim()}”.` : 'No categories yet — add one below.'}
          </Text>
        }
        ListFooterComponent={
          (query || readOnly) ? null : (
            <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
              {adding ? (
                <View>
                  <Input
                    placeholder={parent ? `New subcategory in ${parent.name}` : 'New parent category'}
                    value={newName}
                    onChangeText={setNewName}
                    autoFocus
                    onSubmitEditing={submitAdd}
                  />
                  {error ? <Text style={{ color: colors.red, fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <Button title="Add" onPress={submitAdd} style={{ flex: 1 }} />
                    <Button title="Cancel" kind="ghost" onPress={() => { setAdding(false); setError(''); }} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : (
                <TouchableOpacity onPress={() => setAdding(true)}>
                  <Text style={{ color: colors.subtle, paddingVertical: 10 }}>
                    ＋ {parent ? `New subcategory in ${parent.name}` : 'New parent category'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
      />

      {mode === 'multi' ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16,
          borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
        }}>
          <Text style={{ color: colors.subtle, fontSize: 12 }}>
            {selected.size ? `${selected.size} selected` : 'None selected'}
          </Text>
          <View style={{ flex: 1 }} />
          <Button title="Clear" kind="ghost" onPress={() => setSelected(new Set())} />
          <Button title="Done" onPress={() => finish([...selected])} />
        </View>
      ) : null}
    </View>
  );
}

function Check() {
  return <Text style={{ color: colors.green, fontWeight: '700' }}>✓</Text>;
}
