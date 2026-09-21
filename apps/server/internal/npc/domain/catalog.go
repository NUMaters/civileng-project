package domain

import (
	"fmt"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	MaxAnswerCharacters = 120
	HintLevels          = 3
)

type Position struct {
	Longitude float64 `json:"longitude"`
	Latitude  float64 `json:"latitude"`
	Height    float64 `json:"height"`
}
type Hint struct {
	Level        int      `json:"level"`
	Answers      []string `json:"answers"`
	ChildAnswers []string `json:"childAnswers"`
	FactIDs      []string `json:"factIds"`
}
type Question struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	Hints []Hint `json:"hints"`
}
type NPC struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Occupation    string     `json:"occupation"`
	Kind          string     `json:"kind"`
	TopicFactIDs  []string   `json:"topicFactIds"`
	Introduction  string     `json:"introduction"`
	Persona       string     `json:"persona"`
	LocationLabel string     `json:"locationLabel"`
	Position      Position   `json:"position"`
	ReferralNPCID *string    `json:"referralNpcId"`
	Questions     []Question `json:"questions"`
}
type Source struct {
	ID        string `json:"id"`
	Agency    string `json:"agency"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Section   string `json:"section"`
	Year      string `json:"year"`
	CheckedOn string `json:"checkedOn"`
}
type Fact struct {
	ID            string   `json:"id"`
	Area          string   `json:"area"`
	CanonicalFact string   `json:"canonicalFact"`
	Limitations   string   `json:"limitations"`
	SourceIDs     []string `json:"sourceIds"`
	Approved      bool     `json:"approved"`
	Confidence    string   `json:"confidence"`
}
type Catalog struct {
	Version        string   `json:"version"`
	ScenarioID     string   `json:"scenarioId"`
	Enabled        bool     `json:"enabled"`
	NPCs           []NPC    `json:"npcs"`
	AdditionalNPCs []NPC    `json:"additionalNpcs"`
	Knowledge      []Fact   `json:"knowledge"`
	Sources        []Source `json:"sources"`
}

func ValidAnswer(text string) bool {
	if strings.TrimSpace(text) == "" || utf8.RuneCountInString(text) > MaxAnswerCharacters {
		return false
	}
	if strings.ContainsAny(text, "<>") || strings.Contains(strings.ToLower(text), "http") || strings.Contains(text, "www.") {
		return false
	}
	sentences := strings.Count(text, "。") + strings.Count(text, "！") + strings.Count(text, "？")
	if sentences > 2 {
		return false
	}
	for _, r := range text {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// ValidGeneratedAnswer applies the display and safety constraints for text that
// has not been approved word for word. The generator receives only approved
// Facts, and the NPC Backend resolves sources from those Facts itself.
func ValidGeneratedAnswer(text string) bool {
	if !ValidAnswer(text) {
		return false
	}
	for _, prohibited := range []string{"絶対", "必ず", "100%", "確実"} {
		if strings.Contains(text, prohibited) {
			return false
		}
	}
	return true
}

func (c *Catalog) NPC(id string) (NPC, bool) {
	for _, npc := range c.NPCs {
		if npc.ID == id {
			return npc, true
		}
	}
	return NPC{}, false
}
func (n NPC) Question(id string) (Question, bool) {
	for _, question := range n.Questions {
		if question.ID == id {
			return question, true
		}
	}
	return Question{}, false
}
func (c *Catalog) Facts(ids []string) ([]Fact, []string) {
	facts := []Fact{}
	sources := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		for _, fact := range c.Knowledge {
			if fact.ID != id || !fact.Approved || fact.Confidence != "A" {
				continue
			}
			facts = append(facts, fact)
			for _, source := range fact.SourceIDs {
				if !seen[source] {
					sources = append(sources, source)
					seen[source] = true
				}
			}
		}
	}
	return facts, sources
}

func (c *Catalog) Validate() error {
	if c.Version == "" || c.ScenarioID == "" || len(c.NPCs) == 0 {
		return fmt.Errorf("missing NPC catalog identity")
	}
	sources := map[string]bool{}
	for _, source := range c.Sources {
		u, err := url.Parse(source.URL)
		if err != nil || u.Scheme != "https" || (!strings.HasSuffix(u.Hostname(), ".go.jp") && !strings.HasSuffix(u.Hostname(), ".lg.jp")) || u.User != nil || source.ID == "" || sources[source.ID] {
			return fmt.Errorf("invalid NPC source %q", source.ID)
		}
		sources[source.ID] = true
	}
	facts := map[string]bool{}
	for _, fact := range c.Knowledge {
		if fact.ID == "" || facts[fact.ID] || !fact.Approved || fact.Confidence != "A" || fact.CanonicalFact == "" || len(fact.SourceIDs) == 0 {
			return fmt.Errorf("invalid NPC fact %q", fact.ID)
		}
		facts[fact.ID] = true
		for _, id := range fact.SourceIDs {
			if !sources[id] {
				return fmt.Errorf("missing source %q", id)
			}
		}
	}
	npcs := map[string]bool{}
	for _, npc := range c.NPCs {
		if npc.ID == "" || npcs[npc.ID] {
			return fmt.Errorf("invalid NPC ID %q", npc.ID)
		}
		npcs[npc.ID] = true
		if err := validateNPC(npc, facts); err != nil {
			return err
		}
	}
	for _, npc := range c.NPCs {
		if npc.ReferralNPCID != nil && (!npcs[*npc.ReferralNPCID] || *npc.ReferralNPCID == npc.ID) {
			return fmt.Errorf("invalid referral for %q", npc.ID)
		}
	}
	return nil
}

func validateNPC(npc NPC, facts map[string]bool) error {
	if npc.Kind != "resident" && npc.Kind != "experienced" {
		return fmt.Errorf("invalid NPC kind")
	}
	if npc.Name == "" || npc.Persona == "" || len(npc.Questions) != HintLevels {
		return fmt.Errorf("incomplete NPC %q", npc.ID)
	}
	topicFacts := map[string]bool{}
	for _, id := range npc.TopicFactIDs {
		if !facts[id] || topicFacts[id] {
			return fmt.Errorf("invalid topic fact %q", id)
		}
		topicFacts[id] = true
	}
	if len(topicFacts) == 0 {
		return fmt.Errorf("missing topic facts for %q", npc.ID)
	}
	questions := map[string]bool{}
	for _, question := range npc.Questions {
		if question.ID == "" || questions[question.ID] || len(question.Hints) != HintLevels {
			return fmt.Errorf("invalid question %q", question.ID)
		}
		questions[question.ID] = true
		for i, hint := range question.Hints {
			if hint.Level != i+1 || len(hint.Answers) == 0 || len(hint.ChildAnswers) == 0 {
				return fmt.Errorf("invalid hint %q", question.ID)
			}
			if len(hint.FactIDs) == 0 && (hint.Level != HintLevels || npc.ReferralNPCID == nil) {
				return fmt.Errorf("unfounded hint %q", question.ID)
			}
			for _, id := range hint.FactIDs {
				if !facts[id] {
					return fmt.Errorf("unknown fact %q", id)
				}
				if !topicFacts[id] {
					return fmt.Errorf("out-of-topic fact %q for %q", id, npc.ID)
				}
			}
			for _, answer := range hint.Answers {
				if !ValidAnswer(answer) {
					return fmt.Errorf("invalid answer %q level %d", question.ID, hint.Level)
				}
			}
			for _, answer := range hint.ChildAnswers {
				if !ValidAnswer(answer) {
					return fmt.Errorf("invalid child answer %q level %d", question.ID, hint.Level)
				}
			}
		}
	}
	return nil
}
