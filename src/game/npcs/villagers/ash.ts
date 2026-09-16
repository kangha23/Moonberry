import { GREEN, JUNIPER_DOOR, WELL_SOUTH } from '../places';
import type { NpcDef } from '../types';

/**
 * Ash — the kid, and the one who says the thing nobody else will.
 *
 * Juniper's younger brother. He is outside whenever the weather allows and
 * furious about it when it does not. He is also the character who makes the
 * hearts readable: everybody else is polite from the first meeting, and Ash is
 * plainly not, so going from nothing to somewhere with him is something you can
 * actually hear happening. In Vietnamese that lands as a child who says "tớ"
 * and "cậu" and drops every honorific the rest of the valley bothers with.
 */
export const ASH: NpcDef = {
  id: 'ash',
  name: 'Ash',
  blurb: 'Em trai của Juniper. Ra ngoài bất kể thời tiết, và ca cẩm về thời tiết.',
  texture: 'npc-ash',
  sheet: 'ash-sheet',
  tint: 0xffffff,
  birthday: { season: 'Winter', day: 8 },
  defaultGiftReaction: 'disliked',
  gifts: {
    strawberry: 'loved',
    melon: 'loved',
    sunflower: 'liked',
    tomato: 'liked',
    pumpkin: 'liked',
    turnip: 'hated',
    frostcap: 'hated',
  },
  schedule: [
    // Sent in when it rains, and not remotely happy about it.
    { ...JUNIPER_DOOR, weather: 'Drizzle', fromHour: 6, toHour: 26, activity: 'stuck-in' },

    { ...JUNIPER_DOOR, fromHour: 6, toHour: 9, activity: 'home' },
    { ...GREEN, fromHour: 9, toHour: 16, activity: 'green' },
    { ...WELL_SOUTH, fromHour: 16, toHour: 19, activity: 'well' },
    { ...JUNIPER_DOOR, fromHour: 19, toHour: 26, activity: 'home' },
  ],
  dialogue: [
    { priority: 0, line: '"Tớ biết cậu là ai. Cậu là cái nông trại."' },
    { priority: 0, line: '"Ở đây ai cũng già. Cậu cũng già, nhưng đỡ hơn một tí."' },
    { priority: 0, line: '"Juniper bảo tớ không nên nói mấy câu như thế. Chị ấy nói sau khi tớ đã nói rồi, chẳng ích gì."' },

    { priority: 10, when: { activity: 'green' }, line: '"Cây này của tớ. Tớ không bảo cậu không được đứng gần. Tớ bảo nó là của tớ."' },
    { priority: 10, when: { activity: 'well' }, line: '"Không được thả đồ xuống giếng đâu. Tớ thả bốn thứ rồi."' },
    { priority: 10, when: { activity: 'home' }, line: '"Sớm quá. Quay lại lúc mặt trời lên hẳn đã."' },
    { priority: 30, when: { activity: 'stuck-in' }, line: '"Mưa. MƯA. Mà chị ấy không cho tớ ra. Cậu hỏi chị ấy đi. Hỏi giùm tớ."' },

    { priority: 20, when: { weather: 'Breezy' }, line: '"Gió đẹp nhất mùa. Tớ có diều mà không có dây, nên chủ yếu là đứng đây thôi."' },
    { priority: 30, when: { weather: 'Firefly Shower' }, line: '"Juniper đang ra ao làm bộ bí hiểm. Hôm nay tớ được ra ngoài vì hôm nay đặc biệt."' },
    { priority: 20, when: { season: 'Summer' }, line: '"Dưa. Ai cũng đi trồng củ cải và tớ không hiểu nổi một ai trong số các người."' },
    { priority: 20, when: { season: 'Winter' }, line: '"Tuyết hay được đúng một ngày, sau đó chỉ là trời lạnh kèm thêm mấy bước phiền phức."', mood: 'angry' },
    { priority: 20, when: { season: 'Spring' }, line: '"Chỗ nào cũng mùi bùn mà ai cũng khoái chí. Tớ chịu."' },
    { priority: 20, when: { season: 'Autumn' }, line: '"Juniper bảo mùa thu là tháng đẹp nhất. Chị ấy nói câu đó về tháng nào đang tới."' },

    { priority: 40, when: { minHearts: 1 }, line: '"Cậu mang cho tớ thứ không phải củ cải. Tớ đã nâng đánh giá về cậu lên một chút."' },
    { priority: 40, when: { minHearts: 2 }, line: '"Cậu được đứng gần cái cây. Không phải dưới gốc. Gần thôi."' },
    { priority: 40, when: { minHearts: 4 }, line: '"Tớ xem nông trại được không? Juniper bảo phải được mời và cậu phải thật lòng mời."' },
    { priority: 50, when: { minHearts: 6 }, line: '"Tớ sẽ có nông trại. Không to đâu. Một nông trại dưa."' },
    { priority: 50, when: { minHearts: 6, activity: 'green' }, line: '"Thôi được. Nó là cây của hai đứa. Tớ nghĩ kỹ rồi và đó là quyết định cuối cùng."' },
    { priority: 60, when: { minHearts: 8 }, line: '"Ai hỏi ai sống ở Amberfall là tớ nói tên cậu như thể tớ quen cậu. Vì tớ quen thật."' },
    { priority: 60, when: { minHearts: 10 }, line: '"Juniper bảo cậu là điều tốt nhất đến với làng này trong mười năm. Tớ bảo tớ biết rồi. Tớ biết thật mà."', mood: 'happy' },

    { priority: 100, when: { birthday: true }, line: '"Sinh nhật tớ mà trời lại ĐỔ TUYẾT, sinh nhật tệ nhất có thể, và tớ đang vui kinh khủng."', mood: 'happy' },
  ],
};
