package application

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/NUMaters/civileng-project/apps/server/internal/gamedata"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/domain"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/infrastructure"
	"github.com/google/uuid"
)

func fixture(t *testing.T, generate Generate) (*Service, ConversationResponse) {
	t.Helper()
	root, err := gamedata.ResolveRoot()
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := infrastructure.LoadCatalog(root)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(catalog, generate, 60)
	session, err := service.Create(CreateRequest{"resident", catalog.ScenarioID, catalog.Version, "preparation", 60, ""})
	if err != nil {
		t.Fatal(err)
	}
	return service, session
}
func question(id string, deeper bool) QuestionRequest {
	return QuestionRequest{RequestID: uuid.NewString(), QuestionID: id, Deeper: deeper}
}
func requireCode(t *testing.T, err error, code string) {
	t.Helper()
	var apiError *Error
	if !errors.As(err, &apiError) || apiError.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}
func TestProgressionOwnershipAndSources(t *testing.T) {
	service, session := fixture(t, nil)
	clock := time.Now()
	service.now = func() time.Time { return clock }
	_, err := service.Answer(context.Background(), session.ConversationID, "wrong", question("past", false))
	requireCode(t, err, "invalid_conversation")
	_, err = service.Answer(context.Background(), session.ConversationID, session.Token, question("past", true))
	requireCode(t, err, "invalid_hint")
	request := question("past", false)
	first, err := service.Answer(context.Background(), session.ConversationID, session.Token, request)
	if err != nil || first.HintLevel != 1 || first.FactIDs[0] != "FACT-R02" || first.SourceIDs[0] != "flood-1986" {
		t.Fatalf("bad first answer: %+v %v", first, err)
	}
	_, err = service.Answer(context.Background(), session.ConversationID, session.Token, request)
	requireCode(t, err, "duplicate_request")
	_, err = service.Answer(context.Background(), session.ConversationID, session.Token, question("past", true))
	requireCode(t, err, "cooldown")
	for level := 2; level <= 3; level++ {
		clock = clock.Add(AnswerCooldown)
		result, err := service.Answer(context.Background(), session.ConversationID, session.Token, question("past", true))
		if err != nil || result.HintLevel != level {
			t.Fatalf("level %d: %+v %v", level, result, err)
		}
		if level == 3 && len(result.FactIDs) != 0 {
			t.Fatal("referral must not invent sources")
		}
	}
	clock = clock.Add(AnswerCooldown)
	_, err = service.Answer(context.Background(), session.ConversationID, session.Token, question("past", true))
	requireCode(t, err, "invalid_hint")
	next, err := service.Answer(context.Background(), session.ConversationID, session.Token, question("land", false))
	if err != nil || next.HintLevel != 1 {
		t.Fatalf("new question: %+v %v", next, err)
	}
	if err := service.Close(session.ConversationID, session.Token); err != nil {
		t.Fatal(err)
	}
	_, err = service.Answer(context.Background(), session.ConversationID, session.Token, question("past", false))
	requireCode(t, err, "invalid_conversation")
}
func TestCatalogAndPhaseValidation(t *testing.T) {
	service, _ := fixture(t, nil)
	for _, test := range []struct {
		request CreateRequest
		code    string
	}{
		{CreateRequest{"resident", service.catalog.ScenarioID, "wrong", "preparation", 60, ""}, "catalog_mismatch"},
		{CreateRequest{"unknown", service.catalog.ScenarioID, service.catalog.Version, "preparation", 60, ""}, "unknown_npc"},
		{CreateRequest{"resident", service.catalog.ScenarioID, service.catalog.Version, "disaster", 60, ""}, "invalid_phase"},
		{CreateRequest{"resident", service.catalog.ScenarioID, service.catalog.Version, "preparation", 61, ""}, "invalid_phase"},
	} {
		_, err := service.Create(test.request)
		requireCode(t, err, test.code)
	}
}
func TestCloseCancelsInflightAndRejectsLateAnswer(t *testing.T) {
	started := make(chan struct{})
	generate := func(ctx context.Context, _ domain.GenerationRequest) (domain.GenerationResponse, error) {
		close(started)
		<-ctx.Done()
		return domain.GenerationResponse{}, ctx.Err()
	}
	service, session := fixture(t, generate)
	done := make(chan error, 1)
	go func() {
		_, err := service.Answer(context.Background(), session.ConversationID, session.Token, question("past", false))
		done <- err
	}()
	<-started
	_, err := service.Answer(context.Background(), session.ConversationID, session.Token, question("land", false))
	requireCode(t, err, "busy")
	if err := service.Close(session.ConversationID, session.Token); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		requireCode(t, err, "stale_request")
	case <-time.After(time.Second):
		t.Fatal("generation did not cancel")
	}
}
func TestTimeoutAndUnfoundedOutputUseKnownAnswer(t *testing.T) {
	for _, test := range []struct {
		text   string
		err    error
		reason string
	}{
		{"", context.DeadlineExceeded, "timeout"},
		{"この場所なら絶対安全だよ。", nil, "invalid_output"},
	} {
		service, session := fixture(t, func(_ context.Context, request domain.GenerationRequest) (domain.GenerationResponse, error) {
			return domain.GenerationResponse{InteractionID: request.InteractionID, Result: domain.GenerationSuccess, AnswerText: test.text}, test.err
		})
		answer, err := service.Answer(context.Background(), session.ConversationID, session.Token, question("past", false))
		if err != nil || answer.Mode != "fixed" || answer.FallbackReason != test.reason || !domain.ValidAnswer(answer.AnswerText) || len(answer.SourceIDs) == 0 {
			t.Fatalf("%+v %v", answer, err)
		}
	}
}

