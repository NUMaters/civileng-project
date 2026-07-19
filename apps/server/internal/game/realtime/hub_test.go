package realtime

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestWebSocketConnectPingPongAndSessionState(t *testing.T) {
	session := NewSessionStore()
	hub := NewHub(session)
	go hub.Run()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ServeWS(hub, w, r)
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read session.state: %v", err)
	}

	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if envelope.Type != ServerSessionState {
		t.Fatalf("expected %s, got %s", ServerSessionState, envelope.Type)
	}

	ping := Envelope{
		Type: ClientPing,
		Payload: map[string]any{
			"clientTime": 123,
		},
	}
	pingBytes, _ := json.Marshal(ping)
	if err := conn.WriteMessage(websocket.TextMessage, pingBytes); err != nil {
		t.Fatalf("write ping: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, pongData, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read pong: %v", err)
	}
	var pong Envelope
	if err := json.Unmarshal(pongData, &pong); err != nil {
		t.Fatalf("unmarshal pong: %v", err)
	}
	if pong.Type != ServerPong {
		t.Fatalf("expected %s, got %s", ServerPong, pong.Type)
	}

	place := Envelope{
		Type: ClientPlaceStructure,
		Payload: map[string]any{
			"structureId": "levee",
			"position": map[string]any{
				"longitude": 140.38,
				"latitude":  37.36,
				"height":    0,
			},
			"headingDegrees":    12.0,
			"clientPlacementId": "test-1",
		},
	}
	placeBytes, _ := json.Marshal(place)
	if err := conn.WriteMessage(websocket.TextMessage, placeBytes); err != nil {
		t.Fatalf("write place: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, placedData, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read placed: %v", err)
	}
	var placed Envelope
	if err := json.Unmarshal(placedData, &placed); err != nil {
		t.Fatalf("unmarshal placed: %v", err)
	}
	if placed.Type != ServerStructurePlaced {
		t.Fatalf("expected %s, got %s", ServerStructurePlaced, placed.Type)
	}
}
