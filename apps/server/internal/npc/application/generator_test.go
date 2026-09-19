package application

import (
	"context"
	"testing"

	"github.com/NUMaters/civileng-project/apps/server/internal/gamedata"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/domain"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/infrastructure"
)

func TestGeneratorUsesCatalogGroundingAndReturnsNoProviderDetails(t *testing.T) {
	root, err := gamedata.ResolveRoot()
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := infrastructure.LoadCatalog(root)
	if err != nil {
		t.Fatal(err)
	}
	generator := NewGenerator(catalog, func(_ context.Context, _ domain.NPC, _ domain.Question, hint domain.Hint, facts []domain.Fact) (string, error) {
		if len(facts) == 0 || facts[0].ID != hint.FactIDs[0] {
			t.Fatalf("generator received ungrounded facts: %+v %+v", hint, facts)
		}
		return hint.Answers[0], nil
	}, "test")

	result, err := generator.Generate(context.Background(), domain.GenerationRequest{
		InteractionID: "interaction-1",
		GameSessionID: "game-1",
		NPCID:         "resident",
		ScenarioID:    catalog.ScenarioID,
		QuestionID:    "past",
		HintLevel:     1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Result != domain.GenerationSuccess || result.AnswerText == "" || len(result.SourceIDs) == 0 {
		t.Fatalf("unexpected generation result: %+v", result)
	}
}

func TestGeneratorRejectsInvalidMainBackendContract(t *testing.T) {
	root, err := gamedata.ResolveRoot()
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := infrastructure.LoadCatalog(root)
	if err != nil {
		t.Fatal(err)
	}
	generator := NewGenerator(catalog, nil, "fixed")
	_, err = generator.Generate(context.Background(), domain.GenerationRequest{InteractionID: "interaction-1"})
	requireCode(t, err, "invalid_generation_request")
}
