# 13 — Mỏ và chiến đấu

**Phụ thuộc:** [10 — Thu thập tài nguyên](10-resources-and-tools.md) cho cuốc
chim, [11 — Chế tác](11-crafting.md) cho thứ để làm với quặng.

## Mục tiêu

Một nơi để đi xuống, và một lý do để mang theo thứ gì đó sắc.

## Vì sao

Đây là spec lớn nhất và là spec duy nhất đụng vào một giả định nền của cả dự án,
nên nó xếp cuối.

Kim loại hiện ra từ hư không. Thợ rèn ở spec 06 nâng cuốc lên đồng, thép, vàng và
người chơi trả bằng tiền bán củ cải. Ống tưới ở spec 11 cần đồng thỏi mà không có
đồng ở đâu cả. Mỏ là chỗ kim loại *đến từ*, và khi có nó thì cả cái ratchet của
spec 06 mới có gốc.

Nó cũng là hệ thống duy nhất trong danh sách có **rủi ro**. Mọi thứ khác trong
game này đều an toàn: tệ nhất là mất một ngày. Một nơi mà người chơi có thể thua
là thứ khiến việc chuẩn bị có nghĩa.

## Giả định bị phá vỡ: bản đồ không còn tĩnh

Cả thế giới hiện tại là `maps/*.json`, tĩnh, giống nhau ở mọi thế giới, dựng bằng
Tiled và đóng băng vào `maps.generated.ts`. Mỏ thì không thể như thế. 40 tầng vẽ
tay là 40 file Tiled và một mỏ mà ai cũng thuộc lòng sau hai lần xuống.

**Tầng mỏ được sinh ra, tất định, từ một hạt giống trên `FarmState`.**

```ts
// src/game/world/mineFloor.ts
export interface MineFloor {
  depth: number;
  width: number;
  height: number;
  tiles: TileKind[][];
  nodes: ResourceNode[];
  monsters: MonsterSpawn[];
  /** Ô có thang xuống. */
  ladder: Point | null;
  /** Ô người chơi rơi xuống khi vào tầng. */
  entrance: Point;
}

/** Tất định. Cùng hạt và cùng độ sâu luôn cho ra cùng một tầng. */
export function generateFloor(seed: number, depth: number): MineFloor;
```

Điều này đặt ra một câu hỏi thật: **`AreaId` hiện là một union đóng** lấy từ
`AREA_IDS` trong `maps.generated.ts`, và tầng mỏ không nằm trong đó.

Mở rộng thành:

```ts
export type AreaId = StaticAreaId | `mine:${number}`;
```

và cho `areaMap()` phân nhánh: khu tĩnh thì tra `AREAS`, khu mỏ thì sinh và nhớ
tạm. Cái nhớ tạm đó là bộ nhớ đệm thuần chứ không phải state — nó dựng lại được
từ hạt giống, nên nó không vào bản lưu.

**Hạt giống đổi mỗi ngày.** `mineSeed = hash(worldSeed, day)`. Xuống lại tầng 5
hôm sau là một tầng 5 khác. Đó là thứ khiến mỏ chơi lại được, và nó cũng có nghĩa
là không cần lưu trạng thái từng tầng — chỉ cần lưu độ sâu sâu nhất đã tới.

```ts
interface FarmState {
  // ...
  worldSeed: number;
  /** Tầng sâu nhất nông trại từng chạm tới. Của chung: một người mở đường cho cả bốn. */
  deepestFloor: number;
}
```

## Sinh tầng

Đủ đơn giản để đọc được và đủ khác nhau để không nhàm:

1. Chọn kích thước theo độ sâu, 24×24 tới 40×40.
2. Đục phòng và hành lang bằng thuật toán đi ngẫu nhiên, tất định theo hạt.
3. Rải nút đá theo mật độ tăng dần theo độ sâu, và quặng theo bảng độ sâu.
4. Đặt thang xuống ở một ô xa lối vào. **Thang luôn tồn tại** — thang giấu trong
   đá như Stardew là một cơ chế hay cho người chơi đơn, nhưng trong thế giới bốn
   người thì nó biến một người thành kẻ giữ cả nhóm lại.
