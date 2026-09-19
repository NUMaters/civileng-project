package infrastructure

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/NUMaters/civileng-project/apps/server/internal/gamedata"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/domain"
)

func TestOllamaStructuredOutputValidation(t *testing.T) {
	allowed := "堤防は川の水を安全に流すためのものだよ。"
	for _, test := range []struct {
		name, content string
		valid         bool
	}{
		{"allowed", `{"answerText":"` + allowed + `"}`, true},
		{"invented", `{"answerText":"絶対に安全だよ。"}`, false},
		{"extra_field", `{"answerText":"` + allowed + `","sourceIds":["fake"]}`, false},
		{"trailing", `{"answerText":"` + allowed + `"}{}`, false},
		{"invalid_json", "<html>error</html>", false},
		{"too_large", strings.Repeat("a", maxLLMResponseBytes+1), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/chat" || r.Method != "POST" {
					t.Error("wrong Ollama endpoint")
				}
				var body struct {
					Think  bool
					Stream bool
					Format json.RawMessage
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Think || body.Stream || !strings.Contains(string(body.Format), "enum") {
					t.Error("missing structured output constraints")
				}
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"done": true, "message": map[string]string{"content": test.content}})
			}))
			defer server.Close()
			client, err := NewOllama(server.URL, "test-model")
			if err != nil {
				t.Fatal(err)
			}
			result, err := client.Select(context.Background(), domain.NPC{}, domain.Question{}, domain.Hint{Level: 1, Answers: []string{allowed}}, nil)
			if test.valid {
				if err != nil || result != allowed {
					t.Fatalf("%s %v", result, err)
				}
			} else if !errors.Is(err, domain.ErrInvalidOutput) {
				t.Fatalf("expected invalid output, got %v", err)
			}
		})
	}
}
func TestOllamaHonorsCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(time.Second):
		}
	}))
	defer server.Close()
	client, err := NewOllama(server.URL, "test")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err = client.Select(ctx, domain.NPC{}, domain.Question{}, domain.Hint{}, nil)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline, got %v", err)
	}
}
func TestCatalogRejectsBrokenEvidence(t *testing.T) {
	root, err := gamedata.ResolveRoot()
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := LoadCatalog(root)
	if err != nil {
		t.Fatal(err)
	}
	catalog.Knowledge[0].Approved = false
	if err := catalog.Validate(); err == nil {
		t.Fatal("unapproved fact accepted")
	}
	catalog.Knowledge[0].Approved = true
	catalog.Knowledge[0].SourceIDs = []string{"missing"}
	if err := catalog.Validate(); err == nil {
		t.Fatal("missing source accepted")
	}
}
