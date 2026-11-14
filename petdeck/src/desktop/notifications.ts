import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import type { PetEvent } from '../flows/shared/types'
import { notificationDecision } from '../flows/flow-1-pet-surface/pet-view.ts'
import { isTauri } from './window.ts'

export function notificationBody(event: PetEvent): string {
  if (event.type === 'decision') return '有 Agent 需要你拍板'
  if (event.type === 'done' || event.type === 'relay-ready') return '有 Agent 完成任务'
  return '有 Agent 需要处理'
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
  sendNotification({ title: 'PetDeck 轻拍', body: notificationBody(event) })
  return true
}
