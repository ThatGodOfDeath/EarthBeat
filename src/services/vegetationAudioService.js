/**
 * vegetationAudioService.js — Phase 9 (Repurposed: Pressure System)
 *
 * Previously: Vegetation timbral bed (Phase 8 — LAI)
 * Now:        Pressure audio modifier (Phase 9 — ps / Surface Pressure)
 *
 * Vegetation has been removed from Earth Jukebox. This service's audio
 * architecture (noise → bandpass → lowshelf → gain) is preserved and
 * repurposed for experimental pressure sonification (Candidate D: subtle
 * global timbre modifier).
 *
 * Audio Signal Chain (unchanged from Phase 8):
 *
 *   [AudioBufferSourceNode (Looped Noise Buffer)]
 *                     │
 *                     ▼
 *   [BiquadFilterNode (Bandpass — pressure-modified spectral center)]
 *                           ↑ frequency controlled by ps normalization
 *                     │
 *                     ▼
 *   [BiquadFilterNode (LowShelf — pressure atmospheric color)]
 *                           ↑ gain controlled by ps (high pressure → slight warmth)
 *                     │
 *                     ▼
 *   [GainNode (Pressure subtle gain — very quiet background modifier)]
 *                     │
 *                     ▼
 *            [ctx.destination]
 *
 * Pressure System Behavior (Candidate D — Subtle Global Timbre):
 *   High pressure (clear, stable) → brighter/cleaner character (higher bandpass Hz)
 *   Low pressure  (stormy)        → darker/resonant character (lower bandpass Hz)
 *   The effect is intentionally subtle — pressure should be felt, not heard.
 *
 * Note: updateVegetation() is kept as a deprecated no-op for test compatibility.
 * Use updatePressure() for Phase 9.
 */

import { calculatePressureAudioParams } from '../utils/pressureSonification.js'

class VegetationAudioService {
  constructor() {
    this.ctx = null
    this.noiseSource = null
    this.bandpassFilter = null
    this.lowshelfFilter = null
    this.gainNode = null
    this.noiseBuffer = null
    this.isEnabled = true
    this.isInitialized = false
    this.lastParams = null
  }