func TestServiceAcceptsFactGroundedGeneratedExpression(t *testing.T) {
	service, session := fixture(t, nil)
	service.generate = func(_ context.Context, request domain.GenerationRequest) (domain.GenerationResponse, error) {
		npc, _ := service.catalog.NPC(request.NPCID)
		question, _ := npc.Question(request.QuestionID)
		hint := question.Hints[request.HintLevel-1]
		_, sourceIDs := service.catalog.Facts(hint.FactIDs)
		return domain.GenerationResponse{
			InteractionID: request.InteractionID,
			Result:        domain.GenerationSuccess,
			AnswerText:    "昔の水害の記録を手がかりに、川の近くの様子を見てみよう。",
			SourceIDs:     sourceIDs,
		}, nil
	}

	answer, err := service.Answer(context.Background(), session.ConversationID, session.Token, question("past", false))
	if err != nil || answer.Mode != "ai" || answer.AnswerText == "" || len(answer.SourceIDs) == 0 {
		t.Fatalf("generated expression was not accepted: %+v %v", answer, err)
	}
}
func TestIndependentConversations(t *testing.T) {
	service, first := fixture(t, nil)
	service.generate = func(_ context.Context, request domain.GenerationRequest) (domain.GenerationResponse, error) {
		npc, _ := service.catalog.NPC(request.NPCID)
		question, _ := npc.Question(request.QuestionID)
		hint := question.Hints[request.HintLevel-1]
		_, sourceIDs := service.catalog.Facts(hint.FactIDs)
		return domain.GenerationResponse{InteractionID: request.InteractionID, Result: domain.GenerationSuccess, AnswerText: hint.Answers[0], SourceIDs: sourceIDs}, nil
	}
	second, err := service.Create(CreateRequest{"resident", service.catalog.ScenarioID, service.catalog.Version, "preparation", 60, ""})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for _, session := range []ConversationResponse{first, second} {
		wg.Add(1)
		go func(session ConversationResponse) {
			defer wg.Done()
			answer, err := service.Answer(context.Background(), session.ConversationID, session.Token, question("past", false))
			if err != nil || answer.Mode != "ai" || answer.HintLevel != 1 {
				t.Errorf("%+v %v", answer, err)
			}
		}(session)
	}
	wg.Wait()
}
func TestExpiryDoesNotCommit(t *testing.T) {
	service, session := fixture(t, nil)
	clock := time.Now()
	service.now = func() time.Time { return clock }
	service.generate = func(_ context.Context, request domain.GenerationRequest) (domain.GenerationResponse, error) {
		clock = clock.Add(time.Minute)
		return domain.GenerationResponse{InteractionID: request.InteractionID, Result: domain.GenerationUnavailable}, nil
	}
	_, err := service.Answer(context.Background(), session.ConversationID, session.Token, question("past", false))
	requireCode(t, err, "stale_request")
}
