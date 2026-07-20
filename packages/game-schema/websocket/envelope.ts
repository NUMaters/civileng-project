import type { ClientEventName } from "./client-events";
import type { ServerEventName } from "./server-events";

export type ClientEnvelope<TPayload = unknown> = {
  type: ClientEventName;
  payload: TPayload;
};

export type ServerEnvelope<TPayload = unknown> = {
  type: ServerEventName;
  payload: TPayload;
};
