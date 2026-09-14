# Override art cá nhân

Thư mục này giữ cho thử nghiệm cá nhân của bạn (không commit — xem `.gitignore`).

Art chính thức của game nằm ở **`../lpc/`** (Liberated Pixel Cup + CC0,
credit đầy đủ trong `../lpc/CREDITS.md`) và đã đẹp chuẩn cozy.

Muốn tự thay art khác:

1. Đọc `../lpc/CREDITS.md` để hiểu key nào đang dùng file nào
   (`tile-grass`, `plot-tilled`, `crop-turnip`, `farmhouse`, `tree`,
   `player-sheet` 576x256 walkcycle 64x64, `rowan-sheet`, ...).
2. Thả PNG cùng tên vào `../lpc/` (nhớ cập nhật CREDITS + tôn trọng license
   gốc: file phái sinh từ LPC phải giữ CC-BY-SA 3.0 hoặc GPL 3.0).
3. Hoặc thả vào đây + tự thêm dòng `this.load.image(...)` trong
   `FarmScene.preload()` trỏ sang `/assets/override/...`.
