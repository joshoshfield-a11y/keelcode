/** Quests: 3 generated STARFALL quests (kill / mine / deliver) with
 * deterministic flavor text seeded via the engine's rng streams.
 *
 * Pinned (identical in sim + meta briefs — never change):
 * - kill-8 → 250cr; mine-20 → 200cr; deliver-15 (spends 15 ore) → 300cr
 */

import { mulberry32, hashSeed } from '../engine/rng';

export type QuestKind = 'kill' | 'mine' | 'deliver';

export interface QuestDef {
  id: string;
  kind: QuestKind;
  target: number;
  reward: number;
  title: string;
  description: string;
}

/** Quest progress snapshot in the GameAPI shape (sim brief `getQuests`). */
export interface QuestView {
  id: string;
  kind: string;
  title: string;
  target: number;
  progress: number;
  reward: number;
  done: boolean;
}

const QUEST_SALT = 'drift-arena-quests';

const FLAVOR: Record<QuestKind, string[]> = {
  kill: [
    'Pirates of the Drift hit our ore convoy again. Thin their pack — eight hulls, confirmed kills only.',
    'Raider packs are bleeding the drift lanes dry. Take down eight pirate hulls and the guild pays out.',
    'Bounty board is hot: eight pirate ships prowling the field. Send them home in pieces.',
  ],
  mine: [
    'The refinery is starving. Pull twenty units of raw ore from the field and we keep the lights on.',
    'Ore run, pilot. Crack rock, beam twenty units into cargo — no questions, full pay.',
    'Twenty units of drift ore, delivered to station stock. The belt is rich; your laser is hungry.',
  ],
  deliver: [
    'Supply contract: the outpost needs fifteen units of ore, off your cargo, off your back. Guild pays 300.',
    'Fifteen units of ore to the quartermaster, straight from your hold. Sign here, get paid.',
    'Station stock is short. Deliver fifteen ore units and collect the contract bonus.',
  ],
};

function pickFlavor(kind: QuestKind, rng: () => number): string {
  const pool = FLAVOR[kind];
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

/** Exactly 3 quests, deterministic given seed. Pinned ids/kinds/targets/rewards. */
export function generateQuests(seed: number): QuestDef[] {
  const rng = mulberry32(hashSeed(seed, QUEST_SALT));
  return [
    {
      id: 'q-kill',
      kind: 'kill',
      target: 8,
      reward: 250,
      title: 'Pirates of the Drift',
      description: pickFlavor('kill', rng),
    },
    {
      id: 'q-mine',
      kind: 'mine',
      target: 20,
      reward: 200,
      title: 'Ore Run',
      description: pickFlavor('mine', rng),
    },
    {
      id: 'q-deliver',
      kind: 'deliver',
      target: 15,
      reward: 300,
      title: 'Supply Contract',
      description: pickFlavor('deliver', rng),
    },
  ];
}

export interface QuestStateInit {
  progress?: Record<string, number>;
  done?: Record<string, boolean>;
}

export interface QuestState {
  readonly defs: QuestDef[];
  readonly progress: Record<string, number>;
  readonly done: Record<string, boolean>;
  /**
   * Add n progress to every open quest of `kind`. Returns the ids that
   * completed as a result of this call (each quest completes once).
   */
  addProgress(kind: QuestKind, n: number): string[];
  /**
   * Claim a completed quest's reward. Returns the reward once; 0 for
   * incomplete, unknown, or already-claimed quests.
   */
  claimReward(id: string): number;
  /** Snapshot in the GameAPI `getQuests()` shape. */
  toViews(): QuestView[];
}

export function createQuestState(defs: QuestDef[], init: QuestStateInit = {}): QuestState {
  const progress: Record<string, number> = {};
  const done: Record<string, boolean> = {};
  const claimed = new Set<string>();
  for (const def of defs) {
    progress[def.id] = Math.max(0, Math.min(def.target, Math.floor(init.progress?.[def.id] ?? 0)));
    done[def.id] = init.done?.[def.id] === true || progress[def.id] >= def.target;
  }

  const api: QuestState = {
    defs,
    get progress() {
      return { ...progress };
    },
    get done() {
      return { ...done };
    },
    addProgress(kind: QuestKind, n: number): string[] {
      const completed: string[] = [];
      for (const def of defs) {
        if (def.kind !== kind || done[def.id]) continue;
        progress[def.id] = Math.min(def.target, progress[def.id] + n);
        if (progress[def.id] >= def.target) {
          done[def.id] = true;
          completed.push(def.id);
        }
      }
      return completed;
    },
    claimReward(id: string): number {
      const def = defs.find((d) => d.id === id);
      if (!def || !done[id] || claimed.has(id)) return 0;
      claimed.add(id);
      return def.reward;
    },
    toViews(): QuestView[] {
      return defs.map((d) => ({
        id: d.id,
        kind: d.kind,
        title: d.title,
        target: d.target,
        progress: progress[d.id],
        reward: d.reward,
        done: done[d.id],
      }));
    },
  };
  return api;
}
