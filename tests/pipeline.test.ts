import { describe, expect, it } from 'vitest'
import { dropNode, fill, loadTemplate, type Graph } from '../server/comfy/template.ts'
import { talkPrompt } from '../server/pipeline/prompt.ts'
import { MAX_SEGMENT_FRAMES, framesFor, onGrid, renderLength } from '../server/pipeline/segments.ts'

describe('H3 frame grid', () => {
  it('renders the next 17k + 5 length, at least 124', () => {
    expect(renderLength(192)).toBe(192)
    expect(renderLength(193)).toBe(209)
    expect(renderLength(206)).toBe(209)
    expect(renderLength(100)).toBe(124)
    expect(renderLength(MAX_SEGMENT_FRAMES)).toBe(243)
    for (let n = 1; n <= MAX_SEGMENT_FRAMES; n++) {
      const length = renderLength(n)
      expect(onGrid(length)).toBe(true)
      expect(length).toBeGreaterThanOrEqual(n)
      expect(length - Math.max(n, 124)).toBeLessThan(17)
    }
  })

  it('never renders more than the 10.1 s maximum for a valid segment', () => {
    expect(renderLength(MAX_SEGMENT_FRAMES)).toBeLessThanOrEqual(243)
  })

  it('rounds audio up to whole frames', () => {
    expect(framesFor(8)).toBe(192)
    expect(framesFor(8.56)).toBe(206)
    expect(framesFor(1 / 24)).toBe(1)
  })
})

describe('talk prompt', () => {
  const prompt = talkPrompt({ subject: 'a man with short dark hair', set: 'a home office', text: 'Hello <there> everyone.', direction: 'excited' })

  it('keeps the official sections in order', () => {
    const order = ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:']
    const positions = order.map((section) => prompt.indexOf(section))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('carries the lip-sync retention line and the dialogue markup', () => {
    expect(prompt).toContain('<Audio 1>: fully_copy - <Audio 1>')
    expect(prompt).toContain('(S1) <d>[English] Hello there everyone.</d>')
    expect(prompt).toContain('in an excited tone')
  })

  it('falls back to the picture when no description is given', () => {
    expect(talkPrompt({ subject: '', set: '', text: 'Hi.' })).toContain('<Subject 1> is the person shown in <Picture 1>')
  })

  it('refuses an empty line', () => {
    expect(() => talkPrompt({ subject: '', set: '', text: '  ' })).toThrow()
  })
})

describe('workflow templates', () => {
  it('fills every placeholder of talk_segment with typed values', () => {
    const graph = loadTemplate('talk_segment')
    const values = {
      MODEL: 'm', TEXT_ENCODER: 't', VIDEO_VAE: 'v', AUDIO_VAE: 'a', LORA: 'l', LORA_STRENGTH: 1, VEDA_PREDICTOR: 'p',
      KEY_FRAME: 'k.png', AUDIO: 'a.wav', PROMPT: 'x', WIDTH: 640, HEIGHT: 640, LENGTH: 209, REF_IMAGE_SIZE: 'match',
      SEED: 7, STEPS: 3, DIT_DEVICE: 'cuda:2', DIT_DONOR_DEVICE: 'cuda:3', DIT_ALLOCATIONS: 'cuda:2,0.5gb;cuda:3,15gb;cpu,*',
      TE_DEVICE: 'cuda:0', TE_ALLOCATIONS: 'cuda:0,11gb;cpu,*', VAE_DEVICE: 'cuda:1', OUT_PREFIX: 'sosie/x',
    }
    const filled = fill(graph, values)
    expect(filled['9'].inputs.length).toBe(209)
    expect(filled['11'].inputs.noise_seed).toBe(7)
    expect(JSON.stringify(filled)).not.toMatch(/"\$[A-Z_]+"/)
  })

  it('names the missing placeholders', () => {
    expect(() => fill(loadTemplate('talk_segment'), {})).toThrow(/MODEL/)
  })

  it('drops a node and the inputs that pointed at it', () => {
    const graph: Graph = {
      a: { class_type: 'A', inputs: { x: 1 } },
      b: { class_type: 'B', inputs: { from: ['a', 0], y: 2 } },
    }
    expect(dropNode(graph, 'a')).toEqual({ b: { class_type: 'B', inputs: { y: 2 } } })
  })
})

describe('ComfyUI device names', async () => {
  const { comfyIndex } = await import('../server/comfy/devices.ts')
  it('matches ComfyUI --default-device reordering (default 2 → 2,0,1,3,4)', () => {
    expect([2, 0, 1, 3, 4].map((physical) => comfyIndex(physical, 2))).toEqual([0, 1, 2, 3, 4])
    expect(comfyIndex(0, 0)).toBe(0)
    expect(comfyIndex(3, 0)).toBe(3)
  })
})
