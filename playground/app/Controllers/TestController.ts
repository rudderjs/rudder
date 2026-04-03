import { Controller, Get, Post, Middleware } from '@rudderjs/router'
import { RateLimit } from '@rudderjs/middleware'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

const limit = RateLimit.perMinute(30)

@Controller('/api/test')
export class TestController {
  @Get('/ping')
  ping(_req: AppRequest, res: AppResponse) {
    return res.json({ message: 'pong', source: 'decorator routing' })
  }

  @Post('/echo')
  @Middleware([limit])
  echo(req: AppRequest, res: AppResponse) {
    return res.json({ received: req.body })
  }
}
