import { MARKET_FRONT, ROWAN_DOOR, WELL, WELL_SIDE } from '../places';
import type { NpcDef } from '../types';

/**
 * Rowan — the one who was already here.
 *
 * He was a prop with a quest and one line he repeated forever. He keeps the
 * quest, because it is the first thing the game asks anybody to do, but he now
 * walks to the market at one and home at nine like everybody else.
 *
 * Formal, a little old-fashioned, and interested in the farm in a way that is
 * genuinely about the farm rather than about him. He notices yields. In
 * Vietnamese he is the village elder: he calls the player "cháu" and himself
 * "bác", which carries the age gap and the formality in one word each.
 */
export const ROWAN: NpcDef = {
  id: 'rowan',
  name: 'Rowan',
  blurb: 'Giữ sổ sách của làng, và để mắt rất kỹ tới đám củ cải của cháu.',
  texture: 'npc-rowan',
  sheet: 'rowan-sheet',
  tint: 0xffffff,
  birthday: { season: 'Spring', day: 14 },
  questGiver: true,
  defaultGiftReaction: 'neutral',
  gifts: {
    rhubarb: 'loved',
    winterberry: 'loved',
    turnip: 'liked',
    wheat: 'liked',
    barley: 'liked',
    clover: 'disliked',
    wood: 'hated',
  },
  schedule: [
    // Winter shortens his day: the well is cold and he is not as young as the
    // ledger he keeps. Listed first, so it wins over the everyday rows below.
    { ...ROWAN_DOOR, season: 'Winter', fromHour: 6, toHour: 11, activity: 'home' },
    { ...WELL, season: 'Winter', fromHour: 11, toHour: 16, activity: 'well' },
    { ...ROWAN_DOOR, season: 'Winter', fromHour: 16, toHour: 26, activity: 'home' },

    { ...ROWAN_DOOR, fromHour: 6, toHour: 9, activity: 'home' },
    { ...WELL, fromHour: 9, toHour: 13, activity: 'well' },
    { ...MARKET_FRONT, fromHour: 13, toHour: 17, activity: 'market' },
    { ...WELL_SIDE, fromHour: 17, toHour: 21, activity: 'well' },
    { ...ROWAN_DOOR, fromHour: 21, toHour: 26, activity: 'home' },
  ],
  dialogue: [
    { priority: 0, line: '"Nông trại Amberfall. Đất tốt đấy. Xưa nay vẫn thế."' },
    { priority: 0, line: '"Để ý tới thời tiết, rồi thời tiết sẽ để ý tới cháu."' },
    { priority: 0, line: '"Bác giữ sổ làng từ thời bà nội bác. Chẳng ai hỏi xin xem cả."' },

    { priority: 10, when: { activity: 'well' }, line: '"Giếng này chưa cạn lần nào. Sáng nào bác cũng ra xem, phòng khi hôm nay là ngày đó."' },
    { priority: 10, when: { activity: 'market' }, line: '"Cứ thứ Ba là Tobias đội giá lên, rồi tưởng không ai nhận ra."' },
    { priority: 10, when: { activity: 'home' }, line: '"Sớm quá, hoặc muộn quá. Đằng nào cháu cũng đi một quãng xa chỉ để chào một tiếng."' },

    { priority: 20, when: { weather: 'Drizzle' }, line: '"Cứ để mưa rơi. Đỡ phải xách nước."' },
    { priority: 20, when: { weather: 'Firefly Shower' }, line: '"Đom đóm trong mưa. Mẹ bác gọi đó là đêm thắp đèn, và không giải thích gì thêm."' },
    { priority: 20, when: { season: 'Spring' }, line: '"Mùa xuân thứ gì cũng đòi trồng cùng một lúc. Đừng vội. Nửa mảnh ruộng làm kỹ hơn cả mảnh làm vội."' },
    { priority: 20, when: { season: 'Summer' }, line: '"Nắng thế này thì tưới hai lượt, nếu còn sức."' },
    { priority: 20, when: { season: 'Autumn' }, line: '"Mùa thu có tiền. Đổ vào đất chứ đừng đổ vào mình, rồi thu sang năm còn nhiều hơn."' },
    { priority: 20, when: { season: 'Winter' }, line: '"Chẳng gì mọc được. Nhưng thế không có nghĩa là không có việc."' },

    { priority: 30, when: { questCompleted: true, questRewarded: false }, line: '"Ba củ cải, củ nào cũng thật thà. Để bác trả cho đàng hoàng."' },
    { priority: 30, when: { questRewarded: true, minHearts: 0, maxHearts: 1 }, line: '"Bác đã nói với ngoài chợ về cháu. Cái đó còn đáng hơn mấy đồng bạc."' },

    { priority: 40, when: { minHearts: 2 }, line: '"Cháu nắm được mẹo rồi đấy. Phần lớn người ta bỏ cuộc trước mùa thứ hai."' },
    { priority: 40, when: { minHearts: 4 }, line: '"Bác hay tìm tên cháu trong sổ chợ. Thành thói quen mất rồi."' },
    { priority: 40, when: { minHearts: 4, season: 'Winter' }, line: '"Vào trong tránh rét đi, nếu cháu rảnh. Ấm nước hầu như lúc nào cũng đang đun."' },
    { priority: 50, when: { minHearts: 6 }, line: '"Bà nội bác làm ruộng bên phía thung lũng của con sông. Hai người hẳn sẽ hợp nhau."' },
    { priority: 50, when: { minHearts: 6, activity: 'well' }, line: '"Ngồi một lát đi. Bên giếng là chỗ hay để chẳng nói gì cả."' },
    { priority: 60, when: { minHearts: 8 }, line: '"Bác đã ghi lại Amberfall vào sổ là nông trại đang canh tác. Ô đó bỏ trống đã lâu lắm rồi."' },
    { priority: 60, when: { minHearts: 10 }, line: '"Cháu đã biến nơi này thành ngôi làng có nông trại, chứ không còn là nông trại nằm cạnh một ngôi làng nữa. Cảm ơn cháu."' },

    { priority: 100, when: { birthday: true }, line: '"Sinh nhật bác, phải rồi. Đến tuổi bác thì người ta thôi đếm mà bắt đầu làm tròn."' },
  ],
};
