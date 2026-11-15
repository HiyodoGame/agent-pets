import { useEffect, useMemo, useRef, useState } from 'react'
import type { MotionPref } from '../ui-logic'
import { getOsReducedMotion } from '../ui-logic'
import { advanceSpriteFrame, resolveAnimation, resolveSpritePlayback, shouldCompleteClip } from './skin-loader'
import type { PetAction, PetDirection, PetSkin } from './skin-types'

interface SpritePlayerProps {
  skin: PetSkin
  action: PetAction
  direction?: PetDirection
  size: number
  motion?: MotionPref
  onComplete?: () => void
  onError?: () => void
}

function loadImage(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(url)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

export function SpritePlayer({ skin, action, direction = 'right', size, motion = 'auto', onComplete, onError }: SpritePlayerProps) {
  const clip = useMemo(() => resolveAnimation(skin, action), [skin, action])
  const clipKey = `${skin.id}:${clip.action}:${clip.urls.join('|')}`
  const [loaded, setLoaded] = useState<{ key: string; urls: string[] }>({ key: '', urls: [] })
  const [frame, setFrame] = useState({ key: '', index: 0 })
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const onCompleteRef = useRef(onComplete)
  const onErrorRef = useRef(onError)
  const completedRef = useRef('')

  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])
  useEffect(() => { onErrorRef.current = onError }, [onError])

  useEffect(() => {
    let active = true
    completedRef.current = ''
    if (typeof Image === 'undefined') {
      Promise.resolve().then(() => {
        if (active) setLoaded({ key: clipKey, urls: clip.urls })
      })
      return () => { active = false }
    }
    Promise.all(clip.urls.map(loadImage)).then((urls) => {
      if (!active) return
      const available = urls.filter((url): url is string => url !== null)
      if (available.length === 0) onErrorRef.current?.()
      else setLoaded({ key: clipKey, urls: available })
    })
    return () => { active = false }
  }, [clipKey, clip.urls])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const update = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  const ready = loaded.key === clipKey && loaded.urls.length > 0
  const urls = ready ? loaded.urls : []
  const playback = resolveSpritePlayback(motion, getOsReducedMotion())
  const requestedFrame = frame.key === clipKey ? frame.index : 0
  const currentFrame = Math.min(requestedFrame, Math.max(urls.length - 1, 0))
  const src = ready ? urls[currentFrame] : (loaded.urls[0] ?? clip.urls[0])

  useEffect(() => {
    if (!ready || playback === 'static' || !pageVisible || urls.length < 2) return
    const timer = window.setTimeout(() => {
      setFrame((current) => {
        const index = current.key === clipKey ? current.index : 0
        return { key: clipKey, index: advanceSpriteFrame(index, urls.length, clip.loop) ?? index }
      })
    }, 1000 / clip.fps)
    return () => window.clearTimeout(timer)
  }, [ready, playback, pageVisible, urls.length, clip.loop, clip.fps, currentFrame, clipKey])

  useEffect(() => {
    if (!ready || completedRef.current === clipKey) return
    if (!shouldCompleteClip({ loop: clip.loop, playback, currentFrame, frameCount: urls.length })) return
    completedRef.current = clipKey
    onCompleteRef.current?.()
  }, [ready, clip.loop, clipKey, currentFrame, urls.length, playback])

  return (
    <img
      className="pet-sprite"
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ transform: direction === 'left' ? 'scaleX(-1)' : undefined }}
    />
  )
}
