// Three-way merge: remote replaces unchanged fields; local drafts keep only
// their own changes. Keyed records are merged independently, including deletes.
export function mergeLiveState<T>(base: T, local: T, remote: T): T {
  if (JSON.stringify(local) === JSON.stringify(base)) return remote;
  if (JSON.stringify(remote) === JSON.stringify(base)) return local;
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const key = (value: unknown) => value && typeof value === 'object' ? ('id' in value ? String(value.id) : 'uid' in value ? String(value.uid) : undefined) : undefined;
    if (![...base, ...local, ...remote].every(value => key(value) !== undefined)) return local;
    const before = new Map(base.map(value => [key(value), value]));
    const ours = new Map(local.map(value => [key(value), value]));
    const theirs = new Map(remote.map(value => [key(value), value]));
    return [...new Set([...theirs.keys(), ...ours.keys()])].flatMap(id => {
      // A server deletion is authoritative; never resurrect revoked access.
      if (before.has(id) && !theirs.has(id)) return [];
      const merged = mergeLiveState(before.get(id), ours.get(id), theirs.get(id));
      return merged === undefined ? [] : [merged];
    }) as T;
  }
  if ((base === undefined || (base && typeof base === 'object')) && local && remote && typeof local === 'object' && typeof remote === 'object' && !Array.isArray(local) && !Array.isArray(remote)) {
    const b = (base ?? {}) as Record<string, unknown>, l = local as Record<string, unknown>, r = remote as Record<string, unknown>;
    return Object.fromEntries([...new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])].flatMap(key => {
      const value = mergeLiveState(b[key], l[key], r[key]);
      return value === undefined ? [] : [[key, value]];
    })) as T;
  }
  return local;
}
