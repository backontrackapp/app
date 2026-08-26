import { Capacitor } from '@capacitor/core'
import { ScreenOrientation } from '@capacitor/screen-orientation'
import type { RouteLocationNormalized, Router } from 'vue-router'

function routeAllowsLandscape(route: RouteLocationNormalized) {
  return route.meta.allowsLandscape === true
}

export function installScreenOrientationPolicy(router: Router) {
  if (!Capacitor.isNativePlatform()) return

  let landscapeAllowed: boolean | undefined

  router.beforeResolve(async (to) => {
    const nextLandscapeAllowed = routeAllowsLandscape(to)
    if (nextLandscapeAllowed === landscapeAllowed) return

    try {
      if (nextLandscapeAllowed) {
        await ScreenOrientation.unlock()
      } else {
        await ScreenOrientation.lock({ orientation: 'portrait' })
      }
      landscapeAllowed = nextLandscapeAllowed
    } catch {
      // Orientation restrictions are best-effort when the OS declines a lock.
      landscapeAllowed = undefined
    }
  })
}
