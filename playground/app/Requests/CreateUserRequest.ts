import { FormRequest } from '@boostkit/validation'
import { z } from '@boostkit/validation'

const schema = z.object({
  name:  z.string().min(2, 'Name must be at least 2 characters.'),
  email: z.string().email('Invalid email address.'),
  role:  z.enum(['admin', 'user']).optional().default('user'),
})

export class CreateUserRequest extends FormRequest<typeof schema> {
  rules() { return schema }
}
