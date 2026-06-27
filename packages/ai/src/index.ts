// @rudderjs/ai is Rudder's AI integration. The agnostic agent engine lives in
// @gemstack/ai-sdk; this package re-exports it (this root entry) and adds the
// Rudder-specific bindings on subpaths (./server AiProvider, the ORM-backed
// stores, ./doctor, and the make:agent / ai:eval CLI) that intentionally do not
// graduate to the agnostic engine. In a Rudder app, import from '@rudderjs/ai';
// import '@gemstack/ai-sdk' directly to use the engine without the Rudder bindings.
export * from '@gemstack/ai-sdk'
