import { AiRegistry } from './registry.js'
import type {
  ProviderFactory,
  ProviderAdapter,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
  EmbeddingAdapter,
  EmbeddingResult,
  ImageGenerationAdapter,
  ImageGenerationOptions,
  ImageGenerationResult,
  TextToSpeechAdapter,
  TextToSpeechOptions,
  TextToSpeechResult,
  SpeechToTextAdapter,
  SpeechToTextOptions,
  SpeechToTextResult,
  RerankingAdapter,
  RerankingOptions,
  RerankingResult,
  FileAdapter,
  FileUploadOptions,
  FileUploadResult,
  FileListResult,
  FileContent,
  ToolCall,
  FinishReason,
} from './types.js'

/**
 * One scripted provider response in a multi-step agent loop.
 *
 * Pass an array of these to {@link AiFake.respondWithSequence} to script a
 * multi-turn run end-to-end (e.g. step 0 returns tool calls, step 1 returns
 * the final assistant text). Step indices are 0-based and align 1:1 with
 * provider `generate`/`stream` calls.
 *
 * - `text` — assistant message content (default: empty string)
 * - `toolCalls` — present when the assistant wants to call tools; the loop
 *   will execute them and feed results into the next step
 * - `finishReason` — defaults to `'tool_calls'` when `toolCalls` is set,
 *   otherwise `'stop'`
 */
export interface AiFakeStep {
  text?: string
  toolCalls?: ToolCall[]
  finishReason?: FinishReason
}

/**
 * Testing fake for @rudderjs/ai.
 *
 * @example Single-response shorthand
 * const fake = AiFake.fake()
 * fake.respondWith('Mocked response')
 *
 * const response = await AI.prompt('Hello')
 * assert.strictEqual(response.text, 'Mocked response')
 *
 * fake.assertPrompted(input => input.includes('Hello'))
 * fake.restore()
 *
 * @example Multi-step sequence
 * const fake = AiFake.fake()
 * fake.respondWithSequence([
 *   { toolCalls: [{ id: 't1', name: 'lookup', arguments: { q: 'a' } }] },
 *   { text: 'Done.' },
 * ])
 *
 * @example Forced failure
 * const fake = AiFake.fake()
 * fake.failOnStep(0, new Error('Rate limited'))
 * // first provider call throws; useful for testing onError middleware
 */
export class AiFake {
  private readonly calls: ProviderRequestOptions[] = []
  private readonly imageCalls: ImageGenerationOptions[] = []
  private readonly ttsCalls: TextToSpeechOptions[] = []
  private readonly sttCalls: SpeechToTextOptions[] = []
  private readonly embedCalls: Array<{ input: string | string[]; model: string }> = []
  private readonly rerankCalls: RerankingOptions[] = []
  private readonly fileCalls: Array<{ method: string; args: unknown }> = []
  private _response = 'fake response'
  private _sequence: AiFakeStep[] = []
  private readonly _failures = new Map<number, Error>()
  private _imageResponse = 'ZmFrZS1pbWFnZQ=='  // base64 of 'fake-image'
  private _ttsResponse: Buffer = Buffer.from('fake-audio')
  private _sttResponse = 'fake transcription'
  private _embedResponse: number[][] = [[0.1, 0.2, 0.3]]
  private _rerankResponse: RerankingResult = { results: [] }
  private _fileUploadResponse: FileUploadResult = { id: 'fake-file-id', filename: 'fake.txt', bytes: 0 }

  /** Set the text response the fake will return */
  respondWith(text: string): void {
    this._response = text
  }

  /**
   * Script a multi-step provider response. Each entry in `steps` corresponds
   * to one provider call (the Nth `generate`/`stream` invocation consumes
   * `steps[N]`). When the sequence is exhausted, subsequent calls fall back
   * to {@link respondWith} (default: `'fake response'`).
   *
   * Pair with `tools` on an agent to drive a complete tool-call loop:
   * step 0 emits `toolCalls`, step 1 returns the final assistant text.
   *
   * Calling this resets the sequence and the provider-call counter so
   * scripted step indices are relative to this call. Registered failures
   * (see {@link failOnStep}) are left intact, so the order in which you
   * call `respondWithSequence` and `failOnStep` does not matter.
   */
  respondWithSequence(steps: AiFakeStep[]): void {
    this._sequence = [...steps]
    this.calls.length = 0
  }

