package npc

import (
	"fmt"
	"net/http"
	"os"

	"github.com/NUMaters/civileng-project/apps/server/internal/gamedata"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/application"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/infrastructure"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/presentation"
)

func Register(mux *http.ServeMux) error {
	if os.Getenv("NPC_DIALOGUE_ENABLED") == "false" {
		return nil
	}
	root, err := gamedata.ResolveRoot()
	if err != nil {
		return err
	}
	catalog, err := infrastructure.LoadCatalog(root)
	if err != nil {
		return err
	}
	rules, err := gamedata.Load(root)
	if err != nil {
		return err
	}
	backend, err := infrastructure.NewBackendClient(
		env("NPC_BACKEND_URL", "http://127.0.0.1:8082"),
		env("NPC_BACKEND_TOKEN", ""),
	)
	if err != nil {
		return err
	}
	presentation.Register(mux, application.NewServiceWithMode(catalog, backend.Generate, float64(rules.Rules.Timing.Phases.PreparationSeconds), "ai"))
	return nil
}

// RegisterBackend configures the private stateless NPC Backend. It is called
// by cmd/npc, never by the browser-facing Main Backend process.
func RegisterBackend(mux *http.ServeMux) error {
	root, err := gamedata.ResolveRoot()
	if err != nil {
		return err
	}
	catalog, err := infrastructure.LoadCatalog(root)
	if err != nil {
		return err
	}
	provider := env("NPC_LLM_PROVIDER", "ollama")
	var selectAnswer application.SelectAnswer
	switch provider {
	case "ollama":
		client, err := infrastructure.NewOllama(env("NPC_LLM_BASE_URL", "http://127.0.0.1:11434"), env("NPC_LLM_MODEL", "qwen3:14b"))
		if err != nil {
			return err
		}
		selectAnswer = client.Select
	case "openai":
		client, err := infrastructure.NewOpenAI(
			env("OPENAI_API_KEY", ""),
			env("OPENAI_BASE_URL", "https://api.openai.com"),
			env("OPENAI_MODEL", "gpt-4o-mini"),
		)
		if err != nil {
			return err
		}
		selectAnswer = client.Select
	case "fixed":
	default:
		return fmt.Errorf("unsupported NPC_LLM_PROVIDER %q", provider)
	}
	presentation.RegisterBackend(mux, application.NewGenerator(catalog, selectAnswer, provider), env("NPC_BACKEND_TOKEN", ""))
	return nil
}
func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
