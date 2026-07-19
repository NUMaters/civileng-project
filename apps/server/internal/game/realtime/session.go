package realtime

import "sync"

type GeoPosition struct {
	Longitude float64 `json:"longitude"`
	Latitude  float64 `json:"latitude"`
	Height    float64 `json:"height"`
}

type PlayerSnapshot struct {
	PlayerID string       `json:"playerId"`
	Position *GeoPosition `json:"position"`
}

type PlacementSnapshot struct {
	ID             string      `json:"id"`
	StructureID    string      `json:"structureId"`
	Position       GeoPosition `json:"position"`
	HeadingDegrees float64     `json:"headingDegrees"`
	PlacedBy       string      `json:"placedBy"`
}

// SessionStore keeps Phase 1 in-memory state (solo / light multi prototype).
type SessionStore struct {
	mu         sync.RWMutex
	players    map[string]*GeoPosition
	placements []PlacementSnapshot
}

func NewSessionStore() *SessionStore {
	return &SessionStore{
		players:    make(map[string]*GeoPosition),
		placements: nil,
	}
}

func (s *SessionStore) AddPlayer(playerID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.players[playerID] = nil
}

func (s *SessionStore) RemovePlayer(playerID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.players, playerID)
}

func (s *SessionStore) SetPlayerPosition(playerID string, position GeoPosition) {
	s.mu.Lock()
	defer s.mu.Unlock()
	pos := position
	s.players[playerID] = &pos
}

func (s *SessionStore) AddPlacement(placement PlacementSnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.placements = append(s.placements, placement)
}

func (s *SessionStore) Snapshot(forPlayerID string) map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()

	players := make([]PlayerSnapshot, 0, len(s.players))
	for id, pos := range s.players {
		players = append(players, PlayerSnapshot{
			PlayerID: id,
			Position: pos,
		})
	}

	placements := make([]PlacementSnapshot, len(s.placements))
	copy(placements, s.placements)

	return map[string]any{
		"playerId":   forPlayerID,
		"players":    players,
		"placements": placements,
	}
}