5. Rải quái theo bảng độ sâu.

| Độ sâu | Quặng | Quái |
| --- | --- | --- |
| 1–9 | Đồng | Sên xanh |
| 10–19 | Sắt | Sên, dơi |
| 20–29 | Sắt, vàng | Dơi, bọ đá |
| 30–39 | Vàng | Bọ đá, bóng ma |
| 40 | Vàng, ngọc | Trùm tầng đáy |

Cứ 5 tầng có một cái thang máy ghi nhớ, để lần sau không phải đi lại từ đầu.

## Máu, và vì sao nó không phải năng lượng

Người chơi có thêm `health`, tách khỏi `energy`.

Gộp chúng là lựa chọn hấp dẫn và là lựa chọn sai. Năng lượng là ngân sách của một
ngày và cạn dần đều đặn; máu là rủi ro tức thời và tụt theo cục. Gộp lại thì đào
mười hòn đá sẽ khiến người chơi chết vì một con sên, và việc dọn ruộng buổi sáng
đột nhiên nguy hiểm.

```ts
interface PlayerState {
  // ...
  health: number;
  maxHealth: number;  // 100 lúc đầu
  /** Vô hiệu sau khi trúng đòn, tính bằng phút trong ngày. */
  invulnerableUntil: number;
}
```

**Hết máu không giết nhân vật.** Người chơi ngất, được đưa về nhà, mất 10% ví (dùng
lại đúng `COLLAPSE_COIN_SHARE` của spec 01) và mất một phần đồ đào được. Ngày kết
thúc ngay lập tức **chỉ với người đó** — ba người còn lại không bị một người chơi
ẩu tả kéo cả ngày về số không.

Đó là điểm khác quan trọng so với việc ngủ ở spec 01: ngủ là bỏ phiếu chung, ngất
là chuyện riêng.

## Chiến đấu

Giữ đơn giản một cách có chủ ý. Đây là game nông trại.

```ts
export interface Monster {
  id: string;
  kind: MonsterKind;
  area: AreaId;      // 'mine:12'
  x: number;
  y: number;
  health: number;
  /** Phút trong ngày mà nó được đánh tiếp. */
  nextAttackAt: number;
}
```

- Kiếm là `ItemDef` có `tool: 'sword'`. Vung nó đánh hình quạt trước mặt.
- Quái đi thẳng về phía người chơi gần nhất trong tầm, không tìm đường. Hành lang
  mỏ đủ rộng cho việc đó, và A* cho quái là công việc không mua được gì ở đây.
- Đánh nhau **không tốn năng lượng**. Cùng lý do với liềm: tính phí cho nó chỉ làm
  mỏ thành nơi không đi nổi chứ không thành nơi khó.
- Quái do server mô phỏng trong `world/tick`, cùng chỗ với NPC và vật nuôi. Danh
  sách quái sống theo tầng đang có người, và biến mất khi tầng trống.

**Quái chỉ tồn tại trong mỏ.** Không có quái trên ruộng, không có sự kiện đêm. Một
game nông trại mà người chơi bị tấn công trong lúc tưới nước là một game khác.

## Nhiều người chơi

Đây là chỗ mỏ khác mọi thứ đã làm.

**Tầng là khu vực, nên bốn người ở `mine:12` là ở cùng một chỗ**, và cơ chế khu vực
sẵn có lo phần còn lại: người chơi chỉ được vẽ trên bản đồ họ đang đứng, và điều
đó đã đúng từ spec 04.

Nhưng có hai câu hỏi mới:

- **Người đi xuống trước.** Ai bấm thang thì xuống; người khác không bị kéo theo.
  Đơn giản, và nghĩa là nhóm có thể tách ra — chấp nhận được.
