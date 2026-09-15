# Moonberry Farmstead

Một game nông trại nhập vai ấm áp, dựng bằng React 19, Vite, TypeScript và
Phaser 4.

> **Trạng thái: chơi được, nhiều người, dữ liệu bền.** Tối đa bốn người chơi chung
> một thế giới sống sót qua việc khởi động lại server, vào bằng mã mời. Không cấu
> hình server thì game lùi về một thế giới ngoại tuyến lưu trong trình duyệt.

## Hiện tại chơi được gì

- Ba khu vực dựng bằng Tiled — một nông trại 40x30, một ngôi làng, và một khu
  rừng có cái ao — nối nhau bằng những lối đi, với camera bám theo người chơi
  thay vì một màn hình cố định.
- Vòng lặp trồng trọt đầy đủ: cày, gieo, tưới, lớn qua đêm, thu hoạch, bán.
- Năng lượng: mỗi nhát cuốc hay mỗi lần tưới đều tốn một ít, thu hoạch thì miễn
  phí, và cạn sức thì bị kéo về nửa tốc độ chứ không bị chặn hẳn.
- Đi ngủ kết thúc một ngày. Đó là một cuộc bỏ phiếu: đêm chỉ trôi qua khi tất cả
  những người đang online đã nằm xuống, và thức tới 2 giờ sáng thì nông trại mất
  một phần mười ví tiền.
- Thời gian, chuyển ngày, thời tiết và mùa đều tất định.
- Mười ba loại cây trải khắp bốn mùa, mỗi loại chỉ trồng được đúng mùa của nó và
  chết ở ranh giới mùa — kèm ba ngày báo trước, một lớp màu héo, và một bản tóm
  tắt buổi sáng gọi tên những gì đã mất. Có loại mọc lại sau thu hoạch thay vì bị
  nhổ đi, và đó là lý do đáng cam kết một luống đất cho cả mùa.
- Một quầy chợ mua lại cả giỏ và bán hạt giống của mùa đang tới, trừ vào ví chung
  của nông trại.
- Nông trại bắt đầu ở trạng thái hoang: cỏ dại, đá và vài gốc cây cũ nằm khắp
  ruộng, và tuần đầu tiên là dọn nó ra. Rìu hạ cây lấy gỗ, cuốc chim đập đá lấy
  đá xây, liềm cắt cỏ dại lấy sợi và cắt cỏ thành cỏ khô đổ thẳng vào silo. Rìu
  và cuốc chim tốn sức; liềm thì không, vì cắt cỏ là việc vặt chứ không phải một
  quyết định. Gốc cây cần rìu đồng và tảng đá cần cuốc chim thép — và con trỏ
  chuyển đỏ trước khi bạn phí mười nhát vào một thứ không vỡ.
- Đất tự phục hồi qua đêm, tất định từ một hạt giống nằm trong `FarmState`: cỏ
  lan ra, cỏ dại mọc lại, cây con bén rễ quanh cây mẹ, và đồ hái theo mùa trở
  lại ngoài làng và trong rừng. Đá thì **không** mọc lại trên nông trại — đá đến
  từ mỏ, và đó là chuyện của spec 13. Sáng đầu mùa đông, cỏ chết sạch, và đó là
  lý do cái silo đáng dựng trước mùa thu.
- Mười hai loại đồ hái, ba mỗi mùa, mọc ở bìa rừng và bờ giậu. Chúng bán được ở
  sạp chợ và tặng được cho người làng — và chúng là lý do thứ hai để đi bộ sang
  bên kia bản đồ.
- Một thợ rèn trong làng nhận cuốc, bình tưới, giỏ, rìu hay cuốc chim và trả lại
  sau hai buổi sáng dưới dạng đồng, thép hoặc vàng. Liềm là ngoại lệ duy nhất:
  bậc công cụ mua lại sức, mà liềm vốn không tốn sức, nên nó chỉ có hai bậc và
  cái lưỡi hái vàng mua thẳng ngoài sạp chợ với giá 4000g. Công cụ tốt hơn xử lý cả một hình chữ nhật trong
  một nhát — tới 3x5 — và tốn ít sức hơn khi làm việc đó. Ông ấy giữ công cụ trong
  lúc làm, và đó là cái giá.
- Bốn công trình dựng được trên nông trại — kho, silo, chuồng gà, chuồng bò — đặt
  bằng cách kéo một khung mờ quanh đồng, trả bằng ví chung, và đứng đó như một
  giàn giáo cho tới khi thợ mộc xong việc. Chúng đặc: bạn đi sau lưng chuồng bò và
  đi trước mặt nó.
