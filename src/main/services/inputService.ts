import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AppError } from '../security/errors'

const execFileAsync = promisify(execFile)

const TYPE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class IgrisInput {
  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public int type; public InputUnion U; public static int Size { get { return Marshal.SizeOf(typeof(INPUT)); } } }
  [StructLayout(LayoutKind.Explicit)]
  struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [DllImport("user32.dll", SetLastError=true)]
  static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  public static void TypeText(string text) {
    foreach (char ch in text) {
      INPUT[] inputs = new INPUT[2];
      inputs[0].type = 1; inputs[0].U.ki.wScan = (ushort)ch; inputs[0].U.ki.dwFlags = 0x0004;
      inputs[1].type = 1; inputs[1].U.ki.wScan = (ushort)ch; inputs[1].U.ki.dwFlags = 0x0004 | 0x0002;
      if (SendInput((uint)inputs.Length, inputs, INPUT.Size) != inputs.Length) {
        throw new Exception("SendInput failed");
      }
    }
  }
}
"@
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:IGRIS_TEXT_B64))
[IgrisInput]::TypeText($text)
`

const KEYS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$spec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:IGRIS_KEYS_B64))
$shell = New-Object -ComObject WScript.Shell
$shell.SendKeys($spec)
`

const CLICK_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class IgrisMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
}
"@
[IgrisMouse]::Click([int]$env:IGRIS_CLICK_X, [int]$env:IGRIS_CLICK_Y)
`

const MODIFIER_MAP: Record<string, string> = {
  CTRL: '^',
  CONTROL: '^',
  SHIFT: '+',
  ALT: '%'
}

const KEY_MAP: Record<string, string> = {
  ENTER: '{ENTER}',
  RETURN: '{ENTER}',
  TAB: '{TAB}',
  ESC: '{ESC}',
  ESCAPE: '{ESC}',
  SPACE: ' ',
  BACKSPACE: '{BACKSPACE}',
  DELETE: '{DELETE}',
  INSERT: '{INSERT}',
  HOME: '{HOME}',
  END: '{END}',
  PAGEUP: '{PGUP}',
  PAGEDOWN: '{PGDN}',
  UP: '{UP}',
  DOWN: '{DOWN}',
  LEFT: '{LEFT}',
  RIGHT: '{RIGHT}',
  F1: '{F1}', F2: '{F2}', F3: '{F3}', F4: '{F4}', F5: '{F5}', F6: '{F6}',
  F7: '{F7}', F8: '{F8}', F9: '{F9}', F10: '{F10}', F11: '{F11}', F12: '{F12}',
  F13: '{F13}', F14: '{F14}', F15: '{F15}', F16: '{F16}',
  PRINTSCREEN: '{PRTSC}',
  CAPSLOCK: '{CAPSLOCK}'
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

async function runPowerShell(script: string, env: Record<string, string>): Promise<void> {
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        timeout: 20000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
        env: { ...process.env, ...env }
      }
    )
  } catch (error) {
    throw new AppError(
      'INTERNAL',
      'Windows did not apply the input action. Some apps and elevated windows block simulated input.',
      { cause: error }
    )
  }
}

export function parseKeySpec(keys: string): string {
  const input = keys.trim().toUpperCase()
  if (!input || input.length > 80) {
    throw new AppError('VALIDATION', 'Enter a key combination such as CTRL+S or ENTER.')
  }
  const parts = input.split('+').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) throw new AppError('VALIDATION', 'Enter a key combination.')
  const modifiers: string[] = []
  let keyPart: string | null = null
  for (const part of parts) {
    if (MODIFIER_MAP[part]) {
      if (keyPart) throw new AppError('VALIDATION', 'Place modifiers before the key, e.g. CTRL+S.')
      modifiers.push(MODIFIER_MAP[part] ?? '')
    } else {
      if (keyPart) throw new AppError('VALIDATION', 'Only one non-modifier key is allowed.')
      keyPart = part
    }
  }
  if (!keyPart) throw new AppError('VALIDATION', 'Add a key after the modifiers, e.g. CTRL+S.')
  let rendered = KEY_MAP[keyPart]
  if (!rendered && /^[A-Z0-9]$/.test(keyPart)) rendered = keyPart.toLowerCase()
  if (!rendered) {
    throw new AppError('VALIDATION', `"${keyPart}" is not an allowed key for simulated input.`)
  }
  return `${modifiers.join('')}${rendered}`
}

export class InputService {
  async typeText(text: string): Promise<void> {
    if (!text) throw new AppError('VALIDATION', 'There is no text to type.')
    if (text.length > 2000) throw new AppError('VALIDATION', 'Simulated typing is limited to 2000 characters.')
    if (text.includes('\0')) throw new AppError('VALIDATION', 'That text contains invalid characters.')
    await runPowerShell(TYPE_SCRIPT, { IGRIS_TEXT_B64: encode(text) })
  }

  async pressKeys(keys: string): Promise<string> {
    const spec = parseKeySpec(keys)
    await runPowerShell(KEYS_SCRIPT, { IGRIS_KEYS_B64: encode(spec) })
    return spec
  }

  async click(x: number, y: number): Promise<void> {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 32000 || y > 32000) {
      throw new AppError('VALIDATION', 'Enter valid screen coordinates.')
    }
    await runPowerShell(CLICK_SCRIPT, {
      IGRIS_CLICK_X: String(Math.round(x)),
      IGRIS_CLICK_Y: String(Math.round(y))
    })
  }
}
