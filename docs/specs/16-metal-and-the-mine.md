# 16 — Kim loại có chỗ dùng

**Phụ thuộc:** [13 — Mỏ và chiến đấu](13-mine-and-combat.md) cho tầng mỏ và kiếm,
[10 — Thu thập tài nguyên](10-resources-and-tools.md) cho `ResourceNode` và cuốc
chim, [11 — Chế tác](11-crafting.md) cho máy và công thức,
[06 — Công cụ và công trình](06-tools-and-buildings.md) cho lò rèn.

## Mục tiêu

Xuống mỏ mang về được thứ gì đó, và thứ đó là cách duy nhất để công cụ tốt lên.

## Vì sao

Spec 13 hứa mỏ là "nơi kim loại đến từ". Trong code hiện tại, chuỗi mỏ → kim
loại → công cụ đứt ở ba chỗ, và mỗi chỗ đứt đủ để cả chuỗi không chạy:

1. **Quặng không đào được.** `generateFloor` sinh `ores` cho mỗi tầng (9–24
   mạch), nhưng không chỗ nào trong reducer hay scene đọc trường đó: không vẽ,
   không cuốc. Nguồn quặng duy nhất là quái rơi đồ.
2. **Không ai có kiếm.** `rusty-sword` chỉ xuất hiện trong test: không nằm trong
   bộ đồ khởi đầu, không bán, không rơi. Nên nguồn quặng duy nhất ở trên cũng
   không với tới được.
3. **Không có cách nấu quặng.** `copper-bar` có trong bảng vật phẩm, nhưng lò than
   chỉ đốt gỗ ra than. Công thức `quality-sprinkler` cần đồng thỏi và vì thế
   không chế được.

Và kể cả khi ba chỗ đó liền lại, kim loại vẫn không có việc để làm: thợ rèn nâng
công cụ chỉ lấy vàng (500 / 1800 / 5000g), nên mỏ là một cách kiếm tiền chậm hơn
và rủi ro hơn bán dưa.

Spec này nối cả ba chỗ đứt, rồi cho kim loại một chỗ dùng không thay thế được.

## Vòng lặp

```
cuốc chim ──► mạch quặng (mỏ) ──► quặng ──┐
kiếm ──► quái ──► quặng (rơi) ────────────┤
lò than / mỏ ──► than ────────────────────┤
                                          ▼
                              Lò nấu (5 quặng + 1 than, qua đêm)
                                          ▼
                                         thỏi
                         ┌────────────────┴────────────────┐
             thợ rèn: nâng công cụ               chế kiếm (mở theo độ sâu)
                         │                                 │
             cuốc chim tốt hơn ──► quặng sâu hơn ◄── kiếm tốt hơn ──► xuống sâu hơn
```

Hai cái thang tự nối vào nhau: cuốc đồng cần đồng thỏi từ tầng 1–9, và chính
cuốc đồng mở ra quặng sắt ở tầng 10+. Kiếm đồng mở ở tầng 10, và là thứ làm
tầng 10–19 đi được thoải mái.

## Mạch quặng là `ResourceNode`

Không thêm hệ thống. Comment trên `ResourceNode.requires` đã đoán trước đúng
chỗ này: một loại node, độ cứng lưu theo từng node.

- `NodeKind` thêm **một** loại: `'ore'`. Trường `item` (đang chỉ dùng cho
  `forage`) mang loại quặng: `stone | coal | copper-ore | iron-ore | gold-ore |
  gem`. Doc của `item` đổi thành "với `forage` và `ore`: nó là gì".
- `NODE_DEFS.ore`: `tool: 'pickaxe'`, `health: 3`, `energy: 3`, **`solid:
  false`**. Không đặc vì hành lang mỏ chỉ rộng hai ô và quái đi thẳng không tìm
  đường: một mạch quặng đặc có thể chặn lối tới thang, và không có gì trong
  `generateFloor` đảm bảo điều ngược lại.
- Độ cứng theo loại quặng, ghi vào `requires` lúc sinh:

  | Quặng | `requires` |
  | --- | --- |
  | đá, than, quặng đồng, ngọc | `basic` |
  | quặng sắt | `copper` |
  | quặng vàng | `steel` |

  Câu từ chối của `checkTool` nói tên bậc cần: "Quặng sắt cần cuốc chim đồng."
- Sản lượng: 1–3 món đúng loại `item`, tất định theo hạt, id node và ngày
  qua `yieldOf(node, day, mineSeed)` như mọi node khác. Ngọc luôn ra đúng 1.

### Vòng đời: như quái

