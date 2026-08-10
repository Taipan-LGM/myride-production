import { logger } from "../../lib/logger.js";
import { ROOM } from "../utils/constants.js";

export class RoomManager {
  constructor() {
    /** @type {Map<number, { rideId, customerId, driverId, roomName, createdAt }>} */
    this.rideRooms = new Map();
  }

  rideRoomName(rideId) {
    return ROOM.ride(rideId);
  }

  registerRideRoom(rideId, customerId, driverId = null) {
    const roomName = this.rideRoomName(rideId);
    this.rideRooms.set(rideId, {
      rideId,
      customerId,
      driverId,
      roomName,
      createdAt: Date.now(),
    });
    logger.debug("Ride room registered", { rideId, roomName });
    return roomName;
  }

  removeRideRoom(rideId) {
    this.rideRooms.delete(rideId);
  }

  getRideRoom(rideId) {
    return this.rideRooms.get(rideId);
  }

  joinRideSocket(socket, rideId, customerId, driverId) {
    const roomName = this.rideRoomName(rideId);
    socket.join(roomName);
    this.registerRideRoom(rideId, customerId, driverId);
    return roomName;
  }

  leaveRideSocket(socket, rideId) {
    socket.leave(this.rideRoomName(rideId));
  }

  cleanupStale(maxAgeMs) {
    const now = Date.now();
    let n = 0;
    for (const [rideId, room] of this.rideRooms) {
      if (now - room.createdAt > maxAgeMs) {
        this.rideRooms.delete(rideId);
        n++;
      }
    }
    return n;
  }

  getStats() {
    return {
      rideRooms: this.rideRooms.size,
      rideIds: [...this.rideRooms.keys()],
    };
  }
}
