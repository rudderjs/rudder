export const INSPECTOR_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>MCP Inspector</title>
<style>
  :root {
    --bg: #0f1115;
    --surface: #1a1d24;
    --border: #2a2f3a;
    --text: #e4e6eb;
    --muted: #8a919e;
    --accent: #5c9cf5;
    --error: #ff7b7b;
    --success: #8be78b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font: 14px/1.5 system-ui, sans-serif;
    background: var(--bg); color: var(--text);
    display: grid; grid-template-columns: 280px 1fr; height: 100vh;
  }
  aside {
    background: var(--surface); border-right: 1px solid var(--border);
    padding: 16px; overflow-y: auto;
  }
  aside h2 { font-size: 11px; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; letter-spacing: .05em; }
  aside ul { list-style: none; padding: 0; margin: 0 0 20px; }
  aside li button {
    display: block; width: 100%; text-align: left;
    padding: 8px 12px; margin-bottom: 2px; border: 0; border-radius: 6px;
    background: transparent; color: var(--text); font: inherit; cursor: pointer;
  }
  aside li button:hover { background: rgba(255,255,255,.04); }
  aside li button.active { background: var(--accent); color: #fff; }
  main { padding: 24px 32px; overflow-y: auto; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .meta { color: var(--muted); margin-bottom: 24px; }
  section { margin-bottom: 32px; }
  section h3 { font-size: 12px; text-transform: uppercase; color: var(--muted); margin: 0 0 12px; letter-spacing: .05em; }
  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 14px 16px; margin-bottom: 8px;
  }
  .card-head { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
  .card-head strong { color: var(--text); }
  .card-head span { color: var(--muted); font-size: 13px; }
  .card-body { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px; }
  .card-body[hidden] { display: none; }
  textarea, input {
    width: 100%; font: 12px ui-monospace, monospace; padding: 8px; border-radius: 6px;
    background: var(--bg); color: var(--text); border: 1px solid var(--border); resize: vertical;
  }
  button.run {
    margin-top: 10px; padding: 6px 14px; background: var(--accent); color: #fff; border: 0;
    border-radius: 6px; cursor: pointer; font: 13px system-ui;
  }
  button.run:hover { filter: brightness(1.1); }
  pre {
    background: var(--bg); padding: 12px; border-radius: 6px; overflow-x: auto;
    font: 12px ui-monospace, monospace; margin: 10px 0 0; max-height: 320px; overflow-y: auto;
  }
  .response.error { color: var(--error); }
  .response.ok { color: var(--success); }
  .empty { color: var(--muted); font-style: italic; }
  .pill {
    display: inline-block; padding: 1px 6px; border-radius: 3px; background: var(--border);
    color: var(--muted); font-size: 11px; margin-left: 6px;
  }
</style>
</head>
<body>

<aside>
  <h1 style="font-size:15px;margin:0 0 20px;">⚡ MCP Inspector</h1>
  <h2>Web servers</h2>
  <ul id="web-list"></ul>
  <h2>Local servers</h2>
  <ul id="local-list"></ul>
</aside>

<main id="main">
  <p class="empty">Select a server from the sidebar.</p>
</main>

<script>
async function api(path, options) {
  const r = await fetch(path, options)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText)
  return r.json()
}

function el(tag, attrs, ...children) {
  const n = document.createElement(tag)
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v
    else if (k.startsWith('on')) n[k] = v
    else if (v !== undefined && v !== null) n.setAttribute(k, v)
  }
  for (const c of children) {
    if (c == null) continue
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return n
}

let activeKey = null

async function refreshList() {
  const { web, local } = await api('/api/servers')
  const render = (items, ul) => {
    ul.innerHTML = ''
    if (items.length === 0) {
      ul.appendChild(el('li', { class: 'empty' }, '(none)'))
      return
    }
    for (const s of items) {
      ul.appendChild(el('li', null, el('button', {
        class: s.key === activeKey ? 'active' : '',
        onclick: () => openServer(s.key),
      }, s.label)))
    }
  }
  render(web, document.getElementById('web-list'))
  render(local, document.getElementById('local-list'))
}

async function openServer(key) {
  activeKey = key
  await refreshList()
  const main = document.getElementById('main')
  main.innerHTML = 'Loading…'
  try {
    const detail = await api('/api/servers/' + encodeURIComponent(key))
    main.innerHTML = ''
    main.appendChild(el('h1', null, detail.metadata.name || detail.label))
    main.appendChild(el('div', { class: 'meta' },
      'v' + detail.metadata.version + ' · ' + detail.kind + ' · ' + detail.key,
    ))
    if (detail.metadata.instructions) main.appendChild(el('p', { class: 'meta' }, detail.metadata.instructions))
    renderTools(main, key, detail.tools)
    renderResources(main, key, detail.resources)
    renderPrompts(main, key, detail.prompts)
  } catch (err) {
    main.innerHTML = ''
    main.appendChild(el('p', { class: 'response error' }, err.message))
  }
}

function renderTools(container, key, tools) {
  container.appendChild(el('section', null,
    el('h3', null, 'Tools (' + tools.length + ')'),
    ...(tools.length === 0 ? [el('p', { class: 'empty' }, 'No tools.')] : tools.map((t) => toolCard(key, t))),
  ))
}

function toolCard(key, t) {
  const inputEl = el('textarea', { rows: 4, 'aria-label': 'input' })
  inputEl.value = JSON.stringify(defaultFromSchema(t.inputSchema), null, 2)
  const outEl = el('pre', { class: 'response' })
  outEl.hidden = true
  const body = el('div', { class: 'card-body', hidden: true },
    el('div', { class: 'meta' }, t.description || '(no description)'),
    el('label', null, 'Input JSON'), inputEl,
    el('button', {
      class: 'run',
      onclick: async () => {
        outEl.hidden = false
        outEl.className = 'response'
        outEl.textContent = 'Running…'
        try {
          const input = JSON.parse(inputEl.value)
          const r = await api('/api/servers/' + encodeURIComponent(key) + '/tools/' + encodeURIComponent(t.name), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          })
          outEl.className = 'response ' + (r.isError ? 'error' : 'ok')
          outEl.textContent = JSON.stringify(r, null, 2)
        } catch (e) {
          outEl.className = 'response error'
          outEl.textContent = e.message
        }
      },
    }, 'Call tool'),
    outEl,
  )
  const head = el('div', { class: 'card-head', onclick: () => { body.hidden = !body.hidden } },
    el('strong', null, t.name),
    el('span', null, (t.description || '').slice(0, 60)),
  )
  return el('div', { class: 'card' }, head, body)
}

