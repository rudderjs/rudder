// @rudderjs/ai — AI engine

// Attachments
export { DocumentAttachment as Document, ImageAttachment as Image, getMessageText, attachmentsToContentParts } from './attachment.js'

// Types
export type {
  AgentPromptOptions,
  Attachment,
  AiMessage,
  ContentPart,
  AiConfig,
  AiModelConfig,
  AiProviderConfig,
  AiMiddleware,
  AgentResponse,
  AgentStep,
  AgentStreamResponse,
  AnyTool,
  BeforeToolCallResult,
  ClientTool,
  ConversationStore,
  ConversationStoreMeta,
  FinishReason,
  HasMiddleware,
  HasMemory,
  HasStructuredOutput,
  HasTools,
  MiddlewareConfigResult,
  MiddlewareContext,
  PrepareStepResult,
  ProviderAdapter,
  ProviderFactory,
  ProviderRequestOptions,
  ProviderResponse,
  ServerTool,
  StopCondition,
  Tool,
  StreamChunk,
  TokenUsage,
  ToolCall,
  ToolCallContext,
  ToolChoice,
  ToolDefinitionOptions,
  ToolDefinitionSchema,
  ToolExecuteFn,
  ToolNeedsApproval,
  ToolResult,
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
} from './types.js'

// Registry
export { AiRegistry } from './registry.js'

// Providers
export { AnthropicProvider, type AnthropicConfig } from './providers/anthropic.js'
export { OpenAIProvider, OpenAIAdapter, type OpenAIConfig } from './providers/openai.js'
export { GoogleProvider, type GoogleConfig } from './providers/google.js'
export { OllamaProvider, type OllamaConfig } from './providers/ollama.js'
export { DeepSeekProvider, type DeepSeekConfig } from './providers/deepseek.js'
export { XaiProvider, type XaiConfig } from './providers/xai.js'
export { GroqProvider, type GroqConfig } from './providers/groq.js'
export { MistralProvider, type MistralConfig } from './providers/mistral.js'
export { AzureOpenAIProvider, type AzureOpenAIConfig } from './providers/azure.js'
export { CohereProvider, type CohereConfig } from './providers/cohere.js'
export { JinaProvider, type JinaConfig } from './providers/jina.js'

// Tools
export {
  toolDefinition,
  dynamicTool,
  ToolBuilder,
  toolToSchema,
  pauseForClientTools,
  isPauseForClientToolsChunk,
} from './tool.js'
export type { PauseForClientToolsChunk } from './tool.js'
export { zodToJsonSchema } from './zod-to-json-schema.js'

// Agent
export { Agent, ConversableAgent, agent, stepCountIs, hasToolCall, setConversationStore } from './agent.js'
export { QueuedPromptBuilder } from './queue-job.js'

// Middleware
export { runOnConfig, runOnChunk, runOnBeforeToolCall, runOnAfterToolCall, runSequential, runOnUsage, runOnAbort, runOnError } from './middleware.js'

// Structured Output
export { Output, type OutputWrapper } from './output.js'

// Conversation
export { MemoryConversationStore } from './conversation.js'

// Facade
export { AI } from './facade.js'

// ServiceProvider
export { AiProvider } from './provider.js'

// Image Generation
export { ImageGenerator } from './image.js'

// Audio (TTS & STT)
export { AudioGenerator } from './audio.js'
export { Transcription } from './transcription.js'

// Provider Tools
export { WebSearch, WebFetch, CodeExecution } from './provider-tools.js'

// Vercel AI Protocol
export { toVercelDataStream, toVercelResponse } from './vercel-protocol.js'

// Reranking
export { Reranker } from './rerank.js'

// File Management
export { FileManager } from './files.js'

// Cached Embeddings
export { CachedEmbeddingAdapter } from './cached-embedding.js'

// Testing
export { AiFake } from './fake.js'