  /**
   * Generates a 4-second mono noise buffer for atmospheric pressure texture.
   * @param {AudioContext} ctx
   * @returns {AudioBuffer}
   */
  _createNoiseBuffer(ctx) {
    const bufferSize = ctx.sampleRate * 4
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const output = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1
    }
    return buffer
  }

  /**
   * Initializes the pressure audio chain on the provided AudioContext.
   * Reuses context and nodes if already initialized.
   *
   * @param {AudioContext} ctx - The shared application AudioContext
   */
  init(ctx) {
    if (!ctx) return
    if (this.isInitialized && this.ctx === ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {})
      }
      return
    }

    this.ctx = ctx
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }

    try {
      // 1. Noise source
      this.noiseBuffer = this._createNoiseBuffer(ctx)
      this.noiseSource = ctx.createBufferSource()
      this.noiseSource.buffer = this.noiseBuffer
      this.noiseSource.loop = true

      // 2. Bandpass filter — pressure spectral center
      //    High pressure → ~1600 Hz (brighter), low pressure → ~800 Hz (darker)
      this.bandpassFilter = ctx.createBiquadFilter()
      this.bandpassFilter.type = 'bandpass'
      this.bandpassFilter.frequency.setValueAtTime(1200, ctx.currentTime)
      this.bandpassFilter.Q.setValueAtTime(3.0, ctx.currentTime)

      // 3. LowShelf filter — atmospheric warmth
      //    High pressure → slight warmth boost (+1 to +2 dB)
      //    Low pressure  → slight cut (–1 dB)
      this.lowshelfFilter = ctx.createBiquadFilter()
      this.lowshelfFilter.type = 'lowshelf'
      this.lowshelfFilter.frequency.setValueAtTime(400, ctx.currentTime)
      this.lowshelfFilter.gain.setValueAtTime(0, ctx.currentTime)

      // 4. Gain node — pressure layer is very subtle
      //    Max gain: 0.03 (barely audible background modifier)
      this.gainNode = ctx.createGain()
      this.gainNode.gain.setValueAtTime(0.0001, ctx.currentTime)

      // Connect chain: source → bandpass → lowshelf → gain → destination
      this.noiseSource.connect(this.bandpassFilter)
      this.bandpassFilter.connect(this.lowshelfFilter)
      this.lowshelfFilter.connect(this.gainNode)
      this.gainNode.connect(ctx.destination)

      this.noiseSource.start(0)
      this.isInitialized = true
    } catch (err) {
      console.warn('[VegetationAudioService/Pressure] Failed to initialize Web Audio chain:', err)
      this.isInitialized = false
    }
  }

  /**
   * Updates pressure audio parameters (Candidate D: subtle global timbre).
   *
   * @param {number|null} ps - Surface pressure in Pa
   * @param {number} [glideTimeSec=0.6] - Transition duration (longer than rain/wind — pressure changes slowly)
   */
  updatePressure(ps, glideTimeSec = 0.6) {
    if (!this.ctx) return
    const params = calculatePressureAudioParams(ps)
    this.lastParams = params

    if (!this.isInitialized) {
      this.init(this.ctx)
      if (!this.isInitialized) return
    }

    const t = this.ctx.currentTime
    const glide = Math.max(0.1, glideTimeSec)

    // Target gain: very subtle — pressure modifier sits way below rain and wind
    const targetGain = this.isEnabled
      ? Math.max(0.0001, params.gainModifier)
      : 0.0001

    // 1. Smooth gain transition
    if (this.gainNode) {
      this.gainNode.gain.cancelScheduledValues(t)
      this.gainNode.gain.setValueAtTime(Math.max(0.0001, this.gainNode.gain.value), t)
      this.gainNode.gain.linearRampToValueAtTime(targetGain, t + glide)
    }

    // 2. Bandpass filter frequency — pressure-controlled spectral center
    if (this.bandpassFilter) {
      this.bandpassFilter.frequency.cancelScheduledValues(t)
      this.bandpassFilter.frequency.setValueAtTime(this.bandpassFilter.frequency.value, t)
      this.bandpassFilter.frequency.linearRampToValueAtTime(params.filterHz, t + glide)
    }

    // 3. LowShelf — atmospheric warmth
    //    High pressure → warm, stable (+2 dB)
    //    Low pressure  → cool, turbulent (−1 dB)
    if (this.lowshelfFilter) {
      const shelfGain = (params.norm - 0.5) * 4.0   // ±2 dB range
      this.lowshelfFilter.gain.cancelScheduledValues(t)
      this.lowshelfFilter.gain.setValueAtTime(this.lowshelfFilter.gain.value, t)
      this.lowshelfFilter.gain.linearRampToValueAtTime(shelfGain, t + glide)
    }
  }

  /**
   * Deprecated alias kept for backward compatibility with Phase 8 tests.
   * Vegetation is removed in Phase 9. This is a no-op.
   *
   * @deprecated Use updatePressure(ps) instead.
   */
  updateVegetation(_lai, _glideTimeSec = 0.8) {
    // No-op: vegetation has been removed from Earth Jukebox in Phase 9.
    // Call updatePressure(ps) to drive this audio layer.
  }

  /**
   * Sets whether pressure sonification is enabled.
   * @param {boolean} enabled
   */
  setEnabled(enabled, glideTimeSec = 0.2) {
    this.isEnabled = !!enabled
    if (this.ctx && this.gainNode) {
      const t = this.ctx.currentTime
      const targetGain = this.isEnabled && this.lastParams
        ? Math.max(0.0001, this.lastParams.gainModifier || 0.0001)
        : 0.0001

      this.gainNode.gain.cancelScheduledValues(t)
      this.gainNode.gain.setValueAtTime(Math.max(0.0001, this.gainNode.gain.value), t)
      this.gainNode.gain.linearRampToValueAtTime(targetGain, t + glideTimeSec)
    }
  }

  /**
   * Fades pressure audio to silence.
   * @param {number} [fadeTimeSec=0.15]
   */
  stop(fadeTimeSec = 0.15) {
    if (this.ctx && this.gainNode) {
      const t = this.ctx.currentTime
      this.gainNode.gain.cancelScheduledValues(t)
      this.gainNode.gain.setValueAtTime(Math.max(0.0001, this.gainNode.gain.value), t)
      this.gainNode.gain.linearRampToValueAtTime(0.0001, t + fadeTimeSec)
    }
  }

  /**
   * Disposes the Web Audio chain and releases all nodes.
   */
  dispose() {
    this.stop(0.05)
    if (this.noiseSource) {
      try { this.noiseSource.stop(); this.noiseSource.disconnect() } catch {}
      this.noiseSource = null
    }
    if (this.bandpassFilter) { try { this.bandpassFilter.disconnect() } catch {}; this.bandpassFilter = null }
    if (this.lowshelfFilter) { try { this.lowshelfFilter.disconnect() } catch {}; this.lowshelfFilter = null }
    if (this.gainNode) { try { this.gainNode.disconnect() } catch {}; this.gainNode = null }
    this.noiseBuffer = null
    this.isInitialized = false
    this.ctx = null
  }
}

export const vegetationAudioService = new VegetationAudioService()
