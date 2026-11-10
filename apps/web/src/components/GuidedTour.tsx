import { FileTextIcon, MessageSquareIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.tsx';
import { usePersistentState } from '../usePersistentState.ts';

export type TourPath = 'import' | 'simulate';

interface PathOption {
  path: TourPath;
  title: string;
  steps: string;
  icon: typeof FileTextIcon;
}

const PATHS: PathOption[] = [
  {
    path: 'import',
    title: '评估已有聊天记录',
    steps: '导入记录 → 确认主播角色 → 选评分标准和裁判模型 → 查看报告。不需要配置主播回复模型。',
    icon: FileTextIcon,
  },
  {
    path: 'simulate',
    title: '模拟 AI 主播',
    steps: '添加模型服务并加入模型池 → 为回复配置选择模型 → 发弹幕或运行剧本 → 到「评估分析」评估本场。',
    icon: MessageSquareIcon,
  },
];

/** 帮助入口通过 ?tour=1 重新打开欢迎页 */
export const TOUR_PARAM = 'tour';

export function GuidedTour({ onChoose }: { onChoose: (path: TourPath) => void }) {
  const [seen, setSeen] = usePersistentState('lce.tour.completed', false);
  const [searchParams, setSearchParams] = useSearchParams();
  const reopen = searchParams.get(TOUR_PARAM) === '1';

  useEffect(() => {
    if (!reopen) return;
    setSeen(false);
    setSearchParams((p) => { p.delete(TOUR_PARAM); return p; }, { replace: true });
  }, [reopen, setSeen, setSearchParams]);

  const choose = (path: TourPath) => {
    setSeen(true);
    onChoose(path);
  };

  return (
    <Dialog open={!seen} onOpenChange={(open) => { if (!open) setSeen(true); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">欢迎使用 live-chat-eval</DialogTitle>
          <DialogDescription>
            用来评估直播间主播的对话质量。先选你要做的事，之后随时可以从顶部「帮助」回到这里。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {PATHS.map(({ path, title, steps, icon: Icon }) => (
            <button
              key={path}
              type="button"
              onClick={() => choose(path)}
              className="flex w-full items-start gap-3 rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30"
            >
              <Icon className="mt-0.5 size-5 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">{steps}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-500">
          已预置示例主播「小鹿」、默认回复配置、示例剧本和默认评分标准。
        </p>
      </DialogContent>
    </Dialog>
  );
}
