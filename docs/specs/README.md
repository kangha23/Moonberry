# Specs

Mười một phần việc đã đưa Moonberry từ một cỗ máy trồng trọt biết chạy thành một
trò chơi đáng chơi, và ba phần việc nữa để nó trông như một trò chơi và có chiều
sâu đầy đủ của thể loại. Mỗi spec tự chứa: mục tiêu, những quyết định không hiển nhiên, cái
gì đổi ở đâu, và làm sao biết là nó chạy đúng.

## Phần đã xong — vì sao theo thứ tự đó

Game lúc đầu có một vòng lặp trồng trọt hoàn chỉnh và không có lý do gì để quan
tâm tới nó. Không gì khan hiếm nên không gì là quyết định; không gì tích luỹ nên
không ngày nào quan trọng hơn ngày trước. Spec 01 sửa cái thứ nhất và spec 06 sửa
cái thứ hai. Mọi thứ còn lại là chiều sâu đặt lên trên hai cái đó.

| # | Spec | Phụ thuộc | Vì sao nó ở đây |
| --- | --- | --- | --- |
| 01 | [Năng lượng và giấc ngủ](01-energy-and-sleep.md) | — | Biến vòng lặp thành trò chơi. Hiệu quả cao nhất trên công sức bỏ ra. |
| 02 | [Âm thanh](02-sound.md) | — | Rẻ nhất tính theo cảm giác trên mỗi giờ làm. Độc lập với mọi thứ. |
| 03 | [Ô hành trang](03-inventory-slots.md) | — | Mang tính cấu trúc. Chặn 04, 06, 07. |
| 04 | [Mùa và cây trồng](04-seasons-and-crops.md) | 03 | Cho tấm lịch một ý nghĩa và cho việc lập kế hoạch một tầm nhìn. |
| 05 | [Một HUD, và con chuột](05-hud-and-mouse.md) | 03 | Sửa cái đang sai, chứ không chỉ thêm cái đang thiếu. |
| 06 | [Công cụ và công trình](06-tools-and-buildings.md) | 03 | Cái bánh cóc: mỗi ngày kết thúc với năng lực cao hơn lúc bắt đầu. |
| 07 | [NPC đáng ghé thăm](07-npc-relationships.md) | 03 | Lý do ở lại một khi nông trại đã tự chạy. |
| 08 | [Khung game và ngôn ngữ thị giác](08-frame-and-look.md) | 05 | Hai giây đầu từng nói "trang giới thiệu sản phẩm". Rẻ nhất tính theo ấn tượng đổi được. |
| 09 | [Vật nuôi](09-animals.md) | 06 | Chuồng hết là vỏ rỗng, và tháng Chạp hết là tháng chết. |
| 10 | [Thu thập tài nguyên](10-resources-and-tools.md) | 06 | Gỗ và đá bắt đầu tồn tại, và nông trại bắt đầu ở trạng thái đáng khai phá. |
| 11 | [Chế tác](11-crafting.md) | 10, tốt hơn sau 09 | Cho cái kho một cái ruột, và cho nông trại bậc thang thứ hai. |
| 12 | [Câu cá](12-fishing.md) | 10 | Ba mươi ô nước thôi chỉ là tường chắn, và buổi tối thôi là chỗ trống. |
| 14 | [Bước vào trong nhà](14-farmhouse-interior.md) | — | Ngôi nhà thôi là mặt tiền, và giấc ngủ có một cái giường. |
| 15 | [Phố Việt](15-vietnamese-street.md) | 07, 11, 04 | Một khu phố nghe tiếng Việt. Bước đầu của thành phố, không trả giá của nó. |

## Phần còn lại

Spec 13 lấp trụ cột cuối cùng mà thể loại có và game này chưa có. Nó lớn hơn
phần lớn những cái trên, và nó đứng được một mình.

| # | Spec | Phụ thuộc | Vì sao nó ở đây |
| --- | --- | --- | --- |
| 13 | [Mỏ và chiến đấu](13-mine-and-combat.md) | 10, 11 | Nơi kim loại đến từ. Hệ thống duy nhất có rủi ro. |

### Về thứ tự

**08 đi trước mọi thứ còn lại**, và không phải vì nó quan trọng nhất. Nó đi trước
vì nó đụng vào `FarmScene.createUi` và vào cả bốn bảng React, còn mỗi spec sau đó
lại thêm một bảng hoặc một mảnh HUD nữa. Làm 08 sau nghĩa là viết những mảnh đó
hai lần: một lần theo kiểu cũ, một lần theo kiểu mới.

