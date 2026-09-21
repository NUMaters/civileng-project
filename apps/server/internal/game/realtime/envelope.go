package realtime

// Envelope is the shared JSON shape for WebSocket messages (aligned with game-schema).
type Envelope struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

const (
	ClientMove           = "player.move"
	ClientPlaceStructure = "construction.place"
	ClientPing           = "session.ping"

	ServerSessionState    = "session.state"
	ServerPlayerJoined    = "player.joined"
	ServerPlayerLeft      = "player.left"
	ServerStructurePlaced = "construction.placed"
	ServerPong            = "session.pong"
)
