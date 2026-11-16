import { useCallback, useEffect, useState } from 'react'
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
    if (!desktop) return
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
  }, [desktop])

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
        <button type="button" className="pet-icon-button" aria-label={t('settings.close')} onClick={onClose}>
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
      <label className="pet-field">
        <span>{t('settings.skin')}</span>
        <select value={settings.skinId} onChange={(event) => onChange({ skinId: event.target.value })}>
          {skins.map((skin) => <option key={skin.id} value={skin.id}>{skin.name}</option>)}
          {!skins.some((skin) => skin.id === settings.skinId) && <option value={settings.skinId}>{settings.skinId}</option>}
        </select>
      </label>
      <label className="pet-field">
        <span>{t('settings.motion')}</span>
        <select value={settings.motion} onChange={(event) => onChange({ motion: event.target.value as PetSettings['motion'] })}>
          <option value="auto">{t('settings.motionAuto')}</option>
          <option value="on">{t('settings.motionOn')}</option>
          <option value="reduced">{t('settings.motionReduced')}</option>
          <option value="off">{t('settings.motionOff')}</option>
        </select>
      </label>
      <label className="pet-field">
        <span>{t('settings.language')}</span>
        <select value={locale} onChange={(event) => setLocale(event.target.value as 'zh' | 'en')}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>
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
        <input type="checkbox" checked={settings.roaming} disabled={settings.motion === 'off' || settings.motion === 'reduced'} onChange={(event) => onChange({ roaming: event.target.checked })} />
        <span>{t('settings.roaming')}</span>
      </label>
      <label className="pet-check-field">
        <input type="checkbox" checked={settings.alwaysOnTop} onChange={(event) => onChange({ alwaysOnTop: event.target.checked })} />
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
              disabled={updatePhase === 'checking' || updatePhase === 'installing' || updatePhase === 'unsupported'}
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
