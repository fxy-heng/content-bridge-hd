export function createSnapshot(source, existingSnapshots = [], options = {}) {
  const now = options.now || new Date();
  const snapshot = {
    id: `snap_${now.getTime()}`,
    createdAt: now.toISOString(),
    title: source.title || "未命名草稿",
    source: { ...source }
  };

  return [snapshot, ...existingSnapshots].slice(0, options.limit || 12);
}

export function findSnapshot(snapshots = [], id) {
  return snapshots.find((snapshot) => snapshot.id === id) || null;
}
