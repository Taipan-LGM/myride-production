import { EVENTS } from "../utils/constants.js";

/**
 * Chat is not persisted in legacy SQLite v1 — stub for Flutter contract.
 */
export function registerChatHandlers(socket) {
  socket.on("chat:message", (payload) => {
    const rideId = payload?.ride_id;
    socket.emit(EVENTS.SOCKET_ERROR, {
      event: "chat:message",
      error: "not_implemented",
      message: "In-ride chat is not available in v1. Use phone contact.",
      ride_id: rideId != null ? String(rideId) : null,
    });
  });
}
