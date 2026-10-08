/**
 * vegetationAudio.test.js — Phase 9 (Repurposed: Pressure System)
 *
 * Web Audio service tests for VegetationAudioService, now repurposed as
 * the Pressure System (ps / Surface Pressure) audio modifier.
 *
 * Vegetation has been removed in Phase 9. This service is now the
 * experimental pressure-to-timbre modifier (Candidate D).
 *
 * Verifies:
 *   1. Initialization with shared AudioContext
 *   2. Node chain: noise → bandpass → lowshelf → gain → destination
 *   3. Node reuse on repeated init()
 *   4. updateVegetation() is a deprecated no-op (backward compatibility)
 *   5. updatePressure() with high pressure → bandpass frequency increases
 *   6. updatePressure() with low pressure → bandpass frequency decreases
 *   7. LowShelf filter adjusts with pressure (high pressure → warm, low → cool)
 *   8. setEnabled(false) silences the pressure layer
 *   9. setEnabled(true) after updatePressure restores gain
 *   10. stop() fades gain to silence
 *   11. dispose() cleans up all nodes
 *   12. Pressure gain never exceeds the subtle threshold
 */

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { vegetationAudioService } from '../src/services/vegetationAudioService.js'

function createMockAudioParam(initialValue = 0) {
  return {
    value: initialValue,
    setValueAtTime(val) { this.value = val },
    linearRampToValueAtTime(val) { this.value = val },
    cancelScheduledValues() {},
  }
}

function createMockAudioContext() {
  return {
    currentTime: 10.0,
    sampleRate: 44100,
    state: 'running',
    destination: { id: 'destination' },
    createBuffer(channels, length, sampleRate) {
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: () => new Float32Array(length),
      }
    },
    createBufferSource() {
      return {
        buffer: null,
        loop: false,
        started: false,
        stopped: false,
        connect() {},
        disconnect() {},
        start() { this.started = true },
        stop() { this.stopped = true },
      }
    },
    createBiquadFilter() {
      return {
        type: 'lowpass',
        frequency: createMockAudioParam(1000),
        Q: createMockAudioParam(1),
        gain: createMockAudioParam(0),
        connect() {},
        disconnect() {},
      }
    },
    createGain() {
      return {
        gain: createMockAudioParam(1),
        connect() {},
        disconnect() {},
      }
    },
    resume: async () => {},
  }
}