Nó cũng là một trong hai cái **không đổi `FarmState`** — cái kia là 14 — nên cả
hai chen vào trước mà không nợ ai một lần migrate bản lưu.

**09 đã làm trước 10, và đã trả đúng cái giá spec 09 báo trước — rồi 10 đã trả
lại.** Trong một thời gian, cỏ khô chỉ mua được ở bãi quây, nên silo là một công
trình 900g mà người chơi buộc phải dựng để có chỗ chứa thứ họ vẫn phải bỏ tiền
mua. Liềm đã sửa chuyện đó: cắt cỏ ngoài đồng đổ thẳng cỏ khô vào kho, và khoản
chi hằng tuần kia thành một buổi sáng làm việc. Bãi quây vẫn bán cỏ, và giờ nó là
đúng cái nó nên là — phương án dự phòng cho một tuần bận, chứ không phải nguồn
duy nhất.

**12 đã làm sau 11 dù nó không cần phải thế**, và cái giá của việc đó hoá ra là
một dòng: mồi câu là công thức duy nhất spec 12 mượn của spec 11, và nếu 12 đi
trước thì mồi sẽ là một thứ mua ở sạp thay vì một thứ tết từ sợi. Đi sau thì nó
là dòng thứ mười sáu trong `RECIPES` và không có gì khác phải bàn.

**14 không phụ thuộc spec nào**, và đúng như nó hứa, nó không đổi `FarmState`:
căn phòng không có HUD nào của riêng mình, chỉ là một bản đồ, một cờ `indoor` và
bộ art nội thất.

13 nên đi cuối dù có làm gì trước, vì nó là cái duy nhất phá vỡ một giả định nền:
**bản đồ không còn tĩnh nữa.**

### Spec 10 để lại gì cho những cái sau

Đáng ghi lại, vì hai spec còn lại đều dựng trên đúng những thứ này:

- **`ResourceNode` là state, không phải prop Tiled**, và `isWalkable` nhận một
  đối tượng `Blockers` thay vì thêm một tham số nữa. Spec 13 thêm một trường vào
  đó chứ không thêm một đối số vào mọi chỗ gọi.
- **Khu rừng tồn tại**, và cái ao trong đó là chỗ spec 12 câu cá — hoá ra cả ba
  bản đồ đều có bờ nước đứng được, nên bảng cá chia theo vùng nước chứ không dồn
  vào một cái ao. Thêm một bản đồ là một file Tiled và một dòng trong `AREA_FILES`.
- **Gỗ, gỗ cứng, đá, than, sợi và nhựa cây đều có trong bảng vật phẩm**, mang
  `sellPrice` mà chưa có gì thu. Chúng cố tình *không* mang `produce`, nên một
  chuyến ra sạp chợ không bao giờ âm thầm bán mất đống gỗ đang để dành. Spec 11
  là thứ tiêu chúng.
- **Đá không mọc lại trên nông trại.** Đó là lời hứa với spec 13: nơi kim loại đến
  từ là cái mỏ, chứ không phải một cái sân tự sinh đá vô hạn.

### Những gì vẫn chưa có spec

Nói rõ để không ai tưởng danh sách này là đủ. Vẫn còn thiếu: nấu ăn và hiệu ứng
buff, kỹ năng và cấp độ, lễ hội theo mùa, hôn nhân và gia đình, hệ thống bó vật
phẩm kiểu Community Center, bảo tàng và cổ vật, nâng cấp nhà, và tài khoản thật
thay cho token gắn với một trình duyệt.

Trong số đó, **kỹ năng và cấp độ** là cái nên viết spec tiếp theo, vì nó đan vào
mọi thứ đã có: chặt cây lên cấp Hái lượm, đào lên cấp Khai mỏ, câu cá lên cấp Câu
cá, và mỗi cấp mở công thức ở spec 11. Làm nó sau cùng nghĩa là phải quay lại sửa
cả ba chỗ — và sau spec 10 và 12 thì chặt cây, đào đá và kéo cá đều đã tồn tại,
nên chỗ để móc vào đã sẵn sàng.

### Spec 15 để lại gì

