/**
 * Real-time notifications. Events carry identifiers only; clients refetch through the REST
 * API, which applies RBAC. See docs/ARCHITECTURE.md §6.
 */
let io = null;

export function attachIo(instance) {
  io = instance;
}

export const rooms = {
  restaurant: (rid) => `r:${rid}`,
  floor: (rid) => `r:${rid}:floor`,
  station: (rid, sid) => `r:${rid}:station:${sid}`,
  user: (uid) => `u:${uid}`,
};

function emit(room, event, payload = {}) {
  if (io) io.to(room).emit(event, payload);
}

export const notify = {
  orderChanged(rid, { orderId, tableId }) {
    emit(rooms.floor(rid), 'orders:changed', { orderId, tableId });
  },
  stationsChanged(rid, stationIds) {
    for (const sid of new Set(stationIds)) emit(rooms.station(rid, sid), 'station:changed', { stationId: sid });
  },
  itemsReady(rid, payload) {
    emit(rooms.floor(rid), 'items:ready', payload);
  },
  tablesChanged(rid) {
    emit(rooms.floor(rid), 'tables:changed');
  },
  menuChanged(rid) {
    emit(rooms.restaurant(rid), 'menu:changed');
  },
  settingsChanged(rid) {
    emit(rooms.restaurant(rid), 'settings:changed');
  },
  async revokeUser(uid) {
    if (!io) return;
    emit(rooms.user(uid), 'session:revoked');
    io.in(rooms.user(uid)).disconnectSockets(true);
  },
};

/** Re-evaluate station room membership after stations or roles change. */
export async function resyncStationRooms(rid, stationRoomsFor) {
  if (!io) return;
  const sockets = await io.in(rooms.restaurant(rid)).fetchSockets();
  for (const socket of sockets) {
    const user = socket.data.user;
    const wanted = new Set(stationRoomsFor(user));
    for (const room of socket.rooms) {
      if (room.startsWith(`r:${rid}:station:`) && !wanted.has(room)) socket.leave(room);
    }
    for (const room of wanted) socket.join(room);
  }
}
