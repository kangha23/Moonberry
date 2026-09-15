# 08 — Khung game, và một ngôn ngữ thị giác

**Phụ thuộc:** [05 — Một HUD, và con chuột](05-hud-and-mouse.md). Spec này mở rộng
quyết định của nó chứ không lật lại.

## Mục tiêu

Làm cho nó trông như một trò chơi, chứ không phải một trang web có trò chơi nhúng
trong đó.

## Vì sao

Mọi thứ đã làm tới giờ đều là cơ khí. Spec này là cái đầu tiên nói về thứ người
chơi nhìn thấy trong hai giây đầu, và hai giây đó hiện đang nói: đây là một trang
giới thiệu sản phẩm.

Ba bằng chứng đo được, không phải ý kiến:

**Thanh hotbar nằm dưới màn hình ở 1440×900.** Phần tiêu đề chiếm 270px trên cùng,
khung game bắt đầu ở khoảng y=300, và canvas cao 640px. Người chơi phải cuộn trang
để nhìn thấy thứ mình đang cầm trên tay. Đây là lỗi, không phải lựa chọn.

**Không có chế độ toàn màn hình.** `grep -ri fullscreen src/` trả về rỗng. Canvas
cố định 960×640 ([`constants.ts`](../../src/game/constants.ts)) với
`Phaser.Scale.FIT`, nên trên màn hình lớn nó là một ô nhỏ được phóng to bằng CSS
`width: 100%` — tỉ lệ không nguyên, và pixel art bị nhoè đúng thứ mà `pixelArt:
true` được bật để tránh.

**Hai ngôn ngữ thị giác đang đánh nhau.** Game là pixel art; giao diện là web app:
bo góc 22–30px, `backdrop-filter: blur`, gradient mềm, font Fredoka bo tròn. Biến
`--font-pixel` có được khai báo trong [`styles.css`](../../src/styles.css) và được
dùng ở đúng một chỗ — mã mời. Ngay cả HUD **trong canvas** cũng vẽ bằng
`fontFamily: 'Fredoka, Nunito, monospace'`.

## Phần A — Lấy lại màn hình

**Bỏ phần tiêu đề và bỏ cột bên phải.** Trang trở thành canvas và không gì khác.
Những gì cột đó đang giữ — bộ trộn âm thanh, mã mời, nút tạo nông trại mới, bảng
điều khiển — chuyển vào một menu mở bằng Escape.

Đây là chỗ Escape đang có nghĩa khác: hiện nó đóng hành trang và huỷ việc đặt công
trình. Thứ tự ưu tiên, và phải viết đúng thứ tự này:

1. Đang đặt công trình → huỷ việc đặt.
2. Đang mở một bảng → đóng bảng.
3. Không có gì mở → mở menu.

**Thêm toàn màn hình**, bằng `scale.startFullscreen()` của Phaser, gắn vào phím F
và một nút trong menu. Toàn màn hình là trạng thái của trình duyệt chứ không phải
của game, nên nó không vào `FarmState` và không vào bản lưu.

### Chuyện tỉ lệ, và nó không hiển nhiên

Có hai cách phóng to và chúng cho ra hai trò chơi khác nhau:

1. **Phóng to nguyên khung** — vẫn 960×640 thế giới, mỗi pixel thành 2×2. Đơn
   giản, và trên màn 1440×900 tỉ lệ là 1.4 lần chứ không phải 2, nên pixel méo.
   Muốn tránh thì phải chấp nhận viền đen.
2. **Giữ nguyên kích thước pixel, cho thấy nhiều thế giới hơn** — màn hình to thì
   nhìn được xa hơn. Đây là cách Stardew làm.

**Chọn cách 2**, với `Phaser.Scale.RESIZE` và một mức thu phóng camera *nguyên*
chọn theo kích thước cửa sổ:

```ts
/**
 * Mức phóng, luôn là số nguyên.
 *
 * Số nguyên là toàn bộ điểm của hàm này: 1.4 lần làm một tile 32px thành 44.8px,
 * và pixel art ở tỉ lệ không nguyên thì nhấp nháy khi camera di chuyển.
 * Thà thấy nhiều thế giới hơn một chút còn hơn thấy nó nhoè.
 */
export function zoomFor(width: number, height: number): number {
  return Phaser.Math.Clamp(Math.floor(Math.min(width / 640, height / 400)), 1, 4);
}
```

Hàm thuần, nên nó kiểm thử được — và nó là thứ duy nhất trong phần A kiểm thử
được, nên viết nó ra riêng thay vì nhét vào `resize`.

Cách 2 có một cái giá phải nói rõ: **một người chơi màn hình lớn nhìn được xa hơn
một người chơi màn hình nhỏ.** Trong một game hợp tác không có đối kháng thì điều
đó chấp nhận được. Nếu sau này có gì cạnh tranh, phải xem lại.

`GAME_WIDTH`/`GAME_HEIGHT` không còn là kích thước canvas mà thành kích thước
*thiết kế* của HUD. Mọi chỗ đang đặt HUD theo hai hằng số đó trong
[`FarmScene.ts`](../../src/game/scenes/FarmScene.ts) phải đọc từ camera thay vì
đọc hằng số — đây là phần việc lớn nhất của phần A và nó rải khắp `createUi`.

## Phần B — Một font, một cái khung

`Press Start 2P` đã được nạp sẵn trong [`index.html`](../../index.html) và **không
dùng được nữa** kể từ khi game nói tiếng Việt: nó không có khối U+1EA0–U+1EF9.

Điều xảy ra khi thiếu không phải ô vuông — trình duyệt và canvas đều **rơi sang
font khác giữa chừng một từ**, nên "Thể lực" ra hai kiểu chữ dính nhau. Tệ hơn ô
vuông, vì nó trông như một lỗi vặt thay vì một lỗi.

### Đã khảo sát, và kết quả

Dò `unicode-range` của Google Fonts rồi tải font về đếm cmap bằng `fontTools`.
Khối dấu tiếng Việt là **90 điểm mã** (U+1EA0–U+1EF9), cộng ĂăĐđ và ƠơƯư:

| Font | U+1EA0–1EF9 | Kết luận |
| --- | --- | --- |
| VT323 | 90/90 | Dùng được |
| Handjet | 90/90 | Dùng được |
| Departure Mono | 16/90 | Không |
| Ark Pixel / Fusion Pixel | 0/90 | Không, dù là font pan-CJK |
| Press Start 2P, Silkscreen, Pixelify Sans, Tiny5, Jersey 10–25, Micro 5 | 0/90 | Không |

**Trên Google Fonts chỉ có đúng hai font pixel đủ dấu: VT323 và Handjet.**

Các bộ "font pixel Việt hoá" trôi nổi trên mạng phần lớn là bản chế lại từ font
thương mại, không kèm giấy phép rõ ràng. Repo này đã có kỷ luật giấy phép trong
`public/assets/lpc/CREDITS.md`; đừng phá nó vì một cái font.

### Quyết định: VT323 cho HUD, Nunito cho câu dài

Handjet là font ma trận điểm kiểu biển LED, và ở cỡ 13px thì dấu chồng hai tầng
(ế, ộ, ữ) dính vào nhau. VT323 là font terminal DEC — không phải font game, và
đó là nhược điểm thật — nhưng nó đọc được ở mọi cỡ HUD và nó đơn cách, nên số
trong HUD thẳng cột.

Vậy nên **không** dùng một font cho mọi chữ:

- **VT323** cho đồng hồ, tiền, thể lực, số ô, nhãn ngắn, tiêu đề bảng. Cỡ ≥16px.
- **Nunito** giữ nguyên cho lời thoại, mô tả vật phẩm, và mọi câu dài.

VT323 chỉ có một nét, không có bold — nên nhấn mạnh phải bằng màu, không bằng độ
đậm.

