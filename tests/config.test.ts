import { mkdtempSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT, configProblems, loadConfig, merge } from '../server/config.ts'
import { parseGpus } from '../server/system.ts'

function configDir(local?: object) {
  const dir = mkdtempSync(join(tmpdir(), 'sosie-config-'))
  copyFileSync(join(ROOT, 'config', 'sosie.example.json'), join(dir, 'sosie.example.json'))
  if (local) writeFileSync(join(dir, 'sosie.local.json'), JSON.stringify(local))
  return dir
}

describe('config', () => {
  it('loads the committed example on its own', () => {
    const config = loadConfig(configDir())
    expect(config.ports).toEqual({ web: 5190, api: 3190, comfy: 8190 })
    expect(config.gpus.h3.dit).toBe(2)
  })

  it('merges objects key by key and replaces arrays', () => {
    const config = loadConfig(configDir({ ports: { api: 4000 }, gpus: { tts: [1] }, $comment: 'ignored' }))
    expect(config.ports).toEqual({ web: 5190, api: 4000, comfy: 8190 })
    expect(config.gpus.tts).toEqual([1])
    expect(config.gpus.image).toEqual([1, 3, 2, 0])
  })

  it('rejects invalid values with the key path', () => {
    expect(() => loadConfig(configDir({ ports: { comfy: 'x' } }))).toThrow(/ports\.comfy/)
  })

  it('lists missing paths, clashing ports and the main ComfyUI port', () => {
    const config = loadConfig(configDir({ ports: { comfy: 8188, web: 3190 } }))
    const keys = configProblems(config).map((problem) => problem.key)
    expect(keys).toContain('paths.modelStore')
    expect(keys).toContain('ports.comfy')
    expect(keys.filter((key) => key.startsWith('ports.')).length).toBeGreaterThanOrEqual(2)
  })

  it('merge keeps base keys the local file leaves out', () => {
    expect(merge({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 4 } })).toEqual({ a: 1, b: { c: 2, d: 4 } })
  })
})

describe('parseGpus', () => {
  it('reads nvidia-smi csv rows', () => {
    const gpus = parseGpus('0, NVIDIA GeForce RTX 3090, 9321, 24576, 15000\n4, NVIDIA GeForce RTX 3060, 5375, 12288, 6800\n')
    expect(gpus).toEqual([
      { index: 0, name: 'NVIDIA GeForce RTX 3090', usedMb: 9321, totalMb: 24576, freeMb: 15000 },
      { index: 4, name: 'NVIDIA GeForce RTX 3060', usedMb: 5375, totalMb: 12288, freeMb: 6800 },
    ])
  })

  it('skips malformed lines', () => {
    expect(parseGpus('garbage\n\n')).toEqual([])
  })
})
