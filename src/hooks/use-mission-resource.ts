import { useEffect, useState } from 'react';
import { readCache, writeCache } from '@/lib/mission-cache';
type Result<T> = { data: T | null; error: string | null; source: string };
export function useMissionResource<T>(key: string, load: () => Promise<Result<T>>, refresh: number) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean; cached: boolean; saved: number | null }>({ data: null, error: null, loading: true, cached: false, saved: null });
  useEffect(() => {
    let alive = true;
    setState({ data: null, error: null, loading: true, cached: false, saved: null });
    void (async () => {
      const hit = await readCache<T>(key);
      if (alive && hit) setState({ data: hit.value, error: null, loading: true, cached: true, saved: hit.saved });
      try {
        if (!navigator.onLine && hit) { if (alive) setState({ data: hit.value, error: null, loading: false, cached: true, saved: hit.saved }); return; }
        const result = await load();
        if (result.data) { await writeCache(key, result.data); if (alive) setState({ data: result.data, error: null, loading: false, cached: false, saved: Date.now() }); }
        else if (alive) setState({ data: hit?.value ?? null, error: result.error, loading: false, cached: !!hit, saved: hit?.saved ?? null });
      } catch { if (alive) setState({ data: hit?.value ?? null, error: 'Connection unavailable. Retry when communication returns.', loading: false, cached: !!hit, saved: hit?.saved ?? null }); }
    })();
    return () => { alive = false; };
    // Callers encode every request parameter in key; callback identity is intentionally ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh]);
  return state;
}