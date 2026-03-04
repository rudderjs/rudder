import { Controller, Get, Post, Middleware } from '@boostkit/router'
import { RateLimit } from '@boostkit/middleware'
import type { ForgeRequest, ForgeResponse } from '@boostkit/contracts'

const limit = RateLimit.perMinute(30).toHandler()

@Controller('/api/test')
export class TestController {
  @Get('/ping')
  ping(_req: ForgeRequest, res: ForgeResponse) {
    return res.json({ message: 'pong', source: 'decorator routing' })
  }

  @Post('/echo')
  @Middleware([limit])
  echo(req: ForgeRequest, res: ForgeResponse) {
    return res.json({ received: req.body })
  }
}
