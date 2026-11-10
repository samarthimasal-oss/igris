$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Drawing

$igrisSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

public static class IgrisOperator
{
    // ------------------------------------------------------------------ Win32

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT
    {
        public int dx; public int dy; public uint mouseData; public uint dwFlags;
        public uint time; public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk; public ushort wScan; public uint dwFlags;
        public uint time; public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public INPUTUNION u; }

    [StructLayout(LayoutKind.Sequential)]
    struct MONITORINFO
    {
        public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_ELEVATION { public int TokenIsElevated; }

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, IntPtr lprcMonitor, IntPtr data);

    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int infoClass, out TOKEN_ELEVATION info, int length, out int returned);

    const uint INPUT_MOUSE = 0;
    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const uint MOUSEEVENTF_MOVE = 0x0001;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_WHEEL = 0x0800;
    const uint MOUSEEVENTF_HWHEEL = 0x1000;
    const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
    const int SM_XVIRTUALSCREEN = 76;
    const int SM_YVIRTUALSCREEN = 77;
    const int SM_CXVIRTUALSCREEN = 78;
    const int SM_CYVIRTUALSCREEN = 79;
    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOOLWINDOW = 0x00000080;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint TOKEN_QUERY = 0x0008;
    const int TOKEN_ELEVATION_CLASS = 20;
    const uint WM_CLOSE = 0x0010;

    static readonly HashSet<ushort> PressedKeys = new HashSet<ushort>();
    static readonly List<ushort> PressedOrder = new List<ushort>();
    static readonly HashSet<string> PressedButtons = new HashSet<string>();

    public static void EnableDpi()
    {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch { }
        try { if (SetProcessDpiAwareness(2) == 0) return; } catch { }
        try { SetProcessDPIAware(); } catch { }
    }

    // --------------------------------------------------------------- safety

    public static void Failsafe()
    {
        POINT point;
        if (GetCursorPos(out point) && point.X <= 1 && point.Y <= 1)
        {
            ReleaseAll();
            throw new InvalidOperationException("Emergency stop: the cursor is in the top-left corner of the screen.");
        }
    }

    // ------------------------------------------------------------------ mouse

    static void MouseEvent(uint flags, int dx, int dy, uint data)
    {
        var input = new INPUT { type = INPUT_MOUSE };
        input.u.mi = new MOUSEINPUT
        {
            dx = dx, dy = dy, mouseData = data, dwFlags = flags, time = 0, dwExtraInfo = IntPtr.Zero
        };
        if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) == 0)
            throw new InvalidOperationException("Windows rejected the mouse input.");
    }

    static void AbsoluteMove(int x, int y)
    {
        int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        int vw = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
        int vh = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
        int nx = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
        int ny = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
        MouseEvent(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, nx, ny, 0);
    }

    public static object MoveMouse(int x, int y)
    {
        Failsafe();
        AbsoluteMove(x, y);
        return new { x, y };
    }

    public static object Click(int x, int y, string button, bool doubleClick)
    {
        Failsafe();
        AbsoluteMove(x, y);
        uint down, up;
        string name = (button ?? "left").ToLowerInvariant();
        if (name == "right") { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; }
        else if (name == "middle") { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; }
        else { down = MOUSEEVENTF_LEFTDOWN; up = MOUSEEVENTF_LEFTUP; name = "left"; }
        int times = doubleClick ? 2 : 1;
        for (int i = 0; i < times; i++)
        {
            MouseEvent(down, 0, 0, 0);
            PressedButtons.Add(name);
            System.Threading.Thread.Sleep(15);
            MouseEvent(up, 0, 0, 0);
            PressedButtons.Remove(name);
            if (times == 2) System.Threading.Thread.Sleep(60);
        }
        return new { x, y, button = name, doubleClick };
    }

    public static object MouseDown(string button)
    {
        Failsafe();
        string name = (button ?? "left").ToLowerInvariant();
        uint flag = name == "right" ? MOUSEEVENTF_RIGHTDOWN : name == "middle" ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_LEFTDOWN;
        MouseEvent(flag, 0, 0, 0);
        PressedButtons.Add(name);
        return new { button = name, down = true };
    }

    public static object MouseUp(string button)
    {
        string name = (button ?? "left").ToLowerInvariant();
        uint flag = name == "right" ? MOUSEEVENTF_RIGHTUP : name == "middle" ? MOUSEEVENTF_MIDDLEUP : MOUSEEVENTF_LEFTUP;
        MouseEvent(flag, 0, 0, 0);
        PressedButtons.Remove(name);
        return new { button = name, down = false };
    }

    public static object Drag(int x1, int y1, int x2, int y2, string button)
    {
        Failsafe();
        string name = (button ?? "left").ToLowerInvariant();
        AbsoluteMove(x1, y1);
        uint down = name == "right" ? MOUSEEVENTF_RIGHTDOWN : name == "middle" ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_LEFTDOWN;
        uint up = name == "right" ? MOUSEEVENTF_RIGHTUP : name == "middle" ? MOUSEEVENTF_MIDDLEUP : MOUSEEVENTF_LEFTUP;
        MouseEvent(down, 0, 0, 0);
        PressedButtons.Add(name);
        try
        {
            const int steps = 24;
            for (int i = 1; i <= steps; i++)
            {
                int x = x1 + (x2 - x1) * i / steps;
                int y = y1 + (y2 - y1) * i / steps;
                AbsoluteMove(x, y);
                System.Threading.Thread.Sleep(10);
            }
        }
        finally
        {
            MouseEvent(up, 0, 0, 0);
            PressedButtons.Remove(name);
        }
        return new { from = new { x = x1, y = y1 }, to = new { x = x2, y = y2 }, button = name };
    }

    public static object Scroll(int x, int y, int delta, bool horizontal)
    {
        Failsafe();
        if (x >= 0 || y >= 0) AbsoluteMove(x, y);
        MouseEvent(horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL, 0, 0, unchecked((uint)delta));
        return new { x, y, delta, horizontal };
    }

    // --------------------------------------------------------------- keyboard

    static readonly Dictionary<string, ushort> NamedKeys = new Dictionary<string, ushort>
    {
        { "BACKSPACE", 0x08 }, { "BACK", 0x08 }, { "TAB", 0x09 }, { "ENTER", 0x0D },
        { "RETURN", 0x0D }, { "SHIFT", 0x10 }, { "CONTROL", 0x11 }, { "CTRL", 0x11 },
        { "ALT", 0x12 }, { "MENU", 0x12 }, { "PAUSE", 0x13 }, { "CAPSLOCK", 0x14 },
        { "ESC", 0x1B }, { "ESCAPE", 0x1B }, { "SPACE", 0x20 }, { "PAGEUP", 0x21 },
        { "PAGEDOWN", 0x22 }, { "END", 0x23 }, { "HOME", 0x24 }, { "LEFT", 0x25 },
        { "UP", 0x26 }, { "RIGHT", 0x27 }, { "DOWN", 0x28 }, { "PRINTSCREEN", 0x2C },
        { "INSERT", 0x2D }, { "DELETE", 0x2E }, { "DEL", 0x2E }, { "WIN", 0x5B },
        { "WINDOWS", 0x5B }, { "LWIN", 0x5B }, { "APPS", 0x5D }, { "MULTIPLY", 0x6A },
        { "ADD", 0x6B }, { "SUBTRACT", 0x6D }, { "DECIMAL", 0x6E }, { "DIVIDE", 0x6F },
        { "NUMLOCK", 0x90 }, { "SCROLLLOCK", 0x91 }, { "LSHIFT", 0xA0 }, { "RSHIFT", 0xA1 },
        { "LCONTROL", 0xA2 }, { "RCONTROL", 0xA3 }, { "LALT", 0xA4 }, { "RALT", 0xA5 },
        { "VOLUME_MUTE", 0xAD }, { "VOLUME_DOWN", 0xAE }, { "VOLUME_UP", 0xAF },
        { "MEDIA_NEXT", 0xB0 }, { "MEDIA_PREV", 0xB1 }, { "MEDIA_STOP", 0xB2 },
        { "MEDIA_PLAY", 0xB3 }
    };

    static readonly HashSet<ushort> ExtendedKeys = new HashSet<ushort>
    {
        0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0xA3, 0xA5, 0x5B, 0x5D
    };

    static ushort VirtualKey(string key)
    {
        string name = (key ?? "").Trim();
        if (name.Length == 0) throw new ArgumentException("A key name is required.");
        string upper = name.ToUpperInvariant();
        int fn = 0;
        if (upper.Length >= 2 && upper[0] == 'F' && int.TryParse(upper.Substring(1), out fn) && fn >= 1 && fn <= 24)
            return (ushort)(0x70 + fn - 1);
        if (NamedKeys.ContainsKey(upper)) return NamedKeys[upper];
        if (upper.Length == 1)
        {
            char c = upper[0];
            if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return (ushort)c;
            short scan = VkKeyScan(c);
            if (scan != -1) return (ushort)(scan & 0xFF);
        }
        throw new ArgumentException("Unknown key name: " + name);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern short VkKeyScan(char ch);

    static void KeyEvent(ushort vk, bool down)
    {
        uint flags = down ? 0 : KEYEVENTF_KEYUP;
        if (ExtendedKeys.Contains(vk)) flags |= KEYEVENTF_EXTENDEDKEY;
        var input = new INPUT { type = INPUT_KEYBOARD };
        input.u.ki = new KEYBDINPUT { wVk = vk, wScan = 0, dwFlags = flags, time = 0, dwExtraInfo = IntPtr.Zero };
        if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) == 0)
            throw new InvalidOperationException("Windows rejected the keyboard input.");
    }

    public static object KeyDown(string key)
    {
        Failsafe();
        ushort vk = VirtualKey(key);
        KeyEvent(vk, true);
        if (PressedKeys.Add(vk)) PressedOrder.Add(vk);
        return new { key, down = true };
    }

    public static object KeyUp(string key)
    {
        ushort vk = VirtualKey(key);
        KeyEvent(vk, false);
        PressedKeys.Remove(vk);
        PressedOrder.Remove(vk);
        return new { key, down = false };
    }

    public static object KeyPress(string key)
    {
        Failsafe();
        ushort vk = VirtualKey(key);
        PressedKeys.Add(vk); PressedOrder.Add(vk);
        try { KeyEvent(vk, true); KeyEvent(vk, false); }
        finally { PressedKeys.Remove(vk); PressedOrder.Remove(vk); }
        return new { key };
    }

    public static object KeyChord(string[] keys)
    {
        Failsafe();
        if (keys == null || keys.Length == 0) throw new ArgumentException("A key chord is required.");
        var pressed = new List<ushort>();
        try
        {
            foreach (string key in keys)
            {
                ushort vk = VirtualKey(key);
                KeyEvent(vk, true);
                pressed.Add(vk);
                if (PressedKeys.Add(vk)) PressedOrder.Add(vk);
                System.Threading.Thread.Sleep(12);
            }
        }
        finally
        {
            for (int i = pressed.Count - 1; i >= 0; i--)
            {
                try { KeyEvent(pressed[i], false); } catch { }
                PressedKeys.Remove(pressed[i]);
                PressedOrder.Remove(pressed[i]);
            }
        }
        return new { chord = string.Join("+", keys) };
    }

    static void TextEvent(char value)
    {
        var down = new INPUT { type = INPUT_KEYBOARD };
        down.u.ki = new KEYBDINPUT { wVk = 0, wScan = value, dwFlags = KEYEVENTF_UNICODE, time = 0, dwExtraInfo = IntPtr.Zero };
        var up = new INPUT { type = INPUT_KEYBOARD };
        up.u.ki = new KEYBDINPUT { wVk = 0, wScan = value, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time = 0, dwExtraInfo = IntPtr.Zero };
        if (SendInput(2, new[] { down, up }, Marshal.SizeOf(typeof(INPUT))) == 0)
            throw new InvalidOperationException("Windows rejected the text input.");
    }

    public static object TypeText(string text, int intervalMs)
    {
        Failsafe();
        if (text == null) text = "";
        foreach (char c in text)
        {
            if (c == '\r') continue;
            if (c == '\n') { KeyEvent(0x0D, true); KeyEvent(0x0D, false); }
            else if (c == '\t') { KeyEvent(0x09, true); KeyEvent(0x09, false); }
            else TextEvent(c);
            if (intervalMs > 0) System.Threading.Thread.Sleep(Math.Min(intervalMs, 100));
        }
        return new { characters = text.Length };
    }

    public static object ReleaseAll()
    {
        for (int i = PressedOrder.Count - 1; i >= 0; i--)
        {
            try { KeyEvent(PressedOrder[i], false); } catch { }
        }
        PressedOrder.Clear();
        PressedKeys.Clear();
        foreach (string button in PressedButtons.ToList())
        {
            try
            {
                uint flag = button == "right" ? MOUSEEVENTF_RIGHTUP : button == "middle" ? MOUSEEVENTF_MIDDLEUP : MOUSEEVENTF_LEFTUP;
                MouseEvent(flag, 0, 0, 0);
            }
            catch { }
        }
        PressedButtons.Clear();
        return new { released = true };
    }

    // ---------------------------------------------------------------- windows

    static bool IsElevated(uint pid)
    {
        IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero) return true;
        try
        {
            IntPtr token;
            if (!OpenProcessToken(process, TOKEN_QUERY, out token)) return true;
            try
            {
                TOKEN_ELEVATION elevation;
                int size;
                if (!GetTokenInformation(token, TOKEN_ELEVATION_CLASS, out elevation, Marshal.SizeOf(typeof(TOKEN_ELEVATION)), out size)) return true;
                return elevation.TokenIsElevated != 0;
            }
            finally { CloseHandle(token); }
        }
        finally { CloseHandle(process); }
    }

    static string ProcessName(uint pid)
    {
        try { using (var process = Process.GetProcessById((int)pid)) return process.ProcessName; }
        catch { return "unknown"; }
    }

    static bool IsCloaked(IntPtr handle)
    {
        try
        {
            int cloaked;
            if (DwmGetWindowAttribute(handle, 14, out cloaked, sizeof(int)) == 0) return cloaked != 0;
        }
        catch { }
        return false;
    }

    static string WindowTitle(IntPtr handle)
    {
        var text = new StringBuilder(1024);
        GetWindowText(handle, text, text.Capacity);
        return text.ToString();
    }

    static string WindowClass(IntPtr handle)
    {
        var text = new StringBuilder(512);
        GetClassName(handle, text, text.Capacity);
        return text.ToString();
    }

    public static object WindowInfo(IntPtr handle)
    {
        if (handle == IntPtr.Zero) return null;
        RECT rect;
        GetWindowRect(handle, out rect);
        uint pid;
        GetWindowThreadProcessId(handle, out pid);
        return new
        {
            handle = handle.ToInt64(),
            title = WindowTitle(handle),
            className = WindowClass(handle),
            process = ProcessName(pid),
            pid = (long)pid,
            rect = new { x = rect.Left, y = rect.Top, width = Math.Max(0, rect.Right - rect.Left), height = Math.Max(0, rect.Bottom - rect.Top) },
            minimized = IsIconic(handle),
            maximized = IsZoomed(handle),
            foreground = GetForegroundWindow() == handle,
            elevated = IsElevated(pid)
        };
    }

    public static object[] ListWindows()
    {
        var result = new List<object>();
        EnumWindows(delegate(IntPtr handle, IntPtr data)
        {
            if (!IsWindowVisible(handle)) return true;
            string title = WindowTitle(handle);
            if (string.IsNullOrWhiteSpace(title)) return true;
            if (IsCloaked(handle)) return true;
            int style = GetWindowLong(handle, GWL_EXSTYLE);
            if ((style & WS_EX_TOOLWINDOW) != 0) return true;
            try { result.Add(WindowInfo(handle)); } catch { }
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }

    public static object Foreground()
    {
        return WindowInfo(GetForegroundWindow());
    }

    public static object WindowAt(int x, int y)
    {
        var point = new POINT { X = x, Y = y };
        IntPtr handle = GetAncestor(WindowFromPoint(point), 2);
        return WindowInfo(handle);
    }

    public static object FocusWindow(long handle)
    {
        IntPtr target = new IntPtr(handle);
        if (IsIconic(target)) ShowWindow(target, 9);
        uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        uint targetThread = GetWindowThreadProcessId(target, IntPtr.Zero);
        bool attached = false;
        try
        {
            if (foregroundThread != 0 && targetThread != 0 && foregroundThread != targetThread)
                attached = AttachThreadInput(foregroundThread, targetThread, true);
            BringWindowToTop(target);
            ShowWindow(target, 5);
            SetForegroundWindow(target);
            SetFocus(target);
        }
        finally
        {
            if (attached) AttachThreadInput(foregroundThread, targetThread, false);
        }
        System.Threading.Thread.Sleep(120);
        return new { focused = GetForegroundWindow() == target, window = WindowInfo(target) };
    }

    public static object ShowWindowState(long handle, string state)
    {
        IntPtr target = new IntPtr(handle);
        string name = (state ?? "restore").ToLowerInvariant();
        int command = name == "minimize" ? 6 : name == "maximize" ? 3 : 9;
        ShowWindow(target, command);
        return new { state = name, window = WindowInfo(target) };
    }

    public static object CloseWindow(long handle)
    {
        IntPtr target = new IntPtr(handle);
        bool ok = PostMessage(target, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        return new { requested = ok, window = WindowInfo(target) };
    }

    public static object MoveWindowTo(long handle, int x, int y, int width, int height)
    {
        bool ok = MoveWindow(new IntPtr(handle), x, y, Math.Max(120, width), Math.Max(80, height), true);
        return new { moved = ok, window = WindowInfo(new IntPtr(handle)) };
    }

    // ------------------------------------------------------------- screenshot

    public static object Screenshot(string path)
    {
        int x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        int y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        int width = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
        int height = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
        using (var bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb))
        {
            using (var graphics = Graphics.FromImage(bitmap))
                graphics.CopyFromScreen(x, y, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
            bitmap.Save(path, ImageFormat.Png);
        }
        return new { path, x, y, width, height, capturedAt = DateTime.UtcNow.ToString("o") };
    }

    public static object Cursor()
    {
        POINT point;
        GetCursorPos(out point);
        return new { x = point.X, y = point.Y };
    }

    public static object[] Monitors()
    {
        var list = new List<object>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr monitor, IntPtr hdc, IntPtr rect, IntPtr data)
        {
            var info = new MONITORINFO();
            info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            if (GetMonitorInfo(monitor, ref info))
            {
                list.Add(new
                {
                    x = info.rcMonitor.Left,
                    y = info.rcMonitor.Top,
                    width = info.rcMonitor.Right - info.rcMonitor.Left,
                    height = info.rcMonitor.Bottom - info.rcMonitor.Top,
                    work = new
                    {
                        x = info.rcWork.Left,
                        y = info.rcWork.Top,
                        width = info.rcWork.Right - info.rcWork.Left,
                        height = info.rcWork.Bottom - info.rcWork.Top
                    },
                    primary = (info.dwFlags & 1) != 0
                });
            }
            return true;
        }, IntPtr.Zero);
        return list.ToArray();
    }

    public static object State()
    {
        return new
        {
            version = 1,
            cursor = Cursor(),
            foreground = Foreground(),
            virtualScreen = new
            {
                x = GetSystemMetrics(SM_XVIRTUALSCREEN),
                y = GetSystemMetrics(SM_YVIRTUALSCREEN),
                width = GetSystemMetrics(SM_CXVIRTUALSCREEN),
                height = GetSystemMetrics(SM_CYVIRTUALSCREEN)
            },
            monitors = Monitors(),
            processElevated = IsElevated(GetCurrentProcessId()),
            windows = ListWindows().Length
        };
    }

    // -------------------------------------------------------------------- UIA

    static string RuntimeId(AutomationElement element)
    {
        int[] ids = element.GetRuntimeId();
        return ids == null ? "" : string.Join(".", ids);
    }

    static bool HasPattern(AutomationElement element, AutomationPattern pattern)
    {
        object value;
        return element.TryGetCurrentPattern(pattern, out value);
    }

    public static object[] Patterns(AutomationElement element)
    {
        var patterns = new List<string>();
        if (HasPattern(element, ValuePattern.Pattern)) patterns.Add("ValuePattern");
        if (HasPattern(element, InvokePattern.Pattern)) patterns.Add("InvokePattern");
        if (HasPattern(element, TogglePattern.Pattern)) patterns.Add("TogglePattern");
        if (HasPattern(element, SelectionItemPattern.Pattern)) patterns.Add("SelectionItemPattern");
        if (HasPattern(element, ExpandCollapsePattern.Pattern)) patterns.Add("ExpandCollapsePattern");
        if (HasPattern(element, TextPattern.Pattern)) patterns.Add("TextPattern");
        if (HasPattern(element, ScrollItemPattern.Pattern)) patterns.Add("ScrollItemPattern");
        if (HasPattern(element, RangeValuePattern.Pattern)) patterns.Add("RangeValuePattern");
        return patterns.ToArray();
    }

    static object ElementInfo(AutomationElement element)
    {
        AutomationElement.AutomationElementInformation current = element.Current;
        var bounds = current.BoundingRectangle;
        return new
        {
            refId = RuntimeId(element),
            role = current.ControlType == null ? "Unknown" : current.ControlType.ProgrammaticName.Replace("ControlType.", ""),
            name = (current.Name ?? "").Length > 200 ? current.Name.Substring(0, 200) : (current.Name ?? ""),
            automationId = current.AutomationId ?? "",
            bounds = new
            {
                x = (int)Math.Round(bounds.X),
                y = (int)Math.Round(bounds.Y),
                width = Math.Max(0, (int)Math.Round(bounds.Width)),
                height = Math.Max(0, (int)Math.Round(bounds.Height))
            },
            enabled = current.IsEnabled,
            offscreen = current.IsOffscreen,
            password = current.IsPassword,
            focusable = current.IsKeyboardFocusable,
            patterns = Patterns(element)
        };
    }

    static void Walk(AutomationElement element, int depth, int maxDepth, int max, List<object> result)
    {
        if (result.Count >= max || depth > maxDepth) return;
        try { result.Add(ElementInfo(element)); } catch (ElementNotAvailableException) { return; } catch (Exception) { }
        if (depth >= maxDepth || result.Count >= max) return;
        TreeWalker walker = TreeWalker.ControlViewWalker;
        AutomationElement child;
        try { child = walker.GetFirstChild(element); } catch { return; }
        while (child != null && result.Count < max)
        {
            Walk(child, depth + 1, maxDepth, max, result);
            try { child = walker.GetNextSibling(child); } catch { break; }
        }
    }

    public static object GetElements(long handle, int max, int maxDepth)
    {
        AutomationElement root = handle != 0
            ? AutomationElement.FromHandle(new IntPtr(handle))
            : AutomationElement.RootElement;
        var result = new List<object>();
        Walk(root, 0, Math.Max(1, maxDepth), Math.Max(1, max), result);
        return new { window = WindowInfo(handle == 0 ? GetForegroundWindow() : new IntPtr(handle)), elements = result.ToArray(), truncated = result.Count >= max };
    }

    static AutomationElement Find(AutomationElement root, string runtimeId, int depth)
    {
        if (depth > 40) return null;
        try { if (RuntimeId(root) == runtimeId) return root; } catch { return null; }
        TreeWalker walker = TreeWalker.ControlViewWalker;
        AutomationElement child;
        try { child = walker.GetFirstChild(root); } catch { return null; }
        while (child != null)
        {
            AutomationElement found = Find(child, runtimeId, depth + 1);
            if (found != null) return found;
            try { child = walker.GetNextSibling(child); } catch { return null; }
        }
        return null;
    }

    static AutomationElement Resolve(long handle, string runtimeId)
    {
        AutomationElement root = handle != 0
            ? AutomationElement.FromHandle(new IntPtr(handle))
            : AutomationElement.RootElement;
        AutomationElement element = Find(root, runtimeId, 0);
        if (element == null)
            throw new InvalidOperationException("The element is stale or no longer on screen. Take a new elements snapshot.");
        if (element.Current.IsPassword)
            throw new InvalidOperationException("IGRIS will not operate a password field. Ask the user to type it.");
        if (!element.Current.IsEnabled)
            throw new InvalidOperationException("The element is disabled.");
        return element;
    }

    public static object InvokeElement(long handle, string runtimeId)
    {
        AutomationElement element = Resolve(handle, runtimeId);
        object pattern;
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) { ((InvokePattern)pattern).Invoke(); return new { invoked = true, how = "InvokePattern" }; }
        if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) { ((TogglePattern)pattern).Toggle(); return new { invoked = true, how = "TogglePattern" }; }
        if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) { ((SelectionItemPattern)pattern).Select(); return new { invoked = true, how = "SelectionItemPattern" }; }
        if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) { ((ExpandCollapsePattern)pattern).Expand(); return new { invoked = true, how = "ExpandCollapsePattern" }; }
        throw new InvalidOperationException("The element has no invokable pattern. Use a coordinate click instead.");
    }

    public static object SetElementValue(long handle, string runtimeId, string text, bool append)
    {
        AutomationElement element = Resolve(handle, runtimeId);
        object pattern;
        if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
            throw new InvalidOperationException("The element does not expose a value. Use a coordinate click and type instead.");
        var value = (ValuePattern)pattern;
        if (value.Current.IsReadOnly) throw new InvalidOperationException("The element is read-only.");
        string next = append ? (value.Current.Value ?? "") + text : text;
        value.SetValue(next);
        return new { value = next.Length > 500 ? next.Substring(0, 500) : next };
    }

    public static object GetElementValue(long handle, string runtimeId)
    {
        AutomationElement element = Resolve(handle, runtimeId);
        object pattern;
        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
        {
            string value = ((ValuePattern)pattern).Current.Value ?? "";
            return new { value = value.Length > 4000 ? value.Substring(0, 4000) : value };
        }
        if (element.TryGetCurrentPattern(TextPattern.Pattern, out pattern))
        {
            string value = ((TextPattern)pattern).DocumentRange.GetText(4000) ?? "";
            return new { value = value.Length > 4000 ? value.Substring(0, 4000) : value };
        }
        return new { value = "" };
    }

    public static object FocusElement(long handle, string runtimeId)
    {
        AutomationElement element = Resolve(handle, runtimeId);
        element.SetFocus();
        return new { focused = true, window = Foreground() };
    }
}
'@