Node mỏ nằm trong `state.nodes` với `area: 'mine:N'`, và sống đúng vòng đời mà
`reconcileMonsters` đã định cho quái:

- Tầng vừa có người đầu tiên → sinh node từ `floorFor(mineSeed, depth).ores`,
  id dạng `mine:N:ore:i`.
- Tầng vừa hết người → xoá mọi node có `area` là tầng đó.

Hàm đổi tên thành `reconcileFloors` và lo cả hai danh sách, vì hai vòng đời phải
là một: một tầng có quái mới mà quặng cũ là một tầng không tồn tại trong bất kỳ
hạt giống nào.

**Chấp nhận:** rời tầng rồi quay lại thì quặng mọc lại. Spec 13 đã chọn điều này
cho quái; đồng hồ và sức lực là giới hạn. Không đổi luật thang máy.

`startNewDay` đã đưa mọi người khỏi mỏ, nên sau đổi ngày không còn tầng nào có
người, và `reconcileFloors` xoá sạch node mỏ.

### Cuốc trong mỏ

`applyAct` dưới mỏ hiện chỉ có hai nhánh: kiếm thì đánh, đứng trên thang thì
xuống. Thêm luật: **cầm công cụ không phải kiếm thì đi tiếp xuống luồng node
thường** (`workNodes`), với đúng tầm với và quét hình chữ nhật như trên mặt đất.
Thứ tự: kiếm → thang → node.

`seedNodes` và `startNodeDay` bỏ qua `mine:*`: đất trong mỏ không mọc lại qua
đêm, nó được sinh lại.

## Lò nấu

Một máy mới, `furnace`, trong `MACHINE_DEFS`.

| | |
| --- | --- |
| Công thức | 25 đá + 10 quặng đồng · `unlock: { by: 'start' }` |
| Nhận | 5 quặng cùng loại, **và** 1 than làm nhiên liệu |
| Thời gian | 1 buổi sáng |
| Ra | quặng đồng → đồng thỏi · quặng sắt → sắt thỏi · quặng vàng → vàng thỏi |

Mở từ đầu vì không có quặng thì cũng không chế được: công thức tự khoá bằng
nguyên liệu, không cần thêm điều kiện.

### `MachineDef` đổi dạng

`burns: { input, output }` chỉ chở được một đầu vào — đủ cho lò than, không đủ
cho lò nấu. Đổi thành:

```ts
/**
 * A machine whose output is a plain material rather than an artisan good:
 * which input becomes which output. The kiln has one row, the furnace three.
 */
converts?: Partial<Record<ItemId, ItemId>>;
/** Consumed alongside `intake` of the input, or absent for no fuel. */
fuel?: { item: ItemId; count: number };
```

- `kiln`: `converts: { wood: 'coal' }`, `intake: 10`, không `fuel`.
- `furnace`: `converts: { 'copper-ore': 'copper-bar', 'iron-ore': 'iron-bar',
  'gold-ore': 'gold-bar' }`, `intake: 5`, `fuel: { item: 'coal', count: 1 }`.

`outputFor` đọc `converts` trước `artisanOutputFor`. Nạp máy là **tất cả hoặc
không**: thiếu quặng, thiếu than hay túi không có đủ thì từ chối và túi nguyên
vẹn. Câu từ chối của lò nấu: "Lò nấu cần 5 quặng cùng loại và 1 than."

Không có nhánh `if (kind === 'furnace')` nào ngoài bảng.

### Thỏi

| Thỏi | Giá bán | |
| --- | --- | --- |
| `copper-bar` | **90g** (đang 120g) | Blurb cũ "chưa có cái mỏ nào để đào" viết lại |
| `iron-bar` | 150g | mới |
| `gold-bar` | 300g | mới |

Đồng thỏi hạ giá để nấu rồi bán không thành máy in tiền: 5 quặng đồng (25g) +
1 than (50g) = 75g đầu vào. Thỏi là vật liệu (`MATERIALS`), không có `produce`,
nên sạp chợ không quét mất.

## Thợ rèn lấy thỏi

`TierDef` thêm `bars: { item: ItemId; count: number } | null`, và giá vàng giảm:

| Bậc | Hiện tại | Mới |
| --- | --- | --- |
| Đồng | 500g | **3 đồng thỏi + 250g** |
| Thép | 1800g | **3 sắt thỏi + 1000g** |
| Vàng | 5000g | **3 vàng thỏi + 2500g** |

