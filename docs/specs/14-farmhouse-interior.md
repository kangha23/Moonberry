# 14 — Bước vào trong nhà

**Phụ thuộc:** không có spec nào. Chỉ phụ thuộc art, và art đã tìm được — xem
[Art](#art-lấy-ở-đâu-và-lấy-ô-nào) ở cuối.

Nên làm sau [08 — Khung game và ngôn ngữ thị giác](08-frame-and-look.md): spec
này thêm một cảnh mới phải trông giống phần còn lại của game, và làm nó trước 08
nghĩa là chỉnh khung, màu và lớp phủ hai lần.

## Mục tiêu

Cửa nhà nông trại mở ra được. Bên trong là một căn nhà gỗ có giường, bếp, bàn ăn
và lò sưởi, và **giấc ngủ diễn ra ở cái giường thật** thay vì ở bậc cửa.

## Vì sao

Spec 01 đã nói thẳng đây là món nợ, và vì sao nó vay:

> A cottage interior would be nicer and the area machinery already supports it,
> but there is no interior art. Treat it as a later, separate change.
> — [01 — Năng lượng và giấc ngủ](01-energy-and-sleep.md)

Món nợ đó đến hạn vì ba lý do.

**Ngôi nhà là vật thể lớn nhất trên bản đồ và là vật thể duy nhất người chơi
không vào được.** Chuồng gà, chuồng bò, quầy chợ, lò rèn cũng là mặt tiền vẽ sẵn
và điều đó ổn — chúng là công trình phụ. Nhà thì không: nó là chỗ người chơi kết
thúc mỗi ngày, và hiện tại họ kết thúc ngày bằng cách đứng ngoài đường ấn phím
vào một bức tường.

**Nó là tiền đề cho bốn thứ khác trong danh sách "chưa có spec".** Nâng cấp nhà
cần một cái nhà để nâng cấp. Nấu ăn cần một cái bếp. Rương đồ cần một chỗ đặt.
Trang trí — thứ [11 — Chế tác](11-crafting.md) đã liệt kê ở phần ngoài phạm vi —
cần một căn phòng để trang trí.

**Và nó rẻ.** Bộ máy khu vực đã chạy với ba bản đồ, cổng dịch chuyển đã do
reducer quyết định, và server không biết "khu vực" là gì nên không phải sửa gì.

## Khu vực mới: `farmhouse`

Một bản đồ 12x9 ô, nhỏ bằng khoảng một phần mười nông trại. Nhỏ là cố ý: căn
phòng phải đọc được trọn vẹn trong một khung hình, không có camera nào phải đi
tìm cái gì.

```
       0  1  2  3  4  5  6  7  8  9 10 11
  0    #  =  =  =  =  =  =  =  =  =  =  #    #  viền trần — ô solid, không phải prop
  1    #  =  =  =  =  =  =  =  =  =  =  #    =  tường sau, vữa khung gỗ — ô solid
  2    #  B  .  .  S  S  .  F  F  F  .  #    .  sàn gỗ
  3    #  B  .  .  .  .  .  F  F  F  .  #    B  giường (interact: bed)
  4    #  .  .  .  T  T  .  R  R  R  .  #    S  bồn rửa và bếp lò
  5    #  .  .  c  T  T  c  R  R  R  .  #    T  bàn ăn, c  hai ghế
  6    #  .  .  .  .  .  .  R  R  R  .  #    F  lò sưởi, R  thảm
  7    #  .  .  .  .  .  ^  .  .  .  .  #    ^  chỗ đáp khi vào nhà
  8    #  #  #  #  #  #  D  #  #  #  #  #    D  ô cửa, đi vào là ra sân
```

Sơ đồ này là cái đã ship, không phải bản phác đầu tiên — bản phác đặt lò sưởi
giữa phòng và giường rộng hai ô; phần [Đã làm khác đi ở đâu](#đã-làm-khác-đi-ở-đâu)
ở cuối nói vì sao.

`maps/farmhouse.json`, cùng khuôn với ba bản đồ kia. Thêm một dòng vào
[`scripts/build-maps.mjs`](../../scripts/build-maps.mjs) là có `AreaId` mới:

```js
const AREA_FILES = {
  farm: 'farm.json',
  village: 'village.json',
  forest: 'forest.json',
  farmhouse: 'farmhouse.json',
};
```

`AreaId` là union sinh ra từ danh sách đó, nên TypeScript sẽ tự đi đòi mọi chỗ
khai báo `Record<AreaId, ...>` phải có nhánh mới. Đó là tính năng, không phải
phiền hà.

**Tường trong nhà là ô, không phải prop.** `TileDef` đã có `solid` — nước dùng nó
từ đầu — nên một hàng tường chỉ là ô `solid: true`, không cần bộ máy nào mới.
Thêm hai `kind` vào [`tiled.ts`](../../src/game/world/tiled.ts):

```ts
export type TileKind = 'grass' | 'path' | 'water' | 'plot' | 'floor' | 'wall';
```

## Cái lỗ trên bức tường: phần duy nhất bộ máy chưa làm được

Cổng dịch chuyển kích hoạt khi người chơi **đi vào ô cửa**
([`reducer.ts:1690`](../../src/game/state/reducer.ts)), còn ngôi nhà ngoài trời
là **một hình chữ nhật solid liền khối**, không có ô nào đi qua được. Không đục
được lỗ, vì va chạm của một prop chính là cái khung của prop đó.

Cách rẻ nhất là tách hai thứ đang bị buộc chung: hình vẽ và vật cản.

```ts
// src/game/world/tiled.ts — một loại object mới trong Tiled: type="collider"
export interface AreaMap {
  // ...
  /** Hình chữ nhật chặn đường mà không có gì được vẽ trên đó. */
  colliders: readonly Blocker[];
}
```

```ts
// src/game/world/areas.ts — trong isWalkable, ngay sau vòng lặp props
for (const rect of map.colliders) {
  if (contains(rect, { x, y })) return false;
}
```

Rồi trong `maps/farm.json`, ngôi nhà đổi thành `solid: false` và ba `collider`
thế chỗ, chừa đúng cột cửa:

| Object | Ô | Vì sao |
| --- | --- | --- |
| `house-wall-west` | (3,3) 2x4 | mảng tường trái |
| `house-wall-east` | (6,3) 2x4 | mảng tường phải |
| `house-wall-door` | (5,3) 1x3 | phần tường phía trên khung cửa |
| `to-farmhouse` (portal) | (5,6) 1x1 | ô cửa; đi vào là vào nhà |

Cột 5 là cột cửa, đo từ chính bức vẽ chứ không ướm bằng mắt: cánh cửa nằm ở
`farmhouse.png` x 64..96, mà ngôi nhà đặt tại x=96, nên cửa rơi đúng vào dải
160..192 — ô số 5.

Cùng bộ máy này về sau dùng lại được cho cửa chuồng gà và chuồng bò, và đó là lý
do nó đáng là một loại object chứ không phải một ngoại lệ viết riêng cho cái nhà.

## Hai cổng, và chỗ đáp không được là cổng

```
farm (5,6)  ──→  farmhouse (6,7)
farm (5,7)  ←──  farmhouse (6,8)
```

**Ô đáp không bao giờ được trùng một ô cổng.** Reducer đặt người chơi thẳng vào
`toX/toY` rồi kiểm tra cổng ở bước di chuyển kế tiếp, nên hai cổng úp mặt vào
nhau là một vòng dịch chuyển vô tận. Vào nhà thì đáp ở (6,7) — một ô phía trên ô
cửa bên trong; ra ngoài thì đáp ở (5,7) — ô đường ngay trước thềm.

`label` của cổng là thứ người chơi đọc trên thanh nhắc, nên đặt là `"ngôi nhà"`
và `"sân nông trại"` — reducer ghép nó vào câu *"Bạn theo con đường tới …"*, và
"tới trong nhà" không phải tiếng Việt.

## Giường, và những thứ ấn vào được

Prop trong nhà khai báo y hệt prop ngoài trời — `texture`, `solid`, `depth`,
`interact` — nên phần này không có mã mới, chỉ có bản đồ.

| Prop | Ô | `interact` | Ghi chú |
| --- | --- | --- | --- |
| `bed` | (1,2) 1x2 | `bed` | chuyển từ ngôi nhà ngoài trời vào đây |
| `stove` | (4,2) 2x1 | — | bồn rửa và bếp lò; để dành cho nấu ăn |
| `table` | (4,4) 2x2 | — | bàn ăn |
| `chair-west`, `chair-east` | (3,5), (6,5) | — | hai ghế quay vào bàn |
| `fireplace` | (7,2) 3x2 | — | nguồn sáng của căn phòng, dựa tường sau |
| `rug` | (7,4) 3x3 | — | `solid: false`, `depth: 0`, trước lò sưởi |

**`interact: 'bed'` rời khỏi khối nhà ngoài trời.** Reducer không quan tâm khu
vực nào — nó chỉ hỏi `interactableAt(...)?.interact === 'bed'`
([`reducer.ts:1381`](../../src/game/state/reducer.ts)) — nên luật ngủ không đổi
một dòng. Hai hàm phụ trợ trong kiểm thử thì đổi: `standAtBed` ở
[`reducer.test.ts:139`](../../src/game/state/reducer.test.ts) và ở
[`FarmRoom.test.ts:366`](../../server/src/FarmRoom.test.ts) đang tìm cái giường
trong `START_AREA` rồi đặt người chơi đứng dưới nó; giờ chúng phải đặt người chơi
vào `'farmhouse'`.

Hệ quả thiết kế, nói rõ để không ai tưởng là tai nạn: **mỗi tối người chơi phải
đi vào nhà mới ngủ được.** Đó là nhịp kết ngày của cả thể loại, và nó biến ngôi
nhà từ một hình vẽ thành một nơi chốn. Cái giá là vài giây đi bộ; đổi lại là
đoạn duy nhất trong ngày người chơi nhìn thấy chỗ mình sống.

## Trong nhà thì không có mưa

Đây là phần dễ quên nhất, và là phần hỏng thì thấy ngay: lớp phủ mưa, lớp phủ
đêm, hạt mưa và đàn bướm đều đang vẽ cho cả cảnh.

Một thuộc tính bản đồ là đủ, đặt ngay trong Tiled cạnh `displayName` và `music`:

```ts
// src/game/world/tiled.ts — AreaMap
/** Đúng khi khu vực này ở trong nhà: không mưa, không trời đêm. */
indoor: boolean;
```

Nó đổi bốn chỗ, chỗ nào cũng một dòng:

- [`soundtrack.ts:259`](../../src/game/audio/soundtrack.ts) — `musicFor` hỏi thời
  tiết trước tiên, nên đứng trong nhà vẫn nghe nhạc mưa. Trong nhà thì
  `areaMusic(area)` thắng, và tiếng mưa còn lại là tiếng mưa *ngoài cửa sổ*, tức
  là việc của sfx chứ không phải của nhạc nền. Nhạc đêm cũng nhường như vậy, nếu
  không thì bước qua cửa lúc tám giờ tối chẳng đổi được gì.
- `FOOTSTEP_SOUNDS` là `Record<TileKind, SoundId | null>` nên hai `kind` mới bắt
  buộc phải có nhánh — trình biên dịch sẽ nhắc. `wall: null` vì không ai đứng lên
  tường được, còn `floor` cần một tiếng bước trên gỗ: `footstep-wood`, tổng hợp
  bằng `npm run generate:audio` như mười tám tiếng động kia.
- `FarmScene` — lớp phủ ngày/đêm, lớp phủ hoàng hôn, hạt mưa và bướm tắt khi
  `indoor`. Lò sưởi thay mặt trời: nó là nguồn sáng duy nhất của căn phòng, và
  ánh lửa nhấp nháy của nó dùng lại đúng thứ đang làm cửa sổ nhà sáng lên ban
  đêm.
- `allMusic` nhận thêm một khu vực, nên bản nhạc trong nhà phải nằm trong danh
  sách `preload` — nếu không, lần đầu bước vào nhà là một khoảng im lặng.

## Thay đổi ở reducer

Gần như không có, và đó mới là điểm đáng nói của spec này.

- `isWalkable` đọc thêm `map.colliders` — năm dòng, ở `areas.ts`, không phải ở
  reducer.
- Không có intent mới, không có `ClientCommand` mới, không có trường mới trong
  `FarmState`.
- **Không phải tăng `SAVE_VERSION`.** `player.area` chỉ có thêm một giá trị hợp
  lệ; bản lưu cũ mang `'farm'` và vẫn qua được `isAreaId`. Đây là lý do spec này
  không nợ ai một lần migrate.
- Server không đổi một dòng: `FarmRoom` không có chữ "area" nào trong nó, nó chạy
  đúng reducer kia. Người chơi bước vào nhà tự động biến mất khỏi màn hình ba
  người còn lại, vì `FarmScene` đã lọc theo `player.area === this.builtArea`.

## Client

- `buildArea` đã lo việc dựng lại cảnh khi đổi khu vực, nên bản đồ mới không cần
  mã vẽ mới — chỉ cần các texture mới có mặt trong manifest LPC.
- `renderProps` vẽ prop theo bề ngang footprint rồi cho nó đứng trên cạnh dưới.
  Luật đó đúng cho giường và tủ y như cho cây, **miễn là art được cắt sát**: một
  hàng trong suốt ở đáy PNG là một prop lơ lửng, và `png.test.mjs` đã có bài
  kiểm tra chặn đúng lỗi đó cho các prop tự do kích thước.
- Camera trong một bản đồ nhỏ hơn viewport: bản đồ 12x9 là 384x288 px, nhỏ hơn
  khung 960x640. Kiểm tra `setBounds` canh giữa căn phòng chứ không kẹp nó về góc
  trên-trái.

## Kiểm thử

- `areas.test.ts` chạy vòng qua mọi khu vực nên bản đồ mới vào thẳng các bài đã
  có: mọi prop có `interact` đều phải có chỗ đứng cạnh nó, mọi cổng phải đáp vào
  một ô đi được.
- Một bài mới, và là bài quan trọng nhất: **đi qua cổng, quay lại, và đứng đúng
  chỗ cũ** — chốt luật "ô đáp không phải là cổng". Hỏng luật này là treo game,
  không phải vẽ sai.
- Một bài nữa: ô cửa (5,6) trên nông trại phải `isWalkable`, còn (4,6) và (6,6)
  thì không — cái lỗ đúng bằng một ô, và đúng ở cột cửa.
- `soundtrack.test.ts`: trong nhà, trời mưa, vẫn không ra nhạc mưa.
- e2e: đi vào nhà, ngủ, sáng hôm sau tỉnh dậy vẫn ở trong nhà.

## Art: lấy ở đâu và lấy ô nào

Cùng dòng LPC với toàn bộ art đang có, cùng họ giấy phép CC-BY-SA, và **32px
nguyên bản** — không phóng to, không thu nhỏ, không phải vẽ lại.

| Gói | Giấy phép | Tấm | Dùng cho |
| --- | --- | --- | --- |
| [[LPC] Floors](https://opengameart.org/content/lpc-floors) | CC-BY-SA 4.0 | 1024x2048, ô 32px | sàn gỗ, thảm |
| [[LPC] Walls](https://opengameart.org/content/lpc-walls) | CC-BY-SA 3.0 | 2048x3072, ô 32px | tường vữa khung gỗ |
| [[LPC] Wooden Furniture](https://opengameart.org/content/lpc-wooden-furniture) | CC-BY-SA 4.0 / 3.0 / GPL 3.0 | 512x1024, ô 64px | giường, bàn, ghế, bếp, lò sưởi, tủ |
| [[LPC] Windows & Doors](https://opengameart.org/content/lpc-windows-doors) | CC-BY-SA 3.0 / GPL 3.0+ | 1024x768 | cánh cửa |

Ô đã chọn, đếm từ 0:

- **Sàn** — `floors.png` cột 6, hàng 37: ván gỗ dọc màu mật ong, lát so le. Đã
  dựng thử một mảng 4x4 ô để kiểm: ghép liền mạch, không thấy đường nối.

  ```sh
  node scripts/import-lpc.mjs downloads/floors.png tile-floor-wood --grid 32 --cell 6,37
  ```

- **Tường** — `walls.png` cột 52..63, hàng 56..58: vữa kem với khung gỗ sẫm, đúng
  tông với mặt ngoài gạch đỏ của ngôi nhà. Một bộ tường LPC gồm mặt tường, chân
  tường và viền trần, nên nó chiếm hai hàng ô chứ không phải một.
- **Đồ đạc** — `blonde-wood.png`, gỗ sáng và ấm. Tấm này có sẵn giường đơn và
  giường đôi, bàn tròn và bàn chữ nhật, ghế, băng ghế, tủ bếp kèm bếp lò, tủ quần
  áo, đồng hồ quả lắc và **một cái lò sưởi**. Ô 64px, nên một món là 2x2 ô bản đồ.
  `dark-wood.png` là đúng bộ đó màu sẫm, để dành cho bản nâng cấp nhà sau này.

**Giấy phép là việc bắt buộc, không phải phép lịch sự.** Cả bốn gói đòi kèm
nguyên văn danh sách tác giả. Làm y như đã làm với gói cây trồng: một mục trong
[`public/assets/lpc/CREDITS.md`](../../public/assets/lpc/CREDITS.md) và file
credits gốc chép nguyên vào `public/assets/lpc/credits/`. Gói Floors là CC-BY-SA
**4.0** trong khi art hiện có là 3.0 — hai giấy phép này sống chung được trong
cùng một game, nhưng phải ghi đúng của ai là của nấy, nên đừng gộp mục.

Ba tấm đầu đã tải về và soi kỹ khi viết spec này: cả ba đều là PNG RGBA 8-bit,
đọc được bằng `scripts/lib/png.mjs` sẵn có, và `trans="ff00ff"` trong file `.tsx`
đi kèm chỉ là siêu dữ liệu cũ — ảnh có kênh alpha thật, không phải nền hồng.

## Đã làm khác đi ở đâu

Ghi lại để người đọc spec sau không phải tự dò ra từ diff.

- **Giường một ô ngang, lò sưởi ba ô.** Tấm `blonde-wood.png` không đặt đồ trên
  lưới 64px như bảng art trên kia tưởng: giường là 32x63, lò sưởi 96x72. Luật
  "32px nguyên bản, không phóng to" thắng cái footprint vẽ trước, nên footprint
  đổi theo art chứ không phải ngược lại.
- **Lò sưởi dựa tường sau, không đứng giữa phòng.** Nó là một cái lò xây vào
  tường nhìn thẳng từ phía trước; đặt ở (8,4) thì nó là một bức tường lửng mọc
  giữa sàn. Tấm thảm chuyển ra trước nó, và được đệm thành 96px bề ngang
  (`box`) để canh giữa được trên ba ô.
- **Lò sưởi có lửa.** Tấm furniture vẽ lò nguội — một vòm tối trên bệ đá — và
  riêng quầng sáng `glow` thì trông như sương hồng chứ không như lửa. Scene thêm
  hai khung `hearth-fire-0/1` vẽ bằng palette, lật qua lại, và nhuộm quầng sáng
  sang cam `light.4`.
- **Không lấy gì từ gói Windows & Doors.** Cửa nằm ở tường dưới, mà nhìn từ trên
  xuống thì cửa ở tường dưới là một khoảng trống trên viền trần; hai ô viền
  `tile-wall-door-left/right` đóng khung nó. Gói đó để dành cho cửa sổ trên
  tường sau khi có ai muốn trang trí.
- **Tài nguyên không mọc trong nhà.** Không có trong bản thiết kế, và là lỗi
  thấy ngay khi chụp màn hình: `seedNodes` coi mọi khu vực không phải nông trại
  hay rừng là làng, nên buổi sáng đầu tiên rắc hoa dại lên sàn gỗ. `canHoldNode`
  giờ từ chối mọi khu vực `indoor`, và vì cả gieo lẫn mọc qua đêm đều hỏi nó,
  luật chỉ nằm ở một chỗ.
- **Camera tự đệm bounds.** `setBounds` của Phaser kẹp một bản đồ nhỏ hơn khung
  về mép trái-trên, đúng như phần Client đã nghi. `FarmScene.fitCameraBounds`
  đệm bounds ra bằng khung nhìn ở cả hai phía, và chạy lại mỗi lần resize.
- **Nhạc trong nhà là một bản mới, `home-loop`**, tổng hợp cùng chỗ với bốn bản
  kia: cùng giọng Đô trưởng của nông trại, thấp hơn một quãng tám và thưa hơn.
- **e2e không đi bộ từ điểm xuất phát tới cửa.** Giữ phím theo thời gian không
  canh trúng được một ô cửa rộng 32px trên tốc độ khung hình bài test không
  kiểm soát. Bài test sửa bản lưu để đặt người chơi trước thềm, rồi dùng chính
  tường trong phòng làm thước để đi tới giường.

## Ngoài phạm vi

Nâng cấp nhà (bếp lớn hơn, thêm phòng, cái nôi), nấu ăn và hiệu ứng buff, rương
đồ, trang trí và đặt đồ nội thất, nội thất chuồng trại, và NPC bước vào nhà — cái
cuối cần A*, và chỗ phải sửa đã được đánh dấu sẵn ở
[`schedule.ts:137`](../../src/game/npcs/schedule.ts).
