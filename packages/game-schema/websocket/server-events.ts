/** サーバー → クライアント（`<domain>.<verb>`）。 */
export const SERVER_EVENTS = {
  SESSION_STATE: "session.state",
  PLAYER_JOINED: "player.joined",
  PLAYER_LEFT: "player.left",
  STRUCTURE_PLACED: "construction.placed",
  PONG: "session.pong",
} as const;

export type ServerEventName = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];