- **Một prop có thể mang chữ.** `sign` trên prop có bảng (`shopfront*`),
  client vẽ bằng font hệ thống lên hộp `SIGNBOARD`. Thuộc tính prop giờ là
  danh sách đóng: gõ sai tên là lỗi load map.
- **Một quầy có thể có người trông.** `STALLS` trong `shop.ts` cho phép nhiều
  sạp dùng chung panel chợ với stock riêng, và `keptBy` gắn giờ mở cửa với
  một activity trong lịch NPC chứ không với tên NPC.
- **NPC có thể làm việc ngoài village.** Bà Xoan ở village, bán ở `plaza`;
  `advanceNpcs` cho người đổi map "tới luôn", nên không cần gì thêm.
- **Test đối xứng portal quét mọi map**, nên thêm map mới mà quên cửa về là đỏ.

### Spec 14 để lại gì

- **Hình vẽ và vật cản đã tách nhau.** Object `collider` trong Tiled chặn đường
  mà không vẽ gì, nên một công trình có cửa là một prop không solid cộng vài
  collider. Chuồng gà và chuồng bò về sau dùng lại đúng cách đó.
- **`indoor` là một thuộc tính bản đồ**, và nó tắt thời tiết, trời đêm, nhạc
  mưa và việc mọc tài nguyên. Một khu vực trong nhà mới — hầm mỏ ở spec 13 chẳng
  hạn — chỉ cần đặt cờ đó.
- **Giường ở trong nhà**, nên mọi bài test đưa người chơi đi ngủ đều đặt họ vào
  `'farmhouse'`.

### Spec 12 để lại gì

- **Reducer có một hệ thống chạy theo khung hình, không theo nhịp đồng hồ.**
  `advanceFishing` chạy trên `deltaMs` thô ngay đầu `applyTick`, trước vòng lặp
  mười phút một bước; nó là chỗ duy nhất trong game làm thế, và lý do nằm ở
  `MAX_STEP_MS` trong `fishing.ts`. Spec 13 nếu muốn một pha chiến đấu thời gian
  thực thì móc vào đúng chỗ đó.
- **Bảng bậc công cụ có ba trục chứ không còn hai.** `TierDef` giờ mang thêm
  `barWidth`, và cần câu là món duy nhất vừa bán ở sạp vừa rèn ở lò.
- **Cá mang `produce`**, nên một chuyến ra chợ bán sạch mẻ cá trong ngày; mồi câu
  thì cố tình không mang, vì cùng lý do đống gỗ ở spec 10 không mang.

## Luật áp dụng cho mọi spec

**Đổi `FarmState` là đổi định dạng bản lưu.** Tăng `SAVE_VERSION` trong
`src/game/state/persistence.ts`, thêm một nhánh vào `migrate()` để nâng cấp từ
phiên bản trước, mở rộng `parseFarm` để kiểm tra các trường mới, và thêm một bài
kiểm thử rằng bản lưu do phiên bản cũ ghi vẫn tải được. Bản lưu không migrate
được thì bị từ chối, không bao giờ được đoán.

**Reducer phải thuần.** Không `Date.now()`, không ngẫu nhiên nào không dẫn xuất từ
state, không I/O, không Phaser, không DOM. Nếu một luật cần thời gian thì thời
gian đi vào như một phần của intent. Đây là thứ cho phép cùng một đoạn mã chạy
trên server và trong trình duyệt ngoại tuyến, và là thứ khiến tất cả kiểm thử
được.

**Máy khách đề nghị, server quyết định.** Bất cứ thứ gì mới mà máy khách yêu cầu
được đều đi qua `ClientCommand` trong `src/game/net/protocol.ts` và được kiểm tra
trong `parseClientCommand`. Hai thứ máy khách không bao giờ được tự khai: nó là
người chơi nào, và đã trôi qua bao nhiêu thời gian. Cái gì kiểm ở máy khách cho
mượt thì phải kiểm lại ở server cho đúng.

**Phần trình bày phản ứng theo sự kiện.** Reducer phát ra `GameEvent`; sprite, âm
thanh và thông báo là việc của lớp vẽ. Đừng thò vào store từ scene để phát hiện
một việc vừa xảy ra — hãy phát một sự kiện cho nó.

**Cảm giác được thể hiện, không được thuật lại.** Ưu tiên một hoạt ảnh, một tiếng
động, hay một hạt hiệu ứng hơn là một dòng chữ trên thanh nhắc. Thanh nhắc là
phương án dự phòng, không phải kênh chính.
