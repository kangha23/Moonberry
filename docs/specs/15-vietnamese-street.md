# 15 — Phố Việt

**Phụ thuộc:** [07 — NPC đáng ghé thăm](07-npc-relationships.md) cho máy lịch trình/quà/thoại,
[11 — Chế tác](11-crafting.md) cho công thức, [04 — Mùa và cây trồng](04-seasons-and-crops.md)
cho cây mới. Không phụ thuộc 08 hay 13: không thêm HUD, không thêm combat.

## Mục tiêu

Một khu phố nhỏ nghe tiếng Việt — bảng hiệu đọc được, một bà bán xôi có giờ
giấc, ba món ăn nấu từ nông sản trong game — mà không vẽ lại tileset, không
thêm tiền tệ, không thêm engine nào.

## Vì sao

Game hiện tại nói tiếng Việt bằng lời thoại nhưng nhìn thì không: tên map là
Amberfall, món ăn không có, phố không có. Thuần Việt rẻ nhất nằm ở **chữ +
người + món**, không nằm ở vẽ lại mặt tiền phố cổ. Mặt tiền vẽ tay kiểu
facade là một tranh liền không lặp được, ngược với toàn bộ pipeline tile 32px
native của repo — muốn nó phải cắt 20-30 pieces và nới palette, tức là một
spec art riêng. Spec này cố ý không làm điều đó.

Nó cũng là bước đầu của khu thành phố kiểu Avatar mà không trả giá của nó:
một map, một NPC, ba công thức. Khu phố mở rộng sau này (thời trang, quay số,
pet) đi tiếp từ đây mà không phải sửa gì đã làm.

## Khu vực mới: `plaza`

Một bản đồ 24x18 trong `maps/plaza.json`, vẽ bằng đúng tileset đang có:

- Nền gạch vỉa hè: `tile-path` đi qua `--recolour` sang đỏ gạch trước khi
  import, ghi lại mã màu trong `art/sources.json` như mọi cut khác.
