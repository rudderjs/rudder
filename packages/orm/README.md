# @boostkit/orm

ORM contracts and base model abstraction used by BoostKit ORM adapters.

## Installation

```bash
pnpm add @boostkit/orm
```

## Usage

```ts
import { Model, ModelRegistry } from '@boostkit/orm'

class User extends Model {
  static override table = 'user'
}

const db = ModelRegistry.getAdapter()
const users = await User.all()
const first = await db.query('user').where('role', 'admin').first()
```

## API Reference

- Query types: `WhereOperator`, `WhereClause`, `OrderClause`, `QueryState`
- `QueryBuilder<T>`
- `PaginatedResult<T>`
- `Model`
- `OrmAdapter`, `OrmAdapterProvider`
- `ModelRegistry`

## Configuration

This package has no runtime config object.

## Notes

- `ModelRegistry.set(adapter)` must be called before using `Model.query()` helpers.
- `Model.getTable()` defaults to lowercase class name + `s`.
