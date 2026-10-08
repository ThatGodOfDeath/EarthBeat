/**
 * windAudioService.js — Phase 7
 *
 * Dedicated Web Audio service for environmental wind sonification.
 * Reuses the existing application AudioContext.
 *
 * Audio Signal Chain:
 *
 *   [AudioBufferSourceNode (Looped Noise Buffer)]
 *                         │
 *                         ▼
 *         [BiquadFilterNode (Bandpass / Spectral Filter)]
 *                         │
 *                         ▼
 *         [GainNode (Wind Speed Amplitude Envelope)]
 *                         │
 *                         ▼
 *         [StereoPannerNode (Meteorological Direction)]
 *                         │
 *                         ▼
 *                [ctx.destination]
 */

import {
  calculateWindAudioParams,
  MIN_FILTER_CUTOFF_HZ,
  MIN_FILTER_Q,
} from '../utils/windSonification.js'

class WindAudioService {
  constructor() {
    this.ctx = null
    this.noiseSource = null
    this.filterNode = null
    this.gainNode = null
    this.pannerNode = null
    this.noiseBuffer = null
    this.isEnabled = true
    this.isInitialized = false
    this.lastParams = null
  }

  /**
   * Generates a 2-second mono white noise buffer.
   *
   * @param {AudioContext} ctx
   * @returns {AudioBuffer}
   */
  _createNoiseBuffer(ctx) {
    const bufferSize = ctx.sampleRate * 2
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const output = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      // Uniform random noise in [-1.0, 1.0]
      output[i] = Math.random() * 2 - 1
    }
    return buffer
  }

  /**
   * Initializes the wind audio chain on the provided AudioContext.
   * Reuses the existing context and nodes if already initialized.
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
      // 1. Noise buffer and looped source
      this.noiseBuffer = this._createNoiseBuffer(ctx)
      this.noiseSource = ctx.createBufferSource()
      this.noiseSource.buffer = this.noiseBuffer
      this.noiseSource.loop = true

      // 2. Spectral BiquadFilter (bandpass gives realistic whistling/turbulence)
      this.filterNode = ctx.createBiquadFilter()
      this.filterNode.type = 'bandpass'
      this.filterNode.frequency.setValueAtTime(MIN_FILTER_CUTOFF_HZ, ctx.currentTime)
      this.filterNode.Q.setValueAtTime(MIN_FILTER_Q, ctx.currentTime)

      // 3. Gain node (starts silent)
      this.gainNode = ctx.createGain()
      this.gainNode.gain.setValueAtTime(0.0001, ctx.currentTime)

      // 4. Stereo panner (with graceful fallback if unsupported)
      if (typeof ctx.createStereoPanner === 'function') {
        this.pannerNode = ctx.createStereoPanner()
        this.pannerNode.pan.setValueAtTime(0, ctx.currentTime)
      } else {
        this.pannerNode = null
      }

      // Connect chain: source -> filter -> gain -> panner -> destination
      this.noiseSource.connect(this.filterNode)
      this.filterNode.connect(this.gainNode)

      if (this.pannerNode) {
        this.gainNode.connect(this.pannerNode)
        this.pannerNode.connect(ctx.destination)
      } else {
        this.gainNode.connect(ctx.destination)
      }

      this.noiseSource.start(0)
      this.isInitialized = true
    } catch (err) {
      console.warn('[WindAudioService] Failed to initialize Web Audio chain:', err)
      this.isInitialized = false
    }
  }

  /**
   * Updates wind audio parameters according to the current wind point.
   *
   * @param {object|null} windPoint - { speed, direction, ... }
   * @param {number} [glideTimeSec=0.25] - Transition duration in seconds
   */
  updateWind(windPoint, glideTimeSec = 0.25) {
    if (!this.ctx) return
    const params = calculateWindAudioParams(windPoint)
    this.lastParams = params

    if (!this.isInitialized) {
      this.init(this.ctx)
      if (!this.isInitialized) return
    }

    const t = this.ctx.currentTime
    const glide = Math.max(0.05, glideTimeSec)

    // Calculate target gain
    const targetGain = this.isEnabled && !params.isCalm ? params.gain : 0.0001

    // 1. Smooth gain transition (linear ramp to target)
    if (this.gainNode) {
      this.gainNode.gain.cancelScheduledValues(t)
      this.gainNode.gain.setValueAtTime(Math.max(0.0001, this.gainNode.gain.value), t)
      this.gainNode.gain.linearRampToValueAtTime(targetGain, t + glide)
    }

    // 2. Smooth filter frequency & Q transition
    if (this.filterNode) {
      this.filterNode.frequency.cancelScheduledValues(t)
      this.filterNode.frequency.setValueAtTime(this.filterNode.frequency.value, t)
      this.filterNode.frequency.linearRampToValueAtTime(params.cutoffHz, t + glide)

      this.filterNode.Q.cancelScheduledValues(t)
      this.filterNode.Q.setValueAtTime(this.filterNode.Q.value, t)
      this.filterNode.Q.linearRampToValueAtTime(params.q, t + glide)
    }

    // 3. Smooth stereo pan transition
    if (this.pannerNode) {
      this.pannerNode.pan.cancelScheduledValues(t)
      this.pannerNode.pan.setValueAtTime(this.pannerNode.pan.value, t)
      this.pannerNode.pan.linearRampToValueAtTime(params.pan, t + glide)
    }
  }

  /**
   * Sets whether wind sonification is enabled.
   *
   * @param {boolean} enabled
   * @param {number} [glideTimeSec=0.15]
   */
  setEnabled(enabled, glideTimeSec = 0.15) {
    this.isEnabled = !!enabled
    if (this.ctx && this.gainNode) {
      const t = this.ctx.currentTime
      const targetGain = this.isEnabled && this.lastParams && !this.lastParams.isCalm
        ? this.lastParams.gain
        : 0.0001

      this.gainNode.gain.cancelScheduledValues(t)
      this.gainNode.gain.setValueAtTime(Math.max(0.0001, this.gainNode.gain.value), t)
      this.gainNode.gain.linearRampToValueAtTime(targetGain, t + glideTimeSec)
    }
  }

  /**
   * Fades wind audio to silence.
   *
   * @param {number} [fadeTimeSec=0.12]
   */
  stop(fadeTimeSec = 0.12) {
    if (this.ctx && this.gainNode) {
      const t = this.ctx.currentTime
      this.gainNode.gain.cancelScheduledValues(t)
      this.gainNode.gain.setValueAtTime(Math.max(0.0001, this.gainNode.gain.value), t)
      this.gainNode.gain.linearRampToValueAtTime(0.0001, t + fadeTimeSec)
    }
  }

  /**
   * Disposes the Web Audio chain and releases nodes.
   */
  dispose() {
    this.stop(0.05)
    if (this.noiseSource) {
      try {
        this.noiseSource.stop()
        this.noiseSource.disconnect()
      } catch {
        // ignore if already stopped
      }
      this.noiseSource = null
    }
    if (this.filterNode) {
      try { this.filterNode.disconnect() } catch {}
      this.filterNode = null
    }
    if (this.gainNode) {
      try { this.gainNode.disconnect() } catch {}
      this.gainNode = null
    }
    if (this.pannerNode) {
      try { this.pannerNode.disconnect() } catch {}
      this.pannerNode = null
    }
    this.noiseBuffer = null
    this.isInitialized = false
    this.ctx = null
  }
}

export const windAudioService = new WindAudioService()
