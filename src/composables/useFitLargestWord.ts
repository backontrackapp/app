import fitty, { type FittyInstance } from 'fitty'
import { nextTick, onBeforeUnmount, onMounted, watch, type WatchSource } from 'vue'

const DEFAULT_FITTED_FONT_SIZE_PROPERTY = '--fit-largest-word-size'
const MAX_FITTED_FONT_SIZE_REM = 3.6
const MEASUREMENT_SELECTOR = '[data-fit-largest-word-measurement]'
export const REFIT_TEXT_CONTENT_EVENT = 'refit-text-content'

type FitLargestWordOptions = {
  maxLines: number
  minSizeRem?: number | (() => number | undefined)
  maxSizeRem?: number | (() => number)
  fitWidth?: boolean | (() => boolean)
  fitHeight?: boolean
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
  let eventHost: HTMLElement | undefined

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

  function fitsContent() {
    return targetElements().every(element => (
      (options.maxLines === 1
        ? element.scrollWidth <= element.clientWidth
        : renderedLineCount(element) <= options.maxLines)
      && (!options.fitHeight || sources().every(source => (
        source.getBoundingClientRect().height <= element.clientHeight
      )))
    ))
  }

  function constrainToFit(widthFitSize: number) {
    const minimumSize = rootFontSizeInPixels() * minSizeRem()
    const maximumSize = Math.max(minimumSize, widthFitSize)
    setFittedFontSize(maximumSize)
    if (fitsContent()) return

    let fittingSize = minimumSize
    let overflowingSize = maximumSize
    setFittedFontSize(fittingSize)
    if (!fitsContent()) return

    for (let iteration = 0; iteration < 12; iteration += 1) {
      const candidate = (fittingSize + overflowingSize) / 2
      setFittedFontSize(candidate)
      if (fitsContent()) fittingSize = candidate
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
      constrainToFit(rootFontSizeInPixels() * maxSizeRem())
      notifyFitComplete()
      if ('ResizeObserver' in window) {
        let observedWidth = hostElement.clientWidth
        let observedHeight = hostElement.clientHeight
        resizeObserver = new ResizeObserver(() => {
          const nextWidth = hostElement.clientWidth
          const nextHeight = hostElement.clientHeight
          if (
            Math.abs(nextWidth - observedWidth) < 1
            && (!options.fitHeight || Math.abs(nextHeight - observedHeight) < 1)
          ) return
          observedWidth = nextWidth
          observedHeight = nextHeight
          constrainToFit(rootFontSizeInPixels() * maxSizeRem())
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
      constrainToFit(event.detail.newValue)
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

    if (options.fitHeight && 'ResizeObserver' in window) {
      let observedHeight = hostElement.clientHeight
      resizeObserver = new ResizeObserver(() => {
        const nextHeight = hostElement.clientHeight
        if (Math.abs(nextHeight - observedHeight) < 1) return
        observedHeight = nextHeight
        fit()
      })
      resizeObserver.observe(hostElement)
    }
  }

  function queueFit() {
    void nextTick(() => fit())
  }

  watch(content, queueFit, { flush: 'post' })

  onMounted(() => {
    mounted = true
    eventHost = host()
    eventHost?.addEventListener(REFIT_TEXT_CONTENT_EVENT, fit)
    queueFit()
    void document.fonts?.ready.then(() => {
      if (mounted) fit()
    })
  })

  onBeforeUnmount(() => {
    mounted = false
    eventHost?.removeEventListener(REFIT_TEXT_CONTENT_EVENT, fit)
    eventHost = undefined
    clearInstance()
    targetElements().forEach((element) => {
      element.style.removeProperty(fontSizeProperty)
      delete element.dataset.fitLargestWordSize
    })
  })
}
