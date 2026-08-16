/**
 * CategoriesScreen — the parent → child tree, with add / rename / delete.
 * Renaming is id-based so existing transactions follow automatically. Delete is
 * blocked while any transaction OR split leg references the category (audit M6),
 * via CategoryService.usageCount().
 */
import React, { useState } from 'react';
import { ScrollView, View, Text, Alert, TouchableOpacity } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { Card, SectionTitle, Field, Input, Button, Segmented, Dot } from '../ui/common.js';
import { colors } from '../ui/theme.js';

export default function CategoriesScreen() {
  const { state, services, inGuestSpace, guard, space } = useAppState();
  const cats = services.categories;

  /**
   * In a guest space this is the OWNER's tree, read-only.
   *
   * It used to be the member's own, because `visibleRoots`/`orphans` read the
   * local store unconditionally — so the screen showed your categories under a
   * banner naming someone else's space, and "＋ New category" was hidden while
   * Edit and ✕ on every row stayed live. Nothing was corrupted, but the screen
   * answered a question nobody asked: it is reached FROM a space, and the ids
   * it must explain are the ones a contribution has to carry.
   */
  const tree = inGuestSpace ? (state.categories || []) : null;
  const requireOwn = () => {
    const v = guard?.requireHome('categories') ?? { ok: true };
    if (!v.ok) Alert.alert('Not here', v.message);
    return v.ok;
  };
  const [editing, setEditing] = useState(null); // null | {} | category
  const [typeFilter, setTypeFilter] = useState('expense');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleCollapse = (id) => setCollapsed((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  if (editing !== null) {
    return <CategoryForm category={editing.id ? editing : null} defaultType={typeFilter}
      onDone={() => setEditing(null)} services={services} state={state} />;
  }

  const roots = cats.visibleRoots(typeFilter, tree);
  const orphans = cats.orphans(typeFilter, tree);

  const del = (c) => {
    if (!requireOwn()) return;
    const used = cats.usageCount(c.id);
    if (used > 0) { Alert.alert('In use', `${used} transaction${used === 1 ? '' : 's'} use this — reassign them first.`); return; }
    Alert.alert('Delete category', `Delete "${c.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => cats.delete(c.id) },
    ]);
  };

  const catRow = (c, indent, childCount = 0) => {
    const isOpen = !collapsed.has(c.id);
    return (
      <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9,
        paddingLeft: indent ? 24 : 0, borderBottomWidth: 1, borderColor: colors.muted }}>
        {childCount > 0 ? (
          <TouchableOpacity onPress={() => toggleCollapse(c.id)} style={{ paddingRight: 6 }}>
            <Text style={{ color: colors.faint, width: 14 }}>{isOpen ? '▾' : '▸'}</Text>
          </TouchableOpacity>
        ) : null}
        <Dot color={c.color} />
        <Text style={{ flex: 1, color: colors.text }}>
          {indent ? '↳ ' : ''}{c.name}{childCount > 0 ? <Text style={{ color: colors.faint }}>  {childCount}</Text> : null}
        </Text>
        {/* Both resolved the id against the member's own book and returned
            early on a miss, so they closed and changed nothing. Phase 2 gives
            a member their own categories inside a space; until then, read-only. */}
        {inGuestSpace ? null : (
          <>
            <TouchableOpacity onPress={() => setEditing(c)} style={{ paddingHorizontal: 8 }}>
              <Text style={{ color: colors.subtle }}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => del(c)} style={{ paddingHorizontal: 4 }}>
              <Text style={{ color: colors.red }}>✕</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Segmented
        options={[{ id: 'expense', label: 'Expense' }, { id: 'income', label: 'Income' }, { id: 'transfer', label: 'Transfer' }]}
        value={typeFilter} onChange={setTypeFilter} />
      {inGuestSpace ? (
        <Text style={{
          color: colors.subtle, fontSize: 12, lineHeight: 17,
          backgroundColor: '#818cf815', borderRadius: 10, padding: 10, marginVertical: 12,
        }}>
          {space?.label}'s categories. Anything you add to their accounts is filed
          under these, not your own.
        </Text>
      ) : <Button title="＋ New category" onPress={() => setEditing({})} style={{ marginBottom: 12 }} />}

      {roots.length === 0 && orphans.length === 0 ? (
        <Card><Text style={{ color: colors.subtle, textAlign: 'center' }}>No categories of this type yet.</Text></Card>
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {roots.map((root) => {
            const kids = cats.visibleChildren(root.id, typeFilter);
            return [
              catRow(root, false, kids.length),
              ...(collapsed.has(root.id) ? [] : kids.map((c) => catRow(c, true))),
            ];
          })}
          {orphans.length ? <Text style={{ fontSize: 11, color: colors.faint, paddingTop: 8 }}>Ungrouped</Text> : null}
          {orphans.map((c) => catRow(c, false))}
        </Card>
      )}
    </ScrollView>
  );
}

// Same lucide icon set the web CategoryModal offers. Mobile shows the name
// (it doesn't render lucide glyphs) but stores it, so the web renders the icon.
const CATEGORY_ICONS = [
  'tag', 'utensils', 'car', 'shopping-bag', 'heart-pulse', 'home', 'film',
  'receipt', 'graduation-cap', 'banknote', 'briefcase', 'landmark', 'plane',
  'dumbbell', 'gift', 'baby', 'paw-print', 'wifi',
];
const CATEGORY_COLORS = [
  '#0ea5e9', '#22c55e', '#a855f7', '#f97316', '#14b8a6',
  '#ec4899', '#ef4444', '#0891b2', '#8b5cf6', '#f59e0b',
];

function CategoryForm({ category, defaultType, onDone, services, state }) {
  const cats = services.categories;
  const seedLook = category || cats.guessAppearance(category?.name || 'tag', category?.type || defaultType || 'expense');
  const [name, setName] = useState(category?.name || '');
  const [type, setType] = useState(category?.type || defaultType || 'expense');
  const [parentId, setParentId] = useState(category?.parentId || null);
  const [color, setColor] = useState(category?.color || seedLook.color || CATEGORY_COLORS[0]);
  const [icon, setIcon] = useState(category?.icon || seedLook.icon || 'tag');

  const parents = cats.visibleRoots(type).filter((p) => p.id !== category?.id);

  const save = () => {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    if (category) {
      cats.update(category.id, { name: name.trim(), type, parentId: parentId || null, color, icon });
    } else {
      cats.create({ name: name.trim(), type, parentId: parentId || null, color, icon });
    }
    onDone();
  };

  const del = () => {
    const used = cats.usageCount(category.id);
    if (used > 0) { Alert.alert('In use', `${used} transaction${used === 1 ? '' : 's'} use this — reassign them first.`); return; }
    Alert.alert('Delete category', `Delete "${category.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { cats.delete(category.id); onDone(); } },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card>
        <Field label="Name">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Dot color={color} size={16} />
            <Input value={name} onChangeText={setName} autoFocus placeholder="e.g. Groceries" style={{ flex: 1 }} />
          </View>
        </Field>
        <Field label="Type">
          <Segmented
            options={[{ id: 'expense', label: 'Expense' }, { id: 'income', label: 'Income' }, { id: 'transfer', label: 'Transfer' }]}
            value={type} onChange={(t) => { setType(t); setParentId(null); }} />
        </Field>
        <Field label="Colour">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {CATEGORY_COLORS.map((c) => (
              <TouchableOpacity key={c} onPress={() => setColor(c)}
                style={{
                  width: 30, height: 30, borderRadius: 15, backgroundColor: c,
                  borderWidth: c === color ? 3 : 0, borderColor: colors.text,
                }} />
            ))}
          </View>
        </Field>
        <Field label="Icon (shown on web)">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {CATEGORY_ICONS.map((ic) => (
                <TouchableOpacity key={ic} onPress={() => setIcon(ic)} style={chip(ic === icon)}>
                  <Text style={chipText(ic === icon)}>{ic}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Field>
        <Field label="Parent (optional)">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={() => setParentId(null)}
                style={chip(parentId === null)}>
                <Text style={chipText(parentId === null)}>None</Text>
              </TouchableOpacity>
              {parents.map((p) => (
                <TouchableOpacity key={p.id} onPress={() => setParentId(p.id)} style={chip(parentId === p.id)}>
                  <Text style={chipText(parentId === p.id)}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Field>
      </Card>
      <Button title={category ? 'Save' : 'Create'} onPress={save} />
      {category ? <Button title="Delete category" kind="danger" onPress={del} style={{ marginTop: 8 }} /> : null}
      <Button title="Cancel" kind="ghost" onPress={onDone} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const chip = (on) => ({
  borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
  borderColor: on ? colors.primary : colors.border,
  backgroundColor: on ? colors.primary : colors.card,
});
const chipText = (on) => ({ fontSize: 13, color: on ? colors.primaryFg : colors.text });
