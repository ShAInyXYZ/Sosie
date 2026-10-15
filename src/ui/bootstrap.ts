import { init } from 'neuronkit'
import { spriteUrl } from './icons'

// React owns the editor DOM. Install the shared tooltip/format infrastructure once,
// then let adapters enhance their own stable islands (not the whole React tree).
const bootKey = '__sosieNeuronKitReady'
const host = window as unknown as Record<string, unknown>
if (!host[bootKey]) {
  init(document.createElement('div'), { icons: spriteUrl })
  host[bootKey] = true
}
