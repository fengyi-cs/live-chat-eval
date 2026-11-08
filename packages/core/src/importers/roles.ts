import type { ParsedTranscript, RoleMap, SpeakerRole } from '../domain/types.ts';
import { isActionText } from './markdown.ts';

export interface RoleHints {
  knownAnchors?: Iterable<string>;
  rememberedRoles?: RoleMap;
}

const ACTION_SPEAKERS = new Set(['自动动作']);

/**
 * 优先级：已知主播档案 / 元信息主播名 > 动作发言人 > 记住的角色 > 观众。
 */
export function suggestRoles(parsed: ParsedTranscript, hints: RoleHints = {}): RoleMap {
  const anchors = new Set(hints.knownAnchors ?? []);
  const remembered = hints.rememberedRoles ?? {};
  const roles: RoleMap = {};

  for (const { name } of parsed.speakers) {
    const texts = parsed.messages.filter((m) => m.speaker === name).map((m) => m.text);
    let role: SpeakerRole;
    if (anchors.has(name) || name === parsed.meta.anchorName) role = 'anchor';
    else if (ACTION_SPEAKERS.has(name) || (texts.length > 0 && texts.every(isActionText))) role = 'action';
    else role = remembered[name] ?? 'viewer';
    roles[name] = role;
  }
  return roles;
}

export function anchorsOf(roles: RoleMap): string[] {
  return Object.entries(roles)
    .filter(([, r]) => r === 'anchor')
    .map(([name]) => name);
}
