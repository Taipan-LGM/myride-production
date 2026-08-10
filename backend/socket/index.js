import { logger } from "../lib/logger.js";
import { EVENTS, ROOM, TIMING } from "./utils/constants.js";
import { RoomManager } from "./services/roomManager.js";
import { LocationService } from "./services/locationService.js";
import {
  createLocationThrottle,
  createSocketRateLimiter,
} from "./middleware/rateLimit.js";
import { registerDriverHandlers } from "./handlers/driver.js";
import { registerCustomerHandlers } from "./handlers/customer.js";
import {
  registerRideHandlers,
  handleConnectionRestore,
} from "./handlers/ride.js";
import { registerChatHandlers } from "./handlers/chat.js";
import { registerRideMutationHandlers } from "./handlers/rideMutations.js";
import { joinActiveRideRoom } from "../services/rideSocketService.js";

/**
 * Attach modular Socket.io handlers to an existing server instance.
 * Auth middleware must be registered on `io` before calling this.
 *
 * @param {import('socket.io').Server} io
 * @returns {{ roomManager: RoomManager, locationService: LocationService, getStats: () => object }}
 */
export function attachSocketHandlers(io) {
  const roomManager = new RoomManager();
  const locationService = new LocationService(io);
  const rateLimit = createSocketRateLimiter(120, 60_000);
  const locationThrottle = createLocationThrottle(TIMING.LOCATION_MIN_INTERVAL_MS);

  const cleanupTimer = setInterval(() => {
    const n = roomManager.cleanupStale(TIMING.STALE_ROOM_MS);
    if (n > 0) logger.info("Socket stale room cleanup", { removed: n });
  }, TIMING.STALE_ROOM_MS);

  cleanupTimer.unref?.();

  io.on(EVENTS.CONNECTION, (socket) => {
    const user = socket.data?.user;
    if (!user) return;

    socket.join(ROOM.user(user.id));
    socket.join(ROOM.role(user.role));
    if (user.role === "driver") socket.join(ROOM.driver(user.id));
    if (user.role === "customer") socket.join(ROOM.customer(user.id));
    if (user.role === "admin") socket.join(ROOM.admin);
    if (["operator", "supervisor", "manager"].includes(user.role)) {
      socket.join(ROOM.admin);
    }

    joinActiveRideRoom(socket, user);
    handleConnectionRestore(socket, user, io, roomManager);

    socket.emit(EVENTS.HELLO, {
      user: { id: user.id, role: user.role, email: user.email, name: user.name },
    });

    const deps = {
      user,
      io,
      roomManager,
      locationService,
      rateLimit,
      locationThrottle,
    };

    if (user.role === "driver") {
      registerDriverHandlers(socket, deps);
    }
    if (user.role === "customer") {
      registerCustomerHandlers(socket, deps);
    }
    registerRideHandlers(socket, deps);
    registerRideMutationHandlers(socket, deps);
    registerChatHandlers(socket);

    socket.on(EVENTS.DISCONNECT, () => {
      logger.debug("Socket disconnected", { userId: user.id, socketId: socket.id });
    });
  });

  logger.info("Socket.io handlers attached");

  return {
    roomManager,
    locationService,
    getStats() {
      return {
        rooms: roomManager.getStats(),
        location: locationService.getStats?.() || {},
      };
    },
  };
}
