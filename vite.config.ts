import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { VitePWA } from 'vite-plugin-pwa'

const SITE_ORIGIN = 'https://backontrack.app'
const INDEXABLE_PATHS = ['/', '/privacy', '/terms']

function crawlerIndexingPlugin(mode: string): Plugin {
  return {
    name: 'crawler-indexing',
    transformIndexHtml(html) {
      if (mode === 'prod') return html

      return html.replace(/\n\s*<script type="application\/ld\+json" data-seo-structured-data>[\s\S]*?<\/script>/, '')
    },
    generateBundle() {
      if (mode === 'dev') {
        this.emitFile({
          type: 'asset',
          fileName: 'robots.txt',
          source: 'User-agent: *\nDisallow: /\n',
        })
        return
      }

      if (mode !== 'prod') return

      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: [
          'User-agent: OAI-SearchBot',
          'Allow: /',
          '',
          'User-agent: *',
          'Allow: /',
          '',
          `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
          '',
        ].join('\n'),
      })

      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...INDEXABLE_PATHS.map((path) => `  <url><loc>${new URL(path, SITE_ORIGIN).href}</loc></url>`),
          '</urlset>',
          '',
        ].join('\n'),
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    crawlerIndexingPlugin(mode),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,jpeg,webmanifest,mp3}'],
      },
    }),
  ],
  server: {
    port: 5183,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8090',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    server: {
      deps: {
        inline: [/vuetify/],
      },
    },
  },
}))
