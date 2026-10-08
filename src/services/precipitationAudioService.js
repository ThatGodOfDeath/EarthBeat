/**
 * precipitationAudioService.js — Phase 9 (Moisture System)
 *
 * Dedicated Web Audio service for the Moisture/Precipitation system.
 * Now handles both tprecmax (rain intensity) and tqv (atmospheric moisture).
 *
 * Audio Signal Chain:
 *
 *   [AudioBufferSourceNode (Looped White Noise)]
 *                     │
 *                     ▼
 *   [BiquadFilterNode (Highpass — removes low rumble, isolates rain band)]
 *                     │
 *                     ▼
 *   [BiquadFilterNode (Bandpass — shapes moisture/rain texture character)]
 *                           ↑ frequency + Q controlled by tqv (atmospheric moisture)
 *                     │
 *                     ▼
 *   [GainNode (Moisture Intensity Envelope)]
 *             ↑ gain controlled by tprecmax (precipitation)
 *             ↑ ambient gain floor set by tqv (humid air background)
 *                     │
 *                     ▼
 *            [ctx.destination]
 *
 * Moisture System Behavior:
 *   tprecmax → rain event gain (primary intensity driver)
 *   tqv      → modifies filter character + adds subtle humid ambient gain
 *
 *   Low tqv  + no rain  → near silence (dry, open)
 *   High tqv + no rain  → very subtle humid texture
 *   Low tqv  + rain     → bright, sparse rain sound
 *   High tqv + rain     → rich, dense saturated rain environment
 *
 * Perceptual Design:
 *   - Rain is deliberately different from wind: higher frequency band, no stereo pan.
 *   - Rain pans to center (spatially "above") while wind moves left/right.
 *   - tqv modifies the bandpass center frequency (more moisture → lower, fuller band).
 */

import { calculateRainAudioParams } from '../utils/precipitationSonification.js'
import { calculateMoistureAudioParams } from '../utils/moistureSonification.js'

class PrecipitationAudioService {
  constructor() {
    this.ctx = null
    this.noiseSource = null
    this.highpassFilter = null
    this.bandpassFilter = null
    this.gainNode = null
    this.noiseBuffer = null
    this.isEnabled = true
    this.isInitialized = false
    this.lastParams = null
    this.pannerNode = null   // intentionally null — rain has no stereo pan
  }

