import { FORGE, FORGE_LANE, MAEVE_DOOR, MARKET_SIDE } from '../places';
import type { NpcDef } from '../types';

/**
 * Maeve — the blacksmith, and the reason the forge has somebody at it.
 *
 * The anvil was a building with a panel attached. She is who the panel is.
 * Blunt to the point of rudeness, entirely without malice, and the only person
 * in the valley who will tell you your hoe is the problem. In Vietnamese she
 * uses the flat, unadorned "tôi/cậu" that reads as brusque without being rude.
 *
 * Her working spot is the yard rather than the anvil itself, so walking up to
 * order a tool still opens the counter: the nearer of the two wins, and the
 * two are deliberately not the same tile.
 */
export const MAEVE: NpcDef = {
  id: 'maeve',
  name: 'Maeve',
  blurb: 'Thợ rèn. Sẽ kể cho cậu nghe nông cụ của cậu hỏng ở đâu, rất dài.',
  texture: 'npc-maeve',
  sheet: 'player-sheet',
  tint: 0xc98a8a,
  birthday: { season: 'Autumn', day: 3 },
  defaultGiftReaction: 'neutral',
  gifts: {
    wood: 'loved',
    pumpkin: 'loved',
    barley: 'liked',
    wheat: 'liked',
    cranberry: 'liked',
    sunflower: 'disliked',
    strawberry: 'disliked',
    clover: 'hated',
  },
  schedule: [
    // She does not work the forge in the wet — the yard is open to the sky.
    { ...MAEVE_DOOR, weather: 'Drizzle', fromHour: 6, toHour: 26, activity: 'home' },

    { ...MAEVE_DOOR, fromHour: 6, toHour: 8, activity: 'home' },
    { ...FORGE, fromHour: 8, toHour: 18, activity: 'forge' },
    { ...MARKET_SIDE, fromHour: 18, toHour: 20, activity: 'market' },
    { ...FORGE_LANE, fromHour: 20, toHour: 22, activity: 'lane' },
    { ...MAEVE_DOOR, fromHour: 22, toHour: 26, activity: 'home' },
  ],
  dialogue: [
    { priority: 0, line: '"Nông cụ hoặc thôi. Tôi không giỏi tán gẫu và còn tệ hơn ở khoản giả vờ."' },
    { priority: 0, line: '"Lưỡi cùn ngốn của cậu cả một buổi sáng, mà cậu chẳng bao giờ biết là buổi nào."' },
    { priority: 0, line: '"Đồng trước đã. Ai cũng muốn nhảy thẳng lên vàng, rồi ai cũng tiếc quãng thời gian chờ."' },

    { priority: 10, when: { activity: 'forge' }, line: '"Coi chừng cái sân, nóng hơn vẻ ngoài đấy. Quầy ở đằng trước."' },
    { priority: 10, when: { activity: 'market' }, line: '"Tôi chỉ mua hai thứ: than và bữa tối. Tobias bán một trong hai."' },
    { priority: 10, when: { activity: 'lane' }, line: '"Đi cho giãn gân. Mười tiếng bên đe thì tai ù cả tối."' },
    { priority: 10, when: { activity: 'home' }, line: '"Lò nguội rồi. Quay lại khi nó chưa nguội."' },

    { priority: 20, when: { weather: 'Drizzle' }, line: '"Than ướt. Không. Mai."' },
    { priority: 20, when: { weather: 'Breezy' }, line: '"Hôm nay lửa bén gió. Nghe là thấy khác ngay."' },
    { priority: 20, when: { season: 'Winter' }, line: '"Tháng duy nhất trong năm nghề tôi dễ chịu. Tranh thủ mà nhờ vả."' },
    { priority: 20, when: { season: 'Summer' }, line: '"Đứng cạnh lửa giữa tháng Tám. Cậu thử hỏi tôi buôn bán thế nào xem."' },
    { priority: 20, when: { season: 'Spring' }, line: '"Xuân nào cũng có người mang cuốc gãy tới. Năm nào cũng vậy. Sau khi đất đã cứng lại rồi."' },
    { priority: 30, when: { weather: 'Firefly Shower' }, line: '"Đến tôi cũng dừng tay vì cái này. Đừng kể với ai là tôi nói thế."' },

    { priority: 40, when: { minHearts: 2 }, line: '"Cậu mang nông cụ tới trước khi nó gãy. Riêng cái đó đã hơn nửa thung lũng này rồi."' },
    { priority: 40, when: { minHearts: 4 }, line: '"Tôi rèn cái bản lề đầu tiên năm chín tuổi, giờ vẫn nằm trên cửa nhà thờ. Lệch. Tôi cứ để vậy."' },
    { priority: 40, when: { minHearts: 4, activity: 'forge' }, line: '"Đứng đó, tránh tia lửa ra, rồi xem cũng được. Đừng nói lúc tôi đang đếm."' },
    { priority: 50, when: { minHearts: 6 }, line: '"Hai ngày không có cuốc là lâu đấy. Tôi biết chứ. Tôi vẫn lấy đủ hai ngày, vì hàng làm vội thì rồi cũng quay lại."' },
    { priority: 50, when: { minHearts: 6, season: 'Autumn' }, line: '"Mang bí ngô tới cho tôi trước khi bán. Tôi trả bằng công, không trả bằng tiền."' },
    { priority: 60, when: { minHearts: 8 }, line: '"Trên giá có một cái búa khắc tên cậu ở cán. Đừng làm nó thành chuyện kỳ cục."' },
    { priority: 60, when: { minHearts: 10 }, line: '"Cậu là người duy nhất tới lò rèn để gặp tôi chứ không phải gặp cái đe. Tôi nhận ra ngay từ tuần đầu."' },

    { priority: 100, when: { birthday: true }, line: '"Sinh nhật tôi mà lửa vẫn đòi ăn than. Nói nhanh một câu rồi lát nữa tôi sẽ thấy vui."' },
  ],
};
