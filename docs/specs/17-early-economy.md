# 17 — Cân lại kinh tế đầu game

**Phụ thuộc:** [16 — Kim loại có chỗ dùng](16-metal-and-the-mine.md) cho thỏi,
lò nấu và `{ by: 'depth' }`, [11 — Chế tác](11-crafting.md) cho ống tưới,
[04 — Mùa và cây trồng](04-seasons-and-crops.md) cho bảng cây theo mùa.

## Mục tiêu

Tháng đầu có giới hạn thật: tưới là việc của người cho tới khi mỏ trả công, và
mùa Đông là mùa của mỏ, sông và phố chứ không phải mùa thứ tư của ruộng.

## Vì sao

Buổi đánh giá thiết kế ngày 2026-09-17 tìm ra hai chỗ kinh tế đầu game không có
giới hạn nào đáng kể:

1. **Ống tưới tới ngày 4 và gần như miễn phí.** 6 đá + 8 sợi + 3 nhựa, toàn thứ
   spec 10 rải sẵn trên đất. Từ spec 01, tưới là thứ một ngày thực sự tiêu sức
   vào (2 sức một luống một ngày), nên ống tưới ở tuần đầu xoá luôn giới hạn sức
   lực, và ngày thôi là một quyết định. Comment trong `crafting.ts` nói rõ ống
   tưới rẻ chỉ vì spec 11 đi trước mỏ. Spec 16 đã có đồng thỏi, nên lý do đó
   không còn.
2. **Mùa Đông vẫn còn hai cây "tạm".** Frostcap và winterberry được thêm vào vì
   hồi đó mùa Đông không có gì làm. Comment của chính chúng trong `farming.ts`
   nói phải bỏ ra khi làng có lý do để ghé. Giờ đã có mỏ (13, 16), câu cá (12),
   vật nuôi (09), hái lượm mùa Đông (10) và Phố Việt (15).

