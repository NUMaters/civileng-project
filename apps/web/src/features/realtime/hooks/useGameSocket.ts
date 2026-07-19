import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConstructionPlacePayload,
  PlayerMovePayload,
  SessionStatePayload,
} from "@civilcraft/game-schema/websocket/payloads";
import { GameSocket, type SocketStatus } from "../../../services/websocket";

export type UseGameSocketResult = {
  status: SocketStatus;
  playerId: string | null;
  sendMove: (payload: PlayerMovePayload) => void;
  sendPlaceStructure: (payload: ConstructionPlacePayload) => void;
  sendPing: () => void;
};

export function useGameSocket(enabled = true): UseGameSocketResult {
  const socketRef = useRef<GameSocket | null>(null);
  const [status, setStatus] = useState<SocketStatus>("disconnected");
  const [playerId, setPlayerId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const socket = new GameSocket({
      onStatus: setStatus,
      onSessionState: (payload: SessionStatePayload) => {
        setPlayerId(payload.playerId);
      },
    });
    socketRef.current = socket;
    socket.connect();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled]);

  const sendMove = useCallback((payload: PlayerMovePayload) => {
    socketRef.current?.sendMove(payload);
  }, []);

  const sendPlaceStructure = useCallback((payload: ConstructionPlacePayload) => {
    socketRef.current?.sendPlaceStructure(payload);
  }, []);

  const sendPing = useCallback(() => {
    socketRef.current?.sendPing();
  }, []);

  return {
    status,
    playerId,
    sendMove,
    sendPlaceStructure,
    sendPing,
  };
}