  /**
   * Generates a 3-second mono white noise buffer for rain/moisture texture.
   * @param {AudioContext} ctx
   * @returns {AudioBuffer}
   */
  _createNoiseBuffer(ctx) {
    const bufferSize = ctx.sampleRate * 3
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const output = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1
    }
    return buffer
  }

  /**
   * Initializes the moisture audio chain on the provided AudioContext.
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
      // 1. White noise buffer and looped source
      this.noiseBuffer = this._createNoiseBuffer(ctx)
      this.noiseSource = ctx.createBufferSource()
      this.noiseSource.buffer = this.noiseBuffer
      this.noiseSource.loop = true

      // 2. Highpass filter — removes low-frequency rumble below rain band
      //    Rain sits around 800–4000 Hz; we cut below ~800 Hz
      this.highpassFilter = ctx.createBiquadFilter()
      this.highpassFilter.type = 'highpass'
      this.highpassFilter.frequency.setValueAtTime(2000, ctx.currentTime)
      this.highpassFilter.Q.setValueAtTime(0.5, ctx.currentTime)

      // 3. Bandpass filter — shapes the moisture/rain character
      //    Center frequency controlled by tqv:
      //      Dry air (low tqv)  → ~2000 Hz (bright, sparse)
      //      Humid air (high tqv) → ~600 Hz (full, rich)
      this.bandpassFilter = ctx.createBiquadFilter()
      this.bandpassFilter.type = 'bandpass'
      this.bandpassFilter.frequency.setValueAtTime(2000, ctx.currentTime)
      this.bandpassFilter.Q.setValueAtTime(2.0, ctx.currentTime)

      // 4. Gain node — starts at silence
      this.gainNode = ctx.createGain()
      this.gainNode.gain.setValueAtTime(0.0001, ctx.currentTime)

      // Connect chain: source → highpass → bandpass → gain → destination
      this.noiseSource.connect(this.highpassFilter)
      this.highpassFilter.connect(this.bandpassFilter)
      this.bandpassFilter.connect(this.gainNode)
      this.gainNode.connect(ctx.destination)

      this.noiseSource.start(0)
      this.isInitialized = true
    } catch (err) {
      console.warn('[PrecipitationAudioService] Failed to initialize Web Audio chain:', err)
      this.isInitialized = false
    }
  }

  /**
   * Updates moisture audio from tprecmax (precipitation) and tqv (water vapor).
   *
   * Phase 9 unified moisture system:
   *   - tprecmax → rain gain and primary intensity
   *   - tqv      → filter character + ambient background gain
   *
   * @param {number|null} tprecmaxKgM2S - Total precipitation in kg/m²/s
   * @param {number|null} tqvKgM2    - Total precipitable water in kg/m²
   * @param {number} [glideTimeSec=0.4] - Transition duration in seconds
   */
  updateMoisture(tprecmaxKgM2S, tqvKgM2, glideTimeSec = 0.4) {
    if (!this.ctx) return

    const rainParams = calculateRainAudioParams(tprecmaxKgM2S)
    const moistureParams = calculateMoistureAudioParams(tqvKgM2, tprecmaxKgM2S)

    // Combined params: rain intensity + atmospheric moisture character
    const combinedParams = { ...rainParams, ...moistureParams }
    this.lastParams = combinedParams

    if (!this.isInitialized) {
      this.init(this.ctx)
      if (!this.isInitialized) return
    }

    const t = this.ctx.currentTime
    const glide = Math.max(0.08, glideTimeSec)

    // Target gain:
    //   If precipitation → use rain gain (dominant)
    //   If only tqv (humid, no rain) → use ambient gain (very quiet)
    //   If disabled → silence
    let targetGain = 0.0001
    if (this.isEnabled) {
      if (!rainParams.isSilent) {
        targetGain = rainParams.gain
      } else if (moistureParams.ambientGain > 0) {
        targetGain = moistureParams.ambientGain
      }
    }

    // 1. Smooth gain transition
    if (this.gainNode) {
      this.gainNode.gain.cancelScheduledValues(t)
      this.gainNode.gain.setValueAtTime(Math.max(0.0001, this.gainNode.gain.value), t)
      this.gainNode.gain.linearRampToValueAtTime(targetGain, t + glide)
    }

    // 2. Highpass filter cutoff — tracks rain intensity
    if (this.highpassFilter) {
      const targetCutoff = rainParams.filterCutoff
      this.highpassFilter.frequency.cancelScheduledValues(t)
      this.highpassFilter.frequency.setValueAtTime(this.highpassFilter.frequency.value, t)
      this.highpassFilter.frequency.linearRampToValueAtTime(targetCutoff, t + glide)
    }

    // 3. Bandpass filter — controlled by tqv (atmospheric moisture)
    //    tqv shifts the center frequency: dry → higher, humid → lower
    if (this.bandpassFilter) {
      // If raining: bandpass center tracks rain intensity too
      // If not raining: bandpass center tracks tqv alone
      const tqvHz = moistureParams.filterHz
      const rainHz = rainParams.isSilent ? tqvHz : (rainParams.filterCutoff * 1.2)
      const targetHz = rainParams.isSilent ? tqvHz : Math.min(tqvHz, rainHz)

      const tqvQ = moistureParams.filterQ
      const rainQ = rainParams.isSilent ? tqvQ : Math.max(0.5, 2.5 - 1.5 * rainParams.norm)
      const targetQ = Math.min(tqvQ, rainQ + 0.5)

      this.bandpassFilter.frequency.cancelScheduledValues(t)
      this.bandpassFilter.frequency.setValueAtTime(this.bandpassFilter.frequency.value, t)
      this.bandpassFilter.frequency.linearRampToValueAtTime(Math.max(200, targetHz), t + glide)

      this.bandpassFilter.Q.cancelScheduledValues(t)
      this.bandpassFilter.Q.setValueAtTime(this.bandpassFilter.Q.value, t)
      this.bandpassFilter.Q.linearRampToValueAtTime(Math.max(0.5, targetQ), t + glide)
    }
  }

  /**
   * Backward-compatible alias: use only tprecmax (no tqv modifier).
   * Deprecated in Phase 9 — prefer updateMoisture(tprecmax, tqv, glide).
   *
   * @param {number|null} precipKgM2S
   * @param {number} [glideTimeSec=0.4]
   */
  updatePrecipitation(precipKgM2S, glideTimeSec = 0.4) {
    this.updateMoisture(precipKgM2S, null, glideTimeSec)
  }

  /**
   * Sets whether moisture sonification is enabled.
   * @param {boolean} enabled
   */
  setEnabled(enabled, glideTimeSec = 0.15) {
    this.isEnabled = !!enabled
    if (this.ctx && this.gainNode) {
      const t = this.ctx.currentTime
      let targetGain = 0.0001
      if (this.isEnabled && this.lastParams) {
        if (!this.lastParams.isSilent) {
          targetGain = this.lastParams.gain
        } else if (this.lastParams.ambientGain > 0) {
          targetGain = this.lastParams.ambientGain
        }
      }

      this.gainNode.gain.cancelScheduledValues(t)
      this.gainNode.gain.setValueAtTime(Math.max(0.0001, this.gainNode.gain.value), t)
      this.gainNode.gain.linearRampToValueAtTime(targetGain, t + glideTimeSec)
    }
  }

  /**
   * Fades moisture audio to silence.
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
   * Disposes the Web Audio chain and releases all nodes.
   */
  dispose() {
    this.stop(0.05)
    if (this.noiseSource) {
      try { this.noiseSource.stop(); this.noiseSource.disconnect() } catch {}
      this.noiseSource = null
    }
    if (this.highpassFilter) { try { this.highpassFilter.disconnect() } catch {}; this.highpassFilter = null }
    if (this.bandpassFilter) { try { this.bandpassFilter.disconnect() } catch {}; this.bandpassFilter = null }
    if (this.gainNode) { try { this.gainNode.disconnect() } catch {}; this.gainNode = null }
    this.noiseBuffer = null
    this.isInitialized = false
    this.ctx = null
  }
}

export const precipitationAudioService = new PrecipitationAudioService()
