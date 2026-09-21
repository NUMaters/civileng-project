package infrastructure

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/NUMaters/civileng-project/apps/server/internal/npc/domain"
)

func TestOpenAIUsesStructuredOutputAndAcceptsFactGroundedExpression(t *testing.T) {
	generated := "堤防は、川沿いの水を安全に流すために役立つ工夫なんだ。"
	question := domain.Question{
		Text: "堤防は何をする施設なの？",
		Hints: []domain.Hint{
			{Level: 1, Answers: []string{"堤防は川の水を安全に流すための施設だよ。"}},
			{Level: 2, Answers: []string{"川沿いに設けて、水があふれにくくする役割もあるんだ。"}},
		},
	}
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
		if !strings.Contains(string(body.ResponseFormat), "json_schema") || strings.Contains(string(body.ResponseFormat), "enum") || len(body.Messages) != 2 {
			t.Fatal("missing structured output prompt")
		}
		var prompt struct {
			CurrentLearningTarget  string   `json:"currentLearningTarget"`
			EarlierLearningTargets []string `json:"earlierLearningTargets"`
		}
		if err := json.Unmarshal([]byte(body.Messages[1].Content), &prompt); err != nil {
			t.Fatal(err)
		}
		if prompt.CurrentLearningTarget != question.Hints[1].Answers[0] || !slices.Equal(prompt.EarlierLearningTargets, []string{question.Hints[0].Answers[0]}) {
			t.Fatalf("missing level-specific learning targets: %+v", prompt)
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"choices": []interface{}{map[string]interface{}{
				"message": map[string]string{"content": `{"answerText":"` + generated + `"}`},
			}},
		})
	}))
	defer server.Close()

	client, err := NewOpenAI("test-key", server.URL, "test-model")
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.Select(context.Background(), domain.NPC{}, question, question.Hints[1], []domain.Fact{{ID: "FACT-1", CanonicalFact: "堤防は川沿いの水を安全に流すための施設。"}})
	if err != nil || result != generated {
		t.Fatalf("%s %v", result, err)
	}
}

func TestOpenAIRejectsUnsafeGeneratedAnswer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"choices": []interface{}{map[string]interface{}{
				"message": map[string]string{"content": `{"answerText":"この場所なら絶対安全だよ。"}`},
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
