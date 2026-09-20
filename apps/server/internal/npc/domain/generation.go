package domain

const (
	GenerationSuccess       = "success"
	GenerationNoGrounding   = "no_grounding"
	GenerationBusy          = "busy"
	GenerationTimeout       = "timeout"
	GenerationInvalidOutput = "invalid_output"
	GenerationUnavailable   = "unavailable"
)

// GenerationRequest is the versioned semantic contract sent by Main Backend
// after it has validated the game session and conversation progression.
// NPC Backend remains stateless and does not receive player coordinates,
// remaining time, reading preferences, or other mutable game state.
type GenerationRequest struct {
	InteractionID string `json:"interactionId"`
	GameSessionID string `json:"gameSessionId"`
	NPCID         string `json:"npcId"`
	ScenarioID    string `json:"scenarioId"`
	QuestionID    string `json:"questionId"`
	HintLevel     int    `json:"hintLevel"`
}

// GenerationResponse contains only the information Main Backend needs to
// safely commit an answer. Provider/model details stay inside NPC Backend.
type GenerationResponse struct {
	InteractionID string   `json:"interactionId"`
	Result        string   `json:"result"`
	AnswerText    string   `json:"answerText,omitempty"`
	SourceIDs     []string `json:"sourceIds,omitempty"`
}
