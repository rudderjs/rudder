/**
 * Swagger UI HTML page. v1 CDN-loads the assets from jsDelivr (pinned version)
 * rather than vendoring `swagger-ui-dist` — keeps the package lean and the
 * route a pure string. Apps that need an air-gapped/offline UI can vendor the
 * dist assets and serve their own HTML; this is the convenience default.
 */

const SWAGGER_UI_VERSION = '5.17.14'

export function swaggerUiHtml(specPath: string, title = 'API Docs'): string {
  // specPath is app-controlled (config/registration), not user input — but
  // JSON-encode it anyway so a stray quote can't break out of the attribute.
  const safeSpec = JSON.stringify(specPath)
  const safeTitle = escapeHtml(title)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: ${safeSpec},
        dom_id: '#swagger-ui',
        deepLinking: true,
      })
    }
  </script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
