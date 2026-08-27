# Public page metadata

BackOnTrack's unauthenticated web routes define their search and social metadata in `src/router/index.ts`. `src/services/seo.ts` applies the active route's title, description, canonical URL, robots directive, Open Graph fields, and Twitter Card fields after navigation.

The landing page is indexable for signed-out visitors. Signed-in visitors who open it are redirected to Tasks. Authentication, password recovery, password reset, and email confirmation routes use `noindex, nofollow` because they are utility flows rather than search destinations. Canonical URLs never include query strings, which keeps reset and verification tokens out of page metadata.

Landing-page text remains selectable so visitors can copy product information, while authenticated application views retain their gesture-friendly selection behavior.

All public routes share `public/images/backontrack-og.jpg`, a 1200 by 630 pixel JPEG. `index.html` contains the landing-page metadata as the crawler and no-JavaScript fallback.

The production landing page also exposes Schema.org JSON-LD as a `WebSite` connected to the BackOnTrack `SoftwareApplication`, including its supported platforms, install URL, screenshots, and feature list. The privacy policy and terms routes expose route-specific `WebPage` data connected to the same website and application identifiers. The SEO service replaces the fallback JSON-LD after navigation and removes it from authenticated or `noindex` routes. Development builds omit all structured data.

Development builds created with `vite build --mode dev` emit a `robots.txt` that disallows every crawler from every route and do not emit a sitemap.

Production builds created with `vite build --mode prod` emit a `robots.txt` that explicitly allows `OAI-SearchBot` so public pages can be considered for ChatGPT search. The production file also allows other crawlers, preserving the site's general indexing policy, and points them to `sitemap.xml`. The production sitemap contains only the landing page, privacy policy, and terms and conditions; authenticated and `noindex` utility routes are excluded.
