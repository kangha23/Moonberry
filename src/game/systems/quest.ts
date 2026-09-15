import type { CropId } from './items';

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
    title: 'Vụ thu hoạch đầu tiên',
    description: 'Thu hoạch 3 củ cải cho Rowan ở bên giếng.',
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
    return { quest, reward: 0, claimed: false, message: 'Rowan vẫn còn thiếu vài củ cải nữa.' };
  }
  if (quest.rewarded) {
    return { quest, reward: 0, claimed: false, message: 'Rowan đã đang tính đến phiên chợ tới rồi.' };
  }

  return {
    quest: { ...quest, rewarded: true },
    reward: QUEST_REWARD_COINS,
    claimed: true,
    message: `Rowan trả ${QUEST_REWARD_COINS}g và hứa sẽ đồn tiếng lành về Nông trại Amberfall.`,
  };
}