- Gà, vịt, bò và dê sống trong hai cái chuồng đó. Chúng thuộc về nông trại chứ
  không thuộc về ai: ai ra chuồng trước thì người đó nhặt trứng. Cho ăn tự động
  rút cỏ khô từ silo mỗi sáng; vuốt mỗi con một lần mỗi ngày, và mở cửa chuồng cho
  chúng ra bãi, là hai thứ đẩy độ quý mến lên — và độ quý mến quyết định trứng ra
  loại thường, loại tốt hay thượng hạng, tức là chênh nhau một nửa giá. Bỏ đói
  không giết con vật, chỉ lấy mất độ quý mến và sản phẩm sáng hôm sau.
- Một nguồn thu không phụ thuộc mùa, mà đó mới là điểm chính: đồng chết cả tháng
  Chạp, còn gà thì vẫn đẻ.
- Câu cá ở cả ba vùng nước, và nó là việc duy nhất trên nông trại **không tiêu
  một chút sức nào để làm** — chỉ cú ném là tốn tám điểm. Cần câu mua ngoài sạp
  chợ 500g rồi rèn lên đồng, thép, vàng; bậc cần câu không mua tầm với mà mua bề
  rộng ô vuông trên thanh, tức là mua khả năng giữ nổi con cá khó. Mười tám loài
  chia theo mùa, giờ, thời tiết và vùng nước — cá chình chỉ cắn câu lúc mưa, sau
  bốn giờ chiều, mùa thu, ở khúc sông trong làng; cá trăng thì mỗi năm được vài
  đêm — cộng ba thứ rác để thành công có nghĩa. Mồi tết từ sợi rút một nửa thời
  gian chờ.
- Con cá được bốc ngay lúc ném chứ không phải lúc bắt: chơi thanh giỏi quyết định
  **có** bắt được không, không quyết định bắt được **con gì**. Thanh chạy trên
  server, còn máy khách chỉ gửi nút kéo đang giữ hay đang thả — cùng đúng cái
  cách việc đi lại hoạt động, và cùng một lý do.
- Một hành trang 24 ô đồ xếp chồng được, mười hai ô trong đó là thanh nhanh, gồm
  công cụ, gói hạt, nông sản và một bình tưới có số lần dùng.
- Sáu người làng *sống* ở đó chứ không phải đứng ở đó: Rowan người giữ sổ sách,
  Maeve thợ rèn, Tobias ở quầy chợ, Juniper người hái lượm, Ash em trai cô ấy và
  Bram người bán gia súc.
  Mỗi người đi theo một lịch trình hằng ngày bị mùa và thời tiết bẻ cong — Maeve
  không làm lò ngoài trời khi mưa, Juniper ra ao vào đêm đom đóm — và có bảng quà,
  ngày sinh, cùng hơn hai chục câu thoại đổi theo trái tim, mùa, bầu trời và việc
  họ đang làm dở.
- Tình bạn là của bạn, không phải của nông trại. Hai món quà mỗi người mỗi tuần,
  một món mỗi ngày, và quà đúng sinh nhật tính gấp tám lần — đó là lý do đáng nhìn
  vào tấm lịch. Trái tim tính theo từng người chơi: dưa của bạn không làm cả nhóm
  thành bạn của Tobias.
- Nhiệm vụ vụ thu hoạch đầu tiên của Rowan và phần thưởng đi kèm.
- Tranh vẽ tay LPC/CC0, có kết cấu pixel sinh tự động làm phương án dự phòng.
- Tự động lưu vào trình duyệt, khôi phục khi tải lại, kèm nút "bắt đầu nông trại
  mới".
- Tối đa bốn người chơi trong một thế giới: chung đồng hồ, chung luống đất, chung
  nhiệm vụ và chung ví, mỗi người mang hành trang riêng. Người chơi chỉ được vẽ
  trên bản đồ họ đang đứng.
- Trồng trọt ở nông trại; quầy chợ, lò rèn và tất cả những người đáng nói chuyện
  thì ở trong làng.
- Thế giới lưu trong SQLite và vào bằng mã mời sáu ký tự. Hành trang và chỗ đứng
  của bạn vẫn còn đó khi bạn quay lại.

## Điều khiển

