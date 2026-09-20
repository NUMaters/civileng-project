package application

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"math"
	"sync"
	"time"

	"github.com/NUMaters/civileng-project/apps/server/internal/npc/domain"
	"github.com/google/uuid"
)

const (
	AnswerCooldown   = time.Second
	MaxConversations = 256
	MaxQuestions     = 64
	LLMTimeout       = 5 * time.Second
)

type Error struct{ Code string }

func (e *Error) Error() string { return e.Code }
func reject(code string) error { return &Error{Code: code} }

type CreateRequest struct {
	NPCID            string  `json:"npcId"`
	ScenarioID       string  `json:"scenarioId"`
	CatalogVersion   string  `json:"catalogVersion"`
	Phase            string  `json:"phase"`
	RemainingSeconds float64 `json:"remainingSeconds"`
	Audience         string  `json:"audience"`
}
type ConversationResponse struct {
	ConversationID string `json:"conversationId"`
	Token          string `json:"token"`
	CatalogVersion string `json:"catalogVersion"`
}
type QuestionRequest struct {
	RequestID  string `json:"requestId"`
	QuestionID string `json:"questionId"`
	Deeper     bool   `json:"deeper"`
}
type Answer struct {
	RequestID      string   `json:"requestId"`
	NPCID          string   `json:"npcId"`
	QuestionID     string   `json:"questionId"`
	HintLevel      int      `json:"hintLevel"`
	AnswerText     string   `json:"answerText"`
	FactIDs        []string `json:"factIds"`
	SourceIDs      []string `json:"sourceIds"`
	Mode           string   `json:"mode"`
	FallbackReason string   `json:"fallbackReason,omitempty"`
}
type conversation struct {
	npc           domain.NPC
	token         string
	gameSessionID string
	expires       time.Time
	questionID    string
	level         int
	nextQuestion  time.Time
	seen          map[string]bool
	inFlight      bool
	cancel        context.CancelFunc
	audience      string
}
type Generate func(context.Context, domain.GenerationRequest) (domain.GenerationResponse, error)
type Service struct {
	catalog            *domain.Catalog
	generate           Generate
	generateMode       string
	mu                 sync.Mutex
	conversations      map[string]*conversation
	preparationSeconds float64
	now                func() time.Time
}

func NewService(catalog *domain.Catalog, generate Generate, preparationSeconds float64) *Service {
	return NewServiceWithMode(catalog, generate, preparationSeconds, "ai")
}

