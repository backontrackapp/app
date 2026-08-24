import fitty, { type FittyInstance } from 'fitty'
import { nextTick, onBeforeUnmount, onMounted, watch, type WatchSource } from 'vue'

const DEFAULT_FITTED_FONT_SIZE_PROPERTY = '--fit-largest-word-size'
const MAX_FITTED_FONT_SIZE_REM = 3.6
const MEASUREMENT_SELECTOR = '[data-fit-largest-word-measurement]'

type FitLargestWordOptions = {
  maxLines: number
  minSizeRem?: number | (() => number | undefined)
  maxSizeRem?: number | (() => number)
  fitWidth?: boolean | (() => boolean)
  fontSizeProperty?: string
}

type Typography = {
  fontFamily: string
  fontStyle: string
  fontWeight: string
  letterSpacing: string
  textTransform: string
}

function rootFontSizeInPixels() {
  return Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize,
  ) || 16
}

function renderedLineCount(element: HTMLElement) {
  const lines = new Set<number>()
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const parent = node.parentElement
    if (node.textContent?.trim() && !parent?.closest(MEASUREMENT_SELECTOR)) {
      const range = document.createRange()
      range.selectNodeContents(node)
      Array.from(range.getClientRects()).forEach(rect => {
        if (rect.width && rect.height) lines.add(Math.round(rect.top * 2) / 2)
      })
    }
    node = walker.nextNode()
  }
  return lines.size
}

export function useFitLargestWord(
  host: () => HTMLElement | undefined,
  measurement: () => HTMLElement | undefined,
  sources: () => HTMLElement[],
  content: WatchSource<unknown>,
  options: FitLargestWordOptions,
) {
  let instance: FittyInstance | undefined
  let fitListener: EventListener | undefined
  let resizeObserver: ResizeObserver | undefined
  let mounted = false

  const fontSizeProperty = options.fontSizeProperty ?? DEFAULT_FITTED_FONT_SIZE_PROPERTY
  const minSizeRem = () => {
    const configuredMinimum = typeof options.minSizeRem === 'function'
      ? options.minSizeRem()
      : options.minSizeRem
    return configuredMinimum ?? (1 / rootFontSizeInPixels())
  }
  const maxSizeRem = () => typeof options.maxSizeRem === 'function'
    ? options.maxSizeRem()
    : options.maxSizeRem ?? MAX_FITTED_FONT_SIZE_REM
  const fitsWidth = () => typeof options.fitWidth === 'function'
    ? options.fitWidth()
    : options.fitWidth ?? true

  function targetElements() {
    const element = host()
    return element ? [element] : []
  }

  function clearInstance() {
    const measurementElement = measurement()
    if (measurementElement && fitListener) {
      measurementElement.removeEventListener('fit', fitListener)
    }
    fitListener = undefined
    resizeObserver?.disconnect()
    resizeObserver = undefined
    instance?.unsubscribe()
    instance = undefined
  }

  function setFittedFontSize(sizeInPixels: number) {
    const size = `${sizeInPixels / rootFontSizeInPixels()}rem`
    targetElements().forEach((element) => {
      element.style.setProperty(fontSizeProperty, size)
      element.dataset.fitLargestWordSize = String(sizeInPixels)
    })
  }

  function notifyFitComplete() {
    host()?.dispatchEvent(new CustomEvent('fit-largest-word-complete', { bubbles: true }))
  }

  function fitsLineLimit() {
    return targetElements().every(element => renderedLineCount(element) <= options.maxLines)
  }

  function constrainToLineLimit(widthFitSize: number) {
    const minimumSize = rootFontSizeInPixels() * minSizeRem()
    const maximumSize = Math.max(minimumSize, widthFitSize)
    setFittedFontSize(maximumSize)
    if (fitsLineLimit()) return

    let fittingSize = minimumSize
    let overflowingSize = maximumSize
    setFittedFontSize(fittingSize)
    if (!fitsLineLimit()) return

    for (let iteration = 0; iteration < 12; iteration += 1) {
      const candidate = (fittingSize + overflowingSize) / 2
      setFittedFontSize(candidate)
      if (fitsLineLimit()) fittingSize = candidate
      else overflowingSize = candidate
    }
    setFittedFontSize(fittingSize)
  }

  function fit() {
    const hostElement = host()
    const probe = measurement()
    if (!mounted || !hostElement || !probe || !hostElement.clientWidth) return

    clearInstance()
    if (!fitsWidth()) {
      constrainToLineLimit(rootFontSizeInPixels() * maxSizeRem())
      notifyFitComplete()
      if ('ResizeObserver' in window) {
        let observedWidth = hostElement.clientWidth
        resizeObserver = new ResizeObserver(() => {
          const nextWidth = hostElement.clientWidth
          if (Math.abs(nextWidth - observedWidth) < 1) return
          observedWidth = nextWidth
          constrainToLineLimit(rootFontSizeInPixels() * maxSizeRem())
          notifyFitComplete()
        })
        resizeObserver.observe(hostElement)
      }
      return
    }

    let widestWord = ''
    let widestWordWidth = 0
    let widestTypography: Typography | undefined

    sources().forEach((source) => {
      const style = window.getComputedStyle(source)
      const typography: Typography = {
        fontFamily: style.fontFamily,
        fontStyle: style.fontStyle,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        textTransform: style.textTransform,
      }
      Object.assign(probe.style, typography, { fontSize: '100px' })
      const sourceClone = source.cloneNode(true) as HTMLElement
      sourceClone.querySelectorAll(MEASUREMENT_SELECTOR).forEach(element => element.remove())
      sourceClone.textContent?.trim().split(/\s+/u).filter(Boolean).forEach((word) => {
        probe.textContent = word
        const width = probe.scrollWidth
        if (width <= widestWordWidth) return
        widestWord = word
        widestWordWidth = width
        widestTypography = typography
      })
    })

    if (!widestWord || !widestTypography) return

    Object.assign(probe.style, widestTypography, { fontSize: '100px' })
    probe.textContent = widestWord
    fitListener = ((event: CustomEvent<{ newValue: number }>) => {
      constrainToLineLimit(event.detail.newValue)
      notifyFitComplete()
    }) as EventListener
    probe.addEventListener('fit', fitListener)
    instance = fitty(probe, {
      minSize: rootFontSizeInPixels() * minSizeRem(),
      maxSize: rootFontSizeInPixels() * Math.max(minSizeRem(), maxSizeRem()),
      multiLine: false,
      observeMutations: false,
    })
    instance.fit({ sync: true })
  }

  function queueFit() {
    void nextTick(() => fit())
  }

  watch(content, queueFit, { flush: 'post' })

  onMounted(() => {
    mounted = true
    queueFit()
    void document.fonts?.ready.then(() => {
      if (mounted) fit()
    })
  })

  onBeforeUnmount(() => {
    mounted = false
    clearInstance()
    targetElements().forEach((element) => {
      element.style.removeProperty(fontSizeProperty)
      delete element.dataset.fitLargestWordSize
    })
  })
}
