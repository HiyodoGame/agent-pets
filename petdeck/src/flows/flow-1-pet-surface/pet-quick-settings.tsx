import { useCallback, useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'
import { PetAvatar } from '../shared/pet-avatar'
import { listSkinIds, loadSkin } from '../shared/pet/skin-loader'
import type { PetSettings } from '../shared/pet/pet-settings'
import { isTauri } from '../../desktop/window'
import { t } from '../../i18n/index.ts'
import { useI18n } from '../../i18n/context.ts'
import {
  checkForUpdate,
  installPendingUpdate,
  updateAvailable,
  updateStatusText,
  type UpdateInfo,
  type UpdatePhase,
} from '../../desktop/updater'

function ChoiceGroup<T extends string | number>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const labelId = useId()
  return (
    <div className="pet-field">
      <span id={labelId}>{label}</span>
      <div className="pet-segmented" role="group" aria-labelledby={labelId}>
        {options.map((option) => (
          <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function PetQuickSettings({ settings, onChange, onClose }: {
  settings: PetSettings
  onChange: (patch: Partial<PetSettings>) => void
  onClose: () => void
}) {
  const [skins, setSkins] = useState([{ id: 'default', name: '蓝噗' }])
  const { locale, setLocale } = useI18n()
  const desktop = isTauri()
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>(desktop ? 'checking' : 'unsupported')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateError, setUpdateError] = useState('')

  const runUpdateCheck = useCallback(async () => {
    if (!desktop || updatePhase === 'checking' || updatePhase === 'installing') return
    setUpdatePhase('checking')
    setUpdateError('')
    try {
      const next = await checkForUpdate()
      setUpdateInfo(next)
      setUpdatePhase(next.available ? 'available' : 'uptodate')
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error))
      setUpdatePhase('error')
    }
  }, [desktop, updatePhase])

  const installUpdate = useCallback(async () => {
    setUpdatePhase('installing')
    setUpdateError('')
    try {
      await installPendingUpdate()
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error))
      setUpdatePhase('error')
    }
  }, [])

  useEffect(() => {
    // 打开设置时自动检查一次；不下载，安装必须由用户确认。
    if (!desktop) return
    let active = true
    checkForUpdate()
      .then((next) => {
        if (!active) return
        setUpdateInfo(next)
        setUpdatePhase(next.available ? 'available' : 'uptodate')
      })
      .catch((error) => {
        if (!active) return
        setUpdateError(error instanceof Error ? error.message : String(error))
        setUpdatePhase('error')
      })
    return () => { active = false }
  }, [desktop])

  useEffect(() => {
    let active = true
    listSkinIds().then((ids) => Promise.all(ids.map((id) => loadSkin(id)))).then((loaded) => {
      if (active) setSkins(loaded.map((skin) => ({ id: skin.id, name: skin.name })))
    }).catch(() => {})
    return () => { active = false }
  }, [])

  return (
    <section className="pet-popover pet-settings-panel" role="dialog" aria-label={t('settings.title')}>
      <div className="pet-panel-heading">
        <h2>{t('settings.title')}</h2>
        <button type="button" className="pet-icon-button" aria-label={t('settings.close')} onClick={onClose} autoFocus>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="pet-settings-preview">
        <PetAvatar status="idle" size={82} skinId={settings.skinId} motion={settings.motion} />
        <div>
          <strong>{skins.find((skin) => skin.id === settings.skinId)?.name ?? settings.skinId}</strong>
          <span>{t('settings.rightClickHint')}</span>
        </div>
      </div>
      <ChoiceGroup
        label={t('settings.skin')}
        value={settings.skinId}
        options={[
          ...skins.map((skin) => ({ value: skin.id, label: skin.name })),
          ...(!skins.some((skin) => skin.id === settings.skinId) ? [{ value: settings.skinId, label: settings.skinId }] : []),
        ]}
        onChange={(skinId) => onChange({ skinId })}
      />
      <ChoiceGroup
        label={t('settings.motion')}
        value={settings.motion}
        options={[
          { value: 'auto' as const, label: t('settings.motionAuto') },
          { value: 'on' as const, label: t('settings.motionOn') },
          { value: 'reduced' as const, label: t('settings.motionReduced') },
          { value: 'off' as const, label: t('settings.motionOff') },
        ]}
        onChange={(motion) => onChange({ motion })}
      />
      <ChoiceGroup
        label={t('settings.language')}
        value={locale}
        options={[{ value: 'zh' as const, label: '中文' }, { value: 'en' as const, label: 'English' }]}
        onChange={setLocale}
      />
      <div className="pet-field">
        <span>{t('settings.size')}</span>
        <div className="pet-segmented" role="group" aria-label={t('settings.size')}>
          {([0.75, 1, 1.25] as const).map((scale) => (
            <button key={scale} type="button" aria-pressed={settings.scale === scale} onClick={() => onChange({ scale })}>
              {Math.round(scale * 100)}%
            </button>
          ))}
        </div>
      </div>
      <label className="pet-check-field">
        <input className="pd-switch" type="checkbox" checked={settings.roaming} disabled={settings.motion === 'off' || settings.motion === 'reduced'} onChange={(event) => onChange({ roaming: event.target.checked })} />
        <span>{t('settings.roaming')}</span>
      </label>
      <label className="pet-check-field">
        <input className="pd-switch" type="checkbox" checked={settings.alwaysOnTop} onChange={(event) => onChange({ alwaysOnTop: event.target.checked })} />
        <span>{t('settings.alwaysOnTop')}</span>
      </label>
      <div className="pet-field pet-update-field">
        <span>{t('settings.update')}</span>
        <div className="pet-update-row">
          <span className="pet-update-status" role="status">{updateStatusText(updatePhase, updateInfo, updateError)}</span>
          {updateAvailable(updateInfo) && updatePhase !== 'installing' ? (
            <button type="button" className="pet-update-button" onClick={installUpdate}>{t('settings.installRestart')}</button>
          ) : (
            <button
              type="button"
              className="pet-update-button"
              disabled={updatePhase === 'unsupported'}
              aria-busy={updatePhase === 'checking' || updatePhase === 'installing'}
              onClick={runUpdateCheck}
            >
              {updatePhase === 'checking' ? t('settings.checking') : t('settings.checkUpdate')}
            </button>
          )}
        </div>
        {updatePhase === 'available' && updateInfo?.body ? (
          <p className="pet-update-notes">{updateInfo.body.slice(0, 200)}</p>
        ) : null}
      </div>
    </section>
  )
}