| Hành động | Phím |
| --- | --- |
| Di chuyển | WASD hoặc phím mũi tên |
| Cầm một ô thanh nhanh | 1-9, hoặc bấm vào ô |
| Lướt dọc thanh nhanh | Q và E, hoặc con lăn chuột |
| Mở hành trang | Tab hoặc I (Escape để đóng) |
| Dùng thứ đang cầm / nói chuyện / tặng quà / mua bán / ghé lò rèn / đi ngủ | Space hoặc Enter, hoặc bấm vào một ô |
| Làm cả một hàng | Giữ phím đó và di chuyển |
| Đi ngủ (ở nhà nông trại) | B |
| Ném cần câu | Cầm cần câu rồi bấm vào một ô nước trong tầm |
| Giật và kéo cá | Giữ Space, Enter hoặc chuột trái |
| Huỷ công trình đang đặt / thu dây câu | Escape |

Thứ bạn đang cầm quyết định hành động làm gì: cuốc thì cày, bình tưới thì tưới,
giỏ thì thu hoạch, và gói hạt thì gieo đúng thứ nó mọc ra. Không có enum công cụ
riêng và không có hạt giống được chọn riêng.

Mọi thao tác chuột đều có phím tương đương, và cả hai cùng nhắm vào một con trỏ:
ô nằm dưới con trỏ khi nó trong tầm với, và ô bạn đang quay mặt về phía đó khi
không. Tầm với là một ô rưỡi — tám ô kề và ô đang đứng — và nó được server thực
thi, chứ không phải bởi con trỏ xám cảnh báo bạn về nó.

Khi cầm cần câu, mọi ô nước trong tầm với sẽ sáng lên, nên không phải đoán chỗ
nào ném được. Lúc có cá cắn câu, một dấu chấm thán xuất hiện trên đầu và có một
tiếng động không giống bất cứ tiếng nào khác trong game — bạn có khoảng chín phần
mười giây để giật. Sau đó là thanh câu: giữ phím thì ô vuông đi lên, thả thì nó
rơi, và mục tiêu là giữ con cá nằm trong ô đó.

Đi tới gần một người làng rồi bấm cùng phím đó sẽ nói chuyện với họ — hoặc đưa họ
thứ đang cầm, nếu đó là thứ tặng được. Thanh nhắc nói trước sẽ là cái nào trong
hai, vì một món quà lỡ tay tặng là món không lấy lại được cho tới ngày mai. Công
cụ thì không bao giờ bị tặng đi.

Công cụ từ thợ rèn xử lý một hình chữ nhật lấy ô bạn nhắm làm tâm, và một đường
viền mờ dưới con trỏ cho thấy đó là hình nào. Nó tính năng lượng một lần cho mỗi ô
thực sự được làm và áp hệ số bậc lên cả nhát quét, nên phần tiết kiệm là thật ở
đúng cái tầm mà nó đáng dùng.

## Chạy ở máy

```sh
npm install
npm run dev
```

Mở đường dẫn Vite hiện trong terminal (mặc định `http://localhost:5173`). Chỉ
riêng vậy là đã có một nông trại ngoại tuyến lưu trong trình duyệt.

Để chơi cùng nhau, chạy thêm server trong một terminal thứ hai:

```sh
cd server
npm install
npm run dev
```

Rồi trỏ máy khách về nó bằng cách chép `.env.example` thành `.env.local`:

```sh
VITE_GAME_SERVER=ws://localhost:2567
```

Mở máy khách sẽ tạo một thế giới và đặt mã mời của nó lên thanh địa chỉ, dạng
`?farm=CODE`. Gửi đường dẫn đó cho ai đó, hoặc bảo họ nhập mã, và các bạn thành
những người làm chung một mảnh đất. Không có `VITE_GAME_SERVER`, hoặc khi không
với tới được server, máy khách sẽ nói vậy rồi chơi ngoại tuyến.

Server ghi vào `server/data/moonberry.sqlite` theo mặc định; đặt `DATABASE_FILE`
để đổi chỗ.

## Cổng chất lượng

```sh
npm run lint
npm run test
npm run build
npm run test:e2e      # cần chạy trước: npm run test:e2e:install
npm run quality:fast  # lint + test + build
```

`npm install` sẽ gắn một hook pre-commit của husky chạy `lint-staged` (ESLint trên
các file JS/TS đã stage).

## Bố cục dự án

