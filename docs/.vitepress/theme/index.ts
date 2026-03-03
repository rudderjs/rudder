import DefaultTheme from 'vitepress/theme'
import './custom.css'
import PackageBadge from './components/PackageBadge.vue'
import type { Theme } from 'vitepress'

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('PackageBadge', PackageBadge)
  },
}

export default theme
