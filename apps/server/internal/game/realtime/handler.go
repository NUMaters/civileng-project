package realtime

import (
	"log"
	"net/http"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Local / LAN prototype: allow browser clients from Vite and peers.
		return true
	},
}

// ServeWS upgrades the HTTP connection and starts read/write pumps.
func ServeWS(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("realtime: upgrade failed: %v", err)
		return
	}

	client := NewClient(hub, conn)
	hub.Register(client)

	go client.writePump()
	go client.readPump()
}