### Nếu sau này muốn một font game thật

`Press Start 2P` có `capHeight == ascender == upem == 1000`: **không còn một pixel
nào phía trên chữ hoa.** Không thể thêm dấu vào nó mà không vẽ lại toàn bộ font ở
chiều cao nhỏ hơn. Đó là lý do gần như không có font pixel nào làm tiếng Việt —
dấu chồng hai tầng cần chỗ mà font pixel không có.

`Silkscreen` thì khác: capHeight 700, ascender 1030, tức **thừa 0.33em phía trên**,
và đã có sẵn huyền, sắc, ngã, mũ. Nó là nền tốt để tự dựng một font pixel tiếng
Việt, và nó là OFL nên được phép sửa và phát hành lại dưới tên khác.

Đó là một phần việc riêng, không nằm trong spec này.

**Bảng gỗ thay cho kính mờ.** Panel hiện tại là `border-radius: 22px` +
`backdrop-filter: blur(2px)` + gradient. Thay bằng khung 9-slice: một PNG viền gỗ,
`border-image`, góc vuông, không blur. Áp cho cả ba bảng React
([`InventoryScreen`](../../src/components/InventoryScreen.tsx),
[`ShopPanel`](../../src/components/ShopPanel.tsx),
[`WorkshopPanel`](../../src/components/WorkshopPanel.tsx)) và cho các hộp vẽ bằng
`this.add.rectangle` trong canvas.

Khi đó viền trong canvas và viền trong React là **cùng một file ảnh**, và đó chính
là điều làm hai lớp thôi đánh nhau.

## Phần C — Đồng hồ thành một vật thể

Đồng hồ hiện là hai dòng chữ:

```
Ngày 5 · 9:10 AM
Xuân · 17g
```

Thay bằng một bảng có: mặt đồng hồ hình cung với một kim chạy từ 6h tới 2h, tên
mùa kèm icon, icon thời tiết, và số vàng kèm icon đồng xu. Cùng thông tin, nhưng
nó thuộc về thế giới thay vì nằm đè lên thế giới.

**Thanh thể lực thành một ống dọc** ở góc dưới phải, đổ đầy từ dưới lên, đổi màu
xanh → vàng → đỏ. Thanh ngang kèm chữ "Thể lực 135/270" hiện tại đọc như một thanh
tiến trình phần mềm. Giữ lại con số, nhưng chỉ hiện khi rê chuột vào.

## Phần D — Autotiling

Đường đất hiện cắt vào cỏ bằng cạnh chữ nhật cứng. Đó là thứ khiến bản đồ trông
như một lưới ô vuông chứ không như một mảnh đất.

**Bitmask 4 hướng**, không phải 8:

```ts
/**
 * Chỉ số tile viền, 0–15, từ bốn ô kề.
 *
 * Bốn hướng chứ không phải tám: 16 biến thể cần 16 ô trong bộ tile, còn 47 ô
 * của bitmask 8 hướng thì đẹp hơn và là gấp ba lần việc vẽ. Ở khoảng cách
 * camera này, khác biệt gần như không thấy.
 */
export function edgeMask(
  kindAt: (x: number, y: number) => TileKind | null,
  x: number,
  y: number,
): number;
```

Hàm thuần trong [`tiled.ts`](../../src/game/world/tiled.ts), tính một lần khi phân
tích khu vực chứ không tính mỗi khung hình. Áp cho ba ranh giới: cỏ↔đường,
cỏ↔nước, đường↔nước.

Đây là mục rẻ nhất trong cả spec — không cần vẽ thêm gì ngoài 16 ô viền mỗi ranh
giới, và nó thay đổi ảnh chụp màn hình nhiều hơn phần B.

## Phần E — Bản tóm tắt buổi sáng, có hình

`docs/specs/README.md` viết: *"Cảm giác được thể hiện, không được thuật lại. Thanh
nhắc là phương án dự phòng, không phải kênh chính."*

