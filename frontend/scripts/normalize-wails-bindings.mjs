import {chmod, readFile, writeFile} from 'node:fs/promises'

const bindings = [
  'wailsjs/go/main/App.d.ts',
  'wailsjs/go/main/App.js',
  'wailsjs/go/models.ts',
]

for (const path of bindings) {
  const source = await readFile(path, 'utf8')
  const normalized = `${source.replace(/[\t ]+$/gm, '').trimEnd()}\n`

  if (source !== normalized) await writeFile(path, normalized)
  await chmod(path, 0o644)
}
