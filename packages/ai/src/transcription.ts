import { readFileSync } from 'node:fs'
import { AiRegistry } from './registry.js'
import type { SpeechToTextResult } from './types.js'

/**
 * Fluent builder for speech-to-text transcription.
 *
 * @example
 * const result = await Transcription.fromPath('./audio.mp3').generate()
 * const result = await Transcription.fromBuffer(buf).language('en').generate()
 */
export class Transcription {
  private _model?: string
  private _language?: string
  private _prompt?: string

  private constructor(private readonly _audio: Buffer | string) {}

  /** Create a Transcription from a file path */
  static fromPath(path: string): Transcription {
    return new Transcription(path)
  }

  /** Create a Transcription from a Buffer */
  static fromBuffer(buffer: Buffer): Transcription {
    return new Transcription(buffer)
  }

  /** Set the STT model (e.g. 'openai/whisper-1') */
  model(m: string): this {
    this._model = m
    return this
  }

  /** Set the language hint (ISO-639-1, e.g. 'en', 'es', 'fr') */
  language(l: string): this {
    this._language = l
    return this
  }

  /** Set an optional prompt to guide transcription style */
  prompt(p: string): this {
    this._prompt = p
    return this
  }

  /** Run the transcription */
  async generate(): Promise<SpeechToTextResult> {
    const modelString = this._model ?? AiRegistry.getDefault()
    const [providerName, modelId] = AiRegistry.parseModelString(modelString)
    const factory = AiRegistry.getFactory(providerName)

    if (!factory.createStt) {
      throw new Error(
        `[RudderJS AI] Provider "${providerName}" does not support speech-to-text. ` +
        `Use a provider that implements createStt() (e.g. openai).`,
      )
    }

    // Resolve audio: if string (path), read into Buffer
    const audioBuffer = typeof this._audio === 'string'
      ? readFileSync(this._audio)
      : this._audio

    const adapter = factory.createStt(modelId)
    return adapter.transcribe({
      audio: audioBuffer,
      model: modelId,
      language: this._language,
      prompt: this._prompt,
    })
  }
}