Hiện thanh nhắc đang là kênh chính. Buổi sáng nó nói *"Ngày 5 bắt đầu. 0 luống đã
lớn lên qua đêm."* — một câu văn ở chỗ đáng lẽ là một bảng có icon cây, icon công
cụ vừa xong ở lò rèn, icon công trình vừa dựng xong.

Bảng tóm tắt đã tồn tại (`createSummaryPanel`). Việc ở đây là cho nó hình thay vì
cho nó dòng chữ, dùng lại [`itemIcons.ts`](../../src/game/assets/itemIcons.ts) đã
có sẵn.

## Những gì không được làm hỏng

Spec này đụng vào lớp trình bày, nơi dễ làm hỏng thứ không ai kiểm thử:

- **Một HUD, và nó ở trong canvas.** Luật của spec 05. Menu Escape là ngoại lệ duy
  nhất, và nó được phép vì nó nói về chương trình chứ không nói về thế giới.
- **Vùng `sr-only` phải sống sót.** Cái `role="status" aria-live="polite"` trong
  [`App.tsx`](../../src/App.tsx) là thứ duy nhất khiến game này chơi được bằng
  trình đọc màn hình. Bỏ phần khung React đi mà mang theo nó là hỏng lặng lẽ.
- **`:focus-visible` trên mọi control.** Menu Escape phải giữ được focus bên trong
  nó và trả focus về canvas khi đóng.
- **Chuột và bàn phím ngang nhau.** Luật của spec 05, và menu mới không được là
  chỗ đầu tiên vi phạm.

## Nợ nghệ thuật, và vì sao nó không nằm trong spec này

`public/assets/lpc/` có **20 file PNG** cho cả trò chơi. Trong đó có đúng hai
sprite nông sản — củ cải và dâu — nên mười một loại cây còn lại đang chạy bằng kết
cấu sinh tự động. Năm người làng dùng chung hai sheet, phân biệt bằng `tint`.

Đó là trần thật sự của cảm giác thị giác, và **không có dòng mã nào nâng nó lên.**
Spec này làm được phần khung, phần chữ, phần viền và phần ranh giới tile — tức là
kéo mọi thứ lên tới đúng cái trần đó. Vượt qua nó là việc vẽ, và việc vẽ là một
phần việc riêng với một người khác làm.

Nói rõ để không ai làm xong spec này rồi tự hỏi vì sao nó vẫn chưa giống Stardew.

## Kiểm thử

Phần lớn spec này là thứ mắt nhìn, nên phải trung thực: unit test không kiểm được
"trông có đúng không". Những gì kiểm được, và đáng kiểm:

- `zoomFor` trả về số nguyên, kẹp trong 1–4, và không bao giờ trả 0.
- `edgeMask` đúng ở cả 16 tổ hợp, và ở biên bản đồ nơi ô kề là `null`.
- **Hồi quy cho lỗi đã tìm thấy:** ở 1366×768, thanh hotbar nằm trong khung nhìn
  mà không phải cuộn. Một bài Playwright, và nó là lý do cả spec này tồn tại.
- Không có cuộn ngang ở bề rộng 400px.
- Escape theo đúng ba mức ưu tiên, mỗi mức một ca.
- Menu giữ focus bên trong khi mở, và trả focus về canvas khi đóng.
- Vùng `aria-live` vẫn có mặt và vẫn đổi nội dung khi thanh nhắc đổi.
- Chuyển sang toàn màn hình rồi thoát ra thì HUD về lại đúng chỗ, không kẹt ở kích
  thước cũ.

## Ngoài phạm vi

Vẽ thêm tranh, sprite nhân vật mới, hoạt ảnh chân dung khi nói chuyện, màn hình
tiêu đề, màn hình tạo nhân vật, tuỳ chọn tỉ lệ giao diện, hỗ trợ tay cầm, và dịch
sang ngôn ngữ thứ ba.
