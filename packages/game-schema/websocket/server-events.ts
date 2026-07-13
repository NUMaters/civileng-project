export const SERVER_EVENTS = {
  SESSION_STATE: "server.session_state",
  PLAYER_JOINED: "server.player_joined",
  PLAYER_LEFT: "server.player_left",
} as const;

export type ServerEventName = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];
