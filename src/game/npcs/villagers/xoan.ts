import { WELL_SIDE, XOAN_DOOR, XOI_STALL } from '../places';
import type { NpcDef } from '../types';

/**
 * Bà Xoan — the xôi cart at the head of the phố.
 *
 * Spec 15's one villager, and the first who works somewhere other than the
 * village: up before anybody, at the cart through the morning, home for the
 * noon heat by way of the well, back for the afternoon. Calls everybody
 * "con", remembers what everybody ate, and says so.
 *
 * Borrows Tobias's walk sheet under a warm tint until somebody draws her one
 * — the route for that is at the end of `art/raw/lpc/CREDITS.md`. No portrait
 * yet either, so she talks from an empty frame rather than from his face.
 */
export const XOAN: NpcDef = {
  id: 'xoan',
  name: 'Bà Xoan',
  blurb: 'Bán xôi đầu phố. Nhớ khẩu vị của cả làng.',
  texture: 'npc-xoan',
  sheet: 'tobias-sheet',
  // light.7, the warmest cream the palette has: the lock allows no other.
  tint: 0xf8dbbd,
  birthday: { season: 'Winter', day: 14 },
  defaultGiftReaction: 'neutral',
  gifts: {
    'xoi-dau': 'loved',
    'banh-chung': 'loved',
    'che-dau': 'liked',
    nep: 'liked',
    'dau-xanh': 'liked',
    strawberry: 'loved',
    melon: 'loved',
    pumpkin: 'liked',
    wood: 'disliked',
    stone: 'disliked',
    coal: 'hated',
  },
  schedule: [
    // Hours past the day's own edges on purpose: the clock starts at six and
    // ends at two, and she is at home on both sides of it.
    { ...XOAN_DOOR, fromHour: 5, toHour: 7, activity: 'home' },
    { ...XOI_STALL, fromHour: 7, toHour: 12, activity: 'xoi-stall' },
    { ...WELL_SIDE, fromHour: 12, toHour: 14, activity: 'well' },
    { ...XOI_STALL, fromHour: 14, toHour: 17, activity: 'xoi-stall' },
    { ...XOAN_DOOR, fromHour: 17, toHour: 29, activity: 'home' },
  ],
  dialogue: [
    { priority: 0, line: '"Xôi nóng đây. Ăn đi rồi hẵng đi cày."' },
    { priority: 0, line: '"Con ăn gì chưa? Mặt tái thế kia thì cày được mấy luống."' },
    { priority: 0, line: '"Bà bán xôi ở đầu phố này từ hồi thằng Tobias còn chưa biết đếm tiền."' },

    { priority: 10, when: { activity: 'xoi-stall' }, line: '"Hết xôi gấc thì còn xôi đậu. Hết cả hai thì mai ra sớm."' },
    { priority: 10, when: { activity: 'xoi-stall' }, line: '"Có nếp có đậu thì mang ra đây bà xem. Hạt nào dẻo bà biết ngay."' },
    { priority: 10, when: { activity: 'well' }, line: '"Trưa nắng thế này ai ra phố. Bà ngồi đây một lúc, chiều lại dọn hàng."' },
    { priority: 10, when: { activity: 'xoi-stall' }, line: '"Xôi đậu phải đồ hai lửa. Ai đồ một lửa là bà biết ngay."' },
    { priority: 10, when: { activity: 'home' }, line: '"Dọn hàng rồi con ạ. Ngâm nếp cho mẻ mai đã."' },
    { priority: 10, when: { activity: 'home' }, line: '"Tối rồi, về đi con. Mai ra sớm còn có xôi nóng."' },

    // Two seasons, not four, on purpose. A season line outranks the cart's,
    // so a line for every season would leave the cart's lines never said —
    // which is what four of them did to Tobias's. Summer is when the nếp goes
    // in, and winter is Tết; spring and autumn she talks about the cart.

    { priority: 20, when: { season: 'Summer' }, line: '"Hạ rồi, gieo nếp đi con. Qua mùa này là lỡ cả năm đấy."' },
    { priority: 20, when: { season: 'Winter' }, line: '"Rét thế này mà có nồi bánh chưng đỏ lửa thì chẳng còn gì bằng."' },
    { priority: 20, when: { weather: 'Drizzle' }, line: '"Mưa lâm thâm thế này, xôi nguội nhanh lắm. Ăn luôn đi, đừng để dành."' },
    { priority: 20, when: { weather: 'Firefly Shower' }, line: '"Đom đóm về kìa. Hồi bà còn con gái, cả làng ra bờ ao ngồi xem đến khuya."' },

    { priority: 40, when: { minHearts: 2 }, line: '"Con là đứa trồng dưa ngoài nông trại phải không? Bà nhớ mặt rồi."' },
    { priority: 40, when: { minHearts: 3, activity: 'xoi-stall' }, line: '"Phần con bà để riêng một nắm, nhiều đậu hơn. Đừng nói với ai."', mood: 'happy' },
    { priority: 40, when: { minHearts: 4 }, line: '"Gói bánh chưng thì lá dong phải lau cho khô, lạt phải buộc cho chặt. Nhớ chưa?"' },
    { priority: 50, when: { minHearts: 6 }, line: '"Ông nhà bà ngày trước cũng cày ruộng. Con làm bà nhớ ông ấy."', mood: 'sad' },
    { priority: 50, when: { minHearts: 6, season: 'Winter' }, line: '"Tết này sang nhà bà gói bánh. Bà dạy con gói cho vuông."' },
    { priority: 60, when: { minHearts: 8 }, line: '"Cả phố này ai ăn gì bà thuộc hết. Giờ thêm cả con nữa."', mood: 'happy' },
    { priority: 60, when: { minHearts: 10 }, line: '"Mai kia bà già rồi, cái xe xôi này con giữ hộ bà nhé."', mood: 'happy' },

    { priority: 100, when: { birthday: true }, line: '"Sinh nhật bà mà con cũng nhớ à? Ngồi đây, hôm nay bà mời."', mood: 'happy' },
  ],
};
