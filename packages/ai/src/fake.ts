import { AiRegistry } from './registry.js'
import type {
  ProviderFactory,
  ProviderAdapter,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
  ImageGenerationAdapter,
  ImageGenerationOptions,
  ImageGenerationResult,
  TextToSpeechAdapter,
  TextToSpeechOptions,
  TextToSpeechResult,
  SpeechToTextAdapter,
  SpeechToTextOptions,
  SpeechToTextResult,
} from './types.js'

/**
 * Testing fake for @rudderjs/ai.
 *
 * @example
 * const fake = AiFake.fake()
 * fake.respondWith('Mocked response')
 *
 * const response = await AI.prompt('Hello')
 * assert.strictEqual(response.text, 'Mocked response')
 *
 * fake.assertPrompted(input => input.includes('Hello'))
 * fake.restore()
 */
export class AiFake {
  private readonly calls: ProviderRequestOptions[] = []
  private readonly imageCalls: ImageGenerationOptions[] = []
  private readonly ttsCalls: TextToSpeechOptions[] = []
  private readonly sttCalls: SpeechToTextOptions[] = []
  private _response = 'fake response'
  private _imageResponse = 'ZmFrZS1pbWFnZQ=='  // base64 of 'fake-image'
  private _ttsResponse: Buffer = Buffer.from('fake-audio')
  private _sttResponse = 'fake transcription'

  /** Set the text response the fake will return */
  respondWith(text: string): void {
    this._response = text
  }

  /** Set the base64 image the fake will return */
  respondWithImage(base64: string): void {
    this._imageResponse = base64
  }

  /** Set the audio buffer the TTS fake will return */
  respondWithAudio(audio: Buffer): void {
    this._ttsResponse = audio
  }

  /** Set the transcription text the STT fake will return */
  respondWithTranscription(text: string): void {
    this._sttResponse = text
  }

  /** Install the fake — replaces all registered providers with a mock */
  static fake(): AiFake {
    const fake = new AiFake()

    const adapter: ProviderAdapter = {
      async generate(opts: ProviderRequestOptions): Promise<ProviderResponse> {
        fake.calls.push(opts)
        return {
          message: { role: 'assistant', content: fake._response },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }
      },
      async *stream(opts: ProviderRequestOptions): AsyncIterable<StreamChunk> {
        fake.calls.push(opts)
        yield { type: 'text-delta', text: fake._response }
        yield { type: 'finish', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
      },
    }

    const imageAdapter: ImageGenerationAdapter = {
      async generate(opts: ImageGenerationOptions): Promise<ImageGenerationResult> {
        fake.imageCalls.push(opts)
        return {
          images: [{ base64: fake._imageResponse }],
          model: opts.model ?? 'fake-image',
        }
      },
    }

    const ttsAdapter: TextToSpeechAdapter = {
      async generate(opts: TextToSpeechOptions): Promise<TextToSpeechResult> {
        fake.ttsCalls.push(opts)
        return {
          audio: fake._ttsResponse,
          format: opts.format ?? 'mp3',
          model: opts.model ?? 'fake-tts',
        }
      },
    }

    const sttAdapter: SpeechToTextAdapter = {
      async transcribe(opts: SpeechToTextOptions): Promise<SpeechToTextResult> {
        fake.sttCalls.push(opts)
        return {
          text: fake._sttResponse,
          language: opts.language,
          model: opts.model ?? 'fake-stt',
        }
      },
    }

    const factory: ProviderFactory = {
      name: '__fake__',
      create: () => adapter,
      createImage: () => imageAdapter,
      createTts: () => ttsAdapter,
      createStt: () => sttAdapter,
    }

    AiRegistry.reset()
    AiRegistry.register(factory)
    AiRegistry.setDefault('__fake__/default')
    return fake
  }

  /** Assert at least one prompt was sent, optionally matching a predicate */
  assertPrompted(predicate?: (input: string) => boolean): void {
    if (this.calls.length === 0) throw new Error('[RudderJS AI] Expected at least one prompt, but none were sent.')
    if (predicate) {
      const match = this.calls.some(c => {
        const userMsg = c.messages.find(m => m.role === 'user')
        if (!userMsg) return false
        const text = typeof userMsg.content === 'string' ? userMsg.content : userMsg.content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('')
        return predicate(text)
      })
      if (!match) throw new Error('[RudderJS AI] No prompt matched the predicate.')
    }
  }

  /** Assert no prompts were sent */
  assertNothingPrompted(): void {
    if (this.calls.length > 0) {
      throw new Error(`[RudderJS AI] Expected no prompts, but ${this.calls.length} were sent.`)
    }
  }

  /** Assert at least one image generation was made */
  assertImageGenerated(predicate?: (prompt: string) => boolean): void {
    if (this.imageCalls.length === 0) throw new Error('[RudderJS AI] Expected at least one image generation, but none were made.')
    if (predicate) {
      const match = this.imageCalls.some(c => predicate(c.prompt))
      if (!match) throw new Error('[RudderJS AI] No image generation matched the predicate.')
    }
  }

  /** Assert at least one TTS generation was made */
  assertAudioGenerated(predicate?: (text: string) => boolean): void {
    if (this.ttsCalls.length === 0) throw new Error('[RudderJS AI] Expected at least one audio generation, but none were made.')
    if (predicate) {
      const match = this.ttsCalls.some(c => predicate(c.text))
      if (!match) throw new Error('[RudderJS AI] No audio generation matched the predicate.')
    }
  }

  /** Assert at least one transcription was made */
  assertTranscribed(predicate?: (opts: SpeechToTextOptions) => boolean): void {
    if (this.sttCalls.length === 0) throw new Error('[RudderJS AI] Expected at least one transcription, but none were made.')
    if (predicate) {
      const match = this.sttCalls.some(c => predicate(c))
      if (!match) throw new Error('[RudderJS AI] No transcription matched the predicate.')
    }
  }

  /** Get all recorded provider calls */
  getCalls(): ProviderRequestOptions[] {
    return [...this.calls]
  }

  /** Get all recorded image generation calls */
  getImageCalls(): ImageGenerationOptions[] {
    return [...this.imageCalls]
  }

  /** Get all recorded TTS calls */
  getTtsCalls(): TextToSpeechOptions[] {
    return [...this.ttsCalls]
  }

  /** Get all recorded STT calls */
  getSttCalls(): SpeechToTextOptions[] {
    return [...this.sttCalls]
  }

  /** Restore — clears the fake (user must re-register real providers) */
  restore(): void {
    AiRegistry.reset()
  }
}
