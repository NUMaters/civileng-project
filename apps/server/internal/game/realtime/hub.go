package realtime

import (
	"encoding/json"
	"log"
	"sync"
)

// Hub tracks connected clients and fans out broadcasts.
type Hub struct {
	mu         sync.RWMutex
	clients    map[*Client]struct{}
	session    *SessionStore
	register   chan *Client
	unregister chan *Client
	broadcast  chan []byte
}

func NewHub(session *SessionStore) *Hub {
	return &Hub{
		clients:    make(map[*Client]struct{}),
		session:    session,
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan []byte, 64),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = struct{}{}
			h.mu.Unlock()
			h.session.AddPlayer(client.id)
			log.Printf("realtime: player connected id=%s", client.id)
			h.sendJSON(client, ServerSessionState, h.session.Snapshot(client.id))
			h.broadcastJSONExcept(client, ServerPlayerJoined, map[string]string{
				"playerId": client.id,
			})

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			h.session.RemovePlayer(client.id)
			log.Printf("realtime: player disconnected id=%s", client.id)
			h.broadcastJSON(ServerPlayerLeft, map[string]string{
				"playerId": client.id,
			})

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					// Slow client: drop and disconnect on next unregister.
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) Unregister(client *Client) {
	h.unregister <- client
}

func (h *Hub) Session() *SessionStore {
	return h.session
}

func (h *Hub) sendJSON(client *Client, eventType string, payload any) {
	message, err := json.Marshal(Envelope{Type: eventType, Payload: payload})
	if err != nil {
		log.Printf("realtime: marshal failed: %v", err)
		return
	}
	select {
	case client.send <- message:
	default:
	}
}

func (h *Hub) broadcastJSON(eventType string, payload any) {
	message, err := json.Marshal(Envelope{Type: eventType, Payload: payload})
	if err != nil {
		log.Printf("realtime: marshal failed: %v", err)
		return
	}
	h.broadcast <- message
}

func (h *Hub) broadcastJSONExcept(except *Client, eventType string, payload any) {
	message, err := json.Marshal(Envelope{Type: eventType, Payload: payload})
	if err != nil {
		log.Printf("realtime: marshal failed: %v", err)
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		if client == except {
			continue
		}
		select {
		case client.send <- message:
		default:
		}
	}
}
