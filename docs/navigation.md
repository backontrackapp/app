# Navigation

Authenticated routes use directional transitions based on their menu order and depth. During a route change, the leaving page is pinned to its visible viewport position while the router resets document scrolling.

On touch devices, releasing a bottom-navigation item inside its bounds commits navigation directly instead of depending on the synthetic click that a native momentum scroll may suppress. Confirmed navigation briefly suspends document scrolling for one rendered frame. This cancels any active momentum scroll before the destination is displayed, preventing the incoming route from inheriting the previous page's fling or landing beyond its content. Press feedback may preload and select a bottom-navigation destination, but it does not hide the current page until Vue Router confirms navigation. Mouse clicks and keyboard activation continue through the link's click handler.

## Swipe hints

Bind `v-swipe-hint` to any element that needs to teach one or more swipe actions. The directive displays each labeled direction in order and does not intercept pointer or touch input. Set `repeat` to replay the sequence until the user demonstrates or otherwise confirms the action.

```vue
<script setup lang="ts">
import { confirmSwipeHint } from '@/services/swipeHints'

const hint = {
  id: 'journal-date-navigation',
  items: [
    { direction: 'left' as const, label: 'Previous' },
    { direction: 'right' as const, label: 'Next' },
  ],
  repeat: true,
}

function onDateSwiped() {
  confirmSwipeHint(hint.id)
}
</script>

<template>
  <section v-swipe-hint="hint">
    <!-- Swipeable content -->
  </section>
</template>
```

`confirmSwipeHint(id)` stores the understood hint id in local storage and immediately removes every mounted hint with that id. Future mounts check storage and stay hidden. Confirmation is intentionally separate from the directive so it can happen from the actual gesture handler, a button, or another application event.

Review-set cards use the shared `review-set-card-navigation` hint in both standalone and dense interval sessions. It teaches swipe up for the previous card, swipe down for the next card, and either horizontal direction to flip the card. The hint repeats until the first recognized card swipe that is not consumed by scrolling, then that gesture confirms the hint for both card variants.
