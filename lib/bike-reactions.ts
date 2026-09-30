// One serialized writer per bike. A response confirms a request, never a newer intent.
export function createBikeReaction(
  bike: { liked?: boolean; likes?: number | null },
  send: (liked: boolean) => Promise<{ liked: boolean; likes?: number }>,
) {
  let confirmed = { liked: !!bike.liked, likes: bike.likes ?? undefined };
  let desired = confirmed.liked;
  let version = 0;
  let running = false;
  let error = false;
  let snapshot = { ...confirmed, pending: false, error: false };
  const listeners = new Set<() => void>();
  function publish() {
    snapshot = {
      liked: desired,
      likes:
        typeof confirmed.likes === "number" && Number.isFinite(confirmed.likes)
          ? Math.max(
              0,
              confirmed.likes + Number(desired) - Number(confirmed.liked),
            )
          : undefined,
      pending: running,
      error,
    };
    listeners.forEach((listener) => listener());
  }
  async function drain() {
    if (running) return;
    running = true;
    publish();
    while (desired !== confirmed.liked) {
      const target = desired,
        requestVersion = version;
      try {
        const result = await send(target);
        error = false;
        confirmed = { liked: !!result.liked, likes: result.likes };
        // The server remains authoritative (including changed permissions).
        if (requestVersion === version) desired = confirmed.liked;
      } catch {
        error = requestVersion === version;
        if (requestVersion === version) desired = confirmed.liked;
      }
      publish();
    }
    running = false;
    publish();
  }
  return {
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toggle() {
      desired = !desired;
      version++;
      error = false;
      publish();
      void drain();
    },
  };
}
