package infrastructure

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/NUMaters/civileng-project/apps/server/internal/npc/domain"
)

func LoadCatalog(root string) (*domain.Catalog, error) {
	data, err := os.ReadFile(filepath.Join(root, "npc", "npc-catalog.json"))
	if err != nil {
		return nil, fmt.Errorf("read NPC catalog: %w", err)
	}
	var catalog domain.Catalog
	if err := json.Unmarshal(data, &catalog); err != nil {
		return nil, fmt.Errorf("decode NPC catalog: %w", err)
	}
	catalog.NPCs = append(catalog.NPCs, catalog.AdditionalNPCs...)
	if err := catalog.Validate(); err != nil {
		return nil, fmt.Errorf("validate NPC catalog: %w", err)
	}
	return &catalog, nil
}
