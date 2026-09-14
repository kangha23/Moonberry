import type { CropId } from './satchel';

export const QUEST_REWARD_COINS = 75;

/**
 * Quest progress belongs to the farm, not to an individual player: any player
 * harvesting the target crop advances it, and any player may claim the reward.
 */
export interface QuestState {
  id: 'first-harvest';
  title: string;
  description: string;
  targetCrop: CropId;
  target: number;
  progress: number;
  completed: boolean;
  rewarded: boolean;
}

export function createQuest(): QuestState {
  return {
    id: 'first-harvest',
    title: 'First Harvest',
    description: 'Harvest 3 turnips for Rowan by the well.',
    targetCrop: 'turnip',
    target: 3,
    progress: 0,
    completed: false,
    rewarded: false,
  };
}

export function recordHarvest(quest: QuestState, crop: CropId): QuestState {
  if (quest.completed || crop !== quest.targetCrop) return quest;
  const progress = Math.min(quest.target, quest.progress + 1);
  return { ...quest, progress, completed: progress >= quest.target };
}

export interface QuestRewardResult {
  quest: QuestState;
  /** Credit this to the farm's shared wallet. Zero unless `claimed` is true. */
  reward: number;
  message: string;
  claimed: boolean;
}

export function claimQuestReward(quest: QuestState): QuestRewardResult {
  if (!quest.completed) {
    return { quest, reward: 0, claimed: false, message: 'Rowan still needs a few more turnips.' };
  }
  if (quest.rewarded) {
    return { quest, reward: 0, claimed: false, message: 'Rowan is already planning the next market day.' };
  }

  return {
    quest: { ...quest, rewarded: true },
    reward: QUEST_REWARD_COINS,
    claimed: true,
    message: `Rowan pays ${QUEST_REWARD_COINS}g and promises to spread the word about Amberfall Farm.`,
  };
}
