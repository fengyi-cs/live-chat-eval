import {
  BarChart2Icon,
  BookOpenIcon,
  DownloadIcon,
  SettingsIcon,
  TargetIcon,
  UserIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.tsx';

interface IconAction {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

function RoomIcon({ icon, label, onClick, active, badge, disabled }: IconAction & { badge?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={`relative flex size-9 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            active
              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300'
              : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300'
          }`}
          aria-label={label}
        >
          {icon}
          {badge && <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-emerald-500" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

export interface RoomIconsProps {
  activeSheet: string | null;
  onOpenSheet: (sheet: string | null) => void;
  evalRunning?: boolean;
  liveEvalEnabled?: boolean;
  onToggleLiveEval?: () => void;
}

export function LeftIcons({ activeSheet, onOpenSheet, evalRunning, liveEvalEnabled, onToggleLiveEval }: RoomIconsProps) {
  const actions = [
    { icon: <BookOpenIcon className="size-5" />, label: '弹幕剧本', sheet: 'script', enabled: true },
  ];
  return (
    <div className="hidden flex-col items-center gap-2 py-3 md:flex">
      {actions.map((a) => (
        <RoomIcon
          key={a.label}
          icon={a.icon}
          label={a.label}
          onClick={() => a.enabled && onOpenSheet(activeSheet === a.sheet ? null : a.sheet)}
          active={a.enabled && activeSheet === a.sheet}
          disabled={!a.enabled}
        />
      ))}
      <RoomIcon
        icon={<TargetIcon className="size-5" />}
        label={liveEvalEnabled ? '实时评估：开启（点击关闭）' : '实时评估：关闭（点击开启）'}
        onClick={onToggleLiveEval}
        active={!!liveEvalEnabled}
        badge={evalRunning || liveEvalEnabled}
      />
    </div>
  );
}

export function RightIcons({ activeSheet, onOpenSheet }: RoomIconsProps) {
  const actions = [
    { icon: <DownloadIcon className="size-5" />, label: '导入历史记录', sheet: 'import' },
    { icon: <BarChart2Icon className="size-5" />, label: '场次库', sheet: 'sessions' },
    { icon: <SettingsIcon className="size-5" />, label: '回复配置', sheet: 'config' },
    { icon: <UserIcon className="size-5" />, label: '主播管理', sheet: 'anchors' },
  ];
  return (
    <div className="hidden flex-col items-center gap-2 py-3 md:flex">
      {actions.map((a) => (
        <RoomIcon
          key={a.label}
          icon={a.icon}
          label={a.label}
          onClick={() => onOpenSheet(activeSheet === a.sheet ? null : a.sheet)}
          active={activeSheet === a.sheet}
        />
      ))}
    </div>
  );
}

export function MobileIconBar({ activeSheet, onOpenSheet, evalRunning, liveEvalEnabled, onToggleLiveEval }: RoomIconsProps) {
  const all = [
    { icon: <BookOpenIcon className="size-5" />, label: '弹幕剧本', sheet: 'script', enabled: true },
    { icon: <TargetIcon className="size-5" />, label: '实时评估', sheet: 'eval', enabled: true, special: true },
    { icon: <DownloadIcon className="size-5" />, label: '导入记录', sheet: 'import', enabled: true },
    { icon: <BarChart2Icon className="size-5" />, label: '场次库', sheet: 'sessions', enabled: true },
    { icon: <SettingsIcon className="size-5" />, label: '配置', sheet: 'config', enabled: true },
    { icon: <UserIcon className="size-5" />, label: '主播', sheet: 'anchors', enabled: true },
  ];
  return (
    <div className="flex items-center justify-around border-t border-neutral-200 px-2 py-1.5 dark:border-neutral-800 md:hidden">
      {all.map((a) => (
        <button
          key={a.label}
          type="button"
          disabled={!a.enabled}
          onClick={() => {
            if ('special' in a && a.special) { onToggleLiveEval?.(); return; }
            a.enabled && onOpenSheet(activeSheet === a.sheet ? null : a.sheet);
          }}
          aria-label={a.enabled ? a.label : `${a.label}（即将支持）`}
          title={a.enabled ? undefined : '即将支持'}
          className={`relative flex flex-col items-center gap-0.5 rounded-lg p-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            ('special' in a && a.special && liveEvalEnabled) || activeSheet === a.sheet
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
          }`}
        >
          {a.icon}
          {'special' in a && a.special && liveEvalEnabled && (
            <span className="absolute right-1 top-1 size-2 rounded-full bg-emerald-500" />
          )}
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  );
}
