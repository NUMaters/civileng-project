package npc_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/NUMaters/civileng-project/apps/server/internal/gamedata"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/application"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/domain"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/infrastructure"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/presentation"
	"github.com/google/uuid"
)

// This test exercises the same network boundary used locally and in a future
// deployment: browser-facing Main Backend -> private NPC Backend -> Main Backend.
func TestMainBackendToNPCBackendContract(t *testing.T) {
	root, err := gamedata.ResolveRoot()
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := infrastructure.LoadCatalog(root)
	if err != nil {
		t.Fatal(err)
	}
	selector := func(_ context.Context, _ domain.NPC, _ domain.Question, hint domain.Hint, _ []domain.Fact) (string, error) {
		return hint.Answers[0], nil
	}
	internalMux := http.NewServeMux()
	presentation.RegisterBackend(internalMux, application.NewGenerator(catalog, selector, "test"), "internal-secret")
	internalServer := httptest.NewServer(internalMux)
	defer internalServer.Close()

	backendClient, err := infrastructure.NewBackendClient(internalServer.URL, "internal-secret")
	if err != nil {
		t.Fatal(err)
	}
	publicMux := http.NewServeMux()
	presentation.Register(publicMux, application.NewServiceWithMode(catalog, backendClient.Generate, 60, "ai"))
	publicServer := httptest.NewServer(publicMux)
	defer publicServer.Close()

	createBody, _ := json.Marshal(application.CreateRequest{
		NPCID: "resident", ScenarioID: catalog.ScenarioID, CatalogVersion: catalog.Version,
		Phase: "preparation", RemainingSeconds: 60,
	})
	createResponse, err := http.Post(publicServer.URL+"/api/npc/conversations", "application/json", bytes.NewReader(createBody))
	if err != nil {
		t.Fatal(err)
	}
	defer createResponse.Body.Close()
	if createResponse.StatusCode != http.StatusCreated {
		t.Fatalf("create status: %d", createResponse.StatusCode)
	}
	var conversation application.ConversationResponse
	if err := json.NewDecoder(createResponse.Body).Decode(&conversation); err != nil {
		t.Fatal(err)
	}

	answerBody, _ := json.Marshal(application.QuestionRequest{RequestID: uuid.NewString(), QuestionID: "past"})
	answerRequest, _ := http.NewRequest(http.MethodPost, publicServer.URL+"/api/npc/conversations/"+conversation.ConversationID+"/answers", bytes.NewReader(answerBody))
	answerRequest.Header.Set("Content-Type", "application/json")
	answerRequest.Header.Set("Authorization", "Bearer "+conversation.Token)
	answerResponse, err := http.DefaultClient.Do(answerRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer answerResponse.Body.Close()
	if answerResponse.StatusCode != http.StatusOK {
		t.Fatalf("answer status: %d", answerResponse.StatusCode)
	}
	var answer application.Answer
	if err := json.NewDecoder(answerResponse.Body).Decode(&answer); err != nil {
		t.Fatal(err)
	}
	if answer.Mode != "ai" || answer.AnswerText == "" || len(answer.SourceIDs) == 0 {
		t.Fatalf("unexpected answer: %+v", answer)
	}
}

func TestNPCBackendRejectsWrongInternalToken(t *testing.T) {
	mux := http.NewServeMux()
	presentation.RegisterBackend(mux, nil, "internal-secret")
	r := httptest.NewRequest(http.MethodPost, "/internal/v1/npc/answers", bytes.NewBufferString(`{}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer wrong")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", w.Code)
	}
}
