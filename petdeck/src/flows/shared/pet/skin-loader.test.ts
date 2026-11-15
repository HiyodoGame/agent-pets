import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceSpriteFrame, listSkinIds, loadSkin, resolveAnimation, resolveSpritePlayback, shouldCompleteClip, type SkinManifest } from './skin-loader.ts'

const manifest: SkinManifest = {
  schemaVersion: 1,
  id: 'default',
  name: '默认宠物',
  author: 'PetDeck',
  frameSize: { width: 256, height: 256 },
  anchor: { x: 128, y: 224 },
  direction: 'right',
  animations: {
    idle: { frames: 8, fps: 8, loop: true },
    walk: { frames: 8, fps: 12, loop: true },
    sleep: { frames: 6, fps: 6, loop: true },
    drag: { frames: 2, fps: 8, loop: true },
    drop: { frames: 6, fps: 12, loop: false },
    pet: { frames: 6, fps: 12, loop: false },
    work: { frames: 8, fps: 12, loop: true },
    think: { frames: 6, fps: 10, loop: true },
    done: { frames: 8, fps: 12, loop: false },
    attention: { frames: 6, fps: 10, loop: false },
    offline: { frames: 1, fps: 1, loop: false },
  },
}

function fetchWith(entries: Record<string, unknown>) {
  return async (input: string | URL | Request) => {
    const url = String(input)
    if (!(url in entries)) return new Response('not found', { status: 404 })
    const body = entries[url]
    return typeof body === 'string'
      ? new Response(body, { status: 200 })
      : new Response(JSON.stringify(body), { status: 200 })
  }
}

test('skin loader: loads a valid local pack and derives continuous frame URLs', async () => {
  const skin = await loadSkin('default', fetchWith({ '/pets/default/manifest.json': manifest }))
  assert.equal(skin.id, 'default')
  assert.equal(skin.name, '默认宠物')
  assert.deepEqual(skin.anchor, { x: 128, y: 224 })
  assert.deepEqual(skin.animations.idle?.urls.slice(0, 2), [
    '/pets/default/animations/idle/0001.png',
    '/pets/default/animations/idle/0002.png',
  ])
  assert.equal(skin.animations.idle?.loop, true)
  assert.equal(skin.animations.done?.loop, false)
})

test('skin loader: index lists unique safe local skin ids only', async () => {
  const ids = await listSkinIds(fetchWith({
    '/pets/index.json': { schemaVersion: 1, skins: ['default', 'orange-cat', 'orange-cat', '../bad'] },
  }))
  assert.deepEqual(ids, ['default', 'orange-cat'])
})

test('skin loader: unknown and unsafe skin ids fall back to default', async () => {
  const fetcher = fetchWith({ '/pets/default/manifest.json': manifest })
  const unknown = await loadSkin('missing', fetcher)
  const traversal = await loadSkin('../secret', fetcher)
  assert.equal(unknown.id, 'default')
  assert.equal(traversal.id, 'default')
})

test('skin loader: invalid extensions and remote asset paths are rejected', async () => {
  const remote = structuredClone(manifest)
  remote.animations.idle!.extension = 'https://evil.example/x'
  await assert.rejects(loadSkin('default', fetchWith({
    '/pets/default/manifest.json': remote,
  })), /idle/)
})

test('skin loader: missing clips and optional actions resolve to stable fallbacks', async () => {
  const skin = await loadSkin('default', fetchWith({ '/pets/default/manifest.json': manifest }))
  const noAttention = { ...skin, animations: { ...skin.animations, attention: undefined } }
  assert.equal(resolveAnimation(skin, 'notify').action, 'attention')
  assert.equal(resolveAnimation(skin, 'greet').action, 'idle')
  assert.equal(resolveAnimation(skin, 'greet').loop, false)
  assert.equal(resolveAnimation(skin, 'wake').loop, false)
  assert.equal(resolveAnimation(noAttention, 'notify').action, 'idle')
  assert.equal(resolveAnimation(noAttention, 'done').action, 'done')
})

test('sprite playback: loops wrap and one-shot clips stop on their final frame', () => {
  assert.equal(advanceSpriteFrame(0, 8, true), 1)
  assert.equal(advanceSpriteFrame(7, 8, true), 0)
  assert.equal(advanceSpriteFrame(5, 6, false), null)
})

test('sprite playback: static one-shot clips complete instead of freezing behavior', () => {
  assert.equal(shouldCompleteClip({ loop: false, playback: 'static', currentFrame: 0, frameCount: 6 }), true)
  assert.equal(shouldCompleteClip({ loop: false, playback: 'full', currentFrame: 5, frameCount: 6 }), true)
  assert.equal(shouldCompleteClip({ loop: false, playback: 'full', currentFrame: 0, frameCount: 6 }), false)
  assert.equal(shouldCompleteClip({ loop: true, playback: 'static', currentFrame: 0, frameCount: 8 }), false)
})

test('skin loader: reduced motion and off use a static frame', () => {
  assert.equal(resolveSpritePlayback('auto', true), 'static')
  assert.equal(resolveSpritePlayback('reduced', false), 'static')
  assert.equal(resolveSpritePlayback('off', false), 'static')
  assert.equal(resolveSpritePlayback('auto', false), 'full')
  assert.equal(resolveSpritePlayback('on', true), 'full')
})
