import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import type { PetEvent } from '../flows/shared/types'
import { notificationDecision } from '../flows/flow-1-pet-surface/pet-view.ts'
import { isTauri } from './window.ts'
import { t } from '../i18n/index.ts'

export function notificationBody(event: PetEvent): string {
  const key = event.type === 'decision'
    ? 'notification.decision'
    : event.type === 'started'
      ? 'notification.started'
      : event.type === 'stuck'
        ? 'notification.stuck'
        : 'notification.done'
  return t(key, { agent: event.agentName, project: event.projectName, title: event.sessionTitle })
}

export function createNotificationDispatcher(notify: (event: PetEvent) => unknown | Promise<unknown>) {
  const seen = new Set<string>()
  return async (event: PetEvent, dnd: boolean): Promise<'tap' | 'inbox' | 'duplicate'> => {
    if (seen.has(event.id)) return 'duplicate'
    seen.add(event.id)
    if (notificationDecision(event, dnd) === 'inbox') return 'inbox'
    try {
      if (!dnd) await notify(event)
    } catch (error) {
      seen.delete(event.id)
      throw error
    }
    return 'tap'
  }
}

export async function sendPetSystemNotification(event: PetEvent): Promise<boolean> {
  if (!isTauri()) return false
  let granted = await isPermissionGranted()
  if (!granted) granted = (await requestPermission()) === 'granted'
  if (!granted) return false
  sendNotification({ title: t('notification.title'), body: notificationBody(event) })
  return true
}
