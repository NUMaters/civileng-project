package gamedata

import (
	"testing"
)

func TestLoadGameData(t *testing.T) {
	root, err := ResolveRoot()
	if err != nil {
		t.Fatalf("resolve root: %v", err)
	}

	bundle, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(bundle.Structures) != 5 {
		t.Fatalf("expected 5 structures, got %d", len(bundle.Structures))
	}
	if bundle.Rules.Budget.InitialBudgetSolo != 12_000 {
		t.Fatalf("unexpected solo budget: %d", bundle.Rules.Budget.InitialBudgetSolo)
	}
	if bundle.Rules.Budget.IncomePerSecondPreparation != 80 {
		t.Fatalf("unexpected prep income: %d", bundle.Rules.Budget.IncomePerSecondPreparation)
	}
	if bundle.Rules.Budget.MaxBudget != 24_000 {
		t.Fatalf("unexpected max budget: %d", bundle.Rules.Budget.MaxBudget)
	}
	if bundle.Rules.Timing.TotalPlayTimeSeconds != 180 {
		t.Fatalf("unexpected timing: %d", bundle.Rules.Timing.TotalPlayTimeSeconds)
	}
}
