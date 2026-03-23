import type { FieldInputProps } from './types.js'

export function RatingInput({ value, onChange }: FieldInputProps) {
  const rating = Number(value) || 0
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className={[
            'text-2xl leading-none transition-colors',
            star <= rating ? 'text-yellow-400' : 'text-muted-foreground/30',
          ].join(' ')}
        >
          ★
        </button>
      ))}
    </div>
  )
}