Add-Type -TypeDefinition $igrisSource -ReferencedAssemblies @(
  [System.Object].Assembly.Location,
  [System.Uri].Assembly.Location,
  [System.Linq.Enumerable].Assembly.Location,
  [System.Drawing.Bitmap].Assembly.Location,
  [System.Windows.Automation.AutomationElement].Assembly.Location,
  [System.Windows.Automation.AutomationIdentifier].Assembly.Location,
  [System.Windows.Rect].Assembly.Location
) -Language CSharp

[IgrisOperator]::EnableDpi() | Out-Null

function Send-Response([object]$payload) {
  $json = $payload | ConvertTo-Json -Compress -Depth 10
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

Send-Response @{ ready = $true; version = 1 }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $requestId = $null
  try {
    $request = $line | ConvertFrom-Json
    $requestId = $request.id
    $command = [string]$request.cmd
    $args = $request.args
    if ($null -eq $args) { $args = @{} }

    $result = switch ($command) {
      'state' { [IgrisOperator]::State() }
      'foreground' { [IgrisOperator]::Foreground() }
      'windowAt' { [IgrisOperator]::WindowAt([int]$args.x, [int]$args.y) }
      'listWindows' { [IgrisOperator]::ListWindows() }
      'windowInfo' { [IgrisOperator]::WindowInfo([IntPtr]([long]$args.handle)) }
      'focusWindow' { [IgrisOperator]::FocusWindow([long]$args.handle) }
      'showWindow' { [IgrisOperator]::ShowWindowState([long]$args.handle, [string]$args.state) }
      'closeWindow' { [IgrisOperator]::CloseWindow([long]$args.handle) }
      'moveWindow' { [IgrisOperator]::MoveWindowTo([long]$args.handle, [int]$args.x, [int]$args.y, [int]$args.width, [int]$args.height) }
      'moveMouse' { [IgrisOperator]::MoveMouse([int]$args.x, [int]$args.y) }
      'click' { [IgrisOperator]::Click([int]$args.x, [int]$args.y, [string]$args.button, [bool]$args.double) }
      'mouseDown' { [IgrisOperator]::MouseDown([string]$args.button) }
      'mouseUp' { [IgrisOperator]::MouseUp([string]$args.button) }
      'drag' { [IgrisOperator]::Drag([int]$args.x1, [int]$args.y1, [int]$args.x2, [int]$args.y2, [string]$args.button) }
      'scroll' { [IgrisOperator]::Scroll([int]$args.x, [int]$args.y, [int]$args.delta, [bool]$args.horizontal) }
      'typeText' { [IgrisOperator]::TypeText([string]$args.text, [int]$args.intervalMs) }
      'keyPress' { [IgrisOperator]::KeyPress([string]$args.key) }
      'keyDown' { [IgrisOperator]::KeyDown([string]$args.key) }
      'keyUp' { [IgrisOperator]::KeyUp([string]$args.key) }
      'keyChord' { [IgrisOperator]::KeyChord([string[]]$args.keys) }
      'releaseAll' { [IgrisOperator]::ReleaseAll() }
      'cursor' { [IgrisOperator]::Cursor() }
      'screenshot' { [IgrisOperator]::Screenshot([string]$args.path) }
      'getElements' { [IgrisOperator]::GetElements([long]$args.handle, [int]$args.max, [int]$args.depth) }
      'invokeElement' { [IgrisOperator]::InvokeElement([long]$args.handle, [string]$args.refId) }
      'setElementValue' { [IgrisOperator]::SetElementValue([long]$args.handle, [string]$args.refId, [string]$args.text, [bool]$args.append) }
      'getElementValue' { [IgrisOperator]::GetElementValue([long]$args.handle, [string]$args.refId) }
      'focusElement' { [IgrisOperator]::FocusElement([long]$args.handle, [string]$args.refId) }
      'shutdown' { 'shutdown' }
      default { throw "Unknown operator command: $command" }
    }

    if ($command -eq 'shutdown') { break }
    Send-Response @{ id = $requestId; ok = $true; data = $result }
  } catch {
    $message = $_.Exception.Message
    if ($message -match 'Emergency stop') {
      try { [IgrisOperator]::ReleaseAll() | Out-Null } catch { }
    }
    Send-Response @{ id = $requestId; ok = $false; error = $message }
  }
}
