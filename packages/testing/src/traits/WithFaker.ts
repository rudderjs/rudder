import type { TestCase } from '../TestCase.js'

/**
 * Adds a `faker` instance to the test case for generating test data.
 * Requires `@faker-js/faker` as a peer dependency.
 *
 * @example
 * class UserTest extends TestCase {
 *   use = [WithFaker]
 * }
 *
 * const t = await UserTest.create()
 * const name = t.faker.person.fullName()
 * const email = t.faker.internet.email()
 */
export class WithFaker {
  async setUp(testCase: TestCase): Promise<void> {
    try {
      const { faker } = await import('@faker-js/faker')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(testCase as any).faker = faker
    } catch (err) {
      throw new Error(
        '[RudderJS Testing] WithFaker requires @faker-js/faker. Install it: pnpm add -D @faker-js/faker',
        { cause: err },
      )
    }
  }

  async tearDown(testCase: TestCase): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (testCase as any).faker
  }
}
