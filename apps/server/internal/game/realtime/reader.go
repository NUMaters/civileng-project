package realtime

import (
	"encoding/json"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type movePayload struct {
	Position GeoPosition `json:"position"`
}

type placePayload struct {
	StructureID       string      `json:"structureId"`
	Position          GeoPosition `json:"position"`
	HeadingDegrees    float64     `json:"headingDegrees"`
	ClientPlacementID string      `json:"clientPlacementId"`
}

type pingPayload struct {
	ClientTime int64 `json:"clientTime"`
}

func (c *Client) readPump() {
	defer func() {
		c.hub.Unregister(c)
		_ = c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("realtime: read error id=%s: %v", c.id, err)
			}
			break
		}
		c.handleMessage(data)
	}
}

func (c *Client) handleMessage(data []byte) {
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		log.Printf("realtime: invalid envelope id=%s: %v", c.id, err)
		return
	}

	raw, err := json.Marshal(envelope.Payload)
	if err != nil {
		return
	}

	switch envelope.Type {
	case ClientPing:
		var payload pingPayload
		_ = json.Unmarshal(raw, &payload)
		c.hub.sendJSON(c, ServerPong, map[string]any{
			"clientTime": payload.ClientTime,
			"serverTime": time.Now().UnixMilli(),
		})

	case ClientMove:
		var payload movePayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			return
		}
		c.hub.Session().SetPlayerPosition(c.id, payload.Position)

	case ClientPlaceStructure:
		var payload placePayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			return
		}
		placementID := payload.ClientPlacementID
		if placementID == "" {
			placementID = uuid.NewString()
		}
		placement := PlacementSnapshot{
			ID:             placementID,
			StructureID:    payload.StructureID,
			Position:       payload.Position,
			HeadingDegrees: payload.HeadingDegrees,
			PlacedBy:       c.id,
		}
		c.hub.Session().AddPlacement(placement)
		c.hub.broadcastJSON(ServerStructurePlaced, placement)

	default:
		log.Printf("realtime: unknown event type=%s id=%s", envelope.Type, c.id)
	}
}
