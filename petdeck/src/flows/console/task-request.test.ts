import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldCommitTaskRequest } from './task-request.ts'

test('task request: only the current task and generation may commit', () => {
  const request = { taskId: 'task-a', revision: 3 }
  assert.equal(shouldCommitTaskRequest(request, 'task-a', 3), true)
  assert.equal(shouldCommitTaskRequest(request, 'task-b', 4), false, 'old task response must not enter a new task')
  assert.equal(shouldCommitTaskRequest(request, 'task-a', 4), false, 'an earlier generation is stale even for the same task')
  assert.equal(shouldCommitTaskRequest(request, null, 3), false, 'unmounted pages cannot commit')
})