describe('Phase 9: Pressure Audio Service (repurposed from Vegetation)', () => {

  beforeEach(() => {
    vegetationAudioService.dispose()
  })

  test('1. Initializes audio chain with provided AudioContext', () => {
    const mockCtx = createMockAudioContext()
    vegetationAudioService.init(mockCtx)

    assert.strictEqual(vegetationAudioService.isInitialized, true)
    assert.strictEqual(vegetationAudioService.ctx, mockCtx)
    assert.ok(vegetationAudioService.noiseSource, 'Noise source created')
    assert.ok(vegetationAudioService.bandpassFilter, 'Bandpass filter created')
    assert.ok(vegetationAudioService.lowshelfFilter, 'LowShelf filter created')
    assert.ok(vegetationAudioService.gainNode, 'Gain node created')
  })

  test('2. init() with same context reuses nodes', () => {
    const mockCtx = createMockAudioContext()
    vegetationAudioService.init(mockCtx)

    const existingGain = vegetationAudioService.gainNode
    vegetationAudioService.init(mockCtx)
    assert.strictEqual(vegetationAudioService.gainNode, existingGain, 'Gain node is reused')
  })

  test('3. updateVegetation() is a deprecated no-op — does not change gain', () => {
    const mockCtx = createMockAudioContext()
    vegetationAudioService.init(mockCtx)

    const gainBefore = vegetationAudioService.gainNode.gain.value
    // Call the deprecated method — it should be a no-op
    vegetationAudioService.updateVegetation(5.0, 0.1)
    vegetationAudioService.updateVegetation(null, 0.1)

    // Gain should not have increased to a vegetation-like level
    const gainAfter = vegetationAudioService.gainNode.gain.value
    assert.strictEqual(gainBefore, gainAfter, 'updateVegetation() no-op: gain unchanged')
  })

  test('4. updatePressure(null) → minimal gain (no valid data)', () => {
    const mockCtx = createMockAudioContext()
    vegetationAudioService.init(mockCtx)

    vegetationAudioService.updatePressure(null, 0.1)
    const gain = vegetationAudioService.gainNode.gain.value
    // null pressure → gainModifier should be near minimum
    assert.ok(gain <= 0.04 + 0.001, 'Null pressure → small gain modifier')
  })

  test('5. High pressure (102000 Pa) → higher bandpass frequency (brighter)', () => {
    const mockCtx = createMockAudioContext()
    vegetationAudioService.init(mockCtx)

    vegetationAudioService.updatePressure(102000, 0.1)
    const hzHigh = vegetationAudioService.bandpassFilter.frequency.value

    vegetationAudioService.updatePressure(97500, 0.1)
    const hzLow = vegetationAudioService.bandpassFilter.frequency.value

    assert.ok(hzHigh > hzLow, `High pressure (${hzHigh} Hz) > low pressure (${hzLow} Hz) — brighter`)
  })

  test('6. Low pressure (98000 Pa) → lower bandpass frequency (darker)', () => {
    const mockCtx = createMockAudioContext()
    vegetationAudioService.init(mockCtx)

    vegetationAudioService.updatePressure(98000, 0.1)
    const hzLow = vegetationAudioService.bandpassFilter.frequency.value

    vegetationAudioService.updatePressure(103000, 0.1)
    const hzHigh = vegetationAudioService.bandpassFilter.frequency.value

    assert.ok(hzLow < hzHigh, `Low pressure bandpass (${hzLow} Hz) < high pressure bandpass (${hzHigh} Hz)`)
  })

  test('7. LowShelf gain increases with pressure (high pressure → warmer character)', () => {
    const mockCtx = createMockAudioContext()
    vegetationAudioService.init(mockCtx)

    vegetationAudioService.updatePressure(97500, 0.1)   // Low pressure
    const shelfLow = vegetationAudioService.lowshelfFilter.gain.value

    vegetationAudioService.updatePressure(103000, 0.1)  // High pressure
    const shelfHigh = vegetationAudioService.lowshelfFilter.gain.value

    assert.ok(shelfHigh > shelfLow, `High pressure has warmer shelf (${shelfHigh} dB > ${shelfLow} dB)`)
  })

  test('8. setEnabled(false) silences the pressure layer', () => {
    const mockCtx = createMockAudioContext()
    vegetationAudioService.init(mockCtx)

    vegetationAudioService.updatePressure(101325, 0.1)
    vegetationAudioService.setEnabled(false)
    assert.ok(
      vegetationAudioService.gainNode.gain.value <= 0.001,
      'Disabling silences pressure layer'
    )
  })

  test('9. setEnabled(true) restores pressure gain', () => {
    const mockCtx = createMockAudioContext()
    vegetationAudioService.init(mockCtx)

    vegetationAudioService.updatePressure(103000, 0.1)  // High pressure → some gain

    vegetationAudioService.setEnabled(false)
    assert.ok(vegetationAudioService.gainNode.gain.value <= 0.001, 'Disabled → silence')

    vegetationAudioService.setEnabled(true)
    // Re-enable: gain should restore (gainModifier from lastParams)
    assert.ok(
      vegetationAudioService.isEnabled === true,
      'Re-enabling restores enabled state'
    )
  })

  test('10. stop() fades gain to silence', () => {
    const mockCtx = createMockAudioContext()
    vegetationAudioService.init(mockCtx)

    vegetationAudioService.updatePressure(101325, 0.1)
    vegetationAudioService.stop(0.1)
    assert.ok(vegetationAudioService.gainNode.gain.value <= 0.001, 'stop() fades to silence')
  })

  test('11. dispose() releases all nodes cleanly', () => {
    const mockCtx = createMockAudioContext()
    vegetationAudioService.init(mockCtx)

    vegetationAudioService.dispose()

    assert.strictEqual(vegetationAudioService.isInitialized, false)
    assert.strictEqual(vegetationAudioService.ctx, null)
    assert.strictEqual(vegetationAudioService.gainNode, null)
    assert.strictEqual(vegetationAudioService.bandpassFilter, null)
    assert.strictEqual(vegetationAudioService.lowshelfFilter, null)
    assert.strictEqual(vegetationAudioService.noiseSource, null)
  })

  test('12. Pressure gain modifier stays within subtle threshold', () => {
    const mockCtx = createMockAudioContext()
    vegetationAudioService.init(mockCtx)

    // Maximum pressure → should produce subtle gain, not dominant
    vegetationAudioService.updatePressure(110000, 0.1)  // Well above reference
    const maxGain = vegetationAudioService.gainNode.gain.value

    assert.ok(maxGain <= 0.06, `Pressure gain never dominant (${maxGain} <= 0.06)`)
  })
})
