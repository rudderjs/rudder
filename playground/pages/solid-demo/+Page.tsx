import { createSignal } from 'solid-js'

export default function Page() {
  const [count, setCount] = createSignal(0)

  return (
    <div style={{ 'font-family': 'sans-serif', 'max-width': '480px', margin: '80px auto', 'text-align': 'center' }}>
      <h1 style={{ 'font-size': '2rem', 'font-weight': 'bold', 'margin-bottom': '8px' }}>Solid Demo</h1>
      <p style={{ color: '#666', 'margin-bottom': '32px' }}>
        This page is rendered with <strong>SolidJS</strong> via <code>vike-solid</code>.<br />
        The rest of the app uses React — per-page <code>+config.ts</code> controls the framework.
      </p>

      <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', gap: '16px' }}>
        <button
          style={{ padding: '8px 20px', 'border-radius': '6px', border: '1px solid #ccc', cursor: 'pointer', 'font-size': '1rem' }}
          onClick={() => setCount(c => c - 1)}
        >−</button>
        <span style={{ 'font-size': '1.5rem', 'font-weight': '600', 'min-width': '40px' }}>{count()}</span>
        <button
          style={{ padding: '8px 20px', 'border-radius': '6px', border: '1px solid #ccc', cursor: 'pointer', 'font-size': '1rem' }}
          onClick={() => setCount(c => c + 1)}
        >+</button>
      </div>

      <p style={{ 'margin-top': '40px' }}>
        <a href="/" style={{ color: '#888', 'font-size': '0.9rem' }}>← Back to home</a>
      </p>
    </div>
  )
}
