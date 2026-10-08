/**
 * windAudio.test.js — Phase 7 Wind Audio Service Tests
 *
 * Verifies:
 *   1. Initialization of the Web Audio chain on an existing AudioContext.
 *   2. No duplicate AudioContext creation; persistent node chain reuse.
 *   3. Smooth parameter ramp updates (gain, filter cutoff/Q, stereo pan).
 *   4. Independent enable / disable switching.
 *   5. Smooth fade to silence on stop / calm wind.
 *   6. Clean node disconnection on dispose.
 */

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { windAudioService } from '../src/services/windAudioService.js'

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
        frequency: createMockAudioParam(350),
        Q: createMockAudioParam(1),
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
    createStereoPanner() {
      return {
        pan: createMockAudioParam(0),
        connect() {},
        disconnect() {},
      }
    },
    resume: async () => {},
  }
}

describe('Phase 7: Wind Audio Service Web Audio Chain', () => {

  beforeEach(() => {
    windAudioService.dispose()
  })

  test('1. Initializes audio chain reusing provided AudioContext without duplicating', () => {
    const mockCtx = createMockAudioContext()
    windAudioService.init(mockCtx)

    assert.strictEqual(windAudioService.isInitialized, true)
    assert.strictEqual(windAudioService.ctx, mockCtx)
    assert.ok(windAudioService.noiseSource, 'Looped noise source created')
    assert.ok(windAudioService.filterNode, 'Biquad filter node created')
    assert.ok(windAudioService.gainNode, 'Gain node created')
    assert.ok(windAudioService.pannerNode, 'Stereo panner node created')

    // Calling init again with same context does not recreate nodes
    const existingGain = windAudioService.gainNode
    windAudioService.init(mockCtx)
    assert.strictEqual(windAudioService.gainNode, existingGain, 'Nodes are reused')
  })

  test('2. updateWind schedules smooth ramps for speed and direction', () => {
    const mockCtx = createMockAudioContext()
    windAudioService.init(mockCtx)

    const windPoint = {
      speed: 15.0,
      direction: 90.0, // East → Pan = +1.0
    }

    windAudioService.updateWind(windPoint, 0.25)

    assert.ok(windAudioService.gainNode.gain.value > 0, 'Gain updated to audible level')
    assert.ok(windAudioService.gainNode.gain.value <= 0.25, 'Gain bounded')
    assert.strictEqual(windAudioService.pannerNode.pan.value, 1.0, 'Stereo pan reflects East direction')
    assert.ok(windAudioService.filterNode.frequency.value > 300, 'Filter cutoff reflects speed')
  })

  test('3. Calm wind smoothly ramps gain to 0.0001 (silence)', () => {
    const mockCtx = createMockAudioContext()
    windAudioService.init(mockCtx)

    // First active
    windAudioService.updateWind({ speed: 12.0, direction: 180.0 })
    assert.ok(windAudioService.gainNode.gain.value > 0.01)

    // Then calm
    windAudioService.updateWind({ speed: 0.0, direction: null })
    assert.strictEqual(windAudioService.gainNode.gain.value, 0.0001, 'Calm sets gain to silence')
  })

  test('4. Independent enable / disable toggles wind audio layer', () => {
    const mockCtx = createMockAudioContext()
    windAudioService.init(mockCtx)

    windAudioService.updateWind({ speed: 20.0, direction: 270.0 })
    const activeGain = windAudioService.gainNode.gain.value
    assert.ok(activeGain > 0.05)

    // Disable wind
    windAudioService.setEnabled(false)
    assert.strictEqual(windAudioService.gainNode.gain.value, 0.0001, 'Disabling silences wind audio')

    // Re-enable wind
    windAudioService.setEnabled(true)
    assert.strictEqual(windAudioService.gainNode.gain.value, activeGain, 'Enabling restores wind gain')
  })

  test('5. stop() fades wind gain to silence', () => {
    const mockCtx = createMockAudioContext()
    windAudioService.init(mockCtx)

    windAudioService.updateWind({ speed: 10.0, direction: 45.0 })
    assert.ok(windAudioService.gainNode.gain.value > 0)

    windAudioService.stop(0.12)
    assert.strictEqual(windAudioService.gainNode.gain.value, 0.0001)
  })

  test('6. dispose() releases and disconnects all nodes cleanly', () => {
    const mockCtx = createMockAudioContext()
    windAudioService.init(mockCtx)

    windAudioService.dispose()
    assert.strictEqual(windAudioService.isInitialized, false)
    assert.strictEqual(windAudioService.ctx, null)
    assert.strictEqual(windAudioService.gainNode, null)
    assert.strictEqual(windAudioService.filterNode, null)
    assert.strictEqual(windAudioService.noiseSource, null)
  })
})
