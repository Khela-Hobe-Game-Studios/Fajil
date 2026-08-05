/**
 * The one projection of a player that is allowed onto the wire.
 *
 * Player objects carry `_disconnectTimer`, a Node Timeout whose internals are a
 * circular linked list. Emitting one raw blows the stack inside socket.io's
 * hasBinary(). One copy of this function, not two — two copies is how a field added
 * for the UI lands on some payloads and not others.
 */
function sanitizePlayers(players) {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    // Colour is the identity token the shared screen leans on: across a room a name
    // is small and a colour block is instant. Assigned server-side so the screen and
    // every phone agree about who is which.
    colorIndex: p.colorIndex,
    connectionState: p.connectionState,
    seatHoldUntil: p.seatHoldUntil ?? null,
  }));
}

module.exports = { sanitizePlayers };
