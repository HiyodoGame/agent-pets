// Flow3 看板视图（P2-11）：会话按状态分列的纯分组逻辑，与组件解耦便于单测。
// 列固定五种 SessionStatus 顺序（运行中/等拍板/已完成/卡住/已归档），空列保留——
// 看板的语义是「每个状态一眼可见」，消失的列比空列更难读。
import type { Session, SessionStatus } from '../shared/types'

export interface KanbanColumn {
  status: SessionStatus
  sessions: Session[]
}

export const KANBAN_ORDER: readonly SessionStatus[] = ['active', 'waiting', 'done', 'stuck', 'archived']

/** 会话按状态分列；列顺序固定、空列保留，列内保持原顺序（不再二次排序，尊重 lastSeen 流水）。 */
export function kanbanColumns(sessions: Session[]): KanbanColumn[] {
  return KANBAN_ORDER.map((status) => ({
    status,
    sessions: sessions.filter((s) => s.status === status),
  }))
}
