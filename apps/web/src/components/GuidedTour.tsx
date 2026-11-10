import { useQuery } from '@tanstack/react-query';
import { LightbulbIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api.ts';
import { primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';

interface TourStep {
  title: string;
  body: string;
  icon: string;
}

const STEPS: TourStep[] = [
  {
    title: '欢迎使用 live-chat-eval',
    body: '这是直播间模拟环境，用来测试 AI 主播的对话能力。跟我走一遍，几分钟就能开始第一次测试。',
    icon: '👋',
  },
  {
    title: '第一步：设置模型',
    body: '先到顶部导航的「设置」页面，添加一个模型服务商（比如 DeepSeek、OpenAI），填好 API Key 并保存。这是唯一需要你手动操作的一步。',
    icon: '⚙️',
  },
  {
    title: '第二步：选择主播',
    body: '回到直播间，我们预置了示例主播「小鹿」。点击左上角的名字可以切换主播，点击右侧「主播」图标可以编辑人设。',
    icon: '🎤',
  },
  {
    title: '第三步：配置回复',
    body: '点击右侧「配置」图标，给默认回复方案选上模型就能开播了。预置配置已经调好了回复策略和提示词。',
    icon: '🔧',
  },
  {
    title: '第四步：开始测试',
    body: '直接在底部输入框发弹幕，和主播实时对话；或用左侧「剧本」功能批量模拟观众弹幕弹幕。两种方式都能测试主播的回复能力。',
    icon: '💬',
  },
  {
    title: '第五步：评估分析',
    body: '测完后到「评估分析」页面查看分数报告，到「评分标准」页面调整打分维度。我们也预置了默认评分模板，开箱即用。',
    icon: '📊',
  },
];

export function GuidedTour() {
  const [completed, setCompleted] = usePersistentState('lce.tour.completed', false);
  const [step, setStep] = useState(0);
  const sims = useQuery({ queryKey: ['sims'], queryFn: api.sims });

  const hasSessions = (sims.data?.length ?? 0) > 0;
  if (completed || hasSessions) return null;

  const current = STEPS[step];
  if (!current) return null;
  const isLast = step === STEPS.length - 1;

  const finish = () => setCompleted(true);
  const skip = () => { setCompleted(true); };
  const next = () => {
    if (isLast) finish();
    else setStep((s) => s + 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="新手引导">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-xl dark:bg-indigo-950/50">
            {current.icon}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{current.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">{current.body}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
            onClick={skip}
            aria-label="跳过引导"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-indigo-500' : i < step ? 'w-1.5 bg-indigo-300 dark:bg-indigo-700' : 'w-1.5 bg-neutral-200 dark:bg-neutral-700'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isLast && (
              <button type="button" className={secondaryBtn} onClick={skip}>跳过</button>
            )}
            <button type="button" className={primaryBtn} onClick={next}>
              {isLast ? '开始使用' : '下一步'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          <LightbulbIcon className="size-3.5 shrink-0" />
          <span>已为你预置了示例主播、默认回复配置和示例剧本，只需到设置页添加模型即可开始。</span>
        </div>
      </div>
    </div>
  );
}