- Ba mặt tiền trơn: ráp từ pieces của [LPC] Farm và cottage (mái tôn lấy
  slate của silo recolour), mỗi cái một `prop` solid kèm thuộc tính `sign`
  để client vẽ chữ lên (xem [Biển hiệu](#biển-hiệu-chữ-render-runtime)).
- Một xe đẩy: `market-stall` recolour; một tủ: `jar` phóng theo đúng tỉ lệ
  đã dùng cho `building-shed`. Cột điện + dây là 2 tile vẽ mới duy nhất —
  toàn đường thẳng nên vẽ tay 1 buổi là xong, native 32px.
- Hai portal đối xứng hai đầu đông/tây: tây `plaza <-> farm` (cửa mới ở mép
  đông farm, cuối đường vòng phía nam, hàng 22), đông `plaza <-> village`
  (cửa mới ở mép nam village, cuối làn x=18). Test đối xứng ở dưới bắt cả
  hai chiều.

```
        0..23
   0-5  vườn sau (cỏ)
   6    dây điện chăng giữa hai cột (decor, trên đầu người đi)
   7-8  S1  S2  S3   <- ba mặt tiền 5x2, solid, có sign
   9    xe  cột  tủ  cột  <- interact: xoi-stall ở xe; Bà Xoan đứng cạnh xe
   10-17 vỉa hè gạch, ghế đá, chậu hoa (decor, không solid)
   11-15 portal tây (x=0) <-> farm, portal đông (x=23) <-> village
```

Bà Xoan đứng **cạnh** xe chứ không sau xe: `player/act` chọn thứ gần hơn giữa
người và quầy, nên đứng trước xe thì xe thắng (bán + mở sạp), đứng cạnh bà
thì bà thắng (nói chuyện).

Hai cửa: tây về `farm`, đông sang `village` — farm vẫn là trung tâm như mọi
portal hiện tại, và test đối xứng ở dưới bắt cả hai chiều.

Map sinh bằng `npm run maps:seed -- plaza.json` (chỉ ghi file được nêu tên, không đè các map đã sửa tay), rồi `npm run maps:build` như mọi map khác.
`AREAS` tự có `plaza` — map tĩnh nên **không đổi `FarmState`, không tăng
`SAVE_VERSION`**.

## NPC mới: Bà Xoan bán xôi

Một file `src/game/npcs/villagers/xoan.ts` + một dòng trong
`definitions.ts`. Không case mới nào ở reducer — máy spec 07 đọc data.

```ts
export const XOAN: NpcDef = {
  id: 'xoan',
  name: 'Bà Xoan',
  blurb: 'Bán xôi đầu phố. Nhớ khẩu vị của cả làng.',
  texture: 'npc-xoan',
  sheet: 'tobias-sheet', // mượn sheet thật, tint lại
  tint: 0xf8dbbd, // light.7 — palette-lock không cho màu ngoài 48 màu
  birthday: { season: 'Winter', day: 14 },
  defaultGiftReaction: 'neutral',
  gifts: { strawberry: 'loved', melon: 'loved', coal: 'hated', wood: 'disliked', ... },
  schedule: [
    { ...XOAN_DOOR, fromHour: 5, toHour: 7, activity: 'home' },
    { ...XOI_STALL, fromHour: 7, toHour: 12, activity: 'xoi-stall' },
    { ...WELL_SIDE, fromHour: 12, toHour: 14, activity: 'well' },
    { ...XOI_STALL, fromHour: 14, toHour: 17, activity: 'xoi-stall' },
    { ...XOAN_DOOR, fromHour: 17, toHour: 29, activity: 'home' },
  ],
  dialogue: [ ...hai chục câu theo priority 0/10/20/40+/100 như Tobias... ],
};
```

Chỗ ở (`XOAN_DOOR`) đặt trong village cạnh cottage-bram để không thêm map
nhà. Sheet mượn + tint là adaptation của LPC nên giữ nguyên license
CC-BY-SA như 5 dân hiện tại — đã ghi trong `CREDITS.md`, không thêm ràng
buộc mới. Ai vẽ được sheet bà già Việt thì thay theo đường
`lpc:import --walkcycle` đã ghi ở cuối `CREDITS.md`.

Thoại mẫu theo đúng giọng đã có: priority 0 câu chung (`"Xôi nóng đây. Ăn
đi rồi hẵng đi cày."`), 10 theo activity (`xoi-stall`: `"Hết xôi gấc thì
còn xôi đậu. Hết cả hai thì mai ra sớm."`), 20 theo mùa, 40+ theo tim,
100 sinh nhật.

Câu mùa chỉ có cho Hạ (mùa gieo nếp) và Đông (Tết), không đủ bốn mùa: một câu
priority 20 luôn thắng câu 10, nên đủ bốn mùa thì câu theo activity không bao
giờ được nói — đúng chuyện đang xảy ra với các câu activity của Tobias.

## Ba món Việt

Hai cây mới mùa Summer (gieo như lúa mì, bán hạt ở sạp đúng luật spec 04 —
thêm cây là tự lên kệ, không sửa chợ):

| Cây | Mùa | Ngày | Giá hạt | Art |
| --- | --- | --- | --- | --- |
| `nep` (Nếp) | Summer | 5, rồi 3 ngày/lứa | 60g | `crop-nep.png` 32px native, vẽ mới |
| `dau-xanh` (Đậu xanh) | Summer | 4, rồi 2 ngày/lứa | 50g | `crop-dau-xanh.png` 32px native |

Cả hai mọc lại, và bán thô rẻ (nếp 26g, đậu xanh 16g). Với giá hạt 60g/50g mà
không mọc lại thì mỗi cây phải bán trên giá hạt, và khi đó ba nguyên liệu của
xôi đậu đã đắt hơn 240g của món — nấu ăn sẽ lỗ. Mọc lại thì một vụ hè của một
gốc nếp kiếm ngang một gốc dâu tây mùa xuân, và vào món thì gấp ba.

Ba công thức trong `RECIPES` (`crafting.ts`), mở từ đầu như `torch`:

| Món | Cần | Được | Giá bán | Quà |
| --- | --- | --- | --- | --- |
| `banh-chung` | nep×4 + fiber×2 (lá dong) | 1 | 380g | mọi NPC ≥ liked, Xoan loved |
| `xoi-dau` | nep×3 + dau-xanh×2 | 1 | 240g | Xoan loved |
| `che-dau` | dau-xanh×3 + strawberry×2 | 2 | 200g | Juniper/Ash loved |

Món ăn là `ItemDef` thường (`produce`, giftable, stack như nông sản), không
thêm hệ thống ăn uống — ăn uống/nấu ăn vẫn là việc chưa có spec, và spec này
không lén làm nó. Icon sạp dùng đường placeholder MIT trong `itemIcons.ts`
(như `crop-seeded` đã làm) cho tới khi có người vẽ tay.

## Biển hiệu: chữ render runtime

Bảng hiệu trong PNG để trơn. Chữ lấy từ thuộc tính `sign` của prop
(`sign: 'BÁNH BAO'`) và được vẽ bằng `fillText` trong `FarmScene` với font
hệ thống — dấu tiếng Việt đúng, đổi tên shop không vẽ lại, và text không đi
qua `palette:apply` nên không dính `palette-lock`.

Hai luật: chữ chỉ vẽ khi prop đó đã load (không text ma trên nền trơn), và
`sign` đi qua cùng parser với `interact`/`toArea` — sai chính tả là lỗi load
map chứ không phải chữ lặng lẽ biến mất.

## Thay đổi ở reducer

- Không thêm intent mới. `player/act` trên xe xôi mở panel chợ hiện có:
  bấm một lần bán sạch 3 món trong giỏ (và chỉ 3 món đó — nông sản khác để
  lại cho Tobias), panel bán hạt nếp/đậu xanh đúng mùa. Sạp của Xoan là
  `STALLS['xoi-stall']` trong `shop.ts`: cùng panel `market`, stock riêng.
- "Theo giờ stall" đọc từ lịch, không từ vị trí: xe chỉ giao dịch khi có ai
  đang ở activity `xoi-stall` (`isStaffed`), tức 7–12h và 14–17h. Ngoài giờ,
  `act` chỉ báo giờ mở cửa, và `shop/buy` bị từ chối kể cả khi panel còn mở.
- `NPCS` thêm `xoan`; `NpcId` là union từ `NPCS` nên quà/tim/lịch tự theo.
- `ITEMS` thêm 2 cây + 3 món; `CROP_DEFINITIONS` thêm nếp/đậu xanh.
  Save cũ không biết id mới thì bỏ qua như mọi item lạ — **không migrate**.
  Người chơi cũ học ba công thức vào buổi sáng kế tiếp, như mọi công thức
  `start` mới.
- `seedNodes` không còn rơi về nhánh forage của village cho map lạ: phố lát
  gạch, không mọc gì.

## Client

- Vẽ `plaza` bằng đúng path `renderTiles`/`renderProps` của mỏ (`mineMap.ts`
  đã chứng minh thêm map không cần code vẽ mới).
- Thanh chữ biển hiệu: `signLayout` trong `hudLayout.ts` (hàm thuần, có
  test vị trí/kích thước), font hệ thống, không asset. Vị trí bảng là
  `SIGNBOARD` (tỉ lệ trên hình mặt tiền) — ai vẽ tay mặt tiền phải để bảng
  trống đúng hộp đó.
- `sign` lỗi là lỗi load map: mặt tiền (`shopfront*`) thiếu sign, sign trên
  prop không có bảng, sign rỗng/không phải chuỗi/dài quá 16 ký tự, và bất kỳ
  thuộc tính prop nào ngoài `texture/solid/depth/interact/sign` (bắt lỗi gõ
  `sigm`) đều throw khi parse.
- Sheet Xoan: tint runtime như 5 dân — không thêm PNG người.

## Kiểm thử

- Portal đối xứng: mọi portal `plaza` đều có portal ngược đáp đúng ô, và ô
  đáp walkable (viết thành test quét toàn bộ `AREAS` — đáng có từ lâu sau
  vụ lệch 1 ô ở farmhouse).
- `generateFloor` không đụng — chạy lại suite mỏ vẫn xanh.
- Lịch Xoan: 5h ở nhà, 7-12 và 14-17 ở stall, không đứng lên ô solid/nước.
- Thoại: đúng priority như `dialogue.test.ts` đang bắt cho 6 dân.
- Recipe: đủ nguyên liệu thì ra món + mất nguyên liệu; thiếu thì từ chối và
  túi nguyên vẹn (pattern `crafting.test.ts`).
- Quà: bánh chưng ≥ liked với mọi NPC, Xoan loved xôi.
- `sign` lạ/khuyết thì load map fail loudly, không render nửa vời.
- `art-sync --check` xanh; 2 cây mới native 32px (không block 2x2).

## Vẽ bằng gì (tool + lệnh cho từng món)

Luật chung của repo vẫn đứng: native 32px (không block 2×2), 48 màu
`art/palette.json`, nguồn vào `art/raw/lpc/`, game đọc `public/assets/lpc/`.
Sai size là `lpc:import` từ chối ngay — đó là cố ý, đừng `--force`.

| Món | Tool | Lệnh |
| --- | --- | --- |
| Icon bánh chưng/xôi/chè 32px | PiskelApp (free, online) | `lpc:import -- <file> item-banh-chung --grid 32 --cell 0,0` rồi `lpc:manifest` |
| Cây nếp/đậu 32px | Aseprite (khóa palette 48 màu khi vẽ) hoặc LibreSprite/Pixelorama free | cùng lệnh grid như trên, target `crop-nep`, `crop-dau-xanh` |
| Nón lá (mũ, 1 frame) | Aseprite/Piskel | vẽ đè lên export `hat/cloth/bandana` của LPC generator, giữ nguyên khung 64px |
| Sheet Bà Xoan | LPC Character Generator (web) | `lpc:import -- <export> xoan-sheet --walkcycle` rồi `lpc:manifest`; chưa vẽ thì mượn `tobias-sheet` + tint như spec |
| Gạch vỉa hè lặp không seam | Tiled (Wang set) + Aseprite tile mode | `lpc:import -- <sheet> tile-plaza --grid 32 --cell x,y`, check bằng cách lát 3×3 trước khi commit |
| Kiểm tra màu trước khi vẽ | Lospec | màu mới không có trong 48 màu thì hoặc recolour lúc import (`--recolour a:b`) hoặc thêm ramp vào `palette.json` + chạy `palette:module` |

Không dùng output AI vào game: sai pixel-size, vỡ palette, license mập mờ.
AI chỉ để brainstorm ý tưởng. Chữ Việt trên biển không vẽ vào PNG — render
runtime theo mục [Biển hiệu](#biển-hiệu-chữ-render-runtime).

## Biển chỉ đường và cột mốc

Thêm sau khi làm xong phần trên: cửa không vẽ gì trên map, nên người chơi
không biết lối vào phố ở đâu. Cùng cơ chế chữ vẽ lúc chạy với biển hiệu, thêm
hai loại bảng nữa (`SIGN_KINDS` trong `tiled.ts`):

| Texture | Dòng tối đa | `arrow` | Dùng cho |
| --- | --- | --- | --- |
| `shopfront*` | 1 | cấm | tên cửa hàng |
| `signpost` | 3 | bắt buộc: `left/right/up/down` | biển xanh kiểu QL1: dòng nhỏ, TÊN IN HOA, mũi tên, dòng nhỏ |
| `milestone` | 2 | cấm | cột mốc: dòng trên mũ đỏ, dòng dưới trên đá trắng |

- Nhiều dòng thì viết xuống dòng trong thuộc tính `sign` của Tiled. Dòng
  trống, quá số dòng, thiếu `arrow` hoặc `arrow` trên bảng không có chỗ vẽ đều
  là lỗi load map.
- Bố cục từng dòng và mũi tên là `boardLayout` / `SIGNPOST` / `MILESTONE`
  trong `hudLayout.ts`, hàm thuần có test. Mũi tên vẽ bằng hình, không phải ký
  tự "←".
- Đặt ở: farm (hai biển cạnh hai cửa phía đông: "Khu phố / PHỐ VIỆT" →,
  "Làng / MOONBERRY" →), village ("Khu phố / PHỐ VIỆT" ↓ cạnh cửa nam,
  "Nông trại / AMBERFALL" ← cạnh cửa tây), plaza (một biển mỗi đầu, và cột mốc
  "PV / 0 km" ở đầu giáp farm). Biển không solid, cột mốc solid.
- Biển chỉ đường chiếm 1 ô (32×32), vẽ ở kích thước gốc chứ không co từ
  hình lớn. Chữ trên biển được phép nhỏ tới `SIGNPOST_FONT_MIN` (3px), thấp
  hơn mức sàn của biển hiệu cửa hàng.
- `signs.test.ts` bắt trên map thật: biển không đè prop khác, không đứng trên
  nước/tường/cửa, và cửa gần biển nhất phải nằm về phía mũi tên.

## Hiện trạng art

- **Đã cut từ nguồn:** `xoi-cart` — cùng khung `merchant-cart.png` của
  `market-stall` (pack emberfield), recolour kính sang màu xôi, ghi trong
  `art/sources.json`.
- **Còn là placeholder vẽ bằng code** (`createPixelArtTextures`,
  `itemIcons.ts`), tự bị thay khi có PNG cùng tên: `tile-plaza`, ba
  `shopfront*`, `street-cabinet`, `street-pole`, `street-wire`, `signpost`, `milestone`, cây
  `nep`/`dau-xanh` (field + icon + hạt), icon `banh-chung`/`xoi-dau`/
  `che-dau`, và `npc-xoan` (chỉ hiện khi `tobias-sheet` không load).
  `tile-path` không có toạ độ nguồn nên chưa recolour được qua `art:sync`.
- Bà Xoan chưa có portrait, nên thoại hiện khung mặt trống.

## Ngoài phạm vi

Mặt tiền phố cổ vẽ tay, font bitmap chữ Việt, tuần Tết/event theo lịch,
tiền tệ thứ hai kiểu xu/lượng Avatar, thời trang/pet/quay số (để dành cho
spec thành phố sau), ăn uống/hồi sức từ món ăn, nâng cấp nhà.
