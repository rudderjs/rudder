import { usePageContext } from 'vike-react/usePageContext'
import type { PanelNavigationMeta } from '@rudderjs/panels'

export default function PanelHead() {
  let fontFamilies: string[] = []

  try {
    const ctx = usePageContext() as { data?: { panelMeta?: PanelNavigationMeta } }
    const fonts = ctx.data?.panelMeta?.theme?.fonts
    if (fonts) {
      const seen = new Set<string>()
      if (fonts.body)    seen.add(fonts.body)
      if (fonts.heading && !seen.has(fonts.heading)) seen.add(fonts.heading)
      fontFamilies = [...seen]
    }
  } catch {
    // pageContext may not be available in all render contexts
  }

  const fontHref = fontFamilies.length > 0
    ? `https://fonts.googleapis.com/css2?${fontFamilies.map(f => `family=${f.replace(/ /g, '+')}:wght@400;500;600;700`).join('&')}&display=swap`
    : null

  return (
    <>
      {fontHref && (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link rel="stylesheet" href={fontHref} />
        </>
      )}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('panels-theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
        }}
      />
    </>
  )
}
