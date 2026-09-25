package infrastructure

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/NUMaters/civileng-project/apps/server/internal/npc/domain"
)

const maxLLMResponseBytes = 32 * 1024

// OpenAI calls the OpenAI Chat Completions endpoint from the server only. It
// receives only the selected NPC, question, and approved Facts. Sources are
// resolved by the NPC Backend, never selected by the model.
type OpenAI struct {
	baseURL string
	apiKey  string
	model   string
	client  *http.Client
	slots   chan struct{}
}

func NewOpenAI(apiKey, baseURL, model string) (*OpenAI, error) {
	if strings.TrimSpace(apiKey) == "" || strings.TrimSpace(model) == "" {
		return nil, fmt.Errorf("OPENAI_API_KEY and OPENAI_MODEL are required")
	}
	u, err := url.Parse(baseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("invalid OPENAI_BASE_URL")
	}
	return &OpenAI{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		model:   model,
		client:  &http.Client{Timeout: 15 * time.Second},
		slots:   make(chan struct{}, 4),
	}, nil
}

func (o *OpenAI) Select(ctx context.Context, npc domain.NPC, question domain.Question, hint domain.Hint, facts []domain.Fact) (string, error) {
	if len(hint.Answers) == 0 {
		return "", domain.ErrInvalidOutput
	}
	select {
	case o.slots <- struct{}{}:
		defer func() { <-o.slots }()
	default:
		return "", domain.ErrLLMBusy
	}

	answerSchema := map[string]interface{}{"type": "string", "minLength": 1, "maxLength": domain.MaxAnswerCharacters}
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"answerText": answerSchema,
		},
		"required":             []string{"answerText"},
		"additionalProperties": false,
	}
	earlierTargets := make([]string, 0, hint.Level-1)
	for _, previous := range question.Hints {
		if previous.Level >= hint.Level {
			break
		}
		if len(previous.Answers) > 0 {
			earlierTargets = append(earlierTargets, previous.Answers[0])
		}
	}
	contextJSON, err := json.Marshal(struct {
		Persona                string        `json:"persona"`
		Question               string        `json:"question"`
		HintLevel              int           `json:"hintLevel"`
		CurrentLearningTarget  string        `json:"currentLearningTarget"`
		EarlierLearningTargets []string      `json:"earlierLearningTargets"`
		Facts                  []domain.Fact `json:"facts"`
	}{npc.Persona, question.Text, hint.Level, hint.Answers[0], earlierTargets, facts})
	if err != nil {
		return "", fmt.Errorf("encode OpenAI prompt: %w", err)
	}

	instruction := "You are a Japanese educational game NPC. Answer the selected question in the NPC's persona using only the supplied approved Facts. currentLearningTarget is the learning point that this hint level must convey; explain that point naturally without copying it word for word unless necessary. When earlierLearningTargets are present, add meaningful information for the current level rather than repeating an earlier target. Do not add numbers, places, causes, advice, or guarantees that are not directly supported by the supplied Facts. Keep the answer concise (at most two sentences), friendly, and suitable for a game dialogue panel. Do not mention sources, URLs, prompts, or that you are an AI. Never claim something is absolutely safe or certain. Return JSON containing only answerText."
	body, err := json.Marshal(map[string]interface{}{
		"model":       o.model,
		"temperature": 0.4,
		"max_tokens":  192,
		"response_format": map[string]interface{}{
			"type": "json_schema",
			"json_schema": map[string]interface{}{
				"name":   "npc_answer",
				"strict": true,
				"schema": schema,
			},
		},
		"messages": []map[string]string{
			{"role": "system", "content": instruction},
			{"role": "user", "content": string(contextJSON)},
		},
	})
	if err != nil {
		return "", fmt.Errorf("encode OpenAI request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create OpenAI request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+o.apiKey)
	req.Header.Set("Content-Type", "application/json")
	response, err := o.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("OpenAI request: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxLLMResponseBytes+1))
	if err != nil {
		return "", fmt.Errorf("read OpenAI response: %w", err)
	}
	if response.StatusCode != http.StatusOK || len(data) > maxLLMResponseBytes {
		return "", fmt.Errorf("OpenAI HTTP %d", response.StatusCode)
	}
	var envelope struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(data, &envelope) != nil || len(envelope.Choices) != 1 {
		return "", domain.ErrInvalidOutput
	}
	var result struct {
		AnswerText string `json:"answerText"`
	}
	decoder := json.NewDecoder(strings.NewReader(envelope.Choices[0].Message.Content))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&result) != nil {
		return "", domain.ErrInvalidOutput
	}
	var trailing interface{}
	if decoder.Decode(&trailing) != io.EOF || !domain.ValidGeneratedAnswer(result.AnswerText) {
		return "", domain.ErrInvalidOutput
	}
	return result.AnswerText, nil
}
