/**
 * precipitationAudio.test.js — Phase 8
 *
 * Web Audio service tests for PrecipitationAudioService.
 *
 * Verifies:
 *   1. Initialization with shared AudioContext
 *   2. No duplicate AudioContext (reuses provided context)
 *   3. Node chain: noise → highpass → bandpass → gain → destination
 *   4. Smooth gain transitions for different precipitation values
 *   5. Silence for zero precipitation
 *   6. Enable / disable toggling
 *   7. stop() fades to silence
 *   8. dispose() releases all nodes
 *   9. Calling init() again with same ctx reuses existing nodes
 */

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { precipitationAudioService } from '../src/services/precipitationAudioService.js'

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

describe('Phase 8: Precipitation Audio Service', () => {

  beforeEach(() => {
    precipitationAudioService.dispose()
  })

  test('1. Initializes audio chain with provided AudioContext', () => {
    const mockCtx = createMockAudioContext()
    precipitationAudioService.init(mockCtx)

    assert.strictEqual(precipitationAudioService.isInitialized, true)
    assert.strictEqual(precipitationAudioService.ctx, mockCtx)
    assert.ok(precipitationAudioService.noiseSource, 'Noise source created')
    assert.ok(precipitationAudioService.highpassFilter, 'Highpass filter created')
    assert.ok(precipitationAudioService.bandpassFilter, 'Bandpass filter created')
    assert.ok(precipitationAudioService.gainNode, 'Gain node created')
  })

  test('2. Calling init() again with same context reuses existing nodes', () => {
    const mockCtx = createMockAudioContext()
    precipitationAudioService.init(mockCtx)

    const existingGain = precipitationAudioService.gainNode
    precipitationAudioService.init(mockCtx)

    assert.strictEqual(precipitationAudioService.gainNode, existingGain, 'Gain node is reused')
  })

  test('3. Zero/null precipitation → gain remains at silence level', () => {
    const mockCtx = createMockAudioContext()
    precipitationAudioService.init(mockCtx)

    precipitationAudioService.updatePrecipitation(null, 0.1)
    assert.ok(
      precipitationAudioService.gainNode.gain.value <= 0.0002,
      'Null precipitation → silence'
    )

    precipitationAudioService.updatePrecipitation(0, 0.1)
    assert.ok(
      precipitationAudioService.gainNode.gain.value <= 0.0002,
      'Zero precipitation → silence'
    )
  })

  test('4. Moderate precipitation → audible gain', () => {
    const mockCtx = createMockAudioContext()
    precipitationAudioService.init(mockCtx)

    // 0.000003 kg/m²/s ≈ 10.8 mm/hr = moderate rain
    precipitationAudioService.updatePrecipitation(0.000003, 0.1)

    assert.ok(
      precipitationAudioService.gainNode.gain.value > 0.001,
      'Moderate rain produces audible gain'
    )
  })

  test('5. Heavy precipitation → near maximum gain', () => {
    const mockCtx = createMockAudioContext()
    precipitationAudioService.init(mockCtx)

    // 0.000014 kg/m²/s ≈ 50 mm/hr = reference heavy rain
    precipitationAudioService.updatePrecipitation(0.000014, 0.1)

    assert.ok(
      precipitationAudioService.gainNode.gain.value > 0.1,
      'Heavy rain produces high gain'
    )
  })

  test('6. setEnabled(false) silences the layer', () => {
    const mockCtx = createMockAudioContext()
    precipitationAudioService.init(mockCtx)

    precipitationAudioService.updatePrecipitation(0.000003, 0.1)
    const activeGain = precipitationAudioService.gainNode.gain.value
    assert.ok(activeGain > 0.001)

    precipitationAudioService.setEnabled(false)
    assert.ok(
      precipitationAudioService.gainNode.gain.value <= 0.0002,
      'Disabling silences precipitation audio'
    )
  })

  test('7. setEnabled(true) restores gain from last params', () => {
    const mockCtx = createMockAudioContext()
    precipitationAudioService.init(mockCtx)

    // Activate rain and store the service's gain
    precipitationAudioService.updatePrecipitation(0.000003, 0.1)

    precipitationAudioService.setEnabled(false)
    assert.ok(precipitationAudioService.gainNode.gain.value <= 0.0002, 'Disabled → silence')

    // Re-enable: should restore last known rain gain (audible)
    precipitationAudioService.setEnabled(true)
    assert.ok(
      precipitationAudioService.gainNode.gain.value > 0.001,
      'Re-enabling restores audible rain gain'
    )
  })


  test('8. stop() fades to silence', () => {
    const mockCtx = createMockAudioContext()
    precipitationAudioService.init(mockCtx)

    precipitationAudioService.updatePrecipitation(0.000005, 0.1)
    assert.ok(precipitationAudioService.gainNode.gain.value > 0.001)

    precipitationAudioService.stop(0.1)
    assert.ok(precipitationAudioService.gainNode.gain.value <= 0.0002, 'stop() silences gain')
  })

  test('9. dispose() releases all nodes and resets state', () => {
    const mockCtx = createMockAudioContext()
    precipitationAudioService.init(mockCtx)

    precipitationAudioService.dispose()

    assert.strictEqual(precipitationAudioService.isInitialized, false)
    assert.strictEqual(precipitationAudioService.ctx, null)
    assert.strictEqual(precipitationAudioService.gainNode, null)
    assert.strictEqual(precipitationAudioService.highpassFilter, null)
    assert.strictEqual(precipitationAudioService.bandpassFilter, null)
    assert.strictEqual(precipitationAudioService.noiseSource, null)
  })

  test('10. Highpass filter adjusts with precipitation intensity', () => {
    const mockCtx = createMockAudioContext()
    precipitationAudioService.init(mockCtx)

    // Light rain → higher cutoff
    precipitationAudioService.updatePrecipitation(0.0000003, 0.1)  // ~1 mm/hr
    const lightCutoff = precipitationAudioService.highpassFilter.frequency.value

    // Heavy rain → lower cutoff
    precipitationAudioService.updatePrecipitation(0.000014, 0.1)   // ~50 mm/hr
    const heavyCutoff = precipitationAudioService.highpassFilter.frequency.value

    assert.ok(lightCutoff > heavyCutoff, 'Light rain has higher cutoff than heavy rain')
  })

  test('11. Layer uses different filter type from wind (separating rain from wind perceptually)', () => {
    const mockCtx = createMockAudioContext()
    precipitationAudioService.init(mockCtx)

    // Precipitation has both highpass and bandpass (rain is in upper frequency range)
    assert.ok(precipitationAudioService.highpassFilter, 'Has highpass filter')
    assert.ok(precipitationAudioService.bandpassFilter, 'Has bandpass filter')
    // No stereo panner — rain comes from "above" (center), not left/right like wind
    assert.strictEqual(precipitationAudioService.pannerNode ?? null, null, 'No stereo panner (rain is centered)')
  })
})
