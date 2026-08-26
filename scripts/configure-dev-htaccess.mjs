import { readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const htaccessPath = resolve(projectRoot, 'dist/.htaccess')
const configuredIps = process.env.BACKONTRACK_REQUIRE_IPS?.trim() ?? ''

if (!configuredIps) {
  throw new Error(
    'BACKONTRACK_REQUIRE_IPS must contain a comma-separated IP/CIDR allowlist for development deployments.',
  )
}

const ipEntries = configuredIps.split(',').map((entry) => entry.trim())

if (ipEntries.some((entry) => entry === '')) {
  throw new Error('BACKONTRACK_REQUIRE_IPS contains an empty entry.')
}

for (const entry of ipEntries) {
  const [address, prefix, extra] = entry.split('/')
  const ipVersion = isIP(address)

  if (!ipVersion || extra !== undefined) {
    throw new Error(`BACKONTRACK_REQUIRE_IPS contains an invalid IP/CIDR: ${entry}`)
  }

  if (prefix === undefined) continue

  const maxPrefix = ipVersion === 4 ? 32 : 128
  if (!/^\d+$/.test(prefix) || Number(prefix) > maxPrefix) {
    throw new Error(`BACKONTRACK_REQUIRE_IPS contains an invalid IP/CIDR: ${entry}`)
  }
}

const uniqueIps = [...new Set(ipEntries)]
const restriction = [
  '# Development deployment access restriction.',
  'Order Deny,Allow',
  'Deny from all',
  `Allow from ${uniqueIps.join(' ')}`,
  '',
  '# The migration endpoint remains protected by its application-level key.',
  '<Files "migrate.php">',
  '    Order Allow,Deny',
  '    Allow from all',
  '</Files>',
  '',
].join('\n')

const htaccess = await readFile(htaccessPath, 'utf8')
await writeFile(htaccessPath, `${restriction}${htaccess}`)
