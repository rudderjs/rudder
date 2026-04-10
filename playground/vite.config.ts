import { defineConfig } from 'vite'
import rudderjs from '@rudderjs/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    rudderjs(),
    tailwindcss(),
    react(),
  ],
  server: {
    allowedHosts: true,
  },
  resolve: {
    // Dedupe modules that ship React Context — without dedupe, Vite's
    // optimizeDeps pre-bundles `@pilotiq-pro/ai` with its OWN copies of
    // `@pilotiq/panels` and React, creating duplicate `AiUiContext` /
    // `React` instances. AdminLayout's `useAiUi()` reads the playground's
    // workspace-link copy while pro's `AiUiContext.Provider` writes to
    // its own bundled copy → context lookups return the empty default →
    // AiChatTrigger never renders on the client → hydration mismatch.
    dedupe: ['react', 'react-dom', '@pilotiq/panels', '@pilotiq/lexical'],
  },
  optimizeDeps: {
    include: [
      // Pilotiq pro — statically imported by the locally-overridden
      // pages/(panels)/@panel/+Layout.tsx. Pre-bundling here keeps Vite's
      // dep-graph and HMR happy across React boundary changes.
      '@pilotiq-pro/ai',

      // Panels — UI primitives
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
      'sonner',
      'recharts',
      'shiki',
      'motion/react',
      '@formkit/auto-animate',
      'y-indexeddb',

      // Base UI
      '@base-ui/react/collapsible',
      '@base-ui/react/separator',
      '@base-ui/react/merge-props',
      '@base-ui/react/use-render',
      '@base-ui/react/avatar',
      '@base-ui/react/tooltip',
      '@base-ui/react/menu',
      '@base-ui/react/dialog',
      '@base-ui/react/alert-dialog',
      '@base-ui-components/react/tabs',
      '@base-ui-components/react/checkbox',
      '@base-ui-components/react/select',
      '@base-ui-components/react/switch',
      '@base-ui-components/react/dialog',

      // Vike
      'vike-react/useConfig',

      // Lexical
      'lexical',
      '@lexical/react/LexicalComposerContext',
      '@lexical/react/LexicalComposer',
      '@lexical/react/LexicalContentEditable',
      '@lexical/react/LexicalErrorBoundary',
      '@lexical/react/LexicalPlainTextPlugin',
      '@lexical/react/LexicalCollaborationPlugin',
      '@lexical/react/LexicalCollaborationContext',
      '@lexical/react/LexicalTypeaheadMenuPlugin',
      '@lexical/react/LexicalRichTextPlugin',
      '@lexical/react/LexicalHistoryPlugin',
      '@lexical/react/LexicalListPlugin',
      '@lexical/react/LexicalLinkPlugin',
      '@lexical/react/LexicalDraggableBlockPlugin',
      '@lexical/react/LexicalHorizontalRuleNode',
      '@lexical/link',
      '@lexical/utils',
      '@lexical/rich-text',
      '@lexical/list',
      '@lexical/code',
      '@floating-ui/dom',
    ],
    exclude: [
      // Keep these as workspace-link runtime imports (NOT pre-bundled
      // inside @pilotiq-pro/ai) so a single instance is shared with the
      // playground's own imports. See `dedupe` rationale above.
      '@pilotiq/panels',
      '@pilotiq/lexical',
    ],
  },
  ssr: {
    external: ['@anthropic-ai/sdk', 'openai', '@google/generative-ai'],
  },
})
