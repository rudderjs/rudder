export type ConditionOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not_in' | 'truthy' | 'falsy'

export interface Condition {
  type:  'show' | 'hide' | 'disabled'
  field: string
  op:    ConditionOp
  value: unknown
}

export function evalCondition(cond: Condition, values: Record<string, unknown>): boolean {
  const val = values[cond.field]
  switch (cond.op) {
    case '=':       return val === cond.value
    case '!=':      return val !== cond.value
    case '>':       return (val as number)  >  (cond.value as number)
    case '>=':      return (val as number)  >= (cond.value as number)
    case '<':       return (val as number)  <  (cond.value as number)
    case '<=':      return (val as number)  <= (cond.value as number)
    case 'in':      return (cond.value as unknown[]).includes(val)
    case 'not_in':  return !(cond.value as unknown[]).includes(val)
    case 'truthy':  return !!val
    case 'falsy':   return !val
    default:        return true
  }
}

export function isFieldVisible(field: { conditions?: Condition[] }, values: Record<string, unknown>): boolean {
  if (!field.conditions?.length) return true
  for (const cond of field.conditions) {
    const match = evalCondition(cond, values)
    if (cond.type === 'show' && !match) return false
    if (cond.type === 'hide' &&  match) return false
  }
  return true
}

export function isFieldDisabled(field: { conditions?: Condition[] }, values: Record<string, unknown>): boolean {
  if (!field.conditions?.length) return false
  return field.conditions
    .filter(c => c.type === 'disabled')
    .some(c => evalCondition(c, values))
}
