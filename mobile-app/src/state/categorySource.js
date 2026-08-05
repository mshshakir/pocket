/**
 * categorySource — a read-only, store-free stand-in for CategoryService over a
 * plain category array. Used to browse SOMEONE ELSE's categories (a shared
 * account owner's, from the family snapshot) inside the category picker,
 * without touching the local book. Mirrors the exact method surface the picker
 * relies on (find, visibleRoots, visibleChildren, orphans, hasChildren,
 * search, fullName), with quickCreate disabled.
 *
 * @param {object[]} list  the owner's categories snapshot
 */
export function makeCategorySource(list) {
  const cats = Array.isArray(list) ? list : [];
  const match = (c, type) => !type || c.type === type;

  const find = (id) => cats.find((c) => c.id === id);
  const children = (pid) => cats.filter((c) => c.parentId === pid);
  const visibleChildren = (pid, type = null) =>
    children(pid).filter((c) => match(c, type)).sort((a, b) => a.name.localeCompare(b.name));
  const hasChildren = (id, type = null) => visibleChildren(id, type).length > 0;
  const visibleRoots = (type = null) =>
    cats.filter((c) => !c.parentId)
      .filter((r) => match(r, type) || cats.some((c) => c.parentId === r.id && match(c, type)))
      .sort((a, b) => a.name.localeCompare(b.name));
  const orphans = (type = null) => {
    const ids = new Set(cats.map((c) => c.id));
    return cats.filter((c) => c.parentId && !ids.has(c.parentId) && match(c, type))
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  const fullName = (id) => {
    const c = find(id);
    if (!c) return '';
    if (c.parentId) { const p = find(c.parentId); if (p) return `${p.name} / ${c.name}`; }
    return c.name;
  };
  const search = (query, type = null, limit = 60) => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    return cats
      .filter((c) => match(c, type))
      .filter((c) => fullName(c.id).toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || a.name.localeCompare(b.name);
      })
      .slice(0, limit);
  };
  const quickCreate = () => ({ ok: false, reason: "Can't add categories to a shared account" });

  return { find, children, visibleChildren, hasChildren, visibleRoots, orphans, fullName, search, quickCreate };
}
