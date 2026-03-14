import type { PanelI18n } from '@boostkit/panels'

interface Props {
  draftable:     boolean
  recordStatus:  string | null
  saving:        boolean
  backHref:      string
  onPublish:     () => void
  onUnpublish:   () => void
  i18n:          PanelI18n & Record<string, string>
}

export function FormActions({ draftable, recordStatus, saving, backHref, onPublish, onUnpublish, i18n }: Props) {
  return (
    <div className="flex items-center gap-3 pt-2">
      {draftable ? (
        <>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 border border-border text-sm font-medium rounded-md hover:bg-accent transition-colors disabled:opacity-50"
          >
            {saving ? (i18n.savingDraft ?? 'Saving\u2026') : (i18n.saveDraft ?? 'Save Draft')}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onPublish}
            className="px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? (i18n.publishingButton ?? 'Publishing\u2026') : (i18n.publishButton ?? 'Publish')}
          </button>
          {recordStatus === 'published' && (
            <button
              type="button"
              disabled={saving}
              onClick={onUnpublish}
              className="px-5 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {i18n.unpublish ?? 'Unpublish'}
            </button>
          )}
        </>
      ) : (
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? i18n.saving : i18n.save}
        </button>
      )}
      <a
        href={backHref}
        className="px-5 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {i18n.cancel}
      </a>
    </div>
  )
}
