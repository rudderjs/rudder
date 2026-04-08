export const en = {
  // Layout
  signOut:         'Sign out',

  // Table toolbar
  newButton:       '+ New :label',
  search:          'Search :label\u2026',
  searchButton:    'Search',
  actions:         'Actions',
  edit:            'Edit',
  view:            'View',
  clearFilters:    'Clear filters',
  selected:        ':n selected',
  clearSelection:  'Clear',
  viewAll:         'View all \u2192',
  newRecord:       '+ New',

  // Empty states
  noResultsTitle:  'No results',
  noResultsHint:   'Try adjusting your search or filters.',
  noRecordsTitle:  'No :label yet',
  createFirstLink: 'Create your first :singular',
  noRecordsFound:  'No records found.',
  recordNotFound:  'Record not found.',

  // Pagination
  records:         ':n records',
  page:            'Page :current of :last',
  perPage:         ':n / page',
  loadMore:        'Load more',
  showing:         'Showing :n of :total',

  // Boolean
  yes:             'Yes',
  no:              'No',

  // Confirm / delete
  areYouSure:      'Are you sure?',
  deleteRecord:    'Delete record',
  deleteConfirm:   'This action cannot be undone.',
  confirm:         'Confirm',
  cancel:          'Cancel',

  // Form buttons
  save:            'Save Changes',
  create:          'Create :singular',
  saving:          'Saving\u2026',
  creating:        'Creating\u2026',

  // Loading / progress
  loading:         'Loading\u2026',
  uploading:       'Uploading\u2026',
  loadingForm:     'Loading form\u2026',

  // Navigation
  backTo:          '\u2190 Back to :label',

  // Toasts
  createdToast:    ':singular created successfully.',
  savedToast:      'Changes saved.',
  deletedToast:    ':singular deleted.',
  saveError:       'Failed to save. Please try again.',
  createError:     'Something went wrong. Please try again.',
  deleteError:     'Failed to delete. Please try again.',

  // Duplicate
  duplicate:           'Duplicate',

  // Bulk delete
  deleteSelected:      'Delete :n selected',
  bulkDeleteConfirm:   'This will permanently delete :n records. This action cannot be undone.',
  bulkDeletedToast:    ':n records deleted.',

  // Field UI
  none:            '\u2014 None \u2014',
  invalidJson:     'Invalid JSON',
  addItem:         'Add item',
  addBlock:        'Add block',
  addTag:          'Add tag\u2026',
  addMore:         'Add more\u2026',
  remove:          'Remove',
  item:            'Item :n',
  moveUp:          'Move up',
  moveDown:        'Move down',
  confirmPassword: 'Confirm password',
  createOption:    'Create ":query"',
  createNew:       'Create new :singular',

  // Global search
  globalSearch:         'Search everything\u2026',
  globalSearchShortcut: '\u2318K',
  globalSearchEmpty:    'No results for ":query"',

  // Versioning & collaboration
  publish:              'Publish',
  publishing:           'Publishing\u2026',
  publishedToast:       'Version published.',
  publishError:         'Failed to publish. Please try again.',
  versionHistory:       'Version History',
  noVersions:           'No versions yet.',
  restore:              'Restore',
  restoredToast:        'Version restored.',
  restoreError:         'Failed to restore version.',
  connectedLive:        'Connected',
  disconnectedLive:     'Disconnected',
  editingNow:           ':n editing',
  trash:                'Trash',
  viewTrash:            'View Trash',
  exitTrash:            'View All',
  restoreRecord:        'Restore',
  restoredRecordToast:  'Record restored.',
  forceDelete:          'Delete Permanently',
  forceDeleteConfirm:   'This will permanently delete the record. This action cannot be undone.',
  forceDeletedToast:    'Permanently deleted.',
  bulkRestore:          'Restore Selected',
  bulkForceDelete:      'Delete Permanently',
  trashedBanner:        'You are viewing trashed records.',
  draft:                'Draft',
  published:            'Published',
  saveDraft:            'Save Draft',
  savingDraft:          'Saving\u2026',
  savedDraftToast:      'Draft saved.',
  publishButton:        'Publish',
  publishingButton:     'Publishing\u2026',
  publishedToastDraft:  'Published successfully.',
  unpublish:            'Unpublish',
  unpublishedToast:     'Unpublished — record is now a draft.',
  draftBadge:           'Draft',
  publishedBadge:       'Published',

  // Autosave & persist
  autosaved:            'Saved',
  autosaving:           'Saving\u2026',
  unsavedChanges:       'Unsaved changes',
  restoreDraft:         'You have unsaved changes from :time. Restore them?',
  restoreDraftButton:   'Restore',
  discardDraft:         'Discard',
  unsavedWarning:       'You have unsaved changes. Are you sure you want to leave?',

  // AI quick actions (built-in PanelAgents registered in PanelServiceProvider.register())
  aiAction_rewrite:      'Rewrite',
  aiAction_shorten:      'Shorten',
  aiAction_expand:       'Expand',
  aiAction_fixGrammar:   'Fix grammar',
  aiAction_translate:    'Translate',
  aiAction_summarize:    'Summarize',
  aiAction_makeFormal:   'Make formal',
  aiAction_simplify:     'Simplify',

  // Dashboard
  customizeDashboard:   'Customize',
  doneDashboard:        'Done',
  addWidget:            '+ Add Widget',
  removeWidget:         'Remove',
  widgetSmall:          'S',
  widgetMedium:         'M',
  widgetLarge:          'L',
  noWidgets:            'No widgets added yet.',
  availableWidgets:     'Available Widgets',
}

export type PanelI18n = typeof en