| Đường dẫn | Nội dung |
| --- | --- |
| `src/game/systems/` | Luật chơi thuần và tất định — vật phẩm, hành trang, trồng trọt, tài nguyên trên mặt đất, vật nuôi, thời gian, nhiệm vụ. Có unit test, không phụ thuộc Phaser hay DOM. |
| `src/game/npcs/` | Người làng dưới dạng dữ liệu — mỗi người một file mang lịch trình, bảng quà và lời thoại — cùng ba cỗ máy nhỏ đọc chúng: trái tim và tặng quà, tra lịch trình và bước đi, và chọn câu thoại. Không chỗ nào trong reducer biết tên ai. |
| `maps/` | Nguồn bản đồ Tiled. Mở bằng Tiled để sửa thế giới. |
| `src/game/world/` | Bộ phân tích Tiled, các khu vực đã phân tích, va chạm, và hình học tương tác. Hàm thuần, không Phaser. |
| `src/game/state/` | `FarmState`, giao thức intent/event, reducer trên cả hai, store, và lưu/tải. |
| `src/game/net/` | Giao thức đường truyền và phía trình duyệt của kết nối. |
| `server/` | Server trọng tài và cơ sở dữ liệu của nó. Là package riêng, vì nó triển khai tách khỏi máy khách tĩnh. |
| `src/game/scenes/FarmScene.ts` | Scene Phaser: chỉ vẽ và nhận input. Không sở hữu trạng thái game nào. |
| `src/game/assets/` | Kết cấu pixel sinh tự động, dùng khi thiếu file ảnh. |
| `src/game/audio/` | Bảng ánh xạ sự kiện sang âm thanh, bộ trộn, và lớp bọc duy nhất quanh trình quản lý âm thanh của Phaser. |
| `src/components/`, `src/App.tsx` | Trang chính là canvas và không gì khác. Ở đây chỉ còn ba lớp phủ dạng tài liệu (hành trang, quầy chợ, lò rèn), menu mở bằng Escape — nơi giữ bộ trộn, mã mời và nút tạo nông trại mới — và vùng `aria-live` đọc lại những gì game vừa nói. Thông tin trong thế giới — đồng hồ, thời tiết, thanh nhanh, thể lực, nhiệm vụ — được vẽ trong canvas và chỉ ở đó. |
| `src/game/ui/hudLayout.ts` | Chỗ đặt từng mảnh HUD, tính từ kích thước canvas. Hàm thuần, nên kiểm thử được mà không cần trình duyệt. |
| `public/assets/ui/` | Khung gỗ 9-slice. Cùng một file ảnh cho `border-image` trong CSS và `nineslice` trong canvas, nên hai lớp không vẽ hai cái viền khác nhau. |
| `public/assets/lpc/` | Tranh vẽ tay. **Không phải MIT** — xem `public/assets/lpc/CREDITS.md`. |
| `public/assets/override/` | Tranh thay thế tuỳ chọn ở máy. PNG/JPG ở đây bị gitignore một cách cố ý. |
| `public/assets/audio/` | Hiệu ứng và nền nhạc tổng hợp. Là MIT, khác với tranh — xem `public/assets/audio/CREDITS.md`. |

## Ghi chú kiến trúc

Toàn bộ trạng thái nông trại nằm trong một `FarmState` serialize được duy nhất,
chỉ bị thay đổi bởi reducer thuần trong `src/game/state/reducer.ts`. Máy khách
gửi `Intent`; reducer kiểm tra chúng rồi trả về trạng thái kế tiếp cùng những
`GameEvent` mà lớp vẽ phản ứng theo. Không gì trong `src/game/state/` hay
`src/game/world/` import Phaser, React hay DOM, nên cùng reducer đó là thứ chạy
trên server.

`dispatch` trong `src/game/state/store.ts` là đường nối duy nhất mà phần nhiều
người chơi thay thế: hôm nay nó rút gọn tại chỗ, còn sau đó nó gửi intent lên
server và áp trạng thái trọng tài trả về.

Mô hình nhiều người chơi đã được mã hoá sẵn trong hình dạng của state:

- **Tiền là ví chung của nông trại.** Hành trang và năng lượng để vung thứ trong
  đó là của từng người: ví là của nông trại, mệt mỏi là của bạn.
- **Tiến độ nhiệm vụ là của cả nông trại** — một người thu hoạch, người khác nhận
  thưởng.
- **Bốn chỗ ngồi**, mỗi chỗ một điểm sinh và một nhân vật riêng.
- **Đồng hồ là một intent `world/tick`**, nên một trọng tài duy nhất điều khiển
  thời gian cho tất cả thay vì mỗi máy khách tự đếm khung hình.
