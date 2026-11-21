import { expect, test } from 'bun:test'
import { apply_continuation, create_continuation, next_continuation } from '../src/services/continuation'
import type { TContinuationAction, TContinuationRole, TRequirement } from '../src/types/continuation'

const room = (requirement: TRequirement = 'either') => {
  let state = create_continuation('room', 1, [
    { point_id: 'A', requirement: 'spoken' },
    { point_id: 'B', requirement },
    { point_id: 'C', requirement: 'spoken' },
  ])
  let n = 0
  const send = (role: TContinuationRole, action: TContinuationAction, revision = state.revision) => {
    state = apply_continuation(state, role, {
      session_id: 'room', expected_revision: revision, generation: state.generation,
      event_id: 'event-' + ++n, action,
    })
  };
  const start = (point_id: string) => {
    send('host', { kind: 'play', point_id, attempt_id: point_id + '-audio', asset_id: point_id + '-clip' })
  };
  const end = (point_id: string, natural: boolean) => {
    send('player', { kind: 'playout', attempt_id: point_id + '-audio', asset_id: point_id + '-clip', natural, certain: natural })
  };
  start('A')
  end('A', true)
  start('B')
  end('B', false)
  send('host', { kind: 'prepare', point_id: 'B', attempt_id: 'demo' })
  return { send, state: () => state, next: () => next_continuation(state) }
};

for (const observed of ['setup', 'login'] as const) {
  test('same interrupted narration and conditional setup request with ' + observed, () => {
    const r = room()
    if (observed === 'setup') {
      r.send('worker', { kind: 'observed', attempt_id: 'demo', outcome: 'setup', frame_id: 'frame' })
      expect(r.next()).toEqual({ kind: 'speak', point_id: 'B' })
      r.send('stage', { kind: 'paint', attempt_id: 'demo', frame_id: 'frame', visible: true })
    } else {
      r.send('worker', { kind: 'observed', attempt_id: 'demo', outcome: 'login' })
      expect(() => r.send('stage', { kind: 'paint', attempt_id: 'demo', frame_id: 'frame', visible: true })).toThrow()
    }
    expect(r.next()).toEqual({ kind: 'speak', point_id: observed === 'setup' ? 'C' : 'B' })
    expect(r.state().points[1].spoken).toBe('partial')
    expect(r.state().points[1].demo).toBe(observed === 'setup' ? 'displayed' : 'blocked')
  })
}

test('both objectives remain independently due', () => {
  const r = room('both')
  r.send('worker', { kind: 'observed', attempt_id: 'demo', outcome: 'setup', frame_id: 'frame' })
  expect(() => r.send('host', { kind: 'paint', attempt_id: 'demo', frame_id: 'frame', visible: true })).toThrow()
  expect(() => r.send('stage', { kind: 'paint', attempt_id: 'demo', frame_id: 'other', visible: true })).toThrow()
  expect(() => r.send('stage', { kind: 'paint', attempt_id: 'demo', frame_id: 'frame', visible: false })).toThrow()
  r.send('stage', { kind: 'paint', attempt_id: 'demo', frame_id: 'frame', visible: true })
  expect(r.next()).toEqual({ kind: 'speak', point_id: 'B' })
})

test('interrupted audio cannot later complete and stale events cannot satisfy coverage', () => {
  const r = room()
  expect(() => r.send('player', { kind: 'playout', attempt_id: 'B-audio', asset_id: 'B-clip', natural: true, certain: true })).toThrow()
  expect(() => r.send('worker', { kind: 'observed', attempt_id: 'demo', outcome: 'login' }, 0)).toThrow()
  r.send('host', { kind: 'cancel_demo', attempt_id: 'demo' })
  expect(() => r.send('worker', { kind: 'observed', attempt_id: 'demo', outcome: 'setup', frame_id: 'late' })).toThrow()
  expect(r.next()).toEqual({ kind: 'speak', point_id: 'B' })
  r.send('host', { kind: 'skip', point_id: 'B' })
  expect(r.next()).toEqual({ kind: 'speak', point_id: 'C' })
  r.send('host', { kind: 'revisit', point_id: 'A' })
  expect(r.next()).toEqual({ kind: 'speak', point_id: 'A' })
})

test('required blocked demonstration remains actionable after its explanation completes', () => {
  const r = room('both')
  r.send('worker', { kind: 'observed', attempt_id: 'demo', outcome: 'login' })
  r.send('host', { kind: 'play', point_id: 'B', attempt_id: 'retry-audio', asset_id: 'B-clip' })
  expect(() => r.send('worker', { kind: 'playout', attempt_id: 'retry-audio', asset_id: 'B-clip', natural: true, certain: true })).toThrow()
  r.send('player', { kind: 'playout', attempt_id: 'retry-audio', asset_id: 'B-clip', natural: true, certain: true })
  expect(r.next()).toEqual({ kind: 'retry_or_skip', point_id: 'B' })
})

test('cutoff uncertainty and forced stop leave the whole claim replayable', () => {
  const r = room()
  r.send('host', { kind: 'play', point_id: 'B', attempt_id: 'edge', asset_id: 'B-clip' })
  r.send('player', { kind: 'playout', attempt_id: 'edge', asset_id: 'B-clip', natural: true, certain: false })
  expect(r.state().points[1].spoken).toBe('partial')
  r.send('host', { kind: 'play', point_id: 'B', attempt_id: 'manual', asset_id: 'B-clip' })
  r.send('host', { kind: 'interrupt', attempt_id: 'manual' })
  expect(() => r.send('player', { kind: 'playout', attempt_id: 'manual', asset_id: 'B-clip', natural: true, certain: true })).toThrow()
  expect(r.next()).toEqual({ kind: 'speak', point_id: 'B' })
})
