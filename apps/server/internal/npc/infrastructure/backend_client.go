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

const maxBackendResponseBytes = 16 * 1024

// BackendClient is used only by Main Backend to call the private NPC Backend.
type BackendClient struct {
	baseURL string
	token   string
	client  *http.Client
}

func NewBackendClient(baseURL, token string) (*BackendClient, error) {
	u, err := url.Parse(baseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("invalid NPC_BACKEND_URL")
	}
	return &BackendClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		client:  &http.Client{Timeout: 6 * time.Second},
	}, nil
}

func (c *BackendClient) Generate(ctx context.Context, request domain.GenerationRequest) (domain.GenerationResponse, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return domain.GenerationResponse{}, fmt.Errorf("encode NPC Backend request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/internal/v1/npc/answers", bytes.NewReader(body))
	if err != nil {
		return domain.GenerationResponse{}, fmt.Errorf("create NPC Backend request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	response, err := c.client.Do(req)
	if err != nil {
		return domain.GenerationResponse{}, fmt.Errorf("NPC Backend request: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBackendResponseBytes+1))
	if err != nil {
		return domain.GenerationResponse{}, fmt.Errorf("read NPC Backend response: %w", err)
	}
	if response.StatusCode != http.StatusOK || len(data) > maxBackendResponseBytes {
		return domain.GenerationResponse{}, fmt.Errorf("NPC Backend HTTP %d", response.StatusCode)
	}
	var result domain.GenerationResponse
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&result) != nil {
		return domain.GenerationResponse{}, domain.ErrInvalidOutput
	}
	var trailing interface{}
	if decoder.Decode(&trailing) != io.EOF {
		return domain.GenerationResponse{}, domain.ErrInvalidOutput
	}
	return result, nil
}
