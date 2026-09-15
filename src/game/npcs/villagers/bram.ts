import { BRAM_DOOR, MARKET_SIDE, RANCH, WELL_SOUTH } from '../places';
import type { NpcDef } from '../types';

/**
 * Bram — the stock dealer, and the reason the coop has anything in it.
 *
 * The sixth villager, and the first one added since spec 07 promised that
 * adding one would be a file in this folder and a line in `definitions.ts`.
 * That promise held: nothing in the reducer knows his name, and the panel his
 * pen opens is keyed off the map prop rather than off him.
 *
 * He talks about animals the way farmers actually do — as individuals with
 * opinions, and as a ledger — and he is entirely unsentimental about the fact
 * that he will buy back at half. In Vietnamese he is the older man who calls
 * himself "tôi" and calls you "cậu", warm but never soft.
 */
export const BRAM: NpcDef = {
  id: 'bram',
  name: 'Bram',
  blurb: 'Người bán gia súc. Nhớ tên từng con vật đã đi qua tay mình.',
  texture: 'npc-bram',
  sheet: 'rowan-sheet',
  tint: 0xb8a06a,
  birthday: { season: 'Summer', day: 21 },
  defaultGiftReaction: 'neutral',
  gifts: {
    // What he keeps for the herd, and what he keeps for himself.
    clover: 'loved',
    barley: 'loved',
    wheat: 'liked',
    turnip: 'liked',
    pumpkin: 'liked',
    // Bringing a dealer an egg he sold you the chicken for is a joke he has
    // heard, and he lets you know it.
    egg: 'disliked',
    milk: 'disliked',
    frostcap: 'hated',
  },
  schedule: [
    // He works in the wet. The stock still has to eat, and he says so often
    // enough that the line is a weather condition rather than a schedule one.
    { ...RANCH, weather: 'Drizzle', fromHour: 6, toHour: 20, activity: 'ranch' },
    { ...BRAM_DOOR, weather: 'Drizzle', fromHour: 20, toHour: 26, activity: 'home' },

    { ...BRAM_DOOR, fromHour: 6, toHour: 8, activity: 'home' },
    { ...RANCH, fromHour: 8, toHour: 17, activity: 'ranch' },
    { ...WELL_SOUTH, fromHour: 17, toHour: 19, activity: 'well' },
    { ...MARKET_SIDE, fromHour: 19, toHour: 21, activity: 'market' },
    { ...BRAM_DOOR, fromHour: 21, toHour: 26, activity: 'home' },
  ],
  dialogue: [
    { priority: 0, line: '"Gà trước. Ai cũng muốn bò ngay, rồi ai cũng học lại từ đầu bằng gà."' },
    { priority: 0, line: '"Con vật không cần cậu thương nó. Nó cần cậu đến đúng giờ."' },
    { priority: 0, line: '"Tôi mua lại nửa giá. Cậu thấy ác thì cứ thấy, nhưng ít ra là có đường lui."' },

    { priority: 10, when: { activity: 'ranch' }, line: '"Cỏ khô hai mươi đồng một bó. Không kho chứa thì tôi không bán — cỏ ướt là cỏ bỏ."' },
    { priority: 10, when: { activity: 'well' }, line: '"Rửa tay. Cả ngày với gia súc thì ai cũng nên rửa tay."' },
    { priority: 10, when: { activity: 'market' }, line: '"Tobias không bán trứng. Tôi hỏi rồi. Cậu cứ tự đem ra sạp mà bán."' },
    { priority: 10, when: { activity: 'home' }, line: '"Chuồng đóng rồi. Mai quay lại, tôi dậy trước cậu đấy."' },

    { priority: 20, when: { weather: 'Drizzle' }, line: '"Mưa thì đóng cửa chuồng lại. Chúng ra ngoài ướt mình là cả tuần dỗi cậu."' },
    { priority: 20, when: { weather: 'Breezy' }, line: '"Ngày như hôm nay thì mở cửa chuồng ra. Một buổi chiều ngoài nắng bằng cả tuần vuốt ve."' },
    { priority: 20, when: { season: 'Winter' }, line: '"Đồng thì chết cả tháng Chạp, còn gà thì vẫn đẻ. Đó là toàn bộ lý do tôi ở đây."' },
    { priority: 20, when: { season: 'Summer' }, line: '"Nóng thế này sữa xuống ít hơn. Cứ vắt đều, đừng đổ tại con bò."' },
    { priority: 20, when: { season: 'Spring' }, line: '"Mùa này ai cũng mua. Đến mùa thu thì một nửa quay lại bán."' },
    { priority: 20, when: { season: 'Autumn' }, line: '"Trữ cỏ đi. Kho đầy trước tháng Chạp là ngủ ngon cả mùa đông."' },
    { priority: 30, when: { weather: 'Firefly Shower' }, line: '"Đàn bò đứng im hết. Chúng nhìn thấy cái gì đó mà tôi thì không."' },

    { priority: 40, when: { minHearts: 2 }, line: '"Cậu đặt tên cho chúng. Tôi để ý đấy. Người đặt tên là người còn nhớ cho ăn."' },
    { priority: 40, when: { minHearts: 4 }, line: '"Con bò đầu tiên của tôi tên là Muối. Nó húc tôi gãy hai cái xương sườn và tôi vẫn khóc lúc phải bán."' },
    { priority: 40, when: { minHearts: 4, activity: 'ranch' }, line: '"Đứng đây với tôi một lát. Nhìn chúng ăn là biết con nào ốm trước cả khi nó ốm."' },
    { priority: 50, when: { minHearts: 6 }, line: '"Vuốt mỗi ngày một lần thôi, nhưng ngày nào cũng phải có. Đó là khác biệt giữa trứng thường và trứng thượng hạng."' },
    { priority: 50, when: { minHearts: 6, season: 'Winter' }, line: '"Tháng Chạp cậu vẫn ra chuồng lúc sáu giờ. Người như thế trong thung lũng này đếm trên một bàn tay."' },
    { priority: 60, when: { minHearts: 8 }, line: '"Có con dê con sắp ra ràng. Tôi chưa nói với ai, và tôi đang nói với cậu."' },
    { priority: 60, when: { minHearts: 10 }, line: '"Bốn mươi năm tôi bán gia súc cho người ta. Cậu là người đầu tiên tôi không thấy tiếc con nào."' },

    { priority: 100, when: { birthday: true }, line: '"Sinh nhật tôi à? Đàn bò không biết. Cậu biết thì hơn chúng một bậc rồi đấy."' },
  ],
};