- **Kết thúc một ngày là một cuộc bỏ phiếu**, đếm trên những người đang online,
  nên một người không thể tua nhanh buổi tối của bốn người và một người đăng xuất
  không thể đóng băng nông trại.

### Bản đồ

Thế giới được dựng trong [Tiled](https://www.mapeditor.org/). `maps/*.json` là bản
đồ Tiled thật: mở `maps/farm.json` và sửa như bất kỳ bản đồ nào khác.

Bộ tile là một *image collection*, nên mỗi tile giữ PNG riêng của nó và không có
atlas nào để đóng gói hay giữ đồng bộ với tranh.

Bản đồ nói gì, game làm nấy:

| Trong Tiled | Trong game |
| --- | --- |
| Một lớp tile `ground` | Địa hình, và những ô nào trồng được (`kind: plot`) hay đặc (`kind: water`) |
| Một object kiểu `prop` | Một ngôi nhà, cái cây, quầy hàng hay NPC, kích thước theo hình chữ nhật của nó, chặn đường nếu `solid` |
| Một prop có thuộc tính `interact` | Một thứ để hành động lên: `market`, `blacksmith`, `rancher`, hoặc `bed` |
| Một object kiểu `portal` | Một lối đi, mang theo `toArea` và ô đáp xuống |
| Một object kiểu `spawn` | Nơi người chơi bắt đầu |
| Thuộc tính `displayName` của bản đồ | Tên hiện trên HUD |

Một thứ **không** nằm trong bản đồ: cây cối, đá và cỏ dại mà bạn dọn được. Chúng
là `ResourceNode` trong `FarmState`, đúng như các công trình, và vì đúng một lý
do — `maps/*.json` giống hệt nhau ở mọi thế giới, còn một gốc cây đã bị chặt thì
không. Cái giá phải trả được nói thẳng ra vì nó hay làm người ta vấp: va chạm
không còn là thuộc tính của bản đồ nữa, nên `isWalkable` phải được đưa cho cả
hai danh sách đó dưới dạng một đối tượng `Blockers`.

Nên dời quầy chợ trong Tiled là dời luôn chỗ bán được nông sản và chỗ mua được hạt
giống; không đổi dòng mã nào. Quầy bán gì cũng không cấu hình ở đâu cả — nó là mọi
loại cây trong `CROP_DEFINITIONS` có `seasons` chứa mùa hiện tại, nên thêm một
loại cây là tự nó lên kệ.

Sau khi sửa, sinh lại dữ liệu chạy:

```sh
npm run maps:build
```

Lệnh đó ghi ra `src/game/world/maps.generated.ts`. Lớp gián tiếp này tồn tại vì
máy khách, server và các bài kiểm thử đều cần dữ liệu bản đồ giống hệt nhau, và
một module TypeScript thuần là định dạng duy nhất mà cả ba môi trường chạy đều
import y như nhau — Node ESM cần import attributes cho JSON, còn Vite thì không.

`npm run maps:seed` viết lại bản đồ khởi đầu từ đầu. Nó ghi đè lên bất cứ thứ gì
bạn đã sửa, nên nó không nằm trong bất kỳ bước build nào.

### Server

`server/` chạy đúng cái reducer `applyIntent` mà máy khách chạy và là trọng tài
duy nhất của nông trại. Hai thứ mà máy khách không bao giờ được phép tự khai đã
vắng mặt khỏi giao thức đường truyền theo cách xây dựng chứ không phải theo cách
kiểm tra:

- **Id người chơi của nó.** Lệnh không mang id; server đóng dấu mỗi lệnh bằng kết
  nối nó đi tới, nên một máy khách không thể hành động thay người khác.
- **Bước thời gian của nó.** Di chuyển được gửi dưới dạng một hướng, và server tự
  đẩy nó theo đồng hồ của mình, nên một máy khách bị sửa đổi không thể đi nhanh
  hơn bằng cách khai một delta lớn hơn.

Mọi thứ khác đến từ máy khách đều được kiểm tra trong `src/game/net/protocol.ts`
và bị bỏ lặng lẽ nếu không phân tích được.

Lưu lượng được chia theo mức độ thay đổi: vị trí đi ra mỗi tick, một khung đồng hồ
gọn khi chỉ có thời gian trôi, và cả nông trại chỉ khi có thứ khác đổi. Vì reducer
là bất biến, câu hỏi "thế giới có đổi không?" là một phép so sánh danh tính đối
tượng chứ không phải một phỏng đoán.

Colyseus là kế hoạch ban đầu và đã bị bỏ sau khi thử: giá trị của nó là đồng bộ
delta qua `@colyseus/schema`, thứ mà một reducer JSON thuần không dùng được nếu
không từ bỏ chính cái tính thuần cho phép cùng đoạn mã chạy ở cả hai phía — và
dòng server hiện tại của nó không có máy khách JavaScript nào được phát hành
tương ứng. Server giờ dùng thẳng `ws`.

### Thế giới, và ai sở hữu một chỗ trong đó

Một thế giới được lưu trong SQLite qua driver có sẵn của Node: không dịch vụ nào
phải chạy, không module native nào phải build. `server/src/db.ts` được giữ nhỏ một
cách cố ý, nên chuyển sang Postgres sau này nghĩa là viết thêm một class, chứ
không phải viết lại server.

Một thế giới chỉ sống trong bộ nhớ khi còn người ở trong nó. Nó được đọc lên khi
người đầu tiên tới và được ghi xuống khi nó đổi, nên một lần khởi động lại tốn vài
giây chứ không tốn cả nông trại. Vì SQLite chạy với write-ahead logging, ngay cả
một cú tắt đột ngột cũng để lại lần ghi cuối khôi phục được.

Tư cách thành viên sống lâu hơn một phiên. Rời đi là đánh dấu người chơi đang
vắng chứ không phải xoá họ: hành trang, chỗ đứng và suất trong bốn người vẫn là
của họ, và một thành viên quay lại vẫn vào được ngay cả khi thế giới đã đầy. Chỉ
người mới mới bị từ chối.

Một bản lưu bị bộ kiểm tra từ chối thì bị khước từ chứ không bị thay thế. Dọn ra
một nông trại mới tinh dưới một mã mời đã tồn tại là âm thầm phá huỷ bất cứ thứ gì
đã sai, nên hàng dữ liệu đó được để nguyên trên đĩa để xem xét.

### Token người chơi là gì, và không là gì

Mỗi trình duyệt giữ một token ngẫu nhiên dài mà server cấp một lần và nhận ra về
sau. Đó là thứ khiến nông trại của bạn là của bạn khi bạn quay lại.

**Nó không phải xác thực.** Không có mật khẩu và không có gì để đối chiếu token,
nên:

- Ai lấy được token *chính là* người chơi đó.
- Xoá dữ liệu trang là mất danh tính, không khôi phục được.
- Một token nghĩa là một trình duyệt; không có cách nào đăng nhập ở nơi khác.

Cơ sở dữ liệu lưu một mã băm SHA-256 thay vì token, nên một bản dump bị rò rỉ
không phát ra danh tính dùng được — nhưng đó là giới hạn của lớp bảo vệ này. Tài
khoản thật (mật khẩu, phiên, khôi phục, giới hạn tần suất) là một phần việc riêng,
và giả vờ rằng token là một tài khoản sẽ tệ hơn là nói thẳng rằng nó không phải.

### Bản lưu

`src/game/state/persistence.ts` serialize `FarmState` sau một adapter
`SaveStorage` (hôm nay là localStorage, sau này là một cơ sở dữ liệu) kèm số
phiên bản schema và một móc migration. Một bản lưu được coi là dữ liệu vào không
đáng tin: mọi trường đều được kiểm tra khi tải, và bất cứ thứ gì bất thường sẽ
khiến bản lưu bị bỏ và một nông trại mới được bắt đầu, thay vì khởi động một bản
nửa hợp lệ. Bộ lưu trữ được phép hỏng — một kho bị chặn hay đã đầy sẽ suy giảm
thành "không có bản lưu" thay vì ném lỗi vào vòng lặp vẽ.

## Lộ trình

1. ~~**Tách state** — đưa trạng thái game ra khỏi `FarmScene` vào một store serialize được.~~ Xong.
2. ~~**Lưu/tải** — làm cho store đó bền.~~ Xong.
3. ~~**Server trọng tài** — chung đồng hồ, hành động do server phân xử, đồng bộ người chơi.~~ Xong.
4. ~~**Bản đồ thật** — tilemap Tiled, camera bám theo, va chạm, nhiều khu vực.~~ Xong.
5. ~~**Dữ liệu bền và mã mời** — thế giới lưu trong cơ sở dữ liệu sống sót qua khởi động lại.~~ Xong.
6. ~~**Năng lượng và giấc ngủ** — một ngày có giá và kết thúc khi người chơi quyết định.~~ Xong.

Mười một spec đã vào hết. Một ngày là một ngân sách, nông trại có một cái bánh cóc,
và trong làng có người: năng lượng và ánh sáng ban ngày cạn dần, tiền mua công cụ
và công trình khiến ngày sau rẻ hơn ngày trước, và có một lý do để đi bộ sang làng
không phải là quầy chợ. [`docs/specs/`](docs/specs/) ghi lại mỗi spec đặt ra làm
gì:

| # | Spec | Nó đổi cái gì |
| --- | --- | --- |
| 01 | ~~[Năng lượng và giấc ngủ](docs/specs/01-energy-and-sleep.md)~~ | Xong. Một ngày có giá, và người chơi chọn lúc nó kết thúc |
| 02 | ~~[Âm thanh](docs/specs/02-sound.md)~~ | Xong. Hiệu ứng bám sự kiện, nhạc bám đồng hồ, và bộ trộn thì nhớ |
| 03 | ~~[Ô hành trang](docs/specs/03-inventory-slots.md)~~ | Xong. 24 ô xếp chồng và một thanh nhanh; công cụ và hạt giống là vật phẩm |
| 04 | ~~[Mùa và cây trồng](docs/specs/04-seasons-and-crops.md)~~ | Xong. Cây thuộc về một mùa và chết ở ranh giới; hạt mua ở quầy |
| 05 | ~~[Một HUD, và con chuột](docs/specs/05-hud-and-mouse.md)~~ | Xong. Một HUD, trong canvas; chuột nhắm và server phán tầm với |
| 06 | ~~[Công cụ và công trình](docs/specs/06-tools-and-buildings.md)~~ | Xong. Thợ rèn nâng công cụ qua nhiều ngày; công trình mọc lên trên nông trại |
| 07 | ~~[NPC đáng ghé thăm](docs/specs/07-npc-relationships.md)~~ | Xong. Sáu người làng có lịch trình, quà, trái tim và điều để nói |
| 09 | ~~[Vật nuôi](docs/specs/09-animals.md)~~ | Xong. Gà, vịt, bò và dê; độ quý mến quyết định hạng sản phẩm |
| 10 | ~~[Thu thập tài nguyên](docs/specs/10-resources-and-tools.md)~~ | Xong. Rìu, cuốc chim, liềm; cây, đá và đồ hái theo mùa — gỗ và đá tồn tại |
| 11 | ~~[Chế tác](docs/specs/11-crafting.md)~~ | Xong. Rương, ống tưới, và máy biến nông sản thành đồ thủ công |
| 12 | ~~[Câu cá](docs/specs/12-fishing.md)~~ | Xong. Việc duy nhất không tiêu sức; một lý do để trời mưa là ngày tốt |

### Còn lại gì

Spec 08 nói về thứ người chơi nhìn thấy; spec 13 lấp trụ cột cuối cùng mà thể loại
có và game này chưa có; spec 14 mở cánh cửa duy nhất chưa mở được. Mỗi cái đứng
được một mình:

| # | Spec | Nó đổi cái gì |
| --- | --- | --- |
| 08 | [Khung game và ngôn ngữ thị giác](docs/specs/08-frame-and-look.md) | Toàn màn hình, một font, viền gỗ, autotiling — game thôi trông như một trang web |
| 13 | [Mỏ và chiến đấu](docs/specs/13-mine-and-combat.md) | Nơi kim loại đến từ, và hệ thống duy nhất có rủi ro |
| 14 | [Bước vào trong nhà](docs/specs/14-farmhouse-interior.md) | Ngôi nhà thôi là mặt tiền, và giấc ngủ có một cái giường |

**08 đi trước**, vì nó đụng vào `FarmScene.createUi` và cả bốn bảng React, còn mỗi
spec sau đó lại thêm một mảnh HUD nữa — làm nó sau nghĩa là viết những mảnh đó hai
lần. Nó cũng là một trong hai spec còn lại không đổi `FarmState`.

[`docs/specs/README.md`](docs/specs/README.md) bàn kỹ hơn về thứ tự — đáng đọc
trước khi bắt đầu, vì trong năm spec còn lại thì thứ tự đánh số không phải thứ tự
chặt chẽ nhất — và liệt kê những gì vẫn chưa có spec: nấu ăn, kỹ năng và cấp độ,
lễ hội, hôn nhân, bó vật phẩm, bảo tàng và nâng cấp nhà.

### Hai giới hạn đã biết, không nằm trong spec nào

- **Tài khoản thật.** Token người chơi buộc một danh tính vào một trình duyệt; xem
  phần ghi chú ở trên để biết chính xác nó bảo vệ và không bảo vệ điều gì.
- **Di chuyển qua internet.** Người chơi tại chỗ được dự đoán và được sửa lại khi
  lệch quá ngưỡng, điều đó ổn trên mạng LAN và thấy rõ độ cao su trên đường truyền
  chậm.

## Tài nguyên

```sh
npm run generate:assets
npm run generate:audio
npm run generate:ui
```

Lệnh đầu tạo lại các tài nguyên SVG tất định trong `public/assets/pixel/`. Lệnh
thứ hai tổng hợp mọi hiệu ứng âm thanh và nền nhạc vào `public/assets/audio/`, và
đó là lý do không có âm thanh thu sẵn nào trong repo cần cấp phép: xem
`public/assets/audio/CREDITS.md`, nơi cũng nói phải làm gì khi thay các bản tạm
này bằng bản thu thật.

Lệnh thứ ba vẽ ba khung gỗ 9-slice vào `public/assets/ui/`. Chúng là file ảnh
chứ không phải hình vẽ bằng mã, vì stylesheet cần một cái (`border-image`) và
canvas cần một cái (`this.add.nineslice`) — và điều đáng giá ở đây là cả hai
dùng chung đúng một bức ảnh.

Cả ba đều tất định và không lệnh nào chạy như một phần của build.

### Tranh LPC

Tranh có nguồn và có đích, và đó là hai thư mục khác nhau:

    downloaded sheet  --npm run lpc:import-->  art/raw/lpc/      (nguồn, được commit)
                      --npm run palette:apply-> public/assets/lpc/ (được sinh ra)

Đừng sửa gì trong `public/assets/lpc/`. Nó được dựng lại từ `art/raw/lpc/`, và
mọi màu trong đó bị ép về đúng bảng màu trong `art/palette.json`.

### Màu sắc

Mọi màu trong game đến từ `art/palette.json` — 48 màu, chia thành mười nhóm
(`soil`, `outline`, `shadow`, `clothDeep`, `foliage`, `clothWarm`, `water`,
`leaf`, `building`, `light`), mỗi màu tên `nhóm.bậc` với bậc là số nguyên bắt
đầu từ 0 (`soil.0`, `soil.1`, …). Bảng màu được suy ra (derive) từ chính tranh
trong `art/raw/`, không lấy từ một bảng có sẵn — xem đầu file
`scripts/derive-palette.mjs` để biết vì sao. Ramp `soil` là ngoại lệ: nó được
neo (pin) sẵn trong `art/ramps.json` thay vì để thuật toán gom cụm tự chọn,
vì đất là bề mặt lớn nhất trong game và cần một dải màu liền mạch, không phải
kết quả của việc gom các điểm nâu rải rác. `art/raw/intent/` tồn tại vì một lý
do hẹp: nó giữ các màu mà `scripts/generate-plot-art.mjs` từng được thiết kế
theo trước khi có bảng màu, để những màu đó được "bỏ phiếu" khi
`derive-palette.mjs` tính lại bảng màu — mà không bị chính bảng màu đó lượng
tử hoá lại, vì `apply-palette.mjs` chỉ đọc `art/raw/lpc/`, không bao giờ đọc
thư mục này.

Dùng `PALETTE` từ `src/game/assets/palette.generated.ts` trong code của game,
hoặc từ `scripts/lib/palette-data.mjs` trong một build script. Một hex viết
tay ở bất cứ đâu trong `src/` hoặc `scripts/` làm `npm test` thất bại, một PNG
trong `public/assets/` (kể cả `plot-*.png`) mang màu ngoài bảng cũng vậy —
xem `scripts/palette-lock.test.mjs`.

Để đổi một màu, sửa `art/palette.json`, rồi chạy cả ba lệnh:

    npm run palette:module    # module TypeScript mà game import
    npm run palette:apply     # lượng tử lại tranh đã import
    npm run generate:plots    # vẽ lại các ô đất

Ba lệnh này ghi vào ba nơi khác nhau và độc lập với nhau — chạy theo thứ tự
nào cũng được.

## Triển khai

Bản chính thức chạy trên Vercel theo `vercel.json` (đầu ra tĩnh của Vite):

https://stardew-valley-clone-five.vercel.app

## Giấy phép

Mã nguồn là MIT (xem `LICENSE`). Tranh trong `public/assets/lpc/` giữ giấy phép
riêng của chúng — đọc `public/assets/lpc/CREDITS.md` trước khi phân phối lại.
