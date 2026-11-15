import { useEffect, useState } from 'react'
import type { AgentStatus } from './types'
import { STATUS_COLOR, STATUS_LABEL } from './status-tokens'
import { loadSkin } from './pet/skin-loader'
import { getPetSettings, subscribePetSettings } from './pet/pet-settings'
import { SpritePlayer } from './pet/sprite-player'
import type { PetAction, PetDirection, PetSkin } from './pet/skin-types'
import type { MotionPref } from './ui-logic'

const STATUS_ACTION: Record<AgentStatus, PetAction> = {
  idle: 'idle',
  thinking: 'think',
  running: 'work',
  done: 'done',
  stuck: 'attention',
  offline: 'offline',
}

function FallbackPet({ status, size }: { status: AgentStatus; size: number }) {
  const fill = STATUS_COLOR[status]
  const dim = status === 'offline' ? 0.45 : 0.95
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
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
  )
}

export function PetAvatar({ status, size = 96, action, direction, motion, skinId, onComplete }: {
  status: AgentStatus
  size?: number
  action?: PetAction
  direction?: PetDirection
  motion?: MotionPref
  skinId?: string
  onComplete?: () => void
}) {
  const [settings, setSettings] = useState(getPetSettings)
  const [skin, setSkin] = useState<PetSkin | null>(null)
  const [failed, setFailed] = useState(false)
  const selectedSkin = skinId ?? settings.skinId

  useEffect(() => subscribePetSettings(setSettings), [])

  useEffect(() => {
    let active = true
    loadSkin(selectedSkin).then((next) => {
      if (active) {
        setSkin(next)
        setFailed(false)
      }
    }).catch(() => {
      if (active) {
        setSkin(null)
        setFailed(true)
      }
    })
    return () => { active = false }
  }, [selectedSkin])

  return (
    <div
      className="pet-avatar"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`宠物状态：${STATUS_LABEL[status]}`}
      data-pet-status={status}
      data-pet-action={action ?? STATUS_ACTION[status]}
    >
      {skin && !failed ? (
        <SpritePlayer
          skin={skin}
          action={action ?? STATUS_ACTION[status]}
          direction={direction}
          size={size}
          motion={motion ?? settings.motion}
          onComplete={onComplete}
          onError={() => setFailed(true)}
        />
      ) : (
        <FallbackPet status={status} size={size} />
      )}
    </div>
  )
}
