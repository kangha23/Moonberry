# 11 — Chế tác, rương và đồ thủ công

**Phụ thuộc:** [10 — Thu thập tài nguyên](10-resources-and-tools.md) cho nguyên
liệu. Tốt hơn sau [09 — Vật nuôi](09-animals.md), vì sữa và trứng là đầu vào của
nửa số máy.

## Mục tiêu

Cho gỗ và đá một lý do tồn tại, cho cái kho một cái ruột, và cho tiền một đường
đi ngoài việc mua hạt giống.

## Vì sao

Ba vấn đề, một spec:

**Cái kho vẫn rỗng.** Spec 06 xếp kho là công trình nên xây đầu tiên vì nó "giải
quyết vấn đề người chơi đã có" — 24 ô chật. Nhưng kho không chứa được gì, vì game
không có rương. Đến giờ nó là công trình 1200g duy nhất có công dụng bằng không.

**Nông trại không có bậc thang thứ hai.** Spec 06 dựng cái ratchet đầu tiên: công
cụ tốt hơn, ngày rẻ hơn. Nhưng nó dừng ở đó. Bình tưới vàng là điểm cuối, và sau
đó mỗi ngày lại giống hệt nhau. Ống tưới tự động là bậc thang thứ hai, và nó khác
về chất: nó không làm việc tưới rẻ hơn, nó **xoá việc tưới**.

**Nông sản chỉ có một giá.** Bán quả bí 160g là toàn bộ chiều sâu kinh tế hiện
tại. Thùng ủ biến 160g thành 450g sau bảy ngày, và đó là lần đầu tiên người chơi
phải cân nhắc giữa tiền hôm nay và tiền tuần sau.

## Phần A — Công thức

**Công thức là dữ liệu**, cùng triết lý với `ITEMS` và `NpcDef`.

```ts
// src/game/systems/crafting.ts
export interface Recipe {
  /** Cũng là `ItemId` của thứ làm ra. */
  id: ItemId;
  /** Nguyên liệu và số lượng. */
  needs: Partial<Record<ItemId, number>>;
  /** Làm ra mấy cái. Thường là 1. */
  yields: number;
  /** Mở khoá bằng cách nào. Xem bên dưới. */
  unlock: RecipeUnlock;
}

export type RecipeUnlock =
  | { by: 'start' }
  | { by: 'buy'; cost: number }
  | { by: 'hearts'; npc: NpcId; hearts: number }
  | { by: 'day'; day: number };
```

**Mở khoá bằng trái tim là chỗ spec này trả nợ cho spec 07.** Quan hệ với NPC hiện
chỉ mua được lời thoại. Maeve đưa công thức máy ở 4 tim, Juniper đưa công thức đồ
hái ở 3 tim — đột nhiên việc tặng quà có giá trị cơ khí chứ không chỉ là văn bản.

Công thức đã mở khoá **thuộc về người chơi, không thuộc nông trại**, vì tim là của
người chơi. `PlayerState` thêm `knownRecipes: ItemId[]`.

**Chế tác không cần bàn thợ.** Mở hành trang, có tab chế tác, làm ngay. Bàn thợ là
một bước chân thừa trong một game mà việc đi bộ đã tốn thời gian thật.

### Danh mục khởi đầu

Khoảng 25 công thức là đủ, chia làm bốn nhóm:

| Nhóm | Ví dụ | Đổi cái gì |
| --- | --- | --- |
| Ruộng | Ống tưới, ống tưới chất lượng, bù nhìn, phân bón | Xoá việc lặp |
| Trữ | Rương, rương lớn | Xoá giới hạn 24 ô |
| Máy | Thùng ủ, lọ ngâm, máy vắt sữa, lò than | Nhân giá bán |
| Vặt | Đuốc, cổng, đường lát, mồi câu | Chất lượng sống |

**Ống tưới là công thức quan trọng nhất trong danh sách**, nên cân nó cẩn thận.
Ống tưới thường tưới 4 ô kề, cần 1 đồng thỏi + 1 đá — rẻ, nhưng đồng thì phải đào
(spec 13). Ống tưới chất lượng tưới 8 ô. Đó là thứ biến nông trại 40 ô từ một
buổi sáng thành một cú bấm.

## Phần B — Rương

Rương là thứ nhỏ nhất ở đây và là thứ được dùng nhiều nhất.

```ts
export interface Chest {
  id: string;
  area: AreaId;
  x: number;
  y: number;
  /** Đúng kiểu `Inventory` của spec 03, 36 ô. Dùng lại toàn bộ hàm sẵn có. */
  contents: Inventory;
}
```

**Rương dùng lại `Inventory` nguyên vẹn**, nên `addItem`, `moveStack`,
`splitStack` chạy được ngay không sửa gì. Đó là phần thưởng cho việc spec 03 đã
tách hành trang thành một mô-đun thuần.

**Rương là của chung.** Trong thế giới bốn người, rương riêng tư là cách nhanh
nhất biến một nông trại hợp tác thành bốn nông trại cạnh nhau.

Điều đó tạo ra một bài toán đồng thời thật: hai người cùng mở một rương và cùng
lấy chồng đồ đó. Server là trọng tài như mọi thứ khác — thao tác nào tới trước
thắng, người kia thấy rương cập nhật. Không khoá, không hàng đợi.

