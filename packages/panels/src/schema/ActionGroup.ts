import { Action } from './Action.js'
import type { ActionMeta } from './Action.js'
import { toTitleCase } from './utils.js'

export interface ActionGroupMeta {
  name:    string
  label:   string
  icon:    string | undefined
  actions: ActionMeta[]
}

/**
 * Groups multiple actions into a dropdown menu.
 *
 * @example
 * ActionGroup.make('more')
 *   .label('More Actions')
 *   .icon('more-horizontal')
 *   .actions([
 *     Action.make('archive').handler(async (records) => { ... }),
 *     Action.make('export').handler(async (records) => { ... }),
 *   ])
 */
export class ActionGroup {
  protected _name:    string
  protected _label:   string | undefined
  protected _icon?:   string
  protected _actions: Action[] = []

  constructor(name: string) {
    this._name = name
  }

  static make(name: string): ActionGroup {
    return new ActionGroup(name)
  }

  label(label: string): this {
    this._label = label
    return this
  }

  icon(icon: string): this {
    this._icon = icon
    return this
  }

  actions(actions: Action[]): this {
    this._actions = actions
    return this
  }

  getName(): string { return this._name }

  getLabel(): string {
    if (this._label) return this._label
    return toTitleCase(this._name)
  }

  getActions(): Action[] { return this._actions }

  toMeta(): ActionGroupMeta {
    return {
      name:    this._name,
      label:   this.getLabel(),
      icon:    this._icon,
      actions: this._actions.map(a => a.toMeta()),
    }
  }
}
