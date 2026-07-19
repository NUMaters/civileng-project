import { CLIENT_EVENTS } from "@civilcraft/game-schema/websocket/client-events";
import type { ClientEnvelope } from "@civilcraft/game-schema/websocket/envelope";
import type {
  ConstructionPlacePayload,
  PlayerMovePayload,
  SessionPongPayload,
  SessionStatePayload,
} from "@civilcraft/game-schema/websocket/payloads";
import { SERVER_EVENTS } from "@civilcraft/game-schema/websocket/server-events";
import type { ServerEnvelope } from "@civilcraft/game-schema/websocket/envelope";

export type SocketStatus = "connecting" | "connected" | "disconnected" | "error";

export type GameSocketHandlers = {
  onStatus?: (status: SocketStatus) => void;
  onSessionState?: (payload: SessionStatePayload) => void;
  onPong?: (payload: SessionPongPayload) => void;
  onStructurePlaced?: (payload: ConstructionPlacePayload & { id?: string; placedBy?: string }) => void;
  onMessage?: (envelope: ServerEnvelope) => void;
};

function resolveWsUrl(explicit?: string): string {
  if (explicit !== undefined && explicit !== "") {
    return explicit;
  }
  const fromEnv = import.meta.env.VITE_GAME_WS_URL as string | undefined;
  if (fromEnv !== undefined && fromEnv !== "") {
    if (fromEnv.startsWith("ws://") || fromEnv.startsWith("wss://")) {
      return fromEnv;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${fromEnv.startsWith("/") ? "" : "/"}${fromEnv}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export class GameSocket {
  private socket: WebSocket | null = null;
  private readonly handlers: GameSocketHandlers;
  private readonly url: string;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private status: SocketStatus = "disconnected";

  constructor(handlers: GameSocketHandlers = {}, url?: string) {
    this.handlers = handlers;
    this.url = resolveWsUrl(url);
  }

  connect(): void {
    if (this.disposed) {
      return;
    }
    this.clearReconnect();
    this.setStatus("connecting");
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) {
        return;
      }
      this.setStatus("connected");
      this.startPing();
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      try {
        const envelope = JSON.parse(event.data) as ServerEnvelope;
        this.handlers.onMessage?.(envelope);
        switch (envelope.type) {
          case SERVER_EVENTS.SESSION_STATE:
            this.handlers.onSessionState?.(envelope.payload as SessionStatePayload);
            break;
          case SERVER_EVENTS.PONG:
            this.handlers.onPong?.(envelope.payload as SessionPongPayload);
            break;
          case SERVER_EVENTS.STRUCTURE_PLACED:
            this.handlers.onStructurePlaced?.(
              envelope.payload as ConstructionPlacePayload & { id?: string; placedBy?: string },
            );
            break;
          default:
            break;
        }
      } catch {
        // ignore malformed frames
      }
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) {
        return;
      }
      this.stopPing();
      this.socket = null;
      this.setStatus("disconnected");
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket) {
        return;
      }
      this.setStatus("error");
    });
  }

  disconnect(): void {
    this.disposed = true;
    this.clearReconnect();
    this.stopPing();
    this.socket?.close();
    this.socket = null;
    this.setStatus("disconnected");
  }

  getStatus(): SocketStatus {
    return this.status;
  }

  sendMove(payload: PlayerMovePayload): void {
    this.send({ type: CLIENT_EVENTS.MOVE, payload });
  }

  sendPlaceStructure(payload: ConstructionPlacePayload): void {
    this.send({ type: CLIENT_EVENTS.PLACE_STRUCTURE, payload });
  }

  sendPing(): void {
    this.send({
      type: CLIENT_EVENTS.PING,
      payload: { clientTime: Date.now() },
    });
  }

  private send(envelope: ClientEnvelope): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(envelope));
  }

  private setStatus(status: SocketStatus): void {
    this.status = status;
    this.handlers.onStatus?.(status);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, 25_000);
    this.sendPing();
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) {
      return;
    }
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 2_000);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
