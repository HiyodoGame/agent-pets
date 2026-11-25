#!/usr/bin/env node
// Claude Code Notification hook -> append-only event file consumed by the
// PetDeck claude adapter. Claude passes one JSON object on stdin when it needs
// the user (permission prompt, idle). This script must never throw and must
// never write to stdout/stderr in a way that changes Claude's behavior.
//
// Install shape (settings.json):
//   "hooks": { "Notification": [{ "hooks": [{ "type": "command", "command":
//     "\"<node>\" \"<this script>\" \"<events.jsonl>\"" }] }] }
import fs from 'node:fs';

const out = process.argv[2];
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    const session = String(input.session_id ?? '');
    if (out && session) {
      const record = {
        ts: Date.now(),
        session_id: session,
        cwd: String(input.cwd ?? ''),
        message: String(input.message ?? '').slice(0, 300),
        notification_type: String(input.notification_type ?? ''),
        event: String(input.hook_event_name ?? 'Notification'),
      };
      fs.appendFileSync(out, `${JSON.stringify(record)}\n`);
    }
  } catch {
    // A hook must never break the host CLI.
  }
  process.exit(0);
});
