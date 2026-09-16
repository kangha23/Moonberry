import { JUNIPER_DOOR, LANE_TREE, POND, WELL } from '../places';
import type { NpcDef } from '../types';

/**
 * Juniper — the forager, and the reason the edges of the map are worth walking.
 *
 * She is outdoors unless the sky makes it impossible, and she talks about the
 * valley as a thing with moods. Ash is her younger brother; they share the
 * cottage on the east side, which is why the two of them are so often in the
 * same place and so rarely doing the same thing.
 */
export const JUNIPER: NpcDef = {
  id: 'juniper',
  name: 'Juniper',
  blurb: 'Hái lượm ở các bìa rừng. Biết mùa nào đang nói dối bạn.',
  texture: 'npc-juniper',
  sheet: 'juniper-sheet',
  tint: 0xffffff,
  birthday: { season: 'Autumn', day: 26 },
  defaultGiftReaction: 'neutral',
  gifts: {
    // Spec 15. Chè is the one sweet thing she will admit to.
    'che-dau': 'loved',
    'banh-chung': 'liked',
    // What she has talked about since spec 07 and could not be handed until
    // spec 10: the things that grow at the edges, which she says are the only
    // things worth finding.
    'purple-mushroom': 'loved',
    'wild-leek': 'loved',
    'winter-root': 'loved',
    daffodil: 'liked',
    chestnut: 'liked',
    'snow-yam': 'liked',
    frostcap: 'loved',
    winterberry: 'loved',
    clover: 'loved',
    sunflower: 'liked',
    cranberry: 'liked',
    rhubarb: 'liked',
    turnip: 'disliked',
    wood: 'hated',
  },
  schedule: [
    // Rain keeps her in, and a firefly shower does the exact opposite.
    { ...JUNIPER_DOOR, weather: 'Drizzle', fromHour: 6, toHour: 26, activity: 'home' },
    { ...POND, weather: 'Firefly Shower', fromHour: 6, toHour: 26, activity: 'pond' },

    { ...JUNIPER_DOOR, fromHour: 6, toHour: 10, activity: 'home' },
    { ...LANE_TREE, fromHour: 10, toHour: 15, activity: 'foraging' },
    { ...POND, fromHour: 15, toHour: 19, activity: 'pond' },
    { ...WELL, fromHour: 19, toHour: 21, activity: 'well' },
    { ...JUNIPER_DOOR, fromHour: 21, toHour: 26, activity: 'home' },
  ],
  dialogue: [
    { priority: 0, line: '"Thung lũng này không hề yên tĩnh. Chỉ là người ta lắng nghe sai lúc thôi."' },
    { priority: 0, line: '"Thứ gì ăn được cũng mọc ở rìa. Bờ giậu, mép nước, chân tường. Không bao giờ ở giữa thứ gì cả."' },
    { priority: 0, line: '"Cả đời tôi chưa trồng cây nào mà vẫn ăn uống đàng hoàng."' },

    { priority: 10, when: { activity: 'foraging' }, line: '"Lúc nào cũng dưới gốc cây bên đường. Thứ gì rụng cũng rụng ở đây."' },
    { priority: 10, when: { activity: 'pond' }, line: '"Mỗi năm cái ao đảo nước hai lần. Ngày nó đảo là ngửi ra được."' },
    { priority: 10, when: { activity: 'well' }, line: '"Đi vòng đường xa về nhà. Chưa vào nhà thì chưa gọi là muộn."' },
    { priority: 10, when: { activity: 'home' }, line: '"Ash giữ cái cửa. Tôi giữ cái cửa sổ. Nói qua bên nào cũng được."' },

    { priority: 20, when: { weather: 'Drizzle' }, line: '"Hôm nay thì không. Mưa là mọi thứ đáng tìm đều khép lại, kể cả tôi."', mood: 'sad' },
    { priority: 30, when: { weather: 'Firefly Shower' }, line: '"Đêm thắp đèn. Ra ao đi. Tôi sẽ không giải thích và bạn cũng chẳng cần tôi giải thích."' },
    { priority: 20, when: { season: 'Spring' }, line: '"Mùa xuân ồn ào và lộ liễu. Tôi thích một mùa kín đáo hơn."' },
    { priority: 20, when: { season: 'Summer' }, line: '"Xanh khắp nơi mà chẳng tìm được gì. Mùa hè là một nạn đói đẹp đẽ."' },
    { priority: 20, when: { season: 'Autumn' }, line: '"Bây giờ. Đúng tháng này. Nam việt quất ngoài bờ nước và những thứ ngon hơn nằm dưới lá."' },
    { priority: 20, when: { season: 'Winter' }, line: '"Nấm sương giá đội tuyết mà lên. Chẳng thứ nào khác đủ gan."' },

    { priority: 40, when: { minHearts: 2 }, line: '"Bạn để yên cho bờ giậu. Mùa đầu tôi có để ý. Phần lớn người ta vặt sạch rồi ngồi thắc mắc."' },
    { priority: 40, when: { minHearts: 4 }, line: '"Bố mẹ tôi làm ruộng. Cái đó không ngấm vào tôi, còn Ash thì vẫn đang nghĩ."' },
    { priority: 40, when: { minHearts: 4, activity: 'pond' }, line: '"Ngồi xuống đi. Sẽ chẳng có gì xảy ra cả, và đó chính là ý nghĩa của nó."' },
    { priority: 50, when: { minHearts: 6 }, line: '"Có một bụi dâu đông tôi mới chỉ cho đúng một người. Ông ấy mất rồi, nên con số quay về một."' },
    { priority: 50, when: { minHearts: 6, season: 'Winter' }, line: '"Hôm nào tạnh ráo thì theo tôi ra ngoài. Nhớ đi đôi ủng mà bạn không tiếc."' },
    { priority: 60, when: { minHearts: 8 }, line: '"Bạn đã bắt đầu để ý tới những cái rìa. Nhìn chỗ bạn đi là tôi biết."' },
    { priority: 60, when: { minHearts: 10 }, line: '"Tôi sẽ dẫn bạn đi khắp thung lũng. Từng cái rìa một. Mất cả năm, và tôi có cả năm."', mood: 'happy' },

    { priority: 100, when: { birthday: true }, line: '"Sinh nhật tôi, và tôi định ở ngoài trời trọn ngày. Bạn được mời một phần trong đó."', mood: 'happy' },
  ],
};
