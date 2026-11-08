import type { ActionEvent, AnchorTurn, PairingResult, RawMessage, RoleMap } from '../domain/types.ts';
import { stripActionPrefix } from '../importers/markdown.ts';

/**
 * 把消息流配对成主播回复轮次（规则见 docs/requirements.md 1.4）：
 * - 主播发言关联上一条主播发言之后、它之前的所有观众弹幕；
 * - 没有新弹幕的主播发言是主动发言；
 * - 动作挂到之前最近的一条主播发言上。
 */
export function pairTurns(messages: readonly RawMessage[], roles: RoleMap): PairingResult {
  const turns: AnchorTurn[] = [];
  const orphanActions: ActionEvent[] = [];
  let pending: RawMessage[] = [];

  for (const msg of messages) {
    const role = roles[msg.speaker] ?? 'viewer';
    if (role === 'viewer') pending.push(msg);
    else if (role === 'anchor') {
      const first = pending[0];
      turns.push({
        seq: msg.seq,
        repliesTo: pending.map((p) => p.seq),
        proactive: pending.length === 0,
        latencyMs: first ? msg.ts - first.ts : null,
        actions: [],
      });
      pending = [];
    } else if (role === 'action') {
      const action: ActionEvent = { seq: msg.seq, time: msg.time, text: stripActionPrefix(msg.text) };
      const last = turns.at(-1);
      if (last) last.actions.push(action);
      else orphanActions.push(action);
    }
  }

  return { turns, unanswered: pending.map((p) => p.seq), orphanActions };
}