**Ba thỏi chứ không năm**, vì công cụ tính theo từng người: sáu món nâng được
(cuốc, bình tưới, giỏ, rìu, cuốc chim, cần câu), nên một bậc cho một người là 18
thỏi, tức 90 quặng — khoảng 6–10 tầng. Năm thỏi là 150 quặng mỗi người mỗi bậc,
và bốn người co-op sẽ biến mỏ thành việc cày.

- `upgradeFor` trả thêm `bars`.
- `applyUpgradeTool` kiểm tra theo thứ tự: đứng ở lò rèn → đe rảnh → công cụ có
  bậc trên → mang theo công cụ → **đủ thỏi** → đủ vàng. Thiếu bất kỳ thứ gì thì
  từ chối và không mất gì. Đủ thì trừ công cụ, thỏi và vàng cùng một lúc.
- Câu từ chối khi thiếu thỏi: "Lên đồng cần 3 đồng thỏi, bạn mới có 1."
- `pendingUpgrade` không đổi hình dạng: một công cụ đang chờ lúc cập nhật vẫn
  về đúng hạn, không bị đòi thỏi hồi tố.

Liềm không đổi: hai bậc, lưỡi hái vàng vẫn mua ở sạp chợ. Cần câu mua 500g rồi
leo cùng cái thang mới như mọi công cụ khác.

## Kiếm

Ba thanh mới trong `WEAPON_ROWS`, cùng dạng `rusty-sword`:

| Kiếm | `damage` | Có được | Đánh mấy nhát |
| --- | --- | --- | --- |
| `rusty-sword` | 10 | Nhận khi xuống mỏ mà chưa có kiếm | Sên xanh (30): 3 |
| `copper-sword` | 20 | Chế: 3 đồng thỏi + 5 gỗ · mở ở tầng 10 | Dơi (35): 2 · Bọ đá (60): 3 |
| `steel-sword` | 35 | Chế: 3 sắt thỏi + 5 gỗ cứng · mở ở tầng 20 | Ma (80): 3 |
| `gold-sword` | 60 | Chế: 3 vàng thỏi + 5 gỗ cứng · mở ở tầng 30 | Boss (400): 7 |

Giá bán cả bốn là 0g, như mọi công cụ: nhận lại kiếm gỉ sau khi vứt đi không
mua được gì.

### Kiếm gỉ ở cửa mỏ

Trong `arrive` (`rules/mine.ts`), trước khi đặt người chơi xuống tầng: nếu túi
không có món nào `tool === 'sword'` thì thêm `rusty-sword`, kèm câu "Có người để
lại một thanh kiếm gỉ ở cửa mỏ." Túi đầy thì vẫn xuống, kèm câu "Có một thanh
kiếm gỉ ở cửa mỏ, mà túi bạn hết chỗ."

Đặt ở `arrive` chứ không ở bộ đồ khởi đầu: thanh nhanh ngày đầu đã có sáu công
cụ, và một thanh kiếm chưa có gì để chém là biểu tượng thứ bảy không ai đọc. Và
vì nó chạy mỗi lần xuống, bản lưu cũ tự có kiếm mà không cần migrate.

### Mở khoá theo độ sâu

`RecipeUnlock` thêm `{ by: 'depth'; depth: number }`. `UnlockContext` thêm
`deepestFloor`, đọc từ `state.deepestFloor`.

**Độ sâu là của nông trại, không của người.** Một người xuống tầng 20 thì cả
nhóm học công thức kiếm thép sáng hôm sau — khác với trái tim, vì trái tim là
chuyện giữa hai người, còn "đã có người xuống tới đó" là chuyện của cả nhóm.

Công thức mới học ngay trong `arrive` khi `deepestFloor` tăng và vào buổi sáng,
như `hearts` học sau khi tặng quà: một công thức chỉ tới lúc bình minh sẽ khiến
người chơi tự hỏi mình vừa xuống tầng 10 để làm gì.

## Thay đổi ở reducer

- Không intent mới. Nạp lò nấu qua `machine/load`; chế kiếm qua
  `player/craft`; nâng công cụ qua `player/upgradeTool`.
- Không sự kiện mới. `recipeLearned`, `nodeHit`/`nodeCleared`, `toolTooWeak`,
  `machineLoaded`/`machineReady`, `crafted` và `upgradeOrdered` đã đủ.
- `reconcileMonsters` → `reconcileFloors` (xem trên).
- `applyAct` dưới mỏ: kiếm → thang → node.
- `arrive`: kiếm gỉ.
- `applyUpgradeTool`: thỏi.

## Bản lưu

`FarmState` không đổi hình dạng. Không tăng `SAVE_VERSION`.

