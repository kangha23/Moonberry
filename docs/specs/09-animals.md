# 09 — Vật nuôi

**Phụ thuộc:** [03 — Ô hành trang](03-inventory-slots.md), [06 — Công cụ và công
trình](06-tools-and-buildings.md) cho chuồng gà và chuồng bò.
**Tốt hơn nhiều sau** [10 — Thu thập tài nguyên](10-resources-and-tools.md), vì
liềm và cỏ là nguồn cỏ khô thật sự.

## Mục tiêu

Biến chuồng gà và chuồng bò từ cái vỏ rỗng thành thứ đáng 3400g và 5600g.

## Vì sao

Spec 06 đã nói thẳng điều này và đã tự định giá theo nó: *"một chuồng gà không có
gà chỉ là cái kho có mái đẹp hơn."* Người chơi bỏ ra 5600g để dựng chuồng bò và
nhận lại đúng một vật cản đi đường.

Ngoài ra vật nuôi vá một lỗ hổng trong vòng lặp kinh tế. Hiện tại thu nhập chỉ
đến từ cây trồng, nghĩa là mùa Đông là một tháng chết: không trồng được gì ngoài
hai loại cây, không có lý do gì để dậy sớm. Gà vẫn đẻ trứng vào tháng Chạp. Một
nguồn thu không phụ thuộc mùa là thứ khiến lịch có nhịp thay vì có một vực sâu.

## Vật nuôi sống ở đâu trong state

**Thuộc về nông trại, không thuộc về người chơi.** Con bò ăn cỏ trên đất chung và
được ai cũng vắt sữa được. Đây là điểm khác với `relationships` ở spec 07: tình
bạn là giữa hai người, còn con bò là tài sản của nông trại.

```ts
// src/game/systems/animals.ts
export type AnimalKind = 'chicken' | 'duck' | 'cow' | 'goat';

export interface Animal {
  id: string;
  kind: AnimalKind;
  /** Người chơi đặt khi mua. Chỉ để hiển thị, không mang luật nào. */
  name: string;
  /** Công trình nó thuộc về, theo `Building['id']`. */
  home: string;
  /** Ngày nó được mua, để tính tuổi. */
  bornOnDay: number;
  /**
   * 0–1000. Quyết định sản phẩm ra hạng nào và có ra hay không.
   * Một số của nông trại, không phải của người chơi.
   */
  affection: number;
  /** Đã được vuốt hôm nay chưa. Xoá mỗi sáng. */
  pettedToday: boolean;
  /** Đã ăn hôm nay chưa. Quyết định sáng mai có sản phẩm không. */
  fedToday: boolean;
  /** Ngày sớm nhất nó cho sản phẩm tiếp theo. */
  produceOnDay: number;
  /** Đang đứng đâu, khi nó ở ngoài trời. Null nghĩa là đang trong chuồng. */
  position: { x: number; y: number } | null;
}

interface FarmState {
  // ...
  animals: Animal[];
  /** Cỏ khô trong silo. Không phải vật phẩm trong hành trang — xem bên dưới. */
  hay: number;
}
```

**Cỏ khô không nằm trong hành trang.** Đây là quyết định không hiển nhiên nên nói
rõ: nếu cỏ khô là `ItemStack` thì cho mười con bò ăn là mười lần mở hành trang, và
24 ô sẽ bị một chồng cỏ chiếm chỗ vĩnh viễn. Silo là một con số trên `FarmState`,
và cho ăn rút từ đó. Sức chứa silo là `240 × số silo đã dựng`; không có silo thì
không trữ được cỏ, chỉ mua được từng ngày ở quầy chợ.

## Vòng lặp một ngày

Bốn việc, và chỉ bốn:

1. **Cho ăn.** Một lần mỗi con mỗi ngày, trừ vào `hay`. Tự động nếu chuồng có máng
   — tức là nếu silo còn cỏ, `startNewDay` tự trừ và đặt `fedToday`. Thủ công chỉ
   xảy ra khi silo cạn.
2. **Vuốt.** `act` vào con vật, một lần một ngày, `+15` affection. Đây là việc tốn
   thời gian chứ không tốn năng lượng — nó cạnh tranh với việc tưới nước ở đồng
   hồ, không ở thanh sức.
3. **Thu sản phẩm.** `act` vào con vật khi `produceOnDay <= day`. Trứng vào hành
   trang như vật phẩm bình thường.
4. **Thả ra / lùa vào.** Cửa chuồng mở thì ban ngày chúng đi ra ngoài, tự về lúc
   18h. Ra ngoài được `+8` affection mỗi ngày, trừ khi trời mưa.

**Không cho ăn không giết con vật.** Nó chỉ mất `-20` affection và không cho sản
phẩm hôm sau. Vật nuôi chết vì bỏ bê là cơ chế trừng phạt người chơi nghỉ một tuần
rồi quay lại, và trong thế giới nhiều người chơi thì người chịu phạt thường không
phải người gây ra.

## Sản phẩm

| Loài | Giá mua | Chu kỳ | Sản phẩm | Giá bán |
| --- | --- | --- | --- | --- |
| Gà | 800 | mỗi ngày | Trứng | 55 |
| Vịt | 1600 | 2 ngày | Trứng vịt | 130 |
| Bò | 2400 | mỗi ngày | Sữa | 140 |
| Dê | 5000 | 2 ngày | Sữa dê | 250 |

Chuồng gà chứa gà và vịt, tối đa 8 con. Chuồng bò chứa bò và dê, tối đa 6 con.

**Hạng sản phẩm gắn với affection**, và đây là chỗ chăm sóc trả công:

| Affection | Hạng | Hệ số giá |
| --- | --- | --- |
| < 200 | — | không ra sản phẩm |
| 200–599 | Thường | ×1.0 |
| 600–849 | Tốt | ×1.25 |
| ≥ 850 | Thượng hạng | ×1.5 |

Hạng là một hậu tố trên `ItemId` (`egg`, `egg-good`, `egg-fine`) chứ không phải
một trường mới trên `ItemStack`. Lý do: `ItemStack` hiện chỉ có `item` và `count`,
và thêm trường chất lượng sẽ lan vào `addItem`, `moveStack`, `splitStack`, việc
bán và cả bảng quà tặng. Ba `ItemDef` rẻ hơn một trường mới xuyên hệ thống.

Quyết định này có hệ quả: nếu spec 11 muốn cây trồng cũng có hạng, nó sẽ phải
theo cùng cách hoặc làm lại cả hai. Ghi ở đây để sau này không ai phải đoán.

## Mua bán vật nuôi

**Một NPC mới: người bán gia súc.** Villager thứ sáu, dựng theo đúng khuôn spec 07
— một file trong `src/game/npcs/villagers/`, có lịch trình, bảng quà và lời thoại.
Không cần chạm vào reducer, đúng như lời hứa của spec 07.

Prop trên bản đồ làng mang `interact: 'rancher'`, mở `PanelId` mới là `'ranch'`.
Mua một con vật là chọn loài, chọn chuồng và đặt tên; server kiểm tra ví, kiểm tra
chuồng đã xây xong và còn chỗ.

Bán lại con vật ở cùng bảng đó, được nửa giá mua. Nghe tàn nhẫn nhưng cần thiết:
không có đường ra thì một chuồng đầy gà là một quyết định vĩnh viễn.

## Vật nuôi đi lại

Đây là phần việc thật sự, và nó không giống NPC.

NPC đi theo lịch trình có đích rõ ràng (`schedule.ts`). Con vật thì đi lang thang:
mỗi vài giây chọn một ô trống gần đó và bò tới. Điều đó nghĩa là **cần một hàm
ngẫu nhiên tất định** — reducer thuần, không được gọi `Math.random()`.

```ts
/**
 * Hạt giống lấy từ id con vật và số phút trong ngày, nên hai máy khách mô phỏng
 * ra cùng một đàn mà không cần đồng bộ từng bước đi.
 */
function wanderTarget(animal: Animal, totalMinutes: number): Point;
```

Cách rẻ hơn và nên làm trước: server mô phỏng đàn trong `world/tick` giống hệt
`npcs`, và vị trí đi ra theo khung vị trí mỗi tick. Đàn vật nuôi cùng lắm 14 con,
nhỏ hơn chi phí đã trả cho NPC.

## Thay đổi ở reducer

- Intent mới: `player/petAnimal { animalId }`, `player/collectProduce { animalId }`,
  `player/buyAnimal { kind, home, name }`, `player/sellAnimal { animalId }`,
  `player/feedAnimal { animalId }`, `animals/toggleDoor { buildingId }`.
- `applyAct` nhận diện ô có con vật đứng trước khi nhận diện ô đất: vuốt nếu chưa
  vuốt hôm nay, thu sản phẩm nếu có sản phẩm, và ưu tiên thu sản phẩm.
- `startNewDay`: trừ cỏ khô và đặt `fedToday`, cộng affection cho con được vuốt và
  trừ cho con bị bỏ đói, đặt `produceOnDay` cho con đã đủ điều kiện, xoá
  `pettedToday`.
- `world/tick` gọi thêm bước đi lang thang, cùng chỗ với `npcTick`.
- Sự kiện: `{ kind: 'animalPetted' }`, `{ kind: 'produceCollected'; item; grade }`,
  `{ kind: 'animalBought' }`, `{ kind: 'animalHungry'; count }` cho bản tóm tắt sáng.

`SAVE_VERSION` tăng. `animals` mặc định `[]` và `hay` mặc định `0` khi migrate.

## Client

- Sprite vật nuôi với vòng đi bốn hướng. LPC có bộ gia súc CC0, cùng giấy phép với
  những gì đã có trong `public/assets/lpc/CREDITS.md`.
- Trái tim nhỏ hiện lên khi vuốt; dấu chấm than trên đầu con chưa được ăn.
- Bảng trại gia súc, dựng theo khuôn `ShopPanel.tsx`.
- Vật nuôi tham gia vào thứ tự vẽ theo hàng, giống công trình — đi sau lưng và
  trước mặt con bò phải đúng.
- Âm thanh theo sự kiện, đúng luật spec 02.

## Kiểm thử

- Con vật được cho ăn và affection đủ ngưỡng thì sáng hôm sau có sản phẩm; con bị
  bỏ đói thì không.
- Vuốt lần thứ hai trong ngày bị từ chối, và không cộng affection.
- Hạng sản phẩm bám đúng bảng ngưỡng, ở cả ba biên.
- Mua vật nuôi bị từ chối khi: ví thiếu, chuồng chưa xây xong, chuồng đầy, chuồng
  sai loài.
- Cỏ khô không vượt sức chứa silo, và mua cỏ khi không có silo thì thất bại.
- Hai người chơi cùng thu sản phẩm một con vật: chỉ một người nhận được.
- Đàn vật nuôi sống sót qua lưu, qua khởi động lại server và qua việc vào lại.
- Bước đi lang thang là tất định: cùng state và cùng `totalMinutes` cho ra cùng
  vị trí.

## Ngoài phạm vi

Ấp trứng, ấp máy, cắt lông cừu, đồ thủ công từ sữa (thuộc spec 11), nội thất
chuồng trại, chó mèo trong nhà, ngựa và thú cưng.