function renderResources(container, key, resources) {
  container.appendChild(el('section', null,
    el('h3', null, 'Resources (' + resources.length + ')'),
    ...(resources.length === 0 ? [el('p', { class: 'empty' }, 'No resources.')] : resources.map((r) => resourceCard(key, r))),
  ))
}

function resourceCard(key, r) {
  const uriEl = el('input', { value: r.uri, 'aria-label': 'uri' })
  const outEl = el('pre', { class: 'response' })
  outEl.hidden = true
  const body = el('div', { class: 'card-body', hidden: true },
    el('label', null, 'URI' + (r.template ? ' (template — fill in {placeholders})' : '')),
    uriEl,
    el('button', {
      class: 'run',
      onclick: async () => {
        outEl.hidden = false
        outEl.className = 'response'
        outEl.textContent = 'Loading…'
        try {
          const r2 = await api('/api/servers/' + encodeURIComponent(key) + '/resource?uri=' + encodeURIComponent(uriEl.value))
          outEl.className = 'response ok'
          outEl.textContent = JSON.stringify(r2, null, 2)
        } catch (e) {
          outEl.className = 'response error'
          outEl.textContent = e.message
        }
      },
    }, 'Read resource'),
    outEl,
  )
  return el('div', { class: 'card' },
    el('div', { class: 'card-head', onclick: () => { body.hidden = !body.hidden } },
      el('strong', null, r.uri),
      el('span', null, (r.description || '') + (r.template ? ' · template' : '')),
    ),
    body,
  )
}

function renderPrompts(container, key, prompts) {
  container.appendChild(el('section', null,
    el('h3', null, 'Prompts (' + prompts.length + ')'),
    ...(prompts.length === 0 ? [el('p', { class: 'empty' }, 'No prompts.')] : prompts.map((p) => promptCard(key, p))),
  ))
}

function promptCard(key, p) {
  const argsEl = el('textarea', { rows: 3, 'aria-label': 'arguments' })
  argsEl.value = JSON.stringify(p.argumentSchema ? defaultFromSchema(p.argumentSchema) : {}, null, 2)
  const outEl = el('pre', { class: 'response' })
  outEl.hidden = true
  const body = el('div', { class: 'card-body', hidden: true },
    el('div', { class: 'meta' }, p.description || '(no description)'),
    el('label', null, 'Arguments JSON'), argsEl,
    el('button', {
      class: 'run',
      onclick: async () => {
        outEl.hidden = false
        outEl.className = 'response'
        outEl.textContent = 'Running…'
        try {
          const args = JSON.parse(argsEl.value)
          const r = await api('/api/servers/' + encodeURIComponent(key) + '/prompts/' + encodeURIComponent(p.name), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
          })
          outEl.className = 'response ok'
          outEl.textContent = JSON.stringify(r, null, 2)
        } catch (e) {
          outEl.className = 'response error'
          outEl.textContent = e.message
        }
      },
    }, 'Get prompt'),
    outEl,
  )
  return el('div', { class: 'card' },
    el('div', { class: 'card-head', onclick: () => { body.hidden = !body.hidden } },
      el('strong', null, p.name),
      el('span', null, (p.description || '').slice(0, 60)),
    ),
    body,
  )
}

function defaultFromSchema(schema) {
  if (!schema || schema.type !== 'object' || !schema.properties) return {}
  const out = {}
  for (const [k, v] of Object.entries(schema.properties)) {
    if (v.type === 'string') out[k] = ''
    else if (v.type === 'number' || v.type === 'integer') out[k] = 0
    else if (v.type === 'boolean') out[k] = false
    else if (v.type === 'array') out[k] = []
    else out[k] = null
  }
  return out
}

refreshList()
</script>
</body>
</html>`
