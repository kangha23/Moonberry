import { MARKET_BACK, MARKET_FRONT, TOBIAS_DOOR, WELL_SOUTH } from '../places';
import type { NpcDef } from '../types';

/**
 * Tobias — the stall.
 *
 * Talks in prices because prices are how he thinks, and is warmer than that
 * makes him sound. He has opinions about every crop in the valley and will
 * share the ones you did not ask for first. In Vietnamese he is the market
 * trader who calls everyone "bác" — friendly, flattering, and selling.
 */
export const TOBIAS: NpcDef = {
  id: 'tobias',
  name: 'Tobias',
  blurb: 'Trông sạp chợ. Biết giá của mọi thứ, kể cả bác.',
  texture: 'npc-tobias',
  sheet: 'tobias-sheet',
  tint: 0xffffff,
  birthday: { season: 'Summer', day: 21 },
  defaultGiftReaction: 'liked',
  gifts: {
    melon: 'loved',
    strawberry: 'loved',
    tomato: 'liked',
    cranberry: 'liked',
    turnip: 'neutral',
    clover: 'disliked',
    wood: 'disliked',
    frostcap: 'hated',
  },
  schedule: [
    { ...TOBIAS_DOOR, fromHour: 6, toHour: 8, activity: 'home' },
    { ...MARKET_BACK, fromHour: 8, toHour: 10, activity: 'stocking' },
    { ...MARKET_FRONT, fromHour: 10, toHour: 17, activity: 'market' },
    { ...WELL_SOUTH, fromHour: 17, toHour: 19, activity: 'well' },
    { ...TOBIAS_DOOR, fromHour: 19, toHour: 26, activity: 'home' },
  ],
  dialogue: [
    { priority: 0, line: '"Cái gì cũng có giá. Cái khó là biết giá của ai."' },
    { priority: 0, line: '"Bán nông sản, mua hạt giống, rồi lại bán. Không phức tạp đâu, chỉ là không dứt ra được thôi."' },
    { priority: 0, line: '"Tôi có thể nói cho bác nghe đại hoàng bên thung lũng kia giá bao nhiêu. Tôi sẽ không nói, nhưng tôi biết."' },

    { priority: 10, when: { activity: 'stocking' }, line: '"Chưa mở hàng. Dỡ thùng trước, tươi cười sau."' },
    { priority: 10, when: { activity: 'market' }, line: '"Sạp mở rồi. Trút hết giỏ ra đi, tôi sẽ trả cho bõ công bác đi bộ."' },
    { priority: 10, when: { activity: 'well' }, line: '"Đang đếm tiền cả ngày. Đừng làm tôi phân tâm, mất chỗ là đếm lại."' },
    { priority: 10, when: { activity: 'home' }, line: '"Đóng cửa rồi. Sau sáu giờ tôi cũng là con người, tin hay không thì tùy."' },

    { priority: 20, when: { season: 'Spring' }, line: '"Gốc dâu tây. Đắt, chậm, và là quyết định sáng suốt nhất cả mùa xuân của bác."' },
    { priority: 20, when: { season: 'Summer' }, line: '"Dưa. Năm nào tôi cũng nói, năm nào cũng có người đi trồng củ cải."' },
    { priority: 20, when: { season: 'Autumn' }, line: '"Tiền nằm ở mùa thu. Đừng bán bí ngô cho tôi ngay ngày đầu, chờ lúc sốt giá đã."' },
    { priority: 20, when: { season: 'Winter' }, line: '"Nấm sương giá với dâu đông, hết. Thời tiết đâu phải do tôi đặt ra."' },
    { priority: 20, when: { weather: 'Breezy' }, line: '"Sáng nay nửa cái mái che bay xuống cuối đường. Bác thử hỏi Maeve về mấy cái chốt bà ấy bán cho tôi xem."' },

    { priority: 40, when: { minHearts: 2 }, line: '"Hôm nào giỏ bác cũng nặng. Cái đó không phải may, dù bác có nói với người ta thế nào."' },
    { priority: 40, when: { minHearts: 4 }, line: '"Tôi từng có nông trại. Bốn năm. Tôi bán nông sản của người khác giỏi hơn nhiều."' },
    { priority: 40, when: { minHearts: 4, activity: 'market' }, line: '"Hôm nay giá của bác, không phải giá của tôi. Đừng kể với mấy người kia."' },
    { priority: 50, when: { minHearts: 6 }, line: '"Hồi bác mới tới tôi cho bác đúng một mùa. Giờ tôi thôi nói câu đó với người ta rồi."' },
    { priority: 50, when: { minHearts: 6, season: 'Autumn' }, line: '"Năm nay giữ hàng lại hai ngày đi. Tin tôi, rồi tôi cho bác xem sổ."' },
    { priority: 60, when: { minHearts: 8 }, line: '"Giờ biển ghi \'nông sản Amberfall\'. Người ta hỏi mua đích danh. Cái đó không phải công tôi, mà là công bác."' },
    { priority: 60, when: { minHearts: 10 }, line: '"Nửa cái sạp này là ruộng của bác. Tôi cũng không còn chắc cái chợ này là của ai trong hai chúng ta nữa."', mood: 'happy' },

    { priority: 100, when: { birthday: true }, line: '"Sinh nhật tôi! Mọi thứ nguyên giá và tôi rất vui được gặp bác."', mood: 'happy' },
  ],
};