- `parseNode` nhận `ore` với `item` là một quặng hợp lệ và từ chối `ore` thiếu
  `item`. Node trên `mine:*` **bị bỏ khi tải**, cùng lý do `monsters` được tải
  là `[]`: người trong mỏ lúc lưu đã được đưa về nông trại, nên không tầng nào
  có người.
- Máy `furnace` trong bản lưu cũ không tồn tại; `isMachineKind` tự nhận nó cho
  bản lưu mới.
- Vật phẩm mới (thỏi, kiếm) là id mới; bản lưu cũ không có chúng.

## Client

- **Mạch quặng.** `nodeTexture` thêm `if (node.kind === 'ore') return
  \`node-ore-${node.item}\``. `ground.ts` đã vẽ node theo khu vực người chơi
  đứng, nên node trên `mine:N` tự hiện. Placeholder trong
  `createPixelArtTextures`: một hòn đá có đốm màu của kim loại, lấy màu từ icon
  quặng đã có. PNG cùng tên thì tự thay.
- `CHIP_TINTS.ore`.
- **Lò nấu:** `placeable-furnace`, placeholder vẽ bằng code. Không panel mới.
- **Bảng lò rèn** (`WorkshopPanel.tsx`): mỗi dòng hiện `3 đồng thỏi · 250g`;
  phần thỏi đỏ khi thiếu, như giá tiền đang làm. Nút tắt khi thiếu thỏi **hoặc**
  thiếu tiền. `upgradeOffers` trả thêm `bars: { item, needs, has }`.
- **Icon:** `iron-bar`, `gold-bar`, ba kiếm mới qua placeholder trong
  `itemIcons.ts` cho tới khi có người vẽ tay.

## Kiểm thử

- **Sinh tầng:** mạch quặng đúng dải độ sâu của `oreTable`, tất định theo hạt,
  không nằm trên ô vào hay ô thang.
- **Node quặng:** quặng sắt từ chối cuốc thường và nhận cuốc đồng; quặng vàng
  cần cuốc thép; sản lượng 1–3, ngọc đúng 1; cuốc tốn đúng `energy`.
- **Vòng đời:** người đầu tiên xuống tầng → node sinh; người cuối rời → node
  xoá; quay lại → node sinh lại đúng như lần đầu; sang ngày mới → không còn node
  mỏ nào. Hai người cùng tầng, một người rời → node còn nguyên.
- **Cuốc trong mỏ:** cầm cuốc chim nhắm vào mạch quặng thì cuốc; cầm kiếm thì
  đánh; đứng trên thang tay không thì xuống.
- **Lò nấu:** 5 quặng + 1 than → sáng hôm sau ra 1 thỏi đúng loại; thiếu than,
  thiếu quặng, trộn loại quặng hay nạp thứ lạ → từ chối, túi nguyên vẹn. Lò than
  vẫn chạy như cũ sau khi đổi `burns` → `converts`.
- **Thợ rèn:** đủ thỏi và vàng → trừ cả hai và công cụ; thiếu thỏi → từ chối,
  không mất gì; thiếu vàng → từ chối, không mất gì. Công cụ đang chờ từ trước
  bản cập nhật vẫn về đúng hạn.
- **Công thức:** `{ by: 'depth' }` mở khi `deepestFloor` đạt ngưỡng, cho mọi
  người trên nông trại; ba công thức kiếm đủ nguyên liệu thì ra kiếm, thiếu thì
  từ chối.
- **Kiếm gỉ:** xuống mỏ không có kiếm → nhận; đã có bất kỳ kiếm nào → không
  nhận thêm; túi đầy → vẫn xuống, không nhận, có câu báo.
- **Bản lưu:** node `ore` trên `mine:*` bị bỏ khi tải; bản lưu cũ có máy và công
  cụ đang chờ tải bình thường; `ore` thiếu `item` bị từ chối.
- `itemIcons.test.ts`: không vật phẩm mới nào vẽ ra ô trống.
- `npm run quality:fast` xanh.

## Ngoài phạm vi

- Chỗ dùng của ngọc — để cho spec 19 (bó vật phẩm Phố Việt).
- Giáp và phòng thủ; `strikeDamage` vẫn nhận `defense: 0`.
- Kiếm rơi từ boss, kiếm bán ở sạp.
- Bậc cho liềm.
- Mọi thay đổi kinh tế nông trại: sprinkler, món Việt, cây mùa Đông — spec 17.
- PNG vẽ tay cho mạch quặng, lò nấu, thỏi và kiếm.
