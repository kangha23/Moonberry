# 12 — Câu cá

**Phụ thuộc:** [10 — Thu thập tài nguyên](10-resources-and-tools.md) cho cái ao
trong khu rừng và cho mồi câu.

## Mục tiêu

Một việc để làm khi trời mưa, khi ruộng đã tưới xong, và vào mùa Đông.

## Vì sao

Game có ba mươi ô nước đã được đánh dấu `kind: 'water'` và chúng chỉ làm đúng một
việc: chặn đường.

Câu cá đáng làm vì nó là hoạt động duy nhất trong danh sách **không phụ thuộc vào
ngân sách năng lượng**. Spec 01 làm cho mỗi ngày kết thúc bằng một thanh sức cạn,
và hiện tại lúc đó không còn gì để làm ngoài đi ngủ. Câu cá lấp đúng khoảng đó, và
nó giải thích vì sao trời mưa lại là một ngày tốt thay vì một ngày tưới nước miễn
phí rồi ngồi không.

## Vấn đề khó, và nói thẳng ra trước

**Minigame câu cá là thời gian thực, và game này có server trọng tài.**

Ở Stardew câu cá là một thanh trượt: con cá chạy lên xuống, người chơi giữ chuột
để nâng ô vuông theo nó. Hoàn toàn chạy trên máy khách, vì Stardew không có
server nói không.

Ở đây có ba đường và spec này chọn đường thứ ba:

1. **Máy khách chơi, rồi báo thắng thua.** Đơn giản, và là một lỗ hổng gian lận
   lộ thiên — một máy khách sửa đổi báo thắng mọi lần. Vi phạm thẳng luật "máy
   khách đề nghị, server quyết định".
2. **Bỏ minigame.** Nhấn, đợi, được cá. Trung thực và chống gian lận, nhưng câu cá
   không có minigame chỉ là một cái cây chặt lâu hơn.
3. **Server mô phỏng thanh, máy khách gửi trạng thái nút.** Đúng mô hình đã dùng
   cho việc đi lại: máy khách không gửi vị trí, nó gửi hướng và server tự tính.
   Ở đây máy khách gửi `reel: true/false` và server chạy vật lý thanh trên
   `world/tick` của nó.

Đường 3 đúng về kiến trúc và có một cái giá phải nói rõ: **trên đường truyền chậm,
minigame sẽ khó chịu.** Độ trễ 150ms nghĩa là ô vuông phản hồi chậm hơn ngón tay.
README đã thừa nhận điều tương tự về việc đi lại; điều này thêm một chỗ nữa.

Giảm nhẹ: máy khách dự đoán ô vuông tại chỗ và sửa theo khung của server, đúng như
đang làm với vị trí người chơi. Thanh cá thì không dự đoán — nó do server sinh và
đi ra theo khung, nên hai bên luôn nhìn cùng một con cá.

Nếu khi làm thấy đường 3 quá tốn, **lùi về đường 2 chứ đừng lùi về đường 1.** Một
game câu cá nhạt vẫn là một game; một game câu cá gian lận được thì không.

## Trạng thái một lần câu

Chỉ tồn tại khi đang câu, nên nó nằm trên `PlayerState` và là `null` gần như suốt
thời gian.

```ts
export type CastPhase = 'casting' | 'waiting' | 'biting' | 'reeling';

export interface FishingState {
  phase: CastPhase;
  /** Ô nước đã ném tới. */
  target: Point;
  /** Con cá đã được server bốc, ngay từ lúc ném. */
  fish: ItemId;
  /** Phút trong ngày mà giai đoạn hiện tại kết thúc. */
  until: number;
  /** 0–1, vị trí cá trên thanh. Chỉ có ở `reeling`. */
  fishAt: number;
  fishVelocity: number;
  /** 0–1, vị trí ô vuông của người chơi. */
  barAt: number;
  barVelocity: number;
  /** 0–1. Đầy thì bắt được, cạn thì mất. */
  progress: number;
}
```

**Con cá được bốc lúc ném, không phải lúc bắt.** Điều đó nghĩa là kết quả không
phụ thuộc vào việc chơi thanh giỏi hay dở — chơi giỏi quyết định *có bắt được
không*, chứ không quyết định *bắt được con gì*. Nó cũng khiến việc gian lận không
có gì để nhắm tới: máy khách không biết trước con cá là gì cho tới khi cắn câu.

Bốc cá là một hàm tất định của `spawnSeed`, `totalMinutes` và ô nước, đúng luật
reducer thuần.

## Bảng cá

Khoảng 18 loài là đủ. Mỗi loài có mùa, khung giờ, thời tiết, vùng nước và độ khó.

```ts
export interface FishDef {
  id: ItemId;
  seasons: Season[];
  weather: Weather[] | null;
  fromHour: number;
  toHour: number;
  areas: AreaId[];
  /** 1–10. Quyết định cá chạy nhanh và bất thường tới đâu. */
  difficulty: number;
  /** Cách cá di chuyển, đủ để bốn loài không cảm thấy giống nhau. */
  motion: 'smooth' | 'darter' | 'sinker' | 'floater';
  sellPrice: number;
}
```

