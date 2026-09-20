import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './auth.jsx';

const RealtimeContext = createContext({ socket: null, connected: false });

/** One socket per signed-in session. The server authenticates it with the session cookie. */
export function RealtimeProvider({ children }) {
  const { user, refresh, logout } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) return undefined;
    const s = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', (err) => {
      setConnected(false);
      if (err.message === 'UNAUTHORIZED') refresh().catch(() => {});
    });
    s.on('session:revoked', () => logout());
    s.on('settings:changed', () => refresh().catch(() => {}));
    setSocket(s);
    return () => {
      s.close();
      setSocket(null);
      setConnected(false);
    };
    // The socket is tied to the user identity, not to the user object reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.roleCode]);

  return <RealtimeContext.Provider value={{ socket, connected }}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);

/** Subscribe to socket events for the lifetime of the component. */
export function useSocketEvent(events, handler) {
  const { socket } = useRealtime();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = [].concat(events).join('|');

  useEffect(() => {
    if (!socket) return undefined;
    const names = key.split('|');
    const listeners = names.map((name) => {
      const fn = (payload) => handlerRef.current(payload, name);
      socket.on(name, fn);
      return [name, fn];
    });
    return () => listeners.forEach(([name, fn]) => socket.off(name, fn));
  }, [socket, key]);
}
