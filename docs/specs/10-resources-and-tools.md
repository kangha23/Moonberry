# 10 — Thu thập tài nguyên, và ba công cụ còn thiếu

**Phụ thuộc:** [03 — Ô hành trang](03-inventory-slots.md),
[06 — Công cụ và công trình](06-tools-and-buildings.md) cho bậc công cụ.

## Mục tiêu

Cho người chơi một cách kiếm gỗ và đá, thay vì phát 5 khúc gỗ lúc bắt đầu rồi
thôi.

## Vì sao

Đây là spec nhỏ nhất trong năm cái còn lại và là cái mở khoá nhiều nhất.

Hiện tại `wood` tồn tại như một `ItemDef` và cách duy nhất có nó là năm khúc gỗ
phát lúc tạo hành trang ([`inventory.ts:53`](../../src/game/systems/inventory.ts)).
Không có cách nào kiếm thêm. Điều đó nghĩa là chế tác (spec 11) không có nguyên
liệu, mỏ (spec 13) không có lý do tồn tại, và cái rìu — công cụ mà mọi người chơi
game nông trại đều đưa tay tìm trong mười phút đầu — không có trong game.

Nó cũng vá một điểm chết khác: **nông trại không có gì để dọn.** Ruộng bắt đầu ở
trạng thái sạch trơn, nên không có cảm giác khai phá. Stardew cho người chơi một
mảnh đất mọc đầy cỏ dại và nửa niềm vui của tuần đầu là nhìn nó lộ ra.

## Ba công cụ mới

`Tool` mở rộng từ `'hoe' | 'can' | 'basket'` thành:

```ts
export type Tool = 'hoe' | 'can' | 'basket' | 'axe' | 'pickaxe' | 'scythe';
```

Cả ba đi qua đúng bộ máy bậc công cụ của spec 06 — cùng `TIERS`, cùng thợ rèn,
cùng `pendingUpgrade`. Không có luật mới nào ở đây, và đó là lý do phần này rẻ.

| Công cụ | Làm gì | Bậc mua lại gì |
| --- | --- | --- |
| Rìu | Chặt cây, gốc cây, cành khô | Cây to hơn, ít nhát hơn |
| Cuốc chim | Đập đá, quặng, dọn ô | Đá cứng hơn, ít nhát hơn |
| Liềm | Cắt cỏ dại và cỏ | Cắt cả vùng, không tốn năng lượng |

**Liềm không tốn năng lượng**, giống việc thu hoạch. Cắt cỏ là việc vặt; tính phí
cho nó chỉ làm ngày ngắn đi mà không thêm quyết định nào.

**Liềm không lên bậc ở thợ rèn.** Nó chỉ có hai bậc: liềm thường và lưỡi hái vàng
mua thẳng ở quầy chợ với giá 4000g. Lý do là bậc công cụ ở spec 06 gắn với năng
lượng, mà liềm thì không tốn năng lượng, nên ba bậc giữa không mua được gì.

## Nút tài nguyên

**Nút tài nguyên là state của thế giới, không phải prop trên bản đồ Tiled.** Đây
đúng bài học spec 06 đã rút ra với công trình: `maps/*.json` là tĩnh và giống nhau
ở mọi thế giới, còn một gốc cây đã bị chặt thì không.

```ts
// src/game/systems/resources.ts
export type NodeKind =
  | 'tree'      // chặt được, có mùa, mọc lại
  | 'stump'     // gốc lớn, cần rìu đồng
  | 'rock'      // đá, ra đá
  | 'boulder'   // tảng lớn, cần cuốc chim thép
  | 'weed'      // cỏ dại, ra sợi
  | 'grass'     // cỏ, ra cỏ khô khi cắt bằng liềm
  | 'forage';   // đồ hái theo mùa

export interface ResourceNode {
  id: string;
  kind: NodeKind;
  area: AreaId;
  x: number;
  y: number;
  /** Số nhát còn lại. 0 là đã đổ. */
  health: number;
  /** Bậc công cụ tối thiểu mới đụng được. */
  requires: ToolTier;
  /** Với cây: 0–4, giai đoạn lớn. Null với thứ không lớn. */
  stage: number | null;
  /** Với `forage`: nó ra cái gì. */
  item: ItemId | null;
}

interface FarmState {
  // ...
  nodes: ResourceNode[];
  /** Hạt sinh nút mỗi đêm. Tất định, nên hai máy khách thấy cùng một buổi sáng. */
  spawnSeed: number;
}
```

**Nút chặn đường**, nghĩa là `isWalkable` lại phải nhận thêm một tham số nữa. Spec
06 đã mở đường này khi truyền `buildings` vào; lần này gom cả hai thành một đối
tượng `Blockers` thay vì thêm tham số thứ năm — nếu không thì spec 13 sẽ thêm tham
số thứ sáu.

## Sinh và mọc lại

**Mỗi đêm `startNewDay` sinh thêm nút**, tất định từ `spawnSeed`:

- Cỏ lan ra từ cỏ sẵn có, tối đa 1 ô mỗi đám, dừng ở 60 đám trên nông trại.
- Cỏ dại mọc trên ô trống chưa cày, nhiều hơn vào mùa Xuân.
- Cây con mọc từ hạt rơi quanh cây trưởng thành, xác suất thấp.
- Đồ hái mọc lại ở làng, theo mùa, xoá hết vào sáng ngày đầu mỗi mùa.
- Đá **không** mọc lại trên nông trại. Đá đến từ mỏ (spec 13), và một nông trại tự
  sinh đá vô hạn sẽ làm spec 13 vô nghĩa trước khi nó ra đời.

