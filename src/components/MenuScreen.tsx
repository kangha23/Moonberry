import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useDialogFocus } from './useDialogFocus';
import {
  BUSES,
  BUS_LABELS,
  mixerStore,
  setBusLevel,
  toggleMuted,
} from '../game/audio/settings';
import { inviteLink } from '../game/net/identity';
import { fullscreenAvailable, isFullscreen, toggleFullscreen } from '../game/view/fullscreen';
import { CONTROLS_HINT, onlineCount } from '../game/state/selectors';
import { farmStore, setMenuOpen, startNewFarm } from '../game/state/store';

/**
 * Everything that is about the program rather than about the farm.
 *
 * The page used to keep this in a column beside the game: a title, a blurb, a
 * mixer, an invite code, a button that starts over. All of it pushed the
 * canvas down the page until, on a 1440x900 screen, a player had to scroll to
 * see what they were holding.
 *
 * So the page is the game and this is behind Escape, which is where a menu has
 * lived since the nineties. It is allowed to be a document — a real dialog
 * with real controls — precisely because it is not about the world: the rule
 * that in-world information is drawn in the canvas and only in the canvas is
 * untouched, and nothing in here is in-world information.
 */
export default function MenuScreen() {
  const open = useStore(farmStore, (store) => store.menuOpen);
  const online = useStore(farmStore, (store) => store.online);
  const inviteCode = useStore(farmStore, (store) => store.inviteCode);
  const connectionError = useStore(farmStore, (store) => store.connectionError);
  const playerCount = useStore(farmStore, (store) => onlineCount(store.farm));
  const mixer = useStore(mixerStore, (state) => state);

  const panel = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false);

  useDialogFocus(open, panel);

  // Full screen can be left by a route this dialog knows nothing about — the
  // F key, or Escape handled by the browser itself — so the label follows the
  // browser's event rather than this component's idea of what it last did.
  useEffect(() => {
    const sync = () => setFull(isFullscreen());
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [open]);

  if (!open) return null;

  return (
    <div className="overlay" role="presentation" onClick={() => setMenuOpen(false)}>
      <div
        ref={panel}
        className="panel menu-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Bảng điều khiển"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-header">
          <h2>Tạm dừng</h2>
          <button type="button" className="ghost-button" onClick={() => setMenuOpen(false)}>
            Trở lại nông trại
          </button>
        </header>

        <section className="menu-section">
          <h3>Màn hình</h3>
          <button
            type="button"
            className="ghost-button"
            aria-pressed={full}
            disabled={!fullscreenAvailable()}
            onClick={() => toggleFullscreen()}
          >
            {full ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
          </button>
          <p className="note">
            Hoặc nhấn F. Màn hình rộng hơn cho bạn nhìn xa hơn chứ không phóng to mọi thứ, và mức
            phóng luôn là số nguyên để pixel không bị nhoè.
          </p>
        </section>

        <section className="menu-section">
          <h3>Điều khiển</h3>
          <p className="note">{CONTROLS_HINT}</p>
        </section>

        <section className="menu-section">
          <h3>Âm thanh</h3>
          <div className="mixer">
            {BUSES.map((bus) => (
              <label key={bus} className="mixer-row">
                <span className="mixer-label">{BUS_LABELS[bus]}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(mixer[bus] * 100)}
                  disabled={mixer.muted}
                  onChange={(event) => setBusLevel(bus, Number(event.target.value) / 100)}
                />
                <output className="mixer-value">{Math.round(mixer[bus] * 100)}%</output>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="ghost-button mixer-mute"
            aria-pressed={mixer.muted}
            onClick={() => toggleMuted()}
          >
            {mixer.muted ? 'Bật tiếng' : 'Tắt tiếng'}
          </button>
          <p className="note">
            Lưu trong trình duyệt này chứ không lưu trong nông trại, để một ván đã tắt tiếng thì mai
            vẫn tắt, còn một liên kết mời thì không bao giờ đến tay người khác trong cảnh câm.
          </p>
        </section>

        <section className="menu-section">
          <h3>{online ? 'Kết nối' : 'Lưu trữ'}</h3>
          {online ? (
            <>
              <p className="note">
                Máy chủ giữ nông trại này, giữ đồng hồ và giữ cả cái ví, nên ai ở đây cũng thấy cùng
                một cánh đồng, và mai mọi thứ vẫn còn nguyên.
                {playerCount > 1 ? ` Hiện có ${playerCount} nông dân đang ở đây.` : ''}
              </p>
              {inviteCode ? (
                <div className="invite">
                  <span className="invite-label">Mã mời</span>
                  <code className="invite-code">{inviteCode}</code>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(inviteLink(inviteCode))
                        .then(() => setCopied(true))
                        .catch(() => setCopied(false));
                    }}
                  >
                    {copied ? 'Đã chép liên kết' : 'Chép liên kết mời'}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="note">
                {connectionError ??
                  'Đang chơi ngoại tuyến. Nông trại tự lưu trong lúc bạn chơi, và chỉ lưu trong trình duyệt này.'}
              </p>
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  if (window.confirm('Bắt đầu nông trại mới? Việc này xóa vĩnh viễn nông trại đã lưu.')) {
                    startNewFarm();
                    setMenuOpen(false);
                  }
                }}
              >
                Bắt đầu nông trại mới
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
