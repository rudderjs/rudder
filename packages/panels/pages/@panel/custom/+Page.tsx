export default function CustomPage() {
  return (
    <div className="max-w-2xl p-6">
      <h1 className="text-2xl font-semibold mb-2">Custom Page</h1>
      <p className="text-muted-foreground">
        This is a custom page registered via <code className="font-mono text-sm bg-muted px-1.5 py-0.5 rounded">.pages([CustomPage])</code> on the panel.
      </p>
    </div>
  )
}