func NewServiceWithMode(catalog *domain.Catalog, generate Generate, preparationSeconds float64, generateMode string) *Service {
	if generateMode == "" {
		generateMode = "ai"
	}
	return &Service{catalog: catalog, generate: generate, generateMode: generateMode, conversations: map[string]*conversation{}, preparationSeconds: preparationSeconds, now: time.Now}
}
func (s *Service) Create(request CreateRequest) (ConversationResponse, error) {
	if !s.catalog.Enabled {
		return ConversationResponse{}, reject("disabled")
	}
	npc, ok := s.catalog.NPC(request.NPCID)
	if !ok || request.ScenarioID != s.catalog.ScenarioID {
		return ConversationResponse{}, reject("unknown_npc")
	}
	if request.CatalogVersion != s.catalog.Version {
		return ConversationResponse{}, reject("catalog_mismatch")
	}
	if request.Audience == "" {
		request.Audience = "adult"
	}
	if (request.Audience != "adult" && request.Audience != "child") || request.Phase != "preparation" || math.IsNaN(request.RemainingSeconds) || math.IsInf(request.RemainingSeconds, 0) ||
		request.RemainingSeconds <= 0 || request.RemainingSeconds > s.preparationSeconds {
		return ConversationResponse{}, reject("invalid_phase")
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return ConversationResponse{}, reject("unavailable")
	}
	token, err := uuid.NewRandom()
	if err != nil {
		return ConversationResponse{}, reject("unavailable")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune()
	if len(s.conversations) >= MaxConversations {
		return ConversationResponse{}, reject("capacity")
	}
	s.conversations[id.String()] = &conversation{npc: npc, token: token.String(), gameSessionID: "local-" + id.String(), expires: s.now().Add(time.Duration(request.RemainingSeconds * float64(time.Second))), seen: map[string]bool{}, audience: request.Audience}
	return ConversationResponse{id.String(), token.String(), s.catalog.Version}, nil
}
func (s *Service) prune() {
	for id, c := range s.conversations {
		if !s.now().Before(c.expires) {
			if c.cancel != nil {
				c.cancel()
			}
			delete(s.conversations, id)
		}
	}
}
func (s *Service) owned(id, token string) (*conversation, error) {
	s.prune()
	c := s.conversations[id]
	if c == nil || token == "" || subtle.ConstantTimeCompare([]byte(c.token), []byte(token)) != 1 {
		return nil, reject("invalid_conversation")
	}
	return c, nil
}
func (s *Service) Close(id, token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, err := s.owned(id, token)
	if err != nil {
		return err
	}
	if c.cancel != nil {
		c.cancel()
	}
	delete(s.conversations, id)
	return nil
}

func (s *Service) Answer(ctx context.Context, id, token string, request QuestionRequest) (Answer, error) {
	if _, err := uuid.Parse(request.RequestID); err != nil {
		return Answer{}, reject("invalid_request")
	}
	s.mu.Lock()
	c, err := s.owned(id, token)
	if err != nil {
		s.mu.Unlock()
		return Answer{}, err
	}
	question, ok := c.npc.Question(request.QuestionID)
	if !ok {
		s.mu.Unlock()
		return Answer{}, reject("unknown_question")
	}
	level := 1
	if request.Deeper {
		if c.questionID != question.ID || c.level >= domain.HintLevels {
			s.mu.Unlock()
			return Answer{}, reject("invalid_hint")
		}
		level = c.level + 1
	}
	if c.seen[request.RequestID] {
		s.mu.Unlock()
		return Answer{}, reject("duplicate_request")
	}
	if c.inFlight {
		s.mu.Unlock()
		return Answer{}, reject("busy")
	}
	if s.now().Before(c.nextQuestion) {
		s.mu.Unlock()
		return Answer{}, reject("cooldown")
	}
	if len(c.seen) >= MaxQuestions {
		s.mu.Unlock()
		return Answer{}, reject("capacity")
	}
	workCtx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	c.inFlight = true
	c.seen[request.RequestID] = true
	s.mu.Unlock()
	defer cancel()
	hint := question.Hints[level-1]
	if c.audience == "child" {
		hint.Answers = hint.ChildAnswers
	}
	_, sourceIDs := s.catalog.Facts(hint.FactIDs)
	result := Answer{request.RequestID, c.npc.ID, question.ID, level, "", hint.FactIDs, sourceIDs, "fixed", ""}
	result.AnswerText = hint.Answers[0]
	start := time.Now()
	if len(hint.FactIDs) > 0 && s.generate != nil && c.audience == "adult" {
		generateCtx, stop := context.WithTimeout(workCtx, LLMTimeout)
		generated, generateErr := s.generate(generateCtx, domain.GenerationRequest{
			InteractionID: request.RequestID,
			GameSessionID: c.gameSessionID,
			NPCID:         c.npc.ID,
			ScenarioID:    s.catalog.ScenarioID,
			QuestionID:    question.ID,
			HintLevel:     level,
		})
		stop()
		if generateErr == nil && generated.InteractionID == request.RequestID && generated.Result == domain.GenerationSuccess &&
			domain.ValidGeneratedAnswer(generated.AnswerText) && sameStrings(generated.SourceIDs, sourceIDs) {
			result.AnswerText, result.Mode = generated.AnswerText, s.generateMode
		} else {
			result.FallbackReason = failureReason(generateErr, generated)
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c.inFlight = false
	c.cancel = nil
	// A disconnected request, an expired phase or a closed panel cannot commit its answer.
	if s.conversations[id] != c || workCtx.Err() != nil || !s.now().Before(c.expires) {
		return Answer{}, reject("stale_request")
	}
	c.questionID, c.level = question.ID, level
	c.nextQuestion = s.now().Add(AnswerCooldown)
	slog.Info("npc_answer", "npc", c.npc.ID, "mode", result.Mode, "reason", result.FallbackReason,
		"fact_ids", result.FactIDs, "duration_ms", time.Since(start).Milliseconds())
	return result, nil
}
func sameStrings(actual, expected []string) bool {
	if len(actual) != len(expected) {
		return false
	}
	seen := make(map[string]int, len(actual))
	for _, value := range actual {
		seen[value]++
	}
	for _, value := range expected {
		seen[value]--
		if seen[value] < 0 {
			return false
		}
	}
	return true
}

func failureReason(err error, response domain.GenerationResponse) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	if errors.Is(err, domain.ErrLLMBusy) {
		return "busy"
	}
	if err != nil {
		if errors.Is(err, domain.ErrInvalidOutput) {
			return "invalid_output"
		}
		return "unavailable"
	}
	switch response.Result {
	case domain.GenerationBusy:
		return "busy"
	case domain.GenerationTimeout:
		return "timeout"
	case domain.GenerationNoGrounding:
		return "no_grounding"
	case domain.GenerationUnavailable:
		return "unavailable"
	default:
		return "invalid_output"
	}
}
