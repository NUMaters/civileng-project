export const CLIENT_EVENTS = {
  MOVE: "client.move",
  PLACE_STRUCTURE: "client.place_structure",
} as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];
