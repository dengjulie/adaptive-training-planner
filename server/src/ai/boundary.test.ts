/**
 * The Oura data boundary, checked on the import graph: nothing the AI code imports, directly or
 * through other modules, may lead to Oura code (CLAUDE.md: src/ai/ must not import from
 * integrations/oura/). The lint rule in .oxlintrc.json catches direct imports as they're typed;
 * this catches the indirect ones.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SERVER = path.resolve(import.meta.dirname, '../..')
const relative = (file: string) => path.relative(SERVER, file)

/** Modules that hold Oura data or read it: the readiness rules and what runs them. */
const OURA_MODULES = [/^src\/integrations\/oura\//, /^tests\/fixtures\/oura\//, /^src\/plan\/adapt\.ts$/, /^src\/plan\/service\.ts$/, /^src\/jobs\//]

/** Every local module `entry` imports, directly or not, with the chain that reaches each. */
export function importGraph(entry: string): Map<string, string[]> {
  const chains = new Map<string, string[]>([[entry, [relative(entry)]]])
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true)
    for (const { fileName } of importedFiles) {
      if (!fileName.startsWith('.')) continue // packages
      const target = path.resolve(path.dirname(file), fileName)
      if (chains.has(target)) continue
      chains.set(target, [...chains.get(file)!, relative(target)])
      queue.push(target)
    }
  }
  return chains
}

function ouraReachedFrom(entry: string) {
  return [...importGraph(entry).entries()]
    .filter(([file]) => OURA_MODULES.some((pattern) => pattern.test(relative(file))))
    .map(([, chain]) => chain.join(' → '))
}

const aiFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return aiFiles(full)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : []
  })

const ENTRY_POINTS = [...aiFiles(path.join(SERVER, 'src/ai')), path.join(SERVER, 'src/routes/ai.ts')]

describe('the Oura data boundary', () => {
  it('covers the AI code', () => {
    expect(ENTRY_POINTS.map(relative)).toEqual(
      expect.arrayContaining(['src/ai/goalIntake.ts', 'src/ai/client.ts', 'src/routes/ai.ts']),
    )
  })

  it.each(ENTRY_POINTS.map(relative))('%s never reaches Oura code', (file) => {
    expect(ouraReachedFrom(path.join(SERVER, file))).toEqual([])
  })

  it('keeps the AI modules themselves off the database', () => {
    for (const file of aiFiles(path.join(SERVER, 'src/ai'))) {
      const reached = [...importGraph(file).keys()].map(relative)
      expect(reached.filter((f) => f.startsWith('src/db/')), relative(file)).toEqual([])
    }
  })

  it('would catch a violation (the plan service does read Oura)', () => {
    expect(ouraReachedFrom(path.join(SERVER, 'src/plan/service.ts'))).not.toEqual([])
  })
})
