package application

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/NUMaters/civileng-project/apps/server/internal/npc/domain"
)

type SelectAnswer func(context.Context, domain.NPC, domain.Question, domain.Hint, []domain.Fact) (string, error)

// Generator is the stateless NPC Backend application service. Main Backend
// owns game/conversation state; this service owns grounding and generation.
type Generator struct {
	catalog      *domain.Catalog
	selectAnswer SelectAnswer
	provider     string
}

func NewGenerator(catalog *domain.Catalog, selectAnswer SelectAnswer, provider string) *Generator {
	return &Generator{catalog: catalog, selectAnswer: selectAnswer, provider: provider}
}

func (g *Generator) Generate(ctx context.Context, request domain.GenerationRequest) (domain.GenerationResponse, error) {
	if invalidContractValue(request.InteractionID) || invalidContractValue(request.GameSessionID) ||
		invalidContractValue(request.NPCID) || invalidContractValue(request.ScenarioID) ||
		invalidContractValue(request.QuestionID) || request.HintLevel < 1 || request.HintLevel > domain.HintLevels {
		return domain.GenerationResponse{}, reject("invalid_generation_request")
	}
	if request.ScenarioID != g.catalog.ScenarioID {
		return domain.GenerationResponse{}, reject("unknown_scenario")
	}
	npc, ok := g.catalog.NPC(request.NPCID)
	if !ok {
		return domain.GenerationResponse{}, reject("unknown_npc")
	}
	question, ok := npc.Question(request.QuestionID)
	if !ok {
		return domain.GenerationResponse{}, reject("unknown_question")
	}
	hint := question.Hints[request.HintLevel-1]
	facts, sourceIDs := g.catalog.Facts(hint.FactIDs)
	response := domain.GenerationResponse{InteractionID: request.InteractionID, Result: domain.GenerationNoGrounding}
	if len(facts) == 0 {
		logGeneration(npc.ID, g.provider, response.Result, hint.FactIDs, 0)
		return response, nil
	}
	if g.selectAnswer == nil {
		response.Result = domain.GenerationUnavailable
		logGeneration(npc.ID, g.provider, response.Result, hint.FactIDs, 0)
		return response, nil
	}

	started := time.Now()
	text, err := g.selectAnswer(ctx, npc, question, hint, facts)
	response.Result = generationResult(err)
	if err == nil && domain.ValidGeneratedAnswer(text) {
		response.Result = domain.GenerationSuccess
		response.AnswerText = text
		response.SourceIDs = sourceIDs
	} else if err == nil {
		response.Result = domain.GenerationInvalidOutput
	}
	logGeneration(npc.ID, g.provider, response.Result, hint.FactIDs, time.Since(started).Milliseconds())
	return response, nil
}

func logGeneration(npcID, provider, result string, factIDs []string, durationMilliseconds int64) {
	slog.Info("npc_generation", "npc", npcID, "provider", provider, "result", result,
		"fact_ids", factIDs, "duration_ms", durationMilliseconds)
}

func invalidContractValue(value string) bool {
	value = strings.TrimSpace(value)
	return value == "" || len(value) > 128
}

func generationResult(err error) string {
	switch {
	case err == nil:
		return domain.GenerationInvalidOutput
	case errors.Is(err, context.DeadlineExceeded):
		return domain.GenerationTimeout
	case errors.Is(err, domain.ErrLLMBusy):
		return domain.GenerationBusy
	case errors.Is(err, domain.ErrInvalidOutput):
		return domain.GenerationInvalidOutput
	default:
		return domain.GenerationUnavailable
	}
}