Món Việt (bánh chưng, chè đậu lời hơn thùng ủ, làm xong ngay, không cần máy, và
sạp Tobias cũng mua) là vấn đề thứ ba mà buổi đánh giá tìm ra. Nó **được hoãn
lại**, xem [Ngoài phạm vi](#ngoài-phạm-vi).

## Ống tưới gắn vào mỏ

| | Hiện tại | Mới |
| --- | --- | --- |
| `sprinkler` (4 ô) | 6 đá, 8 sợi, 3 nhựa · `{ by: 'day', day: 4 }` | **1 đồng thỏi**, 6 đá, 3 nhựa · **`{ by: 'depth', depth: 5 }`** |
| `quality-sprinkler` (8 ô) | 1 ống tưới, 2 đồng thỏi, 5 nhựa · 6 tim Maeve | **1 sắt thỏi, 1 đồng thỏi**, 5 nhựa · **`{ by: 'depth', depth: 15 }`** |

- **Cái thứ nhất tới vào tuần 2–3, không phải ngày 4.** Để có nó phải xuống tới
  tầng 5, mang lên 15 quặng đồng (10 cho lò nấu, 5 cho một thỏi), đốt than và chờ
  một đêm.
- **Tưới cả ruộng là việc dài hơi.** 80 luống hiện tại cần khoảng 20 ống tưới
  thường, tức 100 quặng đồng. Tự động hoá thành mục tiêu của cả tháng đầu, không
  phải thứ có sẵn từ tuần đầu.
- **Tầng 15** nằm giữa kiếm đồng (tầng 10) và kiếm thép (tầng 20). Quặng sắt có
  từ tầng 10, nên tới lúc công thức mở thì người chơi thường đã có sắt thỏi đầu
  tiên. Mỗi dải tầng mỏ trả một thứ.
- **Ống tưới chất lượng thôi đòi một ống tưới thường.** Nó đã đòi thỏi của hai
  dải tầng, và bước "chế cái nhỏ rồi mới chế cái to" chỉ thêm một lần bấm, không
  thêm lựa chọn nào.
- **Maeve** mất mốc 6 tim. Bà vẫn trao thùng ủ ở 4 tim.
- Comment dài phía trên dòng `sprinkler` trong `RECIPES` được viết lại: ống tưới
  giờ nằm sau mỏ, và lý do nó từng không nằm ở đó chỉ còn là lịch sử.

### Ruộng mua thêm ở spec 18

Spec 18 sẽ mở rộng ruộng bằng cách **mua** ô đất. Mua đất tiêu vàng, còn ống
tưới tiêu quặng, nên hai thứ không đè lên nhau. Giá ống tưới tính theo từng cái
và không phụ thuộc diện tích ruộng. Spec 18 không phải đổi bảng trên, trừ khi nó
tự thấy cần.

### Bản lưu cũ

Không migrate gì cho phần này:

- Ống tưới **đã đặt** ngoài ruộng và ống tưới **trong túi hay rương** giữ nguyên.
- Người chơi đã học công thức `sprinkler` hoặc `quality-sprinkler` theo luật cũ
  **vẫn biết nó**. `parseKnownRecipes` giữ công thức đã học, và
  `newlyUnlocked` chỉ thêm, không bớt. Công thức mới đòi thỏi, nên biết sớm
  cũng không làm được sớm. Tước công thức đi thì phải thêm luật "quên", và luật
  đó không mua được gì.

## Mùa Đông không trồng gì

### Gỡ `frostcap` và `winterberry`

- **`farming.ts`:** bỏ hai dòng khỏi `CROPS`. Comment "stopgap" thay bằng một
  câu: mùa Đông cố ý không trồng gì, vì đó là mùa của mỏ, câu cá và hái lượm,
  và chính khoảng trống đó cho năm một nhịp.
- **`items.ts`:** bỏ khỏi kiểu `CropId`, bỏ bốn dòng vật phẩm
  (`frostcap-seeds`, `frostcap`, `winterberry-seeds`, `winterberry`), bỏ hai dòng
  trong `CROP_CLASS`. Đồ máy làm từ hai cây này (`juice-frostcap`,
  `pickle-frostcap`, `wine-winterberry`, `jam-winterberry`) được sinh từ
  `CROP_CLASS`, nên tự biến mất theo. Comment nào đếm số cây ("thirteen crops")
  thì sửa lại số.
- **Hình:** mục trong `itemIcons.ts`, `lpc.generated.ts` (sinh lại bằng
  `npm run lpc:manifest` sau khi xoá PNG, không sửa tay), các PNG `crop-*` và `item-*-seeds` trong
  `public/assets/lpc/` và `art/raw/lpc/`, mục trong `art/sources.json` và hai
  bản `CREDITS.md`.
- **Sở thích quà:** chỉ bỏ dòng, không thêm món thay thế.

  | Dân làng | Mất | Còn lại |
  | --- | --- | --- |
  | Juniper | frostcap, winterberry (yêu) | vẫn yêu chè đậu, nấm tím, tỏi rừng, củ đông, cỏ ba lá |
  | Rowan | winterberry (yêu) | vẫn yêu đại hoàng |
  | Ash | frostcap (ghét) | vẫn ghét củ cải |
  | Bram, Tobias | frostcap (ghét) | **không còn món ghét nào** |

  Bram và Tobias không còn món nào để ghét. Chấp nhận: không test nào đòi mỗi
  người phải có một món ghét, và bảng quà của họ vẫn còn món yêu, món thích và
  món không thích. Thêm món ghét mới là việc của một lần xem lại bảng quà, không
  phải của spec kinh tế.

- **Lời thoại:** ba câu nhắc tới hai cây được viết lại, giữ nguyên `when` và
  `priority`:

  | Ai | Khi | Câu mới |
  | --- | --- | --- |
  | Juniper | `season: 'Winter'` | "Rễ đông với cải tuyết nằm ngay dưới lớp tuyết. Phải biết chỗ mà bới." |
  | Juniper | `minHearts: 6` | "Có một bãi rễ đông tôi mới chỉ cho đúng một người. Ông ấy mất rồi, nên con số quay về một." |
  | Tobias | `season: 'Winter'` | "Mùa đông quầy chỉ còn nông cụ. Đất nghỉ thì bác lên mỏ hay ra sông, tôi ngồi đếm tiền mùa thu." |

- **Sạp chợ mùa Đông:** `shopStock('Winter')` không còn hạt nào.
  [ShopPanel.tsx](../../src/components/ShopPanel.tsx) đã có câu cho sạp không có
  hạt ("Mùa Đông gieo gì cũng không sống đến ngày thu hoạch…"), nên không cần sửa.
- Mọi test đang nhắc hai id này thì sửa hoặc bỏ. Sau khi gỡ, tìm các chuỗi
  `frostcap`, `winterberry`, `sương giá` và `dâu đông` trong `src/`, `tests/`,
  `server/`, `public/` và `art/` không được ra kết quả nào, trừ trong bảng giá
  của migration và test của nó.

### Migration v11 → v12: đổi ra vàng

Gặp id vật phẩm lạ thì `parseStack` từ chối, và túi của người chơi từ chối thì
**cả bản lưu bị từ chối**. Rương thì ngược lại: ô lạ lặng lẽ thành ô trống, tức
người chơi mất đồ mà không ai báo. Máy có việc nhắc id lạ thì bị bỏ. Cả ba đều
không chấp nhận được, nên phải có migration.

`SAVE_VERSION` lên **12**. `migrate()` thêm
`if (version <= 11) current = migrateWinterCrops(current);`. Hình dạng
`FarmState` không đổi.

`migrateWinterCrops` chạy trên JSON thô, trước `parseFarm`. Lúc đó `ITEMS` đã
không còn những id này, nên giá được **viết cứng** trong một bảng hằng ngay cạnh
hàm, với comment nói rõ vì sao bảng này không đọc từ `ITEMS`:

| Id | Đổi được | Tính theo |
| --- | --- | --- |
| `frostcap-seeds` | 20g | giá mua |
| `winterberry-seeds` | 80g | giá mua |
| `frostcap` | 52g | giá bán |
| `winterberry` | 38g | giá bán |
| `juice-frostcap` | 156g | giá bán (52 × 3) |
| `pickle-frostcap` | 114g | giá bán (52 × 2,2) |
| `wine-winterberry` | 114g | giá bán (38 × 3) |
| `jam-winterberry` | 84g | giá bán (38 × 2,2) |

Những chỗ được quét, và việc làm ở mỗi chỗ:

| Chỗ | Làm gì |
| --- | --- |
| Túi của **mọi** người chơi trong `players` (kể cả người đang offline) | Bỏ stack, đền `count × giá` |
| Ô trong rương (`placeables` họ chest) | Bỏ stack (ô thành `null`), đền `count × giá` |
| Việc trong máy (`job.input` hoặc `job.output` là id trong bảng) | `job` thành `null`, đền **giá của `input`** |
| Luống có `crop` là `frostcap`/`winterberry` | Về `tilled`, `crop: null`, `daysWatered: 0`, `wateredToday: false`. Không đền: hạt đã gieo là hạt đã tiêu |

Tổng tiền cộng vào `coins`. Bước lập plan phải rà lại `parseFarm` để chắc không
còn chỗ nào khác trong bản lưu chứa `ItemId` hay `CropId` (nhiệm vụ hiện chỉ có
`targetCrop: 'turnip'`, và quan hệ với dân làng không lưu id quà). Tìm thấy chỗ
mới thì thêm vào bảng trên theo cùng tinh thần: không ai mất đồ.

**Không có dòng báo.** Chưa có cơ chế nào báo một việc xảy ra lúc tải bản lưu.
Dựng một cơ chế (một trường tạm trong `FarmState`, đọc xong thì xoá) chỉ để nói
một câu một lần là không đáng: nó đổi hình dạng bản lưu. Người chơi thấy ví
nhiều hơn, còn đồ mùa Đông thì đơn giản không còn trong túi.

## Thay đổi ở reducer

Không có. Không intent mới, không sự kiện mới. `learnRecipes` đã học
`{ by: 'depth' }` từ spec 16, cả buổi sáng, trong `arrive` lẫn khi có người mới
vào nông trại.

## Client

Không có gì mới. Bảng chế tác không hiện công thức chưa mở, nên không có câu
"mở ở tầng 5" nào phải viết. Blurb của hai ống tưới vẫn đúng.

## Kiểm thử

- **Công thức ống tưới:**
  - `newlyUnlocked` ở ngày 4, `deepestFloor: 0` không có `sprinkler`;
  - ở `deepestFloor: 5` thì có;
  - `quality-sprinkler` mở ở 15, không mở ở 14, và không còn phụ thuộc tim với
    Maeve (10 tim, `deepestFloor: 0` vẫn không có).
- **Chế ống tưới:** đủ nguyên liệu mới thì ra; thiếu thỏi thì từ chối và túi
  nguyên vẹn. Ống tưới chất lượng không còn tiêu một ống tưới thường.
- **Người mới vào** nông trại đã xuống tầng 5 thì biết `sprinkler` ngay, theo
  đúng đường spec 16 đã sửa.
- **Test sprinkler hiện có** trong `reducer.test.ts` và `placeables.test.ts` vẫn
  xanh (chúng đặt ống tưới trực tiếp, không chế).
- **Mùa Đông:**
  - `cropsForSeason('Winter')` rỗng;
  - `shopStock('Winter')` chỉ còn công cụ;
  - `isItemId('frostcap')` là false.
- **Migration:** một bản lưu v11 có frostcap trong túi người chơi offline,
  winterberry trong rương, `wine-winterberry` đang ủ trong thùng, `jam-winterberry`
  trong túi, và hai luống đang trồng frostcap. Kiểm rằng:
  - bản lưu tải được;
  - `coins` tăng đúng tổng theo bảng giá;
  - túi và rương không còn id nào trong bảng, các stack khác nguyên chỗ;
  - thùng ủ trống việc;
  - hai luống là `tilled` và trống;
  - một bản lưu v11 không có đồ mùa Đông thì tải ra `coins` y nguyên.
- `itemIcons.test.ts` và các test bảng dân làng (`definitions.test.ts`) vẫn xanh.
- `npm run quality:fast` xanh.

## Ngoài phạm vi

- **Cân lại món Việt.** Bánh chưng (≈3,5×) và chè đậu (≈3,85×) lời hơn thùng ủ
  (3×), làm xong ngay, không cần máy, và sạp Tobias cũng mua. Hoãn theo ý người
  làm game. Một spec sau sẽ chọn giữa: hạ hệ số và chỉ bán cho bà Xoan, bắt phải
  nấu bằng một máy mới, hoặc giới hạn số món bà Xoan mua mỗi ngày.
- Mở rộng ruộng bằng cách mua ô đất — spec 18.
- Thứ gì mới cho mùa Đông. Mỏ, câu cá, vật nuôi, hái lượm và Phố Việt đã có;
  spec này chỉ bỏ cái tạm.
- Đổi giá bất kỳ cây nào khác, hay đổi thùng ủ và lọ ngâm.
