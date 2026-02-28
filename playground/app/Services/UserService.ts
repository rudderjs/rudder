import { Injectable } from '@forge/core'

export interface User {
  id:    number
  name:  string
  email: string
  role:  'admin' | 'user'
}

@Injectable()
export class UserService {
  // In a real app this would call the ORM / Prisma
  private readonly users: User[] = [
    { id: 1, name: 'Alice',   email: 'alice@example.com',   role: 'admin' },
    { id: 2, name: 'Bob',     email: 'bob@example.com',     role: 'user'  },
    { id: 3, name: 'Charlie', email: 'charlie@example.com', role: 'user'  },
  ]

  findAll(): User[] {
    return this.users
  }

  findById(id: number): User | undefined {
    return this.users.find(u => u.id === id)
  }

  findAdmins(): User[] {
    return this.users.filter(u => u.role === 'admin')
  }
}
