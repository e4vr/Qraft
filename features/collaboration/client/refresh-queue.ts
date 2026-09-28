/** One active read and one trailing refresh, driven only by actual events. */
export function createRefreshQueue(load: () => Promise<void>) {
  let running = false;
  let dirty = false;
  let stopped = false;
  async function drain() {
    if (running || stopped) return;
    running = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        await load();
      }
    } finally { running = false; }
  }
  return {
    request: () => {
      if (stopped) return;
      dirty = true;
      queueMicrotask(() => { void drain().catch(() => undefined); });
    },
    stop: () => { stopped = true; dirty = false; },
  };
}
