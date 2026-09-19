package infrastructure

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/NUMaters/civileng-project/apps/server/internal/npc/domain"
)

func TestOpenAIUsesStructuredOutputAndAcceptsOnlyAllowedAnswer(t *testing.T) {
	allowed := "堤防は川の水を安全に流すためのものだよ。"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatal("unexpected OpenAI request")
		}
		var body struct {
			ResponseFormat json.RawMessage `json:"response_format"`
			Messages       []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body.ResponseFormat), "json_schema") || len(body.Messages) != 2 {
			t.Fatal("missing structured output prompt")
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"choices": []interface{}{map[string]interface{}{
				"message": map[string]string{"content": `{"answerText":"` + allowed + `"}`},
			}},
		})
	}))
	defer server.Close()

	client, err := NewOpenAI("test-key", server.URL, "test-model")
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.Select(context.Background(), domain.NPC{}, domain.Question{}, domain.Hint{Level: 1, Answers: []string{allowed}}, nil)
	if err != nil || result != allowed {
		t.Fatalf("%s %v", result, err)
	}
}

func TestOpenAIRejectsUnregisteredAnswer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"choices": []interface{}{map[string]interface{}{
				"message": map[string]string{"content": `{"answerText":"根拠のない回答"}`},
			}},
		})
	}))
	defer server.Close()
	client, err := NewOpenAI("test-key", server.URL, "test-model")
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Select(context.Background(), domain.NPC{}, domain.Question{}, domain.Hint{Level: 1, Answers: []string{"登録済みの回答"}}, nil)
	if !errors.Is(err, domain.ErrInvalidOutput) {
		t.Fatalf("expected invalid output, got %v", err)
	}
}
