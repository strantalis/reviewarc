#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDir, '../..')
const frontendRoot = join(repositoryRoot, 'frontend')
const nodeModules = join(frontendRoot, 'node_modules')
const packageLock = JSON.parse(readFileSync(join(frontendRoot, 'package-lock.json'), 'utf8'))
const goEnvironment = { ...process.env, GOCACHE: process.env.GOCACHE ?? join(tmpdir(), 'reviewarc-go-build-cache') }

// This is the runtime package set observed in Vite's production source maps.
// Regenerate the maps with `cd frontend && npx vite build --sourcemap`, update
// this list when it changes, then regenerate THIRD_PARTY_NOTICES.txt.
const frontendPackages = [
  '@floating-ui/core', '@floating-ui/dom', '@floating-ui/react-dom', '@floating-ui/utils',
  '@pierre/diffs', '@pierre/theme', '@pierre/theming',
  '@radix-ui/number', '@radix-ui/primitive', '@radix-ui/react-arrow',
  '@radix-ui/react-collection', '@radix-ui/react-compose-refs', '@radix-ui/react-context',
  '@radix-ui/react-direction', '@radix-ui/react-dismissable-layer', '@radix-ui/react-focus-guards',
  '@radix-ui/react-focus-scope', '@radix-ui/react-id', '@radix-ui/react-popper',
  '@radix-ui/react-portal', '@radix-ui/react-presence', '@radix-ui/react-primitive',
  '@radix-ui/react-select', '@radix-ui/react-slot', '@radix-ui/react-use-callback-ref',
  '@radix-ui/react-use-controllable-state', '@radix-ui/react-use-layout-effect',
  '@radix-ui/react-use-previous', '@radix-ui/react-use-size', '@radix-ui/react-visually-hidden',
  '@shikijs/core', '@shikijs/engine-javascript', '@shikijs/engine-oniguruma', '@shikijs/langs',
  '@shikijs/primitive', '@shikijs/themes', '@shikijs/transformers', '@shikijs/types',
  '@shikijs/vscode-textmate', 'aria-hidden', 'ccount', 'character-entities-html4',
  'character-entities-legacy', 'comma-separated-tokens', 'diff', 'get-nonce',
  'hast-util-to-html', 'hast-util-whitespace', 'html-void-elements', 'lucide-react',
  'oniguruma-parser', 'oniguruma-to-es', 'property-information', 'react', 'react-dom',
  'react-remove-scroll', 'react-remove-scroll-bar', 'react-style-singleton', 'regex',
  'regex-recursion', 'regex-utilities', 'scheduler', 'shiki', 'space-separated-tokens',
  'stringify-entities', 'tslib', 'use-callback-ref', 'use-sidecar', 'zwitch',
]

const frontendLicenseFallbacks = new Map([
  ['@pierre/theming', '@pierre/diffs'],
  ['react-remove-scroll-bar', 'react-remove-scroll'],
])

const extraGoLicenseFiles = new Map([
  ['golang.org/x/exp', ['PATENTS']],
  ['golang.org/x/sys', ['PATENTS']],
  ['modernc.org/libc', ['LICENSE-3RD-PARTY.md']],
  ['modernc.org/mathutil', ['mersenne/LICENSE']],
  ['modernc.org/memory', ['LICENSE-GO', 'LICENSE-MMAP-GO']],
])

function licenseFile(directory) {
  const match = readdirSync(directory).find((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name))
  if (!match) throw new Error(`No license file found in ${directory}`)
  return join(directory, match)
}

function addLicense(groups, component, sourcePath, sourceLabel, textOverride) {
  const text = (textOverride ?? readFileSync(sourcePath, 'utf8'))
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd()
  const digest = createHash('sha256').update(text).digest('hex')
  const group = groups.get(digest) ?? { components: [], sources: new Set(), text }
  group.components.push(component)
  group.sources.add(sourceLabel)
  groups.set(digest, group)
}