Cùng khuôn với `CROP_DEFINITIONS` và cùng lý do: thêm một con cá là thêm một dòng,
không phải sửa bốn chỗ.

Quan trọng là **bảng phải chia theo điều kiện chứ không chia đều.** Một con cá chỉ
xuất hiện lúc trời mưa, mùa Đông, sau 8 giờ tối là một con cá người chơi sẽ nhớ.
Mười tám con cá bắt được mọi lúc là một con cá lặp lại mười tám lần.

Rác cũng nằm trong bảng — rong, lon rỉ, giày cũ — với độ khó 1 và giá 0. Nó tồn
tại để thành công có nghĩa.

## Cần câu và mồi

Cần câu là `ItemDef` có `tool: 'rod'`, đi qua bộ máy bậc của spec 06 với một khác
biệt: bậc cần câu không mua vùng ảnh hưởng mà mua **độ rộng ô vuông**, tức là dễ
hơn chứ không nhanh hơn.

| Bậc | Ô vuông | Mua ở đâu |
| --- | --- | --- |
| Thường | 0.20 | Quầy chợ, 500g |
| Sợi | 0.26 | Thợ rèn |
| Sắt | 0.32 | Thợ rèn |
| Vàng | 0.40 | Thợ rèn |

Mồi câu chế tác từ sợi (spec 11), rút ngắn giai đoạn `waiting` xuống một nửa. Đó
là toàn bộ công dụng của nó, và như thế là đủ.

## Thay đổi ở reducer

- Intent mới: `player/cast { target }`, `player/reel { down: boolean }`,
  `player/cancelCast`.
- `applyAct` khi trong tay là cần câu và ô nhắm tới là nước thì chuyển sang ném,
  và chịu đúng luật tầm với 1.5 ô của spec 05.
- `world/tick` chạy bước câu cá cho mọi người chơi đang có `fishing !== null`,
  cùng chỗ với `npcTick` và bước vật nuôi.
- Ném tốn `8` năng lượng, kéo cá không tốn gì. Trượt vẫn mất năng lượng đó — nếu
  không thì ném thử vô hạn là chiến thuật tối ưu.
- Sự kiện: `{ kind: 'cast' }`, `{ kind: 'bite' }`, `{ kind: 'fishCaught'; fish;
  difficulty }`, `{ kind: 'fishEscaped'; }`.
- Đang câu thì không đi được. `player/move` bị bỏ qua khi `fishing` khác `null`,
  chứ không huỷ lần câu — nếu không thì một phím bấm nhầm là mất con cá.

`SAVE_VERSION` tăng. `fishing` mặc định `null` khi migrate, và **luôn được đặt về
`null` khi tải bản lưu** — một lần câu đang dở không nên sống sót qua việc khởi
động lại server.

## Client

- Cần câu có tư thế ném; phao nổi trên ô nước đã nhắm.
- Dấu chấm than và một tiếng động khi cắn câu. Đây là khoảnh khắc quan trọng nhất
  của cả hệ thống — nếu bỏ lỡ nó thì không có gì khác quan trọng.
- Thanh câu vẽ trong canvas, không phải trong React. Nó là thông tin trong thế
  giới, đúng luật spec 05.
- Cá bắt được hiện lên với tên và kích thước, giữ một nhịp trước khi vào hành
  trang.
- Ô nước có thể câu được sáng lên khi cầm cần, để người chơi không phải đoán.

## Kiểm thử

- Bốc cá là tất định, và tôn trọng mùa, giờ, thời tiết và vùng nước — mỗi ràng
  buộc một ca riêng.
- Ném vào ô không phải nước bị từ chối; ném ngoài tầm với bị từ chối.
- Vật lý thanh: giữ `reel` thì `progress` tăng khi ô vuông trùm lấy cá và giảm khi
  không. `progress` chạm 1 thì bắt được, chạm 0 thì mất.
- Ô vuông của bậc vàng rộng hơn của bậc thường, và tỉ lệ thắng ở cùng một hạt
  giống cao hơn.
- Mồi câu rút ngắn giai đoạn chờ, và bị tiêu đúng một lần mỗi lần ném.
- Người chơi mất kết nối giữa lúc kéo cá: lần câu bị dọn sạch, không để lại
  `fishing` treo.
- Hai người cùng câu một lúc, ở hai ao, được hai con cá độc lập.
- Máy khách gửi `reel` khi không ở giai đoạn `reeling` thì bị bỏ qua lặng lẽ.
- Hành trang đầy lúc bắt được cá: con cá vẫn giữ trong `fishing` và có thông báo,
  chứ không biến mất.

## Ngoài phạm vi

Lồng cua, ao nuôi cá, kho báu trong lúc câu, bộ sưu tập cá và bảo tàng, câu cá
trong mỏ (nếu spec 13 muốn thì đó là một dòng trong bảng cá), và kỹ năng câu cá
lên cấp.
