import { useState } from 'react';
import { useStore } from 'zustand';
import GameCanvas from './components/GameCanvas';
import { inviteLink } from './game/net/identity';
import {
  CONTROLS_HINT,
  formatClock,
  localPlayer,
  onlineCount,
  promptFor,
  seedLabel,
  toolLabel,
} from './game/state/selectors';
import { farmStore, startNewFarm } from './game/state/store';

export default function App() {
  // Individually selected so a change to one slice does not re-render the rest.
  const time = useStore(farmStore, (store) => store.farm.time);
  const season = useStore(farmStore, (store) => store.farm.season);
  const weather = useStore(farmStore, (store) => store.farm.weather);
  const coins = useStore(farmStore, (store) => store.farm.coins);
  const quest = useStore(farmStore, (store) => store.farm.quest);
  const playerCount = useStore(farmStore, (store) => onlineCount(store.farm));
  const player = useStore(farmStore, localPlayer);
  const prompt = useStore(farmStore, promptFor);
  const restored = useStore(farmStore, (store) => store.restored);
  const online = useStore(farmStore, (store) => store.online);
  const inviteCode = useStore(farmStore, (store) => store.inviteCode);
  const connectionError = useStore(farmStore, (store) => store.connectionError);
  const [copied, setCopied] = useState(false);

  const satchel = player?.satchel;
  const questPercent = Math.min(100, Math.round((quest.progress / quest.target) * 100));

  return (
    <main className="shell">
      <section className="hero-panel" aria-label="Game overview">
        <div>
          <p className="eyebrow">
            Amberfall Farm
            {online ? ' • shared farm' : restored ? ' • saved progress restored' : ''}
          </p>
          <h1>Restore a little hillside farm before moonrise.</h1>
          <p className="lede">
            A first playable slice with farming, movement, weather, time pressure, a neighbor quest,
            and commit-ready pixel-art-style assets.
          </p>
        </div>
        <div className="day-card" aria-label="Current farm conditions">
          <span>Day {time.day}</span>
          <strong>{formatClock(time.totalMinutes)}</strong>
          <em>
            {season} • {weather}
          </em>
        </div>
      </section>

      <section className="play-layout">
        <GameCanvas />

        <aside className="hud-panel" aria-label="Farm status">
          <div className="hud-section">
            <h2>Satchel</h2>
            <dl className="inventory-grid">
              <div>
                <dt>Farm coins</dt>
                <dd>{coins}g</dd>
              </div>
              <div>
                <dt>Water</dt>
                <dd>{satchel?.water ?? 0}</dd>
              </div>
              <div>
                <dt>Wood</dt>
                <dd>{satchel?.wood ?? 0}</dd>
              </div>
              <div>
                <dt>Turnips</dt>
                <dd>{satchel?.crops.turnip ?? 0}</dd>
              </div>
              <div>
                <dt>Seeds</dt>
                <dd>
                  {satchel?.seeds.turnip ?? 0} turnip • {satchel?.seeds.strawberry ?? 0} berry
                </dd>
              </div>
              <div>
                <dt>Equipped</dt>
                <dd>
                  {toolLabel(player)} • {seedLabel(player)}
                </dd>
              </div>
            </dl>
            <p className="hud-note">
              Coins are the farm&apos;s shared wallet. Seeds, crops, and water are yours alone.
              {playerCount > 1 ? ` ${playerCount} farmhands here right now.` : ''}
            </p>
          </div>

          <div className="hud-section quest-card">
            <div className="quest-heading">
              <span>Rowan&apos;s request</span>
              <strong>{quest.completed ? 'Ready' : `${quest.progress}/${quest.target}`}</strong>
            </div>
            <h2>{quest.title}</h2>
            <p>{quest.description}</p>
            <div className="progress-track" aria-label={`Quest progress ${questPercent}%`}>
              <span style={{ width: `${questPercent}%` }} />
            </div>
          </div>

          <div className="hud-section prompt-card">
            <h2>Hint</h2>
            <p>{prompt}</p>
            <small>{CONTROLS_HINT}</small>
          </div>

          <div className="hud-section">
            <h2>{online ? 'Connection' : 'Save'}</h2>
            {online ? (
              <>
                <p className="hud-note">
                  The server keeps this farm, its clock, and its wallet, so everyone here sees the
                  same fields and it is all still here tomorrow.
                </p>
                {inviteCode ? (
                  <div className="invite">
                    <span className="invite-label">Invite code</span>
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
                      {copied ? 'Link copied' : 'Copy invite link'}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="hud-note">
                  {connectionError ?? 'Playing offline. The farm saves itself as you play, in this browser only.'}
                </p>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    if (window.confirm('Start a new farm? This erases the saved farm for good.')) {
                      startNewFarm();
                    }
                  }}
                >
                  Start a new farm
                </button>
              </>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
