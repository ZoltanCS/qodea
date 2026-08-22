import { QodeaBot, type BotColor, type BotMood } from './mascot/QodeaBot';
import './mascot/mascot.css';

const SHOWCASE: Array<{ mood: BotMood; color: BotColor; label: string }> = [
  { mood: 'working', color: 'red', label: 'working' },
  { mood: 'thinking', color: 'cream', label: 'thinking' },
  { mood: 'waiting', color: 'blue', label: 'waiting' },
  { mood: 'error', color: 'red', label: 'error' },
  { mood: 'success', color: 'cream', label: 'success' },
];

export function App() {
  return (
    <main className="boot">
      <QodeaBot mood="idle" color="cream" size={150} />
      <h1 className="wordmark">Qodea</h1>
      <p className="status">M0 · scaffold online — the bot already has moods; the brain arrives in M1</p>
      <div className="mascot-row">
        {SHOWCASE.map(({ mood, color, label }) => (
          <figure key={label} className="mascot-cell">
            <QodeaBot mood={mood} color={color} size={64} />
            <figcaption>{label}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