function goModules() {
  const format = '{{with .Module}}{{if .Main}}{{else}}{{.Path}}\t{{.Version}}\t{{.Dir}}{{end}}{{end}}'
  const output = execFileSync('go', ['list', '-deps', '-tags', 'sparkle', '-f', format, '.'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: goEnvironment,
  })
  return [...new Set(output.split('\n').filter(Boolean))].sort().map((line) => {
    const [name, version, directory] = line.split('\t')
    return { name, version, directory }
  })
}

const groups = new Map()

for (const name of frontendPackages) {
  const entry = packageLock.packages[`node_modules/${name}`]
  if (!entry?.version) throw new Error(`No locked version found for ${name}`)
  const fallback = frontendLicenseFallbacks.get(name) ?? name
  const sourcePath = licenseFile(join(nodeModules, fallback))
  addLicense(groups, `npm: ${name}@${entry.version}`, sourcePath, `npm package: ${fallback}@${packageLock.packages[`node_modules/${fallback}`]?.version ?? entry.version}`)
}

for (const { name, version, directory } of goModules()) {
  addLicense(groups, `Go module: ${name}@${version}`, licenseFile(directory), `Go module: ${name}@${version}/LICENSE`)
  for (const filename of extraGoLicenseFiles.get(name) ?? []) {
    const sourcePath = join(directory, filename)
    if (!existsSync(sourcePath)) throw new Error(`Expected license file missing: ${sourcePath}`)
    addLicense(groups, `Go module supplemental notice: ${name}@${version} (${filename})`, sourcePath, `Go module: ${name}@${version}/${filename}`)
  }
}

const goRoot = realpathSync(execFileSync('go', ['env', 'GOROOT'], { encoding: 'utf8', env: goEnvironment }).trim())
const goLicense = [join(goRoot, 'LICENSE'), join(dirname(goRoot), 'LICENSE')].find(existsSync)
if (!goLicense) throw new Error(`Unable to find the Go toolchain license near ${goRoot}`)
addLicense(groups, `Go runtime: ${execFileSync('go', ['version'], { encoding: 'utf8', env: goEnvironment }).trim()}`, goLicense, 'Go toolchain distribution: LICENSE')
const goPatents = [join(goRoot, 'PATENTS'), join(dirname(goRoot), 'PATENTS')].find(existsSync)
if (goPatents) addLicense(groups, 'Go runtime patent grant', goPatents, 'Go toolchain distribution: PATENTS')

const sparkleLicense = [
  join(repositoryRoot, 'dist/sparkle/LICENSE'),
  join(repositoryRoot, 'build/darwin/updater/.deps/LICENSE'),
].find(existsSync)
if (!sparkleLicense) {
  throw new Error('Sparkle license is unavailable. Run build/darwin/updater/fetch_sparkle.sh first.')
}
addLicense(groups, 'Sparkle 2.9.2', sparkleLicense, 'Sparkle 2.9.2 release archive: LICENSE')

const sections = [...groups.values()]
  .sort((a, b) => a.components[0].localeCompare(b.components[0]))
  .map((group) => {
    const components = [...new Set(group.components)].sort().map((name) => `  - ${name}`).join('\n')
    const sources = [...group.sources].sort().map((source) => `  - ${source}`).join('\n')
    return `Components:\n${components}\nLicense text sourced from:\n${sources}\n\n${group.text}`
  })

const header = `ReviewArc Third-Party Notices
=================================

ReviewArc includes the third-party software listed below. The notices and
license texts are reproduced from the pinned upstream distributions. This
file is generated by scripts/release/generate_third_party_notices.mjs; do not
edit it by hand.

The ReviewArc source code has its own license in LICENSE. These third-party
licenses apply only to their respective components.
`

const divider = '\n\n' + '='.repeat(80) + '\n\n'
const outputPath = join(repositoryRoot, 'THIRD_PARTY_NOTICES.txt')
const output = header + divider + sections.join(divider) + '\n'
if (process.argv.includes('--check')) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output) {
    throw new Error('THIRD_PARTY_NOTICES.txt is stale. Run scripts/release/generate_third_party_notices.mjs.')
  }
} else {
  writeFileSync(outputPath, output)
}
