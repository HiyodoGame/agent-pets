// Shared pet avatar. Kept out of flow-1 so the ambient surface module can be
// lazy-loaded while the shell/floating button still render the avatar.
import type { AgentStatus } from './types'
import { resolveMotionEnabled, getMotionPref, getOsReducedMotion } from './ui-logic'
import { STATUS_COLOR, STATUS_ANIM, STATUS_LABEL } from './status-tokens'

export function PetAvatar({ status, size = 96 }: { status: AgentStatus; size?: number }) {
  const reduce = !resolveMotionEnabled(getMotionPref(), getOsReducedMotion())
  const anim = reduce ? '' : STATUS_ANIM[status]
  const fill = STATUS_COLOR[status]
  const dim = status === 'offline' ? 0.4 : 0.9
  return (
    <div className={anim} style={{ width: size, height: size }} role="img" aria-label={`宠物状态：${STATUS_LABEL[status]}`}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <ellipse cx="30" cy="28" rx="9" ry="12" fill={fill} opacity={dim} />
        <ellipse cx="70" cy="28" rx="9" ry="12" fill={fill} opacity={dim} />
        <ellipse cx="50" cy="60" rx="34" ry="30" fill={fill} opacity={dim} />
        <circle cx="38" cy="55" r="6" fill="var(--color-bg-base)" />
        <circle cx="62" cy="55" r="6" fill="var(--color-bg-base)" />
        <circle cx="38" cy="55" r="2.5" fill="var(--color-text)" />
        <circle cx="62" cy="55" r="2.5" fill="var(--color-text)" />
        {status === 'stuck' ? (
          <path d="M40 74 q10 -7 20 0" stroke="var(--color-text)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        ) : (
          <path d="M40 70 q10 8 20 0" stroke="var(--color-text)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        )}
      </svg>
    </div>
  )
}
