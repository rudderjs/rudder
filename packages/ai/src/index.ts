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
  StreamChunk,
  TokenUsage,
  ToolCall,
  ToolChoice,
  ToolDefinitionOptions,
  ToolDefinitionSchema,
  ToolExecuteFn,
  ToolNeedsApproval,
  ToolResult,
  EmbeddingAdapter,
  EmbeddingResult,
} from './types.js'

// Registry
export { AiRegistry } from './registry.js'

// Providers
export { AnthropicProvider, type AnthropicConfig } from './providers/anthropic.js'
export { OpenAIProvider, OpenAIAdapter, type OpenAIConfig } from './providers/openai.js'
export { GoogleProvider, type GoogleConfig } from './providers/google.js'
export { OllamaProvider, type OllamaConfig } from './providers/ollama.js'

// Tools
export { toolDefinition, ToolBuilder, toolToSchema } from './tool.js'
export { zodToJsonSchema } from './zod-to-json-schema.js'

// Agent
export { Agent, agent, stepCountIs, hasToolCall } from './agent.js'

// Middleware
export { runOnConfig, runOnChunk, runOnBeforeToolCall, runOnAfterToolCall, runSequential, runOnUsage, runOnAbort, runOnError } from './middleware.js'

// Structured Output
export { Output, type OutputWrapper } from './output.js'

// Conversation
export { MemoryConversationStore } from './conversation.js'

// Facade
export { AI } from './facade.js'

// ServiceProvider factory
export { ai } from './provider.js'

// Testing
export { AiFake } from './fake.js'
