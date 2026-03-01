import { z } from 'zod'

export const TodoInputSchema = z.object({
  title:     z.string().min(1, 'Title is required'),
  completed: z.boolean().optional().default(false),
})

export const TodoUpdateSchema = z.object({
  title:     z.string().min(1).optional(),
  completed: z.boolean().optional(),
})

export type TodoInput  = z.infer<typeof TodoInputSchema>
export type TodoUpdate = z.infer<typeof TodoUpdateSchema>

export interface Todo {
  id:        string
  title:     string
  completed: boolean
  createdAt: Date
  updatedAt: Date
}
