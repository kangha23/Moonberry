import { describe, expect, it } from 'vitest';
import { QUEST_REWARD_COINS, claimQuestReward, createQuest, recordHarvest } from './quest';

describe('quest system', () => {
  it('tracks only the requested crop and pays once', () => {
    let quest = createQuest();

    quest = recordHarvest(quest, 'strawberry');
    expect(quest.progress).toBe(0);

    quest = recordHarvest(quest, 'turnip');
    quest = recordHarvest(quest, 'turnip');
    quest = recordHarvest(quest, 'turnip');

    expect(quest.completed).toBe(true);
    expect(quest.progress).toBe(3);

    const firstClaim = claimQuestReward(quest);
    quest = firstClaim.quest;

    expect(firstClaim.claimed).toBe(true);
    expect(firstClaim.reward).toBe(QUEST_REWARD_COINS);

    const secondClaim = claimQuestReward(quest);
    expect(secondClaim.claimed).toBe(false);
    expect(secondClaim.reward).toBe(0);
  });
});
