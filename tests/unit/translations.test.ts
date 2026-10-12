import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HINGLISH } from '../../src/lib/hinglish'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('Hinglish coverage', () => {
  it('has a translation for every literal passed to t()', () => {
    const root = join(import.meta.dirname, '..', '..', 'src')
    const missing = new Set<string>()
    for (const file of sourceFiles(root)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
        if (!(m[1] in HINGLISH)) missing.add(m[1])
      }
    }
    expect([...missing]).toEqual([])
  })
})