Vào sáng ngày đầu mùa Đông, cỏ chết hết. Đó là lý do có silo, và là lý do spec 09
đáng làm sau spec này.

## Tài nguyên ra gì

| Nút | Ra | Giá bán |
| --- | --- | --- |
| Cây | 8–12 gỗ, đôi khi nhựa cây | gỗ 4 |
| Gốc cây | 20 gỗ cứng | 30 |
| Đá | 1–2 đá | 3 |
| Tảng đá | 5 đá, đôi khi than | 3 |
| Cỏ dại | 1 sợi | 2 |
| Cỏ | 1 cỏ khô vào silo | — |
| Đồ hái | xem bảng mùa bên dưới | 40–160 |

**Đồ hái theo mùa** là 12 vật phẩm mới, ba mỗi mùa, và chúng là thứ khiến việc đi
bộ sang làng có lý do thứ hai. Chúng cũng là quà tặng tốt — bảng quà ở spec 07 có
chỗ cho chúng mà không phải sửa gì.

| Mùa | Đồ hái |
| --- | --- |
| Xuân | Hành rừng, thuỷ tiên, rau dại |
| Hạ | Anh túc, nho rừng, mao lương |
| Thu | Nấm tím, cúc dại, hạt dẻ |
| Đông | Rễ đông, cải tuyết, thạch anh |

Juniper là người hái lượm ([`juniper.ts`](../../src/game/npcs/villagers/juniper.ts))
và hiện tại cô ấy nói về việc đó mà không làm được. Đây là spec khiến lời thoại
của cô ấy thành sự thật.

## Năng lượng, và vì sao nó quan trọng ở đây

Chặt cây tốn `4` năng lượng một nhát, đập đá tốn `3`. Nghe nhỏ, nhưng một cái cây
là 5 nhát và một buổi sáng dọn đất là hết nửa thanh sức.

Đây là lần đầu tiên người chơi phải **chọn giữa hai việc đều đúng**: dọn đất hay
tưới ruộng. Spec 01 tạo ra ngân sách; spec này là thứ đầu tiên tiêu ngân sách đó
vào một việc không phải trồng trọt. Cân số sao cho một ngày làm được một trong hai
chứ không phải cả hai.

## Thay đổi ở reducer

- `actionForSlot` mở rộng cho ba `Tool` mới, và `applyAct` phân nhánh theo nút
  đứng trên ô trước khi phân nhánh theo `PlotState`.
- Một nhát trúng nút: trừ `health`, trừ năng lượng, và khi `health` về 0 thì cho
  vật phẩm rơi vào hành trang — **từ chối nhát cuối nếu hành trang đầy**, chứ
  không làm rơi ra đất. Vật phẩm rơi trên đất là một hệ thống riêng và không đáng
  có ở đây.
- Công cụ có vùng ảnh hưởng vẫn dùng `areaOfEffectTiles`; một nhát rìu thép chạm
  nhiều cây tính năng lượng theo từng cây thật sự chạm.
- `startNewDay` chạy bước sinh nút, sau bước mùa vụ và trước bước tóm tắt.
- Sự kiện: `{ kind: 'nodeHit'; id; kind }`, `{ kind: 'nodeCleared'; id; drops }`,
  `{ kind: 'toolTooWeak'; requires }` — cái cuối là quan trọng, vì "đập mãi không
  vỡ" mà không nói gì là lỗi giao diện chứ không phải thử thách.

`SAVE_VERSION` tăng. `nodes` mặc định `[]` và `spawnSeed` mặc định một hằng số khi
migrate — **không** mặc định rỗng rồi sinh lại, vì thế sẽ rải đá lên ruộng đang
trồng của người chơi cũ.

## Bản đồ

Nông trại 40×30 hiện tại quá gọn cho việc này. Hai lựa chọn, và spec này chọn cái
thứ hai:

1. Rải nút lên ruộng hiện có — rẻ, nhưng ruộng thành ra chật.
2. **Thêm một khu rừng**, bản đồ thứ ba, nối với nông trại bằng một cửa. Cây, gốc,
   đồ hái và một cái ao ở đó. Chỉ là một file Tiled và một dòng trong
   `AREA_IDS`, và spec 12 sẽ cần cái ao đó.

## Client

- Sprite cây bốn giai đoạn, đá, cỏ, cỏ dại. `createPixelArtTextures.ts` đã có sẵn
  khuôn để sinh tạm.
- Hiệu ứng rung khi trúng, vỡ khi đổ, và mảnh văng.
- Nút vào thứ tự vẽ theo hàng như công trình và vật nuôi.
- Con trỏ báo trước khi công cụ quá yếu, thay vì để người chơi đập mười nhát.

## Kiểm thử

- Rìu thường không hạ được gốc cây; rìu đồng thì được.
- Nhát cuối bị từ chối khi hành trang đầy, và nút vẫn còn nguyên `health` là 1.
- Liềm cắt cỏ đưa cỏ khô vào silo, và không đưa gì vào hành trang.
- Cắt cỏ khi silo đầy thì cỏ vẫn mất — và có thông báo nói vì sao.
- Sinh nút là tất định: cùng `spawnSeed` và cùng state cho ra cùng buổi sáng.
- Cỏ chết sạch vào ngày đầu mùa Đông.
- Nút không bao giờ sinh lên ô đã cày, lên công trình, lên cửa hay lên ô sinh.
- Đồ hái đổi theo mùa và bị xoá ở ranh giới mùa.
- Nút chặn đường đi, ở cả client lẫn đường di chuyển của server.

## Ngoài phạm vi

Cây ăn quả trồng được, chích nhựa cây, cây trong chậu, bón phân, và mọi thứ dùng
tới gỗ đá — đó là [spec 11](11-crafting.md).
