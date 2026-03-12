interface Props {
  code: string; language: string
  onChange: (patch: Record<string, unknown>) => void
  disabled?: boolean
}

export function CodeBlock({ code, language, onChange, disabled }: Props) {
  return (
    <div className="rounded-lg border bg-muted/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
        <input
          type="text"
          value={language}
          onChange={(e) => onChange({ language: e.target.value })}
          placeholder="language"
          className="text-xs bg-transparent border-none outline-none text-muted-foreground w-24"
          disabled={disabled}
        />
      </div>
      <textarea
        value={code}
        onChange={(e) => onChange({ code: e.target.value })}
        className="w-full p-3 text-sm font-mono bg-transparent resize-none outline-none min-h-[80px]"
        disabled={disabled}
        spellCheck={false}
      />
    </div>
  )
}
