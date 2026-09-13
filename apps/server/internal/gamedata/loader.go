package gamedata

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

type StructureEffects struct {
	WaterLevelReduction     float64 `json:"waterLevelReduction"`
	OverflowPrevention      float64 `json:"overflowPrevention"`
	DrainageCapacity        float64 `json:"drainageCapacity"`
	BankProtection          float64 `json:"bankProtection"`
	ChannelCapacityIncrease float64 `json:"channelCapacityIncrease"`
}

type StructureRole struct {
	PrimaryHazard string   `json:"primaryHazard"`
	Strengths     []string `json:"strengths"`
	Weaknesses    []string `json:"weaknesses"`
}

type StructureDefinition struct {
	ID                       string             `json:"id"`
	DisplayName              string             `json:"displayName"`
	Description              string             `json:"description"`
	ConstructionCost         int                `json:"constructionCost"`
	ConstructionTimeSeconds  int                `json:"constructionTimeSeconds"`
	MaintenanceCostPerSecond int                `json:"maintenanceCostPerSecond"`
	AllowedTerrains          []string           `json:"allowedTerrains"`
	SupportedDisasters       []string           `json:"supportedDisasters"`
	Effects                  StructureEffects   `json:"effects"`
	Role                     StructureRole      `json:"role"`
	HazardAffinity           map[string]float64 `json:"hazardAffinity"`
}

type BudgetRules struct {
	InitialBudgetSolo                 int    `json:"initialBudgetSolo"`
	InitialBudgetMultiplayerPerPlayer int    `json:"initialBudgetMultiplayerPerPlayer"`
	IncomePerSecondPreparation        int    `json:"incomePerSecondPreparation"`
	IncomePerSecondDisaster           int    `json:"incomePerSecondDisaster"`
	DisasterStartGrant                int    `json:"disasterStartGrant"`
	MaxBudget                         int    `json:"maxBudget"`
	Description                       string `json:"description"`
}

type GameTiming struct {
	TotalPlayTimeSeconds int `json:"totalPlayTimeSeconds"`
	Phases               struct {
		PreparationSeconds int `json:"preparationSeconds"`
		DisasterSeconds    int `json:"disasterSeconds"`
		ResultSeconds      int `json:"resultSeconds"`
	} `json:"phases"`
}

type VictoryConditions struct {
	ClearThresholdPercent   float64 `json:"clearThresholdPercent"`
	FailureThresholdPercent float64 `json:"failureThresholdPercent"`
	Description             string  `json:"description"`
}

type RulesBundle struct {
	Budget  BudgetRules       `json:"budget"`
	Timing  GameTiming        `json:"timing"`
	Victory VictoryConditions `json:"victory"`
}

type Bundle struct {
	Structures []StructureDefinition `json:"structures"`
	Rules      RulesBundle           `json:"rules"`
}

// ResolveRoot returns packages/game-data directory.
func ResolveRoot() (string, error) {
	if dir := os.Getenv("GAME_DATA_DIR"); dir != "" {
		return filepath.Clean(dir), nil
	}

	candidates := []string{
		filepath.Join("packages", "game-data"),
		filepath.Join("..", "packages", "game-data"),
		filepath.Join("..", "..", "packages", "game-data"),
		filepath.Join("..", "..", "..", "packages", "game-data"),
	}

	if _, file, _, ok := runtime.Caller(0); ok {
		candidates = append(candidates, filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "packages", "game-data")))
	}

	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if err == nil && info.IsDir() {
			abs, absErr := filepath.Abs(candidate)
			if absErr != nil {
				return candidate, nil
			}
			return abs, nil
		}
	}
	return "", fmt.Errorf("game-data directory not found (set GAME_DATA_DIR)")
}

func Load(root string) (*Bundle, error) {
	structuresDir := filepath.Join(root, "structures")
	entries, err := os.ReadDir(structuresDir)
	if err != nil {
		return nil, fmt.Errorf("read structures: %w", err)
	}

	structures := make([]StructureDefinition, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		var structure StructureDefinition
		if err := readJSON(filepath.Join(structuresDir, entry.Name()), &structure); err != nil {
			return nil, err
		}
		structures = append(structures, structure)
	}

	var budget BudgetRules
	var timing GameTiming
	var victory VictoryConditions
	if err := readJSON(filepath.Join(root, "rules", "budget-rules.json"), &budget); err != nil {
		return nil, err
	}
	if err := readJSON(filepath.Join(root, "rules", "game-timing.json"), &timing); err != nil {
		return nil, err
	}
	if err := readJSON(filepath.Join(root, "rules", "victory-conditions.json"), &victory); err != nil {
		return nil, err
	}

	return &Bundle{
		Structures: structures,
		Rules: RulesBundle{
			Budget:  budget,
			Timing:  timing,
			Victory: victory,
		},
	}, nil
}

func readJSON(path string, dest any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	return nil
}
