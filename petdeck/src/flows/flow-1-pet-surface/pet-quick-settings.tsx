import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { PetAvatar } from '../shared/pet-avatar'
import { listSkinIds, loadSkin } from '../shared/pet/skin-loader'
import type { PetSettings } from '../shared/pet/pet-settings'

export function PetQuickSettings({ settings, onChange, onClose }: {
  settings: PetSettings
  onChange: (patch: Partial<PetSettings>) => void
  onClose: () => void
}) {
  const [skins, setSkins] = useState([{ id: 'default', name: '蓝噗' }])

  useEffect(() => {
    let active = true
    listSkinIds().then((ids) => Promise.all(ids.map((id) => loadSkin(id)))).then((loaded) => {
      if (active) setSkins(loaded.map((skin) => ({ id: skin.id, name: skin.name })))
    }).catch(() => {})
    return () => { active = false }
  }, [])

  return (
    <section className="pet-popover pet-settings-panel" role="dialog" aria-label="宠物设置">
      <div className="pet-panel-heading">
        <h2>宠物设置</h2>
        <button type="button" className="pet-icon-button" aria-label="关闭宠物设置" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="pet-settings-preview">
        <PetAvatar status="idle" size={82} skinId={settings.skinId} motion={settings.motion} />
        <div>
          <strong>{skins.find((skin) => skin.id === settings.skinId)?.name ?? settings.skinId}</strong>
          <span>右键宠物可随时回来设置</span>
        </div>
      </div>
      <label className="pet-field">
        <span>宠物样式</span>
        <select value={settings.skinId} onChange={(event) => onChange({ skinId: event.target.value })}>
          {skins.map((skin) => <option key={skin.id} value={skin.id}>{skin.name}</option>)}
          {!skins.some((skin) => skin.id === settings.skinId) && <option value={settings.skinId}>{settings.skinId}</option>}
        </select>
      </label>
      <label className="pet-field">
        <span>动效</span>
        <select value={settings.motion} onChange={(event) => onChange({ motion: event.target.value as PetSettings['motion'] })}>
          <option value="auto">跟随系统</option>
          <option value="on">完整</option>
          <option value="reduced">减弱</option>
          <option value="off">关闭</option>
        </select>
      </label>
      <div className="pet-field">
        <span>宠物尺寸</span>
        <div className="pet-segmented" role="group" aria-label="宠物尺寸">
          {([0.75, 1, 1.25] as const).map((scale) => (
            <button key={scale} type="button" aria-pressed={settings.scale === scale} onClick={() => onChange({ scale })}>
              {Math.round(scale * 100)}%
            </button>
          ))}
        </div>
      </div>
      <label className="pet-check-field">
        <input type="checkbox" checked={settings.roaming} disabled={settings.motion === 'off' || settings.motion === 'reduced'} onChange={(event) => onChange({ roaming: event.target.checked })} />
        <span>偶尔在附近漫步</span>
      </label>
      <label className="pet-check-field">
        <input type="checkbox" checked={settings.alwaysOnTop} onChange={(event) => onChange({ alwaysOnTop: event.target.checked })} />
        <span>保持在其他窗口上方</span>
      </label>
    </section>
  )
}
