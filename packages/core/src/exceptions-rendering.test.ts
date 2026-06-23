import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AppRequest } from '@rudderjs/contracts'
import { HttpException, wantsJson, renderHttpException, renderServerError } from './exceptions.js'

function makeReq(accept?: string): AppRequest {
  return { headers: accept !== undefined ? { accept } : {} } as unknown as AppRequest
}

describe('wantsJson()', () => {
  it('returns true when the Accept header is absent', () => {
    assert.equal(wantsJson(makeReq()), true)
  })

  it('returns true for Accept: application/json', () => {
    assert.equal(wantsJson(makeReq('application/json')), true)
  })

  it('returns false for Accept: text/html', () => {
    assert.equal(wantsJson(makeReq('text/html')), false)
  })

  it('returns true for a compound Accept: text/html,application/json (JSON wins)', () => {
    assert.equal(wantsJson(makeReq('text/html,application/json')), true)
  })
})

describe('renderHttpException()', () => {
  it('returns a JSON response for a JSON client', async () => {
    const err = new HttpException(404, 'Not Found')
    const res = renderHttpException(err, makeReq('application/json'))

    assert.equal(res.status, 404)
    assert.match(res.headers.get('content-type') ?? '', /application\/json/)
    const body = await res.json() as { message: string; status: number }
    assert.equal(body.message, 'Not Found')
    assert.equal(body.status, 404)
  })

  it('returns an HTML response for an HTML client', async () => {
    const err = new HttpException(403, 'Forbidden')
    const res = renderHttpException(err, makeReq('text/html'))

    assert.equal(res.status, 403)
    assert.match(res.headers.get('content-type') ?? '', /text\/html/)
    const html = await res.text()
    assert.ok(html.includes('403'))
    assert.ok(html.includes('Forbidden'))
  })

  it('forwards custom headers from HttpException onto the Response', () => {
    const err = new HttpException(401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' })
    const res = renderHttpException(err, makeReq('application/json'))

    assert.equal(res.headers.get('WWW-Authenticate'), 'Bearer')
  })

  it('forwards Retry-After header for a 429', () => {
    const err = new HttpException(429, 'Too Many Requests', { 'Retry-After': '60' })
    const res = renderHttpException(err, makeReq('application/json'))

    assert.equal(res.headers.get('Retry-After'), '60')
  })
})

describe('renderServerError()', () => {
  it('returns a JSON 500 for a JSON client in non-debug mode', async () => {
    const res = renderServerError(makeReq('application/json'), false, new Error('secret'))

    assert.equal(res.status, 500)
    assert.match(res.headers.get('content-type') ?? '', /application\/json/)
    const body = await res.json() as { message: string; status: number; exception?: string }
    assert.equal(body.message, 'Internal Server Error')
    assert.equal(body.status, 500)
    assert.equal(body.exception, undefined)
  })

  it('includes exception and trace in JSON debug mode', async () => {
    const err = new Error('debug detail')
    const res = renderServerError(makeReq('application/json'), true, err)

    const body = await res.json() as { exception: string; trace: string[] }
    assert.equal(body.exception, 'debug detail')
    assert.ok(Array.isArray(body.trace))
  })

  it('returns an HTML 500 for an HTML client', async () => {
    const res = renderServerError(makeReq('text/html'), false, new Error('oops'))

    assert.equal(res.status, 500)
    assert.match(res.headers.get('content-type') ?? '', /text\/html/)
    const html = await res.text()
    assert.ok(html.includes('500'))
    assert.ok(html.includes('Internal Server Error'))
  })

  it('includes the stack in the HTML debug page', async () => {
    const err = new Error('stack visible')
    const res = renderServerError(makeReq('text/html'), true, err)

    const html = await res.text()
    assert.ok(html.includes('stack visible'))
  })
})
