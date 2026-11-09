import type { ChatMessage, TurnInput } from '@lce/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type AnchorConfigSummary, type ChatDone } from '../api.ts';
import { card, input, primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';

const MAX_BATCH = 50;
const DEFAULT_SPEAKER = '观众';

interface TrialTurn {
  input: TurnInput;
  reply: string;
  info?: ChatDone;
  error?: string;
}

function parseDanmakuLines(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(.{1,100}?)[：:]\s*(.+)$/.exec(line);
      return m ? { speaker: m[1]!.trim(), text: m[2]!.trim() } : { speaker: DEFAULT_SPEAKER, text: line };
    });
}

export function TrialPanel({ config }: { config: AnchorConfigSummary }) {
  const anchors = useQuery({ queryKey: ['anchors'], queryFn: api.anchors });
  const [anchorPick, setAnchorPick] = usePersistentState<string | null>('lce.trial.anchor', null);
  const anchorName = anchors.data?.find((a) => a.name === anchorPick)?.name ?? anchors.data?.[0]?.name ?? null;
  const [log, setLog] = usePersistentState<TrialTurn[]>(`lce.trial.${config.id}.${anchorName ?? ''}`, []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ChatMessage[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const danmaku = parseDanmakuLines(draft);
  const history = () => log.filter((t) => !t.error && t.reply).map(({ input, reply }) => ({ input, reply }));

  const run = async (turn: TurnInput) => {
    if (busy || !anchorName) return;
    const body = { anchorName, input: turn, history: history() };
    setLog((l) => [...l, { input: turn, reply: '' }]);
    if (turn.kind === 'danmaku') setDraft('');
    setPreview(null);
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const patchLast = (fn: (t: TrialTurn) => TrialTurn) => setLog((l) => [...l.slice(0, -1), fn(l.at(-1)!)]);
    try {
      await api.trialChat(
        config.id,
        body,
        { onDelta: (text) => patchLast((t) => ({ ...t, reply: t.reply + text })), onDone: (info) => patchLast((t) => ({ ...t, info })) },
        ctrl.signal,
      );
    } catch (err) {
      patchLast((t) => ({ ...t, error: ctrl.signal.aborted ? '已停止' : (err as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const showPrompt = async () => {
    setPreviewError(null);
    if (!anchorName) return;
    try {
      const turn: TurnInput = danmaku.length ? { kind: 'danmaku', danmaku: danmaku.slice(0, MAX_BATCH) } : { kind: 'proactive' };
      setPreview(await api.trialPrompt(config.id, { anchorName, input: turn, history: history() }));
    } catch (err) {
      setPreviewError((err as Error).message);
    }
  };

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h3 className="text-sm font-medium">回复方案预览</h3>
          <p className="text-xs text-neutral-400">使用选定主播人设测试回复效果，不创建场次记录</p>
        </div>
        <select
          aria-label="试播用的主播"
          className="rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
          value={anchorName ?? ''}
          onChange={(e) => setAnchorPick(e.target.value)}
        >
          {anchors.data?.length === 0 && <option value="">还没有主播</option>}
          {anchors.data?.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
        <button type="button" className={secondaryBtn} onClick={() => void showPrompt()} disabled={busy}>
          查看提示词
        </button>
        <button
          type="button"
          className={secondaryBtn}
          disabled={busy || log.length === 0}
          onClick={() => {
            setLog([]);
            setPreview(null);
          }}
        >
          清空
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        用所选主播的人设和这套回复配置（已保存的），手动发弹幕看主播怎么回。
        {!config.modelAvailable && <span className="text-amber-600"> 这套配置还没有选模型，或模型已不在模型池里。</span>}
      </p>

      {preview && (
        <div className="space-y-2 rounded border border-dashed border-neutral-300 p-2 dark:border-neutral-700">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>下一次请求会发送 {preview.length} 条消息</span>
            <button type="button" className="underline" onClick={() => setPreview(null)}>
              收起
            </button>
          </div>
          {preview.map((m, i) => (
            <div key={i} className="text-xs">
              <span className="font-mono text-neutral-500">{m.role}</span>
              <pre className="whitespace-pre-wrap break-words font-sans">{m.content}</pre>
            </div>
          ))}
        </div>
      )}
      {previewError && <p className="text-xs text-red-600">{previewError}</p>}

      <ul className="max-h-[60vh] space-y-3 overflow-y-auto" aria-live="polite">
        {log.map((t, i) => (
          <li key={i} className="space-y-1">
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900">
                {t.input.kind === 'proactive' ? (
                  <span className="text-violet-600 dark:text-violet-300">[主动发言]</span>
                ) : (
                  t.input.danmaku.map((d, j) => (
                    <p key={j}>
                      <span className="text-neutral-500">{d.speaker}：</span>
                      {d.text}
                    </p>
                  ))
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-lg bg-sky-50 px-3 py-2 text-sm dark:bg-sky-950">
                <p className="whitespace-pre-wrap">{t.reply || (t.error ? '' : '…')}</p>
                {t.error && <p className="text-xs text-red-600">{t.error}</p>}
                {t.info && (
                  <p className="mt-1 text-xs text-neutral-500">
                    {t.info.model} · 首字 {t.info.firstTokenMs ?? '-'}ms · 总耗时 {t.info.totalMs}ms
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (danmaku.length && danmaku.length <= MAX_BATCH) void run({ kind: 'danmaku', danmaku });
        }}
      >
        <textarea
          aria-label="试播弹幕"
          className={`${input} min-h-20`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={'每行一条弹幕，格式「昵称：内容」\n卡文：主播晚上好\n奶茶：今天播多久'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-xs text-neutral-500">
            {danmaku.length > 0 ? `${danmaku.length} 条弹幕` : 'Ctrl+Enter 发送'}
            {danmaku.length > MAX_BATCH && <span className="text-red-600">，一次最多 {MAX_BATCH} 条</span>}
          </span>
          {busy ? (
            <button type="button" className={secondaryBtn} onClick={() => abort.current?.abort()}>
              停止
            </button>
          ) : (
            <>
              <button type="button" className={secondaryBtn} onClick={() => void run({ kind: 'proactive' })}>
                主动发言
              </button>
              <button type="submit" className={primaryBtn} disabled={danmaku.length === 0 || danmaku.length > MAX_BATCH}>
                发送弹幕
              </button>
            </>
          )}
        </div>
      </form>
    </section>
  );
}
