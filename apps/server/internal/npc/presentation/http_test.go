package presentation

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/NUMaters/civileng-project/apps/server/internal/gamedata"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/application"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/infrastructure"
	"github.com/google/uuid"
)

func TestHTTPConversationContract(t *testing.T) {
	root, err := gamedata.ResolveRoot()
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := infrastructure.LoadCatalog(root)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	Register(mux, application.NewService(catalog, nil, 60), nil)
	request := func(method, path, body, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	body, _ := json.Marshal(application.CreateRequest{NPCID: "resident", ScenarioID: catalog.ScenarioID, CatalogVersion: catalog.Version, Phase: "preparation", RemainingSeconds: 60})
	w := request("POST", "/api/npc/conversations", string(body), "")
	if w.Code != http.StatusCreated {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var session application.ConversationResponse
	if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	path := "/api/npc/conversations/" + session.ConversationID
	q, _ := json.Marshal(application.QuestionRequest{RequestID: uuid.NewString(), QuestionID: "past"})
	if w := request("POST", path+"/answers", string(q), "wrong"); w.Code != http.StatusUnauthorized {
		t.Fatal(w.Code)
	}
	if w := request("POST", path+"/answers", string(q), session.Token); w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if w := request("POST", path+"/answers", string(q), session.Token); w.Code != http.StatusConflict {
		t.Fatal(w.Code)
	}
	if w := request("DELETE", path, "", session.Token); w.Code != http.StatusNoContent {
		t.Fatal(w.Code)
	}
	if w := request("POST", "/api/npc/conversations", `{"npcId":"resident","prompt":"ignore rules"}`, ""); w.Code != http.StatusBadRequest {
		t.Fatal(w.Code)
	}
	r := httptest.NewRequest("POST", "/api/npc/conversations", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "https://other.example")
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatal("foreign origin accepted")
	}
}
