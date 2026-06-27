// `@rudderjs/ai/server` — the Rudder `ServiceProvider` binding for the AI
// engine. The engine itself lives in `@gemstack/ai-sdk`; this provider reads
// `config('ai')` and wires the engine into the Rudder container, so it lives
// on the Rudder side rather than in the framework-agnostic engine.
export { AiProvider } from './provider.js'
