#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, statSync, writeFileSync } from 'node:fs'

const [sbomPath, version, dmgPath] = process.argv.slice(2)
if (!sbomPath || !version || !dmgPath) {
  throw new Error('Usage: augment_sbom.mjs <sbom.spdx.json> <version> <release.dmg>')
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDir, '../..')
const packageLock = JSON.parse(readFileSync(join(repositoryRoot, 'frontend/package-lock.json'), 'utf8'))
const notices = readFileSync(join(repositoryRoot, 'THIRD_PARTY_NOTICES.txt'), 'utf8')
const sparkleEnvironment = readFileSync(join(repositoryRoot, 'build/darwin/updater/sparkle.env'), 'utf8')
const document = JSON.parse(readFileSync(sbomPath, 'utf8'))

if (document.spdxVersion !== 'SPDX-2.3' || document.SPDXID !== 'SPDXRef-DOCUMENT') {
  throw new Error('Syft output is not an SPDX 2.3 document')
}
if (!Array.isArray(document.packages) || !Array.isArray(document.relationships)) {
  throw new Error('Syft SPDX document is missing packages or relationships')
}
if (document.packages.some((item) => item.SPDXID?.startsWith('SPDXRef-ReviewArc-'))) {
  throw new Error('SBOM has already been augmented')
}

const described = document.relationships.find((item) =>
  item.spdxElementId === 'SPDXRef-DOCUMENT' && item.relationshipType === 'DESCRIBES')
if (!described || !document.packages.some((item) => item.SPDXID === described.relatedSpdxElement)) {
  throw new Error('Syft SPDX document has no described application root')
}

const appPackage = document.packages.find((item) => item.SPDXID === described.relatedSpdxElement)
appPackage.name = 'ReviewArc.app'
appPackage.versionInfo = version
appPackage.licenseDeclared = 'Apache-2.0'
appPackage.licenseConcluded = 'Apache-2.0'
appPackage.primaryPackagePurpose = 'APPLICATION'

function identifier(kind, value) {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 16)
  return `SPDXRef-ReviewArc-${kind}-${digest}`
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function npmPurl(name, packageVersion) {
  if (!name.startsWith('@')) return `pkg:npm/${name}@${packageVersion}`
  const [scope, packageName] = name.split('/')
  return `pkg:npm/${encodeURIComponent(scope)}/${packageName}@${packageVersion}`
}

function checksumFromIntegrity(integrity) {
  const [algorithm, encoded] = integrity.split('-', 2)
  if (!algorithm || !encoded) return []
  return [{ algorithm: algorithm.toUpperCase(), checksumValue: Buffer.from(encoded, 'base64').toString('hex') }]
}

const dmgName = basename(dmgPath)
const dmgDigest = sha256(dmgPath)
const checksumFile = readFileSync(`${dmgPath}.sha256`, 'utf8').trim().split(/\s+/)
if (checksumFile[0] !== dmgDigest) throw new Error('DMG checksum file does not match the release artifact')

const dmgID = identifier('DMG', `${dmgName}@${version}:${dmgDigest}`)
document.packages.push({
  name: dmgName,
  SPDXID: dmgID,
  versionInfo: version,
  supplier: 'NOASSERTION',
  downloadLocation: 'NOASSERTION',
  filesAnalyzed: false,
  checksums: [{ algorithm: 'SHA256', checksumValue: dmgDigest }],
  licenseConcluded: 'NOASSERTION',
  licenseDeclared: 'NOASSERTION',
  copyrightText: 'NOASSERTION',
  primaryPackagePurpose: 'APPLICATION',
  comment: `Notarized ReviewArc DMG (${statSync(dmgPath).size} bytes) described by this SBOM.`,
})
described.relatedSpdxElement = dmgID
document.relationships.push({
  spdxElementId: dmgID,
  relatedSpdxElement: appPackage.SPDXID,
  relationshipType: 'CONTAINS',
})

const npmComponents = [...notices.matchAll(/^  - npm: (.+)@([^@\s]+)$/gm)]
if (npmComponents.length === 0) throw new Error('Third-party notices contain no npm runtime inventory')
for (const [, name, lockedVersion] of npmComponents) {
  const entry = packageLock.packages[`node_modules/${name}`]
  if (!entry || entry.version !== lockedVersion) {
    throw new Error(`Notice inventory and package lock disagree for ${name}@${lockedVersion}`)
  }
  const license = entry.license?.toLowerCase() === 'apache-2.0' ? 'Apache-2.0' : entry.license
  if (!license) throw new Error(`Locked package ${name}@${lockedVersion} has no declared license`)
  const packageID = identifier('NPM', `${name}@${lockedVersion}`)
  document.packages.push({
    name,
    SPDXID: packageID,
    versionInfo: lockedVersion,
    supplier: 'NOASSERTION',
    downloadLocation: entry.resolved ?? 'NOASSERTION',
    filesAnalyzed: false,
    checksums: checksumFromIntegrity(entry.integrity ?? ''),
    licenseConcluded: license,
    licenseDeclared: license,
    copyrightText: 'NOASSERTION',
    primaryPackagePurpose: 'LIBRARY',
    sourceInfo: 'Declared runtime component from the generated ReviewArc third-party notice inventory.',
    externalRefs: [{
      referenceCategory: 'PACKAGE-MANAGER',
      referenceType: 'purl',
      referenceLocator: npmPurl(name, lockedVersion),
    }],
  })
  document.relationships.push({
    spdxElementId: appPackage.SPDXID,
    relatedSpdxElement: packageID,
    relationshipType: 'CONTAINS',
  })
}

const sparkleMatch = notices.match(/^  - Sparkle ([^\s]+)$/m)
if (!sparkleMatch) throw new Error('Third-party notices contain no Sparkle runtime component')
const sparkleVersion = sparkleMatch[1]
const configuredSparkleVersion = sparkleEnvironment.match(/^SPARKLE_VERSION=(.+)$/m)?.[1]
if (sparkleVersion !== configuredSparkleVersion) {
  throw new Error(`Notice inventory and release configuration disagree for Sparkle ${sparkleVersion}`)
}
const sparkleID = identifier('Sparkle', sparkleVersion)
document.packages.push({
  name: 'Sparkle',
  SPDXID: sparkleID,
  versionInfo: sparkleVersion,
  supplier: 'NOASSERTION',
  downloadLocation: `https://github.com/sparkle-project/Sparkle/releases/tag/${sparkleVersion}`,
  filesAnalyzed: false,
  licenseConcluded: 'MIT',
  licenseDeclared: 'MIT',
  copyrightText: 'NOASSERTION',
  primaryPackagePurpose: 'LIBRARY',
  sourceInfo: 'Embedded framework declared by the generated ReviewArc third-party notice inventory.',
  externalRefs: [{
    referenceCategory: 'PACKAGE-MANAGER',
    referenceType: 'purl',
    referenceLocator: `pkg:github/sparkle-project/Sparkle@${sparkleVersion}`,
  }],
})
document.relationships.push({
  spdxElementId: appPackage.SPDXID,
  relatedSpdxElement: sparkleID,
  relationshipType: 'CONTAINS',
})

document.name = `ReviewArc-${version}-macOS-universal`
document.creationInfo.creators.push('Tool: ReviewArc release SBOM augmenter')
document.comment = 'Generated from the signed application bundle and bound to the notarized DMG checksum; bundled frontend and Sparkle components are enriched from the verified third-party notice inventory.'
writeFileSync(sbomPath, `${JSON.stringify(document, null, 2)}\n`)
