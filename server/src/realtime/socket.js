import { Server } from 'socket.io';
import { config } from '../config.js';
import { userFromToken, readCookie, accessibleStations } from '../auth/session.js';
import { roleHas, PERMISSIONS } from '../auth/permissions.js';
import { attachIo, rooms } from './hub.js';

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    serveClient: false,
    // Reject cross-site WebSocket hijacking: the Origin must match the Host we were reached on.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (!origin) return callback(null, true);
      try {
        const host = new URL(origin).host;
        callback(null, host === req.headers.host || host === req.headers['x-forwarded-host']);
      } catch {
        callback(null, false);
      }
    },
  });

  io.use((socket, next) => {
    const user = userFromToken(readCookie(socket.handshake.headers.cookie, config.cookieName));
    if (!user) return next(new Error('UNAUTHORIZED'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(rooms.restaurant(user.restaurantId));
    socket.join(rooms.user(user.id));
    // The cashier follows order changes (new bills, items added after payment) like the floor does.
    if (roleHas(user.roleCode, PERMISSIONS.FLOOR_VIEW) || roleHas(user.roleCode, PERMISSIONS.CASHIER_WORK)) {
      socket.join(rooms.floor(user.restaurantId));
    }
    for (const station of accessibleStations(user)) socket.join(rooms.station(user.restaurantId, station.id));
  });

  attachIo(io);
  return io;
}
