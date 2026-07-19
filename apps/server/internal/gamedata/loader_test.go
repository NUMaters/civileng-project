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
	if bundle.Rules.Budget.InitialBudgetSolo != 10_000 {
		t.Fatalf("unexpected solo budget: %d", bundle.Rules.Budget.InitialBudgetSolo)
	}
	if bundle.Rules.Timing.TotalPlayTimeSeconds != 180 {
		t.Fatalf("unexpected timing: %d", bundle.Rules.Timing.TotalPlayTimeSeconds)
	}
}
