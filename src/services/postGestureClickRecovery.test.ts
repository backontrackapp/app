import { installPostGestureClickRecovery } from './postGestureClickRecovery'

function pointerEvent(
  type: string,
  x: number,
  y: number,
  pointerId: number,
  pointerType = 'touch',
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  })
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
  })
  return event
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function swipe(element: HTMLElement, pointerId = 1) {
  element.dispatchEvent(pointerEvent('pointerdown', 20, 100, pointerId))
  element.dispatchEvent(pointerEvent('pointermove', 20, 60, pointerId))
  element.dispatchEvent(pointerEvent('pointerup', 20, 60, pointerId))
}

describe('post-gesture click recovery', () => {
  let removeRecovery: (() => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('PointerEvent', MouseEvent)
    document.body.replaceChildren()
  })

  afterEach(() => {
    removeRecovery?.()
    removeRecovery = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('recovers a retargeted tap after its control becomes available', () => {
    const surface = document.createElement('div')
    const controls = document.createElement('div')
    const button = document.createElement('button')
    button.textContent = 'Actions'
    button.disabled = true
    button.style.pointerEvents = 'none'
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 48, 48))
    controls.append(button)
    document.body.append(surface, controls)

    let clicks = 0
    button.addEventListener('click', () => { clicks += 1 })
    removeRecovery = installPostGestureClickRecovery()

    swipe(surface)
    controls.dispatchEvent(pointerEvent('pointerdown', 120, 120, 2))
    controls.dispatchEvent(pointerEvent('pointerup', 120, 120, 2))
    vi.advanceTimersByTime(96)
    expect(clicks).toBe(0)

    button.disabled = false
    button.style.pointerEvents = 'auto'
    vi.advanceTimersByTime(64)
    expect(clicks).toBe(1)

    vi.advanceTimersByTime(500)
    expect(clicks).toBe(1)
  })

  it('recovers mouse drags in the web app', () => {
    const surface = document.createElement('div')
    const button = document.createElement('button')
    document.body.append(surface, button)

    let clicks = 0
    button.addEventListener('click', () => { clicks += 1 })
    removeRecovery = installPostGestureClickRecovery()

    surface.dispatchEvent(pointerEvent('pointerdown', 20, 100, 1, 'mouse'))
    surface.dispatchEvent(pointerEvent('pointermove', 20, 60, 1, 'mouse'))
    surface.dispatchEvent(pointerEvent('pointerup', 20, 60, 1, 'mouse'))
    button.dispatchEvent(pointerEvent('pointerdown', 20, 20, 2, 'mouse'))
    button.dispatchEvent(pointerEvent('pointerup', 20, 20, 2, 'mouse'))
    vi.advanceTimersByTime(64)
    expect(clicks).toBe(1)
  })

  it('does not change ordinary mouse input or controls that activate on pointerup', () => {
    const surface = document.createElement('div')
    const button = document.createElement('button')
    const pointerUpControl = document.createElement('button')
    pointerUpControl.dataset.postGestureClickRecovery = 'off'
    document.body.append(surface, button, pointerUpControl)

    let buttonClicks = 0
    let pointerUpClicks = 0
    button.addEventListener('click', () => { buttonClicks += 1 })
    pointerUpControl.addEventListener('click', () => { pointerUpClicks += 1 })
    removeRecovery = installPostGestureClickRecovery()

    surface.dispatchEvent(pointerEvent('pointerdown', 20, 100, 1, 'mouse'))
    surface.dispatchEvent(pointerEvent('pointerup', 20, 100, 1, 'mouse'))
    button.dispatchEvent(pointerEvent('pointerdown', 20, 20, 2, 'mouse'))
    button.dispatchEvent(pointerEvent('pointerup', 20, 20, 2, 'mouse'))
    vi.advanceTimersByTime(64)
    expect(buttonClicks).toBe(0)

    swipe(surface, 3)
    pointerUpControl.dispatchEvent(pointerEvent('pointerdown', 20, 20, 4))
    pointerUpControl.dispatchEvent(pointerEvent('pointerup', 20, 20, 4))
    vi.advanceTimersByTime(600)
    expect(pointerUpClicks).toBe(0)
  })
})
