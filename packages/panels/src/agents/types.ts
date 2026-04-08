/** Serialised agent metadata sent to the client via the resource meta endpoint. */
export interface PanelAgentMeta {
  slug:   string
  label:  string
  icon?:  string | undefined
  fields: string[]
}