- **Tầng trống thì quên.** Khi người cuối rời `mine:12`, danh sách quái và nút của
  tầng đó bị xoá. Quay lại thì sinh lại từ hạt. Điều đó có nghĩa là đi lên rồi đi
  xuống làm quặng mọc lại, nên **thang máy chỉ đi xuống tầng đã mở, và việc rời mỏ
  hoàn toàn thì đặt lại về tầng 1.**

## Thay đổi ở reducer

- Intent mới: `player/attack { target }`, `player/descend`, `player/useElevator
  { depth }`, `player/exitMine`.
- `applyAct` khi trong tay là kiếm thì đánh; khi đứng trên thang thì xuống.
- `world/tick` chạy bước quái: đuổi, đánh, chết.
- `startNewDay` đổi `mineSeed`, đưa mọi người đang trong mỏ về nông trại, và hồi
  đầy `health` cùng `energy`.
- `isWalkable` đọc thêm `tiles` của tầng sinh ra, qua cùng đối tượng `Blockers` mà
  spec 10 đã gom lại.
- Sự kiện: `{ kind: 'damaged'; amount }`, `{ kind: 'monsterKilled'; kind; drops }`,
  `{ kind: 'descended'; depth }`, `{ kind: 'faint'; coinsLost }`,
  `{ kind: 'newDepthRecord'; depth }`.

`SAVE_VERSION` tăng. `worldSeed` sinh một lần khi tạo nông trại và **không bao giờ
đổi**; `deepestFloor` mặc định `0`; `health` mặc định `maxHealth`. Người chơi đang
ở `mine:*` lúc lưu thì được đặt lại về ô sinh trên nông trại khi tải — một tầng
không còn tồn tại sau khi hạt đổi.

## Client

- Bộ tile mỏ, ba biến thể theo dải độ sâu để tầng 35 không giống tầng 3.
- Thanh máu, chỉ hiện khi dưới mức đầy hoặc khi đang ở trong mỏ.
- Vung kiếm có hoạt ảnh và có khung dừng khi trúng. Đây là toàn bộ cảm giác của
  chiến đấu — không có nó thì đánh nhau như đi xuyên qua nhau.
- Quái nhấp nháy khi trúng, tan ra khi chết.
- Màn hình tối dần theo độ sâu, và đuốc (spec 11) thành ra có công dụng.
- Nhạc mỏ riêng, theo luật spec 02.

## Kiểm thử

- `generateFloor` là tất định: cùng hạt và độ sâu cho ra tầng giống hệt, và mọi
  tầng đều có đường đi được từ lối vào tới thang.
- Bảng quặng và bảng quái bám đúng dải độ sâu.
- Đánh trúng trừ đúng máu, và thời gian vô hiệu chặn được đòn thứ hai trong cùng
  một khoảnh khắc.
- Ngất: trừ đúng ví, kết thúc ngày của riêng người đó, và không đánh thức ba
  người còn lại.
- Xuống thang chỉ đưa người bấm xuống.
- Tầng trống được dọn, và quay lại sinh ra tầng giống hệt trong cùng một ngày.
- Đổi ngày đưa mọi người ra khỏi mỏ và đổi hạt.
- Bản lưu có người chơi ở `mine:7` thì tải về ô sinh trên nông trại.
- Máy khách gửi `attack` khi trong tay không phải kiếm thì bị bỏ qua.
- Máy khách gửi `useElevator` tới tầng sâu hơn `deepestFloor` thì bị từ chối.

## Ngoài phạm vi

Hang Đầu Lâu, bom, giáp và nhẫn, thuốc hồi phục, địa chất và đá quý lồng, bảo
tàng, kỹ năng chiến đấu lên cấp, và trùm có nhiều giai đoạn. Trùm tầng 40 nên là
một con quái to hơn, không phải một hệ thống riêng.
