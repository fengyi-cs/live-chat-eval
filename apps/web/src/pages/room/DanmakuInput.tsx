import { useState } from 'react';
import { input, primaryBtn } from '../../ui.ts';
import { usePersistentState } from '../../usePersistentState.ts';

interface Props {
  onSend: (speaker: string, text: string) => Promise<void>;
  busy?: boolean;
  disabled?: boolean;
  hint?: string;
}

export function DanmakuInput({ onSend, busy, disabled, hint }: Props) {
  const [speaker, setSpeaker] = usePersistentState('lce.room.speaker', '我');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = !disabled && !sending && !busy && Boolean(speaker.trim() && text.trim());

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await onSend(speaker.trim(), text.trim());
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="flex items-center gap-2 border-t border-neutral-200 px-2 py-2 dark:border-neutral-800"
      onSubmit={(e) => { e.preventDefault(); void handleSend(); }}
    >
      <div className="w-24 shrink-0">
        <input
          className={input}
          value={speaker}
          onChange={(e) => setSpeaker(e.target.value)}
          aria-label="昵称"
          placeholder="昵称"
          maxLength={100}
          disabled={disabled}
        />
      </div>
      <input
        className={`${input} min-w-0 flex-1`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="弹幕内容"
        placeholder={hint ?? '发一条弹幕'}
        maxLength={2000}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
          }
        }}
      />
      <button type="submit" className={primaryBtn} disabled={!canSend || sending}>
        发送
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
