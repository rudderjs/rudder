import { Injectable } from '@rudderjs/core'
import { User } from '../Models/User.js'

@Injectable()
export class UserService {
  findAll() {
    return User.all()
  }

  findById(id: string) {
    return User.find(id)
  }

  findAdmins() {
    return User.where('role', 'admin').get()
  }

  create(data: { name: string; email: string; role?: string }) {
    return User.create(data)
  }
}