## Phần C — Máy chế biến

```ts
export interface Machine {
  id: string;
  kind: 'keg' | 'jar' | 'churn' | 'kiln';
  area: AreaId;
  x: number;
  y: number;
  /** Đang chế biến cái gì, và xong vào ngày nào. */
  job: { input: ItemId; output: ItemId; readyOnDay: number } | null;
}
```

**Máy đo bằng ngày, không đo bằng giờ.** Stardew đo bằng giờ và điều đó buộc người
chơi canh đồng hồ. Ở đây ngày đã là đơn vị của mọi thứ khác — cây lớn theo ngày,
thợ rèn tính theo ngày, công trình tính theo ngày — và đồng nhất đáng giá hơn độ
chính xác.

| Máy | Nhận | Ra | Ngày | Hệ số giá |
| --- | --- | --- | --- | --- |
| Thùng ủ | nông sản | rượu / bia | 7 | ×3.0 |
| Lọ ngâm | nông sản | mứt / dưa muối | 3 | ×2.2 |
| Máy vắt | sữa | phô mai / bơ | 2 | ×1.9 |
| Lò than | 10 gỗ | 1 than | 1 | — |

Tên vật phẩm ra lấy theo đầu vào: `wine-melon`, `jam-strawberry`. Sinh bằng hàm
chứ không gõ tay 13 × 2 dòng trong `ITEMS` — một `artisanItemFor(input, machine)`
dựng `ItemDef` tại chỗ lúc khởi tạo bảng.

`Machine` và `Chest` và `ResourceNode` và `Building` giờ là bốn danh sách vật thể
đặt trên bản đồ, cùng luật va chạm và cùng thứ tự vẽ. **Gom chúng về một khái niệm
`Placeable` chung** trước khi viết cái thứ tư, không phải sau.

## Thay đổi ở reducer

- Intent mới: `player/craft { recipe, count }`, `player/placeItem { item, x, y }`,
  `player/pickUpItem { x, y }`, `chest/moveStack { chestId, from, to, ... }`,
  `machine/load { machineId }`, `machine/collect { machineId }`.
- `applyAct` phân nhánh thêm: rương thì mở bảng, máy thì nạp hoặc thu.
- `startNewDay` hoàn thành máy tới hạn, và tưới các ô trong tầm ống tưới **trước**
  bước tăng trưởng — thứ tự này là cả điểm của ống tưới.
- `PanelId` thêm `'chest'` và `'crafting'`. Rương gắn với vị trí như quầy chợ, nên
  đi xa là bảng tự đóng; tab chế tác thì không.
- Sự kiện: `{ kind: 'crafted' }`, `{ kind: 'machineLoaded' }`,
  `{ kind: 'machineReady' }`, `{ kind: 'recipeLearned'; recipe; from }`.

`SAVE_VERSION` tăng. `chests`, `machines`, `sprinklers` mặc định `[]`;
`knownRecipes` mặc định là các công thức `{ by: 'start' }`.

Lưu ý về kích thước bản lưu: bốn cái rương đầy là 144 ô trong JSON. Bản lưu sẽ
phình nhanh, và `persistence.ts` phải kiểm tra từng ô như nó đang kiểm tra hành
trang. Ô rương không hợp lệ thì bỏ ô đó, **không** vứt cả bản lưu — mất một chồng
đồ nhẹ hơn mất cả nông trại.

## Client

- Tab chế tác trong `InventoryScreen.tsx`: lưới công thức, tô xám cái thiếu
  nguyên liệu, hiện cái còn thiếu.
- Bảng rương: hai lưới cạnh nhau, kéo thả qua lại, nút "dồn hết vào".
- Chế độ đặt vật phẩm, dùng lại đúng khuôn đặt công trình của spec 06.
- Máy có sprite ba trạng thái: rỗng, đang chạy, xong. Trạng thái xong phải nhìn
  thấy từ xa — một cái bong bóng nổi lên trên đầu.

## Kiểm thử

- Chế tác trừ đúng nguyên liệu và bị từ chối khi thiếu, khi hành trang đầy, và
  khi công thức chưa mở khoá.
- Tim đủ ngưỡng thì học được công thức, và học đúng một lần.
- Công thức đã học là của riêng người chơi: người thứ hai không có nó.
- Ống tưới tưới đúng hình của nó vào sáng hôm sau, và tưới trước bước lớn.
- Ống tưới không tưới ô chưa cày, và không tưới sang bản đồ khác.
- Máy từ chối đầu vào sai, và từ chối khi đang chạy.
- Hai người cùng lấy một chồng đồ trong rương: tổng số không tự nhân đôi.
- Rương và máy sống sót qua lưu, khởi động lại và vào lại.
- Bản lưu có một ô rương hỏng: ô đó bị bỏ, phần còn lại nguyên vẹn.

## Ngoài phạm vi

Nấu ăn và hiệu ứng buff — nó cần nhà bếp, cần nâng cấp nhà, và cần một hệ thống
buff mà game chưa có. Đáng làm, nhưng là spec riêng. Ngoài ra: thùng gỗ ủ lâu,
máy làm mayonnaise từ trứng hạng, tháp obelisk, trang trí và đặt đồ nội thất.
