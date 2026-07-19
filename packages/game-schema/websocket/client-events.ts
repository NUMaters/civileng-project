/** クライアント → サーバー（`<domain>.<verb>`）。 */
export const CLIENT_EVENTS = {
  MOVE: "player.move",
  PLACE_STRUCTURE: "construction.place",
  PING: "session.ping",
} as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];
