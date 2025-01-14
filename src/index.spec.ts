import 'mocha'
import { TestScheduler } from 'rxjs/testing'
import { of } from 'rxjs'
import { delay, catchError, switchMap } from 'rxjs/operators'
import { throwError } from 'rxjs/internal/observable/throwError'
import * as chai from 'chai'
import * as sinon from 'sinon'
import * as sinonChai from 'sinon-chai'

import connect, { normalClosureMessage, IWebSocket } from '.'

chai.use(sinonChai)
const { expect } = chai

describe('rxjs-websockets', () => {
  let scheduler: TestScheduler
  let expect$: typeof scheduler.expectObservable
  let flush: typeof scheduler.flush
  let cold: typeof scheduler.createColdObservable
  let hot: typeof scheduler.createHotObservable
  beforeEach(() => {
    scheduler = new TestScheduler(chai.assert.deepEqual)
    expect$ = scheduler.expectObservable.bind(scheduler)
    flush = scheduler.flush.bind(scheduler)
    cold = scheduler.createColdObservable.bind(scheduler)
    hot = scheduler.createHotObservable.bind(scheduler)
  })

  class MockSocket {
    onmessage = (event: any) => {}
    onopen = (event: any) => {}
    onclose = (event: any) => {}
    onerror = (event: any) => {}
    close = sinon.stub()
    // forwards input as output
    send(data: string) { this.onmessage({ data }) }
  }

  const connectHelper = (mockSocket: IWebSocket, protocols: string | string[] = []) =>
    connect('url', { protocols, makeWebSocket: () => mockSocket })

  it('connects to websocket lazily and retrieves data', () => {
    const mockSocket = new MockSocket()
    const socket = connectHelper(mockSocket)
    const input = hot('abcde|')
    expect$(
      of(null).pipe(
        // delay subscription to websocket by 10ms, TODO: find some way to
        // verify the connection is attempted lazily
        delay(10, scheduler),
        switchMap(() => {
          return socket.pipe(
            switchMap(factory => {
              // ensure factory is called when socket is open
              expect(scheduler.now()).to.equal(20)
              return factory(input)
            })
          )
        })
      )
    ).toBe('--cde')

    // websocket opens at 20ms
    scheduler.schedule(() => {
      // if one of the expectations raises an error this won't be defined
      if (mockSocket.onopen)
        mockSocket.onopen({})
    }, 20)

    flush()
  })

  it('closes websocket on unsubscribe', () => {
    const mockSocket = new MockSocket()
    const socket = connectHelper(mockSocket)
    scheduler.schedule(() => mockSocket.onopen({}), 10)

    expect$(
      socket.pipe(switchMap(factory => factory(cold('a|')))),
      '--!',
    ).toBe('-a')
    flush()

    expect(mockSocket.close).to.have.been.calledOnce
  })

  describe('raises Error', () => {
    const runTest = (reason: string, code: number, expectedReason: string) => {
      const mockSocket = new MockSocket()
      const socket = connectHelper(mockSocket)
      scheduler.schedule(() => mockSocket.onopen({}), 10)
      scheduler.schedule(() => mockSocket.onclose({ reason, code }), 30)
      expect$(
        socket.pipe(
          switchMap(factory => factory(cold('a'))),
          // rethrow error as string... can't get expectation to match the error
          catchError(error => throwError(error.message))
        ),
      ).toBe('-a-#', undefined, expectedReason)
      flush()
    }

    it('with message equal to reason on unclean websocket close', () => {
      const reason = 'Freakish closure'
      runTest(reason, 9000, reason)
    })

    it('with normalClosureMessage when socket was closed normally', () => {
      runTest('whatever', 1000, normalClosureMessage)
    });
  })
})
