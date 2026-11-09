import { useQuery } from '@tanstack/react-query';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api.ts';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.tsx';
import { cn } from '../lib/utils.ts';

export interface PoolChoice {
  providerId: string | null;
  model: string | null;
}

interface Props {
  value: PoolChoice;
  onChange: (choice: PoolChoice) => void;
  placeholder?: string;
  id?: string;
}

export function ModelPicker({ value, onChange, placeholder = '从模型池选择模型', id }: Props) {
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers });
  const [open, setOpen] = useState(false);
  const pool = (providers.data ?? []).filter((p) => p.enabledModels.length > 0);
  const current = providers.data?.find((p) => p.id === value.providerId);
  const inPool = Boolean(current && value.model && current.enabledModels.includes(value.model));
  const label = current && value.model ? `${current.name} / ${value.model}` : null;

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            className="flex w-full items-center justify-between gap-2 rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-left text-sm dark:border-neutral-700"
          >
            <span className={cn('truncate', !label && 'text-neutral-400')}>{label ?? placeholder}</span>
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="搜索模型" />
            <CommandList>
              <CommandEmpty>{pool.length === 0 ? '模型池是空的，先到「设置 · 模型服务」启用模型' : '没有匹配的模型'}</CommandEmpty>
              {pool.map((p) => (
                <CommandGroup key={p.id} heading={p.name}>
                  {p.enabledModels.map((m) => {
                    const selected = p.id === value.providerId && m === value.model;
                    return (
                      <CommandItem
                        key={m}
                        value={`${p.name} ${m}`}
                        onSelect={() => {
                          onChange({ providerId: p.id, model: m });
                          setOpen(false);
                        }}
                      >
                        <CheckIcon className={cn('size-4', selected ? 'opacity-100' : 'opacity-0')} />
                        <span className="truncate">{m}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {label && !inPool && <p className="text-xs text-amber-600">这个模型已不在模型池里，请重新选择</p>}
    </div>
  );
}
