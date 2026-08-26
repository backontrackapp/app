import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'

export interface SeoMetadata {
  title: string
  description: string
  robots?: 'index, follow' | 'noindex, nofollow'
  structuredData?: 'software-application' | 'web-page'
}

const SITE_NAME = 'BackOnTrack'
const SITE_ORIGIN = 'https://backontrack.app'
const SITE_LANGUAGE = 'en-CA'
const WEBSITE_ID = `${SITE_ORIGIN}/#website`
const SOFTWARE_APPLICATION_ID = `${SITE_ORIGIN}/#software-application`
const STRUCTURED_DATA_ENABLED = import.meta.env.MODE === 'prod'
const SOCIAL_IMAGE_PATH = '/images/backontrack-og.jpg'
const SOCIAL_IMAGE_ALT = 'A runner wearing headphones uses BackOnTrack flashcards and interval training to build his way forward.'
const SOFTWARE_FEATURES = [
  'Task planning and scheduling',
  'Programmable interval timers and routines',
  'Flashcard learning and review',
  'Configurable tracking and insights',
  'Private journaling and reflection',
]
const SOFTWARE_SCREENSHOTS = [
  '/images/tasks.jpeg',
  '/images/intervals.jpeg',
  '/images/tracking.jpeg',
]

function setMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector)

  if (!element) {
    element = document.createElement('meta')
    document.head.append(element)
  }

  Object.entries(attributes).forEach(([name, value]) => element?.setAttribute(name, value))
}

function setCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')

  if (!element) {
    element = document.createElement('link')
    element.rel = 'canonical'
    document.head.append(element)
  }

  element.href = href
}

function removeMeta(selector: string) {
  document.head.querySelector(selector)?.remove()
}

function setStructuredData(data: Record<string, unknown>) {
  let element = document.head.querySelector<HTMLScriptElement>('script[data-seo-structured-data]')

  if (!element) {
    element = document.createElement('script')
    element.type = 'application/ld+json'
    element.dataset.seoStructuredData = ''
    document.head.append(element)
  }

  element.textContent = JSON.stringify(data)
}

function removeStructuredData() {
  document.head.querySelector('script[data-seo-structured-data]')?.remove()
}

function buildStructuredData(seo: SeoMetadata, canonicalUrl: string): Record<string, unknown> | undefined {
  if (!STRUCTURED_DATA_ENABLED || seo.robots === 'noindex, nofollow') return undefined

  if (seo.structuredData === 'software-application') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          '@id': WEBSITE_ID,
          url: `${SITE_ORIGIN}/`,
          name: SITE_NAME,
          description: seo.description,
          inLanguage: SITE_LANGUAGE,
          about: { '@id': SOFTWARE_APPLICATION_ID },
        },
        {
          '@type': 'SoftwareApplication',
          '@id': SOFTWARE_APPLICATION_ID,
          url: `${SITE_ORIGIN}/`,
          name: SITE_NAME,
          description: seo.description,
          applicationCategory: 'ProductivityApplication',
          operatingSystem: ['Web', 'Android', 'iOS'],
          image: new URL(SOCIAL_IMAGE_PATH, SITE_ORIGIN).href,
          screenshot: SOFTWARE_SCREENSHOTS.map((path) => new URL(path, SITE_ORIGIN).href),
          featureList: SOFTWARE_FEATURES,
          installUrl: 'https://github.com/BackOnTrackApp/app/releases/latest',
        },
      ],
    }
  }

  if (seo.structuredData === 'web-page') {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: seo.title,
      description: seo.description,
      inLanguage: SITE_LANGUAGE,
      isPartOf: {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        url: `${SITE_ORIGIN}/`,
        name: SITE_NAME,
      },
      about: {
        '@type': 'SoftwareApplication',
        '@id': SOFTWARE_APPLICATION_ID,
        name: SITE_NAME,
      },
    }
  }

  return undefined
}

function clearPublicMetadata(route: RouteLocationNormalizedLoaded) {
  const routeTitle = typeof route.meta.title === 'string' ? `${route.meta.title} | ${SITE_NAME}` : SITE_NAME
  const publicMetaSelectors = [
    'meta[name="description"]',
    'meta[property="og:title"]',
    'meta[property="og:description"]',
    'meta[property="og:url"]',
    'meta[property="og:image"]',
    'meta[property="og:image:type"]',
    'meta[property="og:image:width"]',
    'meta[property="og:image:height"]',
    'meta[property="og:image:alt"]',
    'meta[name="twitter:title"]',
    'meta[name="twitter:description"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:alt"]',
  ]

  document.title = routeTitle
  document.head.querySelector('link[rel="canonical"]')?.remove()
  setMeta('meta[name="robots"]', { name: 'robots', content: 'noindex, nofollow' })
  removeStructuredData()
  publicMetaSelectors.forEach(removeMeta)
}

function applySeoMetadata(route: RouteLocationNormalizedLoaded) {
  const seo = route.meta.seo as SeoMetadata | undefined
  if (!seo) {
    clearPublicMetadata(route)
    return
  }

  const canonicalUrl = new URL(route.path, SITE_ORIGIN).href
  const socialImageUrl = new URL(SOCIAL_IMAGE_PATH, SITE_ORIGIN).href

  document.title = seo.title
  setCanonical(canonicalUrl)
  setMeta('meta[name="description"]', { name: 'description', content: seo.description })
  setMeta('meta[name="robots"]', { name: 'robots', content: seo.robots || 'index, follow' })
  setMeta('meta[property="og:title"]', { property: 'og:title', content: seo.title })
  setMeta('meta[property="og:description"]', { property: 'og:description', content: seo.description })
  setMeta('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl })
  setMeta('meta[property="og:image"]', { property: 'og:image', content: socialImageUrl })
  setMeta('meta[property="og:image:type"]', { property: 'og:image:type', content: 'image/jpeg' })
  setMeta('meta[property="og:image:width"]', { property: 'og:image:width', content: '1200' })
  setMeta('meta[property="og:image:height"]', { property: 'og:image:height', content: '630' })
  setMeta('meta[property="og:image:alt"]', { property: 'og:image:alt', content: SOCIAL_IMAGE_ALT })
  setMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: seo.title })
  setMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: seo.description })
  setMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: socialImageUrl })
  setMeta('meta[name="twitter:image:alt"]', { name: 'twitter:image:alt', content: SOCIAL_IMAGE_ALT })

  const structuredData = buildStructuredData(seo, canonicalUrl)
  if (structuredData) setStructuredData(structuredData)
  else removeStructuredData()
}

export function installSeoMetadata(router: Router) {
  router.afterEach((route) => applySeoMetadata(route))
}
