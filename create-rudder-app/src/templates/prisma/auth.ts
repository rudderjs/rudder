export function prismaAuth(): string {
  return `model User {
  id            String    @id @default(cuid())
  name          String
  email         String    @unique
  password      String?
  emailVerifiedAt DateTime?
  image         String?
  role          String    @default("user")
  rememberToken String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model PasswordResetToken {
  email     String   @id
  token     String
  createdAt DateTime @default(now())
}
`
}
