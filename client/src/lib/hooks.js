import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime, useSocketEvent } from './realtime.jsx';

/**
 * Fetch data and keep it fresh: refetch on the given socket events (debounced), after a
 * socket reconnect (events may have been missed), when the tab regains focus, and on a
 * slow safety interval.
 */
export function useLiveQuery(fetcher, deps, { events = [], filter, intervalMs = 60_000 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);
  const timer = useRef(null);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const result = await fetcherRef.current();
      if (mine === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mine === seq.current) setError(err);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  const scheduleReload = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 120);
  }, [load]);

  useEffect(() => {
    setLoading(true);
    load();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useSocketEvent(events, (payload, name) => {
    if (!filter || filter(payload, name)) scheduleReload();
  });

  const { connected } = useRealtime();
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) scheduleReload();
    wasConnected.current = connected;
  }, [connected, scheduleReload]);

  useEffect(() => {
    const onFocus = () => document.visibilityState === 'visible' && scheduleReload();
    document.addEventListener('visibilitychange', onFocus);
    const id = intervalMs ? setInterval(scheduleReload, intervalMs) : null;
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      if (id) clearInterval(id);
    };
  }, [scheduleReload, intervalMs]);

  return { data, error, loading, reload: load, setData };
}

/** Re-render every `ms` milliseconds (for timers). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Run an async action with a busy flag and a toast on failure. */
export function useAction(toast) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn, { success } = {}) => {
      setBusy(true);
      try {
        const result = await fn();
        if (success) toast.success(success);
        return result;
      } catch (err) {
        toast.error(err.message || 'خطایی رخ داد');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return [run, busy];
}

/** Short chime using WebAudio (no asset needed). Browsers only allow it after a user gesture. */
let audioCtx = null;
export function unlockAudio() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    /* audio unavailable */
  }
}
export function chime(kind = 'ready') {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const notes = kind === 'ready' ? [880, 1175] : [660, 660];
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const t = audioCtx.currentTime + i * 0.18;
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}
