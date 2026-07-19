package realtime

import (
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 32 * 1024
)

// Client is a single WebSocket connection.
type Client struct {
	id   string
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

func NewClient(hub *Hub, conn *websocket.Conn) *Client {
	return &Client{
		id:   uuid.NewString(),
		hub:  hub,
		conn: conn,
		send: make(chan []byte, 32),
	}
}

func (c *Client) ID() string {
	return c.id
}
