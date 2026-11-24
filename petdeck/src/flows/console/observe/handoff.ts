// Pure handoff logic for observed sessions. Observed rows are read-only (local
// observe-only adapters and remote SSH probes), so the capability PetDeck offers is
// a handoff package the user pastes into the external tool. Never claim a send.
import type { InjectPayload } from '../../../adapters/types'

export const MAX_HANDOFF_TEXT = 4000
export const MAX_CONTEXT_TEXT = 2000

export function buildObservedHandoff({ agent, context, instruction }: {
  agent: string
  context: string
  instruction: string
}): InjectPayload {
  return {
    to: agent,
    from: 'petdeck',
    context: context.trim().slice(0, MAX_HANDOFF_TEXT),
    instruction: instruction.trim().slice(0, MAX_HANDOFF_TEXT),
  }
}

/** The transcript's latest assistant line is the most useful handoff context; fall
 *  back to the session's last message when the transcript has no assistant text. */
export function defaultHandoffContext(lines: ReadonlyArray<{ role: string; text: string }>, lastMessage?: string | null): string {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line.role === 'assistant' && line.text.trim()) return line.text.trim().slice(0, MAX_CONTEXT_TEXT)
  }
  return String(lastMessage ?? '').trim().slice(0, MAX_CONTEXT_TEXT)
}
