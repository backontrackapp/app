# Navigation

Authenticated routes use directional transitions based on their menu order and depth. During a route change, the leaving page is pinned to its visible viewport position while the router resets document scrolling.

On touch devices, releasing a bottom-navigation item inside its bounds commits navigation directly instead of depending on the synthetic click that a native momentum scroll may suppress. Confirmed navigation briefly suspends document scrolling for one rendered frame. This cancels any active momentum scroll before the destination is displayed, preventing the incoming route from inheriting the previous page's fling or landing beyond its content. Press feedback may preload and select a bottom-navigation destination, but it does not hide the current page until Vue Router confirms navigation. Mouse clicks and keyboard activation continue through the link's click handler.
