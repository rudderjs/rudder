import { Controller, Get, Post } from '@forge/router'
import type { Context } from '@forge/server'
import { TodoService } from './TodoService.js'

@Controller('/todos')
export class TodoController {
  constructor(private service: TodoService) {}

  @Get('/')
  async index(_ctx: Context) {
    const items = await this.service.findAll()
    return { data: items }
  }

  @Get('/:id')
  async show({ params }: Context) {
    const item = await this.service.findById(params!['id'] as string)
    if (!item) return { error: 'Not found' }
    return { data: item }
  }

  @Post('/')
  async store({ body }: Context) {
    const item = await this.service.create(body as any)
    return { data: item }
  }
}