  /**
   * Force the Nth provider call to throw. Useful for testing failover
   * (paired with multiple registered factories), error middleware, and
   * `onError` hooks without a real network failure.
   *
   * The step index is 0-based and counts every `generate`/`stream` call
   * the fake adapter receives. Failures take precedence over any scripted
   * sequence at the same index — the sequence step is NOT consumed.
   */
  failOnStep(stepIndex: number, error: Error): void {
    this._failures.set(stepIndex, error)
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

  /** Set the embeddings the fake will return */
  respondWithEmbedding(embeddings: number[][]): void {
    this._embedResponse = embeddings
  }

  /** Set the reranking results the fake will return */
  respondWithRanking(results: RerankingResult['results']): void {
    this._rerankResponse = { results }
  }

  /** Set the file upload result the fake will return */
  respondWithFileUpload(result: FileUploadResult): void {
    this._fileUploadResponse = result
  }

  /** Install the fake — replaces all registered providers with a mock */
  static fake(): AiFake {
    const fake = new AiFake()

    const adapter: ProviderAdapter = {
      async generate(opts: ProviderRequestOptions): Promise<ProviderResponse> {
        const stepIndex = fake.calls.length
        fake.calls.push(opts)
        const failure = fake._failures.get(stepIndex)
        if (failure) throw failure
        const next = fake._sequence[stepIndex]
        if (next) {
          return {
            message: {
              role: 'assistant',
              content: next.text ?? '',
              ...(next.toolCalls ? { toolCalls: next.toolCalls } : {}),
            },
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: next.finishReason ?? (next.toolCalls ? 'tool_calls' : 'stop'),
          }
        }
        return {
          message: { role: 'assistant', content: fake._response },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }
      },
      async *stream(opts: ProviderRequestOptions): AsyncIterable<StreamChunk> {
        const stepIndex = fake.calls.length
        fake.calls.push(opts)
        const failure = fake._failures.get(stepIndex)
        if (failure) throw failure
        const next = fake._sequence[stepIndex]
        if (next) {
          if (next.text) yield { type: 'text-delta', text: next.text }
          if (next.toolCalls) {
            for (const tc of next.toolCalls) yield { type: 'tool-call', toolCall: tc }
          }
          yield {
            type: 'finish',
            finishReason: next.finishReason ?? (next.toolCalls ? 'tool_calls' : 'stop'),
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          }
          return
        }
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

    const embeddingAdapter: EmbeddingAdapter = {
      async embed(input: string | string[], model: string): Promise<EmbeddingResult> {
        fake.embedCalls.push({ input, model })
        const inputs = Array.isArray(input) ? input : [input]
        const embeddings = inputs.map((_, i) => fake._embedResponse[i % fake._embedResponse.length]!)
        return {
          embeddings,
          usage: { promptTokens: 0, totalTokens: 0 },
        }
      },
    }

    const rerankingAdapter: RerankingAdapter = {
      async rerank(opts: RerankingOptions): Promise<RerankingResult> {
        fake.rerankCalls.push(opts)
        return fake._rerankResponse
      },
    }

    const fileAdapter: FileAdapter = {
      async upload(opts: FileUploadOptions): Promise<FileUploadResult> {
        fake.fileCalls.push({ method: 'upload', args: opts })
        return { ...fake._fileUploadResponse, filename: opts.filePath.split('/').pop() ?? fake._fileUploadResponse.filename }
      },
      async list(): Promise<FileListResult> {
        fake.fileCalls.push({ method: 'list', args: {} })
        return { files: [fake._fileUploadResponse] }
      },
      async delete(fileId: string): Promise<void> {
        fake.fileCalls.push({ method: 'delete', args: fileId })
      },
      async retrieve(fileId: string): Promise<FileContent> {
        fake.fileCalls.push({ method: 'retrieve', args: fileId })
        return { data: Buffer.from('fake-content'), mimeType: 'application/octet-stream' }
      },
    }

    const factory: ProviderFactory = {
      name: '__fake__',
      create: () => adapter,
      createEmbedding: () => embeddingAdapter,
      createImage: () => imageAdapter,
      createTts: () => ttsAdapter,
      createStt: () => sttAdapter,
      createReranking: () => rerankingAdapter,
      createFiles: () => fileAdapter,
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

  /** Assert at least one embedding was made */
  assertEmbedded(predicate?: (input: string | string[]) => boolean): void {
    if (this.embedCalls.length === 0) throw new Error('[RudderJS AI] Expected at least one embedding, but none were made.')
    if (predicate) {
      const match = this.embedCalls.some(c => predicate(c.input))
      if (!match) throw new Error('[RudderJS AI] No embedding matched the predicate.')
    }
  }

  /** Assert at least one reranking was made */
  assertReranked(predicate?: (opts: RerankingOptions) => boolean): void {
    if (this.rerankCalls.length === 0) throw new Error('[RudderJS AI] Expected at least one reranking, but none were made.')
    if (predicate) {
      const match = this.rerankCalls.some(c => predicate(c))
      if (!match) throw new Error('[RudderJS AI] No reranking matched the predicate.')
    }
  }

  /** Get all recorded embedding calls */
  getEmbedCalls(): Array<{ input: string | string[]; model: string }> {
    return [...this.embedCalls]
  }

  /** Get all recorded reranking calls */
  getRerankCalls(): RerankingOptions[] {
    return [...this.rerankCalls]
  }

  /** Assert at least one file upload was made */
  assertFileUploaded(predicate?: (filePath: string) => boolean): void {
    const uploads = this.fileCalls.filter(c => c.method === 'upload')
    if (uploads.length === 0) throw new Error('[RudderJS AI] Expected at least one file upload, but none were made.')
    if (predicate) {
      const match = uploads.some(c => predicate((c.args as FileUploadOptions).filePath))
      if (!match) throw new Error('[RudderJS AI] No file upload matched the predicate.')
    }
  }

  /** Get all recorded file operation calls */
  getFileCalls(): Array<{ method: string; args: unknown }> {
    return [...this.fileCalls]
  }

  /** Restore — clears the fake (user must re-register real providers) */
  restore(): void {
    AiRegistry.reset()
  }
}
