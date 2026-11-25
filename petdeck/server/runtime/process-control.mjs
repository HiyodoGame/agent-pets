// Windows process-tree suspend/resume for the pause button.
// Uses ntdll's NtSuspendProcess/NtResumeProcess via PowerShell Add-Type — no native
// npm dependency. Other platforms report unsupported instead of pretending.
import { spawnSync } from 'node:child_process';

export function buildProcessControlScript(pid, action) {
  const target = Number(pid);
  if (!Number.isInteger(target) || target <= 0) throw new Error('invalid pid');
  if (action !== 'suspend' && action !== 'resume') throw new Error('invalid action');
  const fn = action === 'suspend' ? 'NtSuspendProcess' : 'NtResumeProcess';
  const ordering = action === 'suspend'
    ? 'if ($ids.Count -gt 0) { $ids.Reverse() }'
    : '# resume root first, then children';
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$source = @'
using System;
using System.Runtime.InteropServices;
public static class PetDeckProcessControl {
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
Add-Type -TypeDefinition $source
$all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId, ParentProcessId
$ids = New-Object System.Collections.Generic.List[int]
$queue = New-Object System.Collections.Generic.Queue[int]
$queue.Enqueue(${target})
while ($queue.Count -gt 0) {
  $current = $queue.Dequeue()
  if ($ids.Contains($current)) { continue }
  $ids.Add($current)
  foreach ($child in $all) {
    if ([int]$child.ParentProcessId -eq $current) { $queue.Enqueue([int]$child.ProcessId) }
  }
}
${ordering}
$failed = 0
foreach ($processId in $ids) {
  $handle = [PetDeckProcessControl]::OpenProcess(0x0800, $false, $processId)
  if ($handle -eq [IntPtr]::Zero) { $failed += 1; continue }
  try {
    $result = [PetDeckProcessControl]::${fn}($handle)
    if ($result -ne 0) { $failed += 1 }
  } finally {
    [void][PetDeckProcessControl]::CloseHandle($handle)
  }
}
if ($failed -gt 0) { exit 3 }
`;
}

function failureDetail(stderr, status) {
  // A redirected stderr makes Windows PowerShell wrap progress/error records in
  // CLIXML, which is unreadable in the task page. Keep only plain text lines.
  const raw = String(stderr ?? '');
  const plain = raw.includes('#< CLIXML')
    ? raw.split(/\r?\n/).filter((line) => line && !line.startsWith('#< CLIXML') && !line.startsWith('<')).join(' ')
    : raw;
  const text = plain.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 500) : 'exit ' + status;
}

export function controlProcessTree(pid, action, { platform = process.platform, spawnImpl = spawnSync, timeoutMs = 20_000 } = {}) {
  if (platform !== 'win32') {
    return { ok: false, code: 'unsupported-platform', detail: 'pause is only implemented on Windows' };
  }
  const script = buildProcessControlScript(pid, action);
  // Windows PowerShell 5.1 fed via `-Command -` lets the C# here-string swallow
  // the rest of stdin: the script exits 0 without ever calling ntdll, so the task
  // would be marked paused while the agent kept running. -EncodedCommand runs the
  // exact script with no temp file and no stdin parsing.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
  });
  if (result?.error) return { ok: false, code: 'spawn-error', detail: result.error.message };
  if (result?.status !== 0) {
    return { ok: false, code: 'control-failed', detail: failureDetail(result?.stderr, result?.status) };
  }
  return { ok: true, code: action === 'suspend' ? 'suspended' : 'resumed' };
}

export function suspendProcessTree(pid, opts = {}) { return controlProcessTree(pid, 'suspend', opts); }
export function resumeProcessTree(pid, opts = {}) { return controlProcessTree(pid, 'resume', opts); }
