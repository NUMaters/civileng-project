import budgetRules from "../rules/budget-rules.json";
import gameTiming from "../rules/game-timing.json";
import victoryConditions from "../rules/victory-conditions.json";
import channelDredging from "../structures/channel-dredging.json";
import drainagePump from "../structures/drainage-pump.json";
import levee from "../structures/levee.json";
import retentionBasin from "../structures/retention-basin.json";
import revetment from "../structures/revetment.json";
import heavyRain from "../disasters/heavy-rain.json";
import riverFlood from "../disasters/river-flood.json";
import typhoon from "../disasters/typhoon.json";
import type {
  DisasterDefinition,
  GameDataBundle,
  GameRulesBundle,
  StructureDefinition,
} from "./types";

const structures: StructureDefinition[] = [
  levee,
  retentionBasin,
  drainagePump,
  revetment,
  channelDredging,
] as StructureDefinition[];

const disasters: DisasterDefinition[] = [
  heavyRain,
  riverFlood,
  typhoon,
] as DisasterDefinition[];

export function loadStructures(): StructureDefinition[] {
  return structures.map((structure) => ({ ...structure }));
}

export function loadRules(): GameRulesBundle {
  return {
    budget: { ...budgetRules },
    timing: {
      ...gameTiming,
      phases: { ...gameTiming.phases },
    },
    victory: { ...victoryConditions },
  };
}

export function loadDisasters(): DisasterDefinition[] {
  return disasters.map((disaster) => ({ ...disaster }));
}

export function loadGameData(): GameDataBundle {
  return {
    structures: loadStructures(),
    rules: loadRules(),
    disasters: loadDisasters(),
  };
}

export { structures as STRUCTURES };
