using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;
using System.Windows.Forms;

// The tracker can inspect the terminal at its own integrity level. The OLE
// window and file reads run in a separate process under the desktop shell token.
public static class ComputerBridgeDrop
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public static void Track(string token, byte[] assembly)
    {
        string marker = "\u2063" + String.Concat(token.Select(c => String.Concat(
            Convert.ToString(Convert.ToInt32(c.ToString(), 16), 2).PadLeft(4, '0')
                .Select(b => b == '0' ? '\u200b' : '\u2060'))));
        var tracker = new Tracker(marker, assembly);
        var worker = new Thread(tracker.Run);
        worker.SetApartmentState(ApartmentState.MTA);
        worker.Start();
        worker.Join();
        if (tracker.Failure != null) throw tracker.Failure;
    }

    private sealed class Tracker
    {
        private readonly string marker;
        private readonly byte[] assembly;
        private readonly AutoResetEvent changed = new AutoResetEvent(false);
        private volatile string layout = "H";
        private volatile bool closed;
        public Exception Failure;

        public Tracker(string marker, byte[] assembly)
        { this.marker = marker; this.assembly = assembly; }

        private void ReadLayouts()
        {
            string line;
            while ((line = Console.ReadLine()) != null) { layout = line; changed.Set(); }
            closed = true;
            changed.Set();
        }

        public void Run()
        {
            try { RunCore(); }
            catch (Exception error) { Failure = error; }
        }

        private void RunCore()
        {
            SetThreadDpiAwarenessContext(new IntPtr(-4)); // Physical coordinates, including mixed-DPI monitors.
            var conditions = new PropertyCondition(AutomationElement.ClassNameProperty, "TermControl");
            var reader = new Thread(ReadLayouts) { IsBackground = true };
            reader.Start();
            // EOF can arrive while PowerShell compiles the helper. No window
            // listener is needed unless a live TUI has supplied a layout.
            changed.WaitOne();
            if (closed) return;
            var roots = new List<IntPtr>();
            EnumWindows((window, state) => {
                var name = new StringBuilder(256);
                GetClassNameW(window, name, name.Capacity);
                if (IsWindowVisible(window) && name.ToString() == "CASCADIA_HOSTING_WINDOW_CLASS") roots.Add(window);
                return true;
            }, IntPtr.Zero);
            var events = new List<WindowEvents>();
            Broker broker = null;
            IntPtr bound = IntPtr.Zero;
            string applied = "H";
            try
            {
                foreach (var candidate in roots)
                {
                    uint pid;
                    GetWindowThreadProcessId(candidate, out pid);
                    events.Add(new WindowEvents(candidate, pid, changed));
                }
                changed.Set();
                while (!closed)
                {
                    changed.WaitOne();
                    if (closed) break;
                    if (broker != null && !broker.IsOpen) throw new IOException("The drop receiver exited.");
                    string command = "H";
                    IntPtr owner = IntPtr.Zero;
                    // Prefer the already-bound terminal. UIA is only queried
                    // for geometry; subscribing into an unrelated Terminal's
                    // UIA tree can block indefinitely when it is unresponsive.
                    IEnumerable<IntPtr> candidates = bound == IntPtr.Zero ? (IEnumerable<IntPtr>)roots : new[] { bound };
                    foreach (var candidate in candidates)
                    {
                        command = Geometry(candidate, conditions, layout);
                        if (command != "H") { owner = candidate; break; }
                    }
                    if (owner != IntPtr.Zero && owner != bound)
                    {
                        if (broker != null) broker.Dispose();
                        broker = new Broker(assembly, owner, changed);
                        bound = owner;
                        applied = "H";
                        // Recheck after starting Explorer's process: the tab
                        // may already have been switched or resized.
                        changed.Set();
                        continue;
                    }
                    if (command == applied) continue;
                    broker.Send(command);
                    applied = command;
                }
            }
            finally
            {
                if (broker != null) broker.Dispose();
                foreach (var watcher in events) watcher.Dispose();
            }
        }

        private string Geometry(IntPtr owner, Condition conditions, string layout)
        {
            if (layout == "H" || !IsWindow(owner) || IsIconic(owner) || !IsWindowVisible(owner)) return "H";
            try
            {
                var root = AutomationElement.FromHandle(owner);
                var panes = root.FindAll(TreeScope.Descendants, conditions).Cast<AutomationElement>();
                var pane = panes.SingleOrDefault(p => !p.Current.IsOffscreen && p.Current.HelpText.EndsWith(marker, StringComparison.Ordinal));
                if (pane == null) return "H";
                var text = (TextPattern)pane.GetCurrentPattern(TextPattern.Pattern);
                var rows = text.GetVisibleRanges().SelectMany(r => r.GetBoundingRectangles()).ToArray();
                var parts = layout.Split(' ');
                int columns = Int32.Parse(parts[2]), lines = Int32.Parse(parts[3]);
                int col = Int32.Parse(parts[4]), row = Int32.Parse(parts[5]);
                int width = Int32.Parse(parts[6]), height = Int32.Parse(parts[7]);
                // UIA exposes the padded text grid as one rectangle per row.
                // Wait for the matching TUI render if Terminal has just resized.
                if (rows.Length != lines || lines == 0 || columns == 0) return "H";
                var first = rows[0];
                var last = rows[rows.Length - 1];
                double dx = first.Width / columns, dy = first.Height;
                if (dx < 1 || dy < 1 || Math.Abs(last.Bottom - first.Top - dy * lines) > 1) return "H";
                int left = (int)Math.Round(first.Left + col * dx), top = (int)Math.Round(first.Top + row * dy);
                int right = (int)Math.Round(first.Left + (col + width) * dx), bottom = (int)Math.Round(first.Top + (row + height) * dy);
                return String.Format(Invariant, "P {0} {1} {2} {3} {4} {5} {6} {7} {8}",
                    parts[1], left, top, right - left, bottom - top, col, row, width, height);
            }
            catch (ElementNotAvailableException) { return "H"; }
        }
    }

    private sealed class WindowEvents : IDisposable
    {
        private uint threadId;
        private readonly Thread thread;

        public WindowEvents(IntPtr owner, uint pid, AutoResetEvent changed)
        {
            using (var ready = new ManualResetEvent(false))
            {
                thread = new Thread(() => {
                    threadId = GetCurrentThreadId();
                    MessageData message;
                    PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
                    EventCallback callback = (hook, type, window, obj, child, source, time) => {
                        if (obj != -8 && (window == owner || GetAncestor(window, 2) == owner)) changed.Set();
                    };
                    // Observe this Terminal process's accessibility events; no input hook.
                    IntPtr locations = SetWinEventHook(0x8000, 0x8017, IntPtr.Zero, callback, pid, 0, 0);
                    IntPtr minimize = SetWinEventHook(0x0016, 0x0017, IntPtr.Zero, callback, pid, 0, 0);
                    ready.Set();
                    while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
                    UnhookWinEvent(locations);
                    UnhookWinEvent(minimize);
                    GC.KeepAlive(callback);
                }) { IsBackground = true };
                thread.Start();
                ready.WaitOne();
            }
        }

        public void Dispose()
        {
            PostThreadMessage(threadId, 0x0012, IntPtr.Zero, IntPtr.Zero);
            thread.Join();
        }
    }

    private sealed class Broker : IDisposable
    {
        private readonly NamedPipeServerStream pipe;
        private readonly Process process;
        private readonly StreamWriter writer;
        private volatile bool ended;
        public bool IsOpen { get { return !ended; } }

        public Broker(byte[] assembly, IntPtr owner, AutoResetEvent changed)
        {
            uint shellPid;
            GetWindowThreadProcessId(GetShellWindow(), out shellPid);
            using (var shell = Process.GetProcessById((int)shellPid))
            using (var current = WindowsIdentity.GetCurrent())
            {
                IntPtr token;
                Check(OpenProcessToken(shell.Handle, 0x000A, out token));
                try
                {
                    var shellUser = TokenSid(token, 1);
                    string name = "ComputerBridge.Drop." + Guid.NewGuid().ToString("N");
                    var security = new PipeSecurity();
                    security.SetAccessRuleProtection(true, false);
                    security.AddAccessRule(new PipeAccessRule(current.User, PipeAccessRights.FullControl, AccessControlType.Allow));
                    security.AddAccessRule(new PipeAccessRule(shellUser, PipeAccessRights.ReadWrite, AccessControlType.Allow));
                    pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous, 65536, 4096, security);
                    string executable = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
                    string arguments = ReceiverCommand(name);
                    bool same = current.User.Equals(shellUser) && TokenSid(current.Token, 25).Equals(TokenSid(token, 25));
                    process = same ? Process.Start(new ProcessStartInfo(executable, arguments) {
                        UseShellExecute = false, CreateNoWindow = true
                    }) : StartWithToken(token, executable, arguments);
                }
                finally { CloseHandle(token); }
            }
            try
            {
                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15)))
                    pipe.WaitForConnectionAsync(timeout.Token).GetAwaiter().GetResult();
                uint clientPid;
                Check(GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out clientPid));
                if (clientPid != process.Id) throw new IOException("Unexpected drop receiver process.");
                using (var bootstrap = new BinaryWriter(pipe, Encoding.UTF8, true))
                {
                    bootstrap.Write(assembly.Length);
                    bootstrap.Write(assembly);
                }
                // First line is the receiver's HWND. The tracker owns the z-order,
                // so it can attach a window from a lower-integrity Explorer.
                IntPtr overlay = new IntPtr(Int64.Parse(ReadAsciiLine(pipe), Invariant));
                uint windowPid;
                GetWindowThreadProcessId(overlay, out windowPid);
                if (windowPid != clientPid) throw new IOException("Unexpected drop receiver window.");
                if (IntPtr.Size == 8) SetWindowLongPtr(overlay, -8, owner);
                else SetWindowLong(overlay, -8, owner.ToInt32());
                if (GetWindow(overlay, 4) != owner) throw new Win32Exception(Marshal.GetLastWin32Error());
                writer = new StreamWriter(pipe, Encoding.ASCII, 4096, true) { AutoFlush = true, NewLine = "\n" };
                writer.WriteLine("O " + owner.ToInt64().ToString(Invariant));
                Task.Run(() => {
                    try { pipe.CopyTo(Console.OpenStandardOutput()); }
                    catch (IOException) { }
                    catch (ObjectDisposedException) { }
                    finally { ended = true; changed.Set(); }
                });
            }
            catch { Dispose(); throw; }
        }

        public void Send(string command) { writer.WriteLine(command); }

        public void Dispose()
        {
            pipe.Dispose();
            if (!process.WaitForExit(1500)) { process.Kill(); process.WaitForExit(); }
            process.Dispose();
        }
    }

    private static string ReceiverCommand(string name)
    {
        string bootstrap = "$ErrorActionPreference='Stop'; " +
            "$p=[IO.Pipes.NamedPipeClientStream]::new('.', '" + name + "', [IO.Pipes.PipeDirection]::InOut); " +
            "try { $p.Connect(15000); $r=[IO.BinaryReader]::new($p,[Text.Encoding]::UTF8,$true); " +
            "try { $bytes=$r.ReadBytes($r.ReadInt32()) } finally { $r.Dispose() }; " +
            "[Reflection.Assembly]::Load($bytes)>$null; [ComputerBridgeDrop]::Receive($p) } finally { $p.Dispose() }";
        // CreateProcessWithTokenW accepts only 1024 characters, including the
        // executable. The script has no interpolated paths or double quotes.
        return "-NoLogo -NoProfile -NonInteractive -STA -Command \"" + bootstrap + "\"";
    }

    public static void Receive(NamedPipeClientStream pipe)
    {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        using (var form = new DropSurface(pipe))
        {
            WriteAscii(pipe, form.Handle.ToInt64().ToString(Invariant));
            var reader = new Thread(() => {
                try
                {
                    using (var input = new StreamReader(pipe, Encoding.ASCII, false, 4096, true))
                    {
                        string line;
                        while ((line = input.ReadLine()) != null)
                        {
                            string command = line;
                            form.BeginInvoke(new Action(() => form.Position(command)));
                        }
                    }
                }
                catch (IOException) { }
                finally { if (!form.IsDisposed) form.BeginInvoke(new Action(Application.ExitThread)); }
            }) { IsBackground = true };
            reader.Start();
            Application.Run();
        }
    }

    private sealed class DropSurface : Form
    {
        private readonly Stream pipe;
        private readonly object outputLock = new object();
        private IntPtr owner;
        private int generation, column, row, columns, rows;
        private volatile bool receiving;

        public DropSurface(Stream pipe)
        {
            this.pipe = pipe;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            Opacity = 1.0 / 255; // Zero alpha would also make the HWND hit-test transparent.
            AllowDrop = true;
        }

        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams
        {
            get { var p = base.CreateParams; p.ExStyle |= 0x08000080; return p; } // NOACTIVATE | TOOLWINDOW
        }

        public void Position(string command)
        {
            string[] p = command.Split(' ');
            if (p[0] == "O") { owner = new IntPtr(Int64.Parse(p[1], Invariant)); return; }
            if (p[0] == "H") { Hide(); return; }
            generation = Int32.Parse(p[1]);
            Bounds = new Rectangle(Int32.Parse(p[2]), Int32.Parse(p[3]), Int32.Parse(p[4]), Int32.Parse(p[5]));
            column = Int32.Parse(p[6]); row = Int32.Parse(p[7]); columns = Int32.Parse(p[8]); rows = Int32.Parse(p[9]);
            if (!Visible) Show();
        }

        private void Mouse(string kind, MouseEventArgs e)
        {
            if (!Visible || e.X < 0 || e.Y < 0 || e.X >= Width || e.Y >= Height) return;
            var point = PointToScreen(e.Location);
            Send(String.Format(Invariant, "M {0} {1} {2} {3} {4} {5} {6}", kind, generation,
                column + e.X * columns / Width, row + e.Y * rows / Height, point.X, point.Y, owner.ToInt64()));
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            SetForegroundWindow(owner);
            if (e.Button == MouseButtons.Left) Mouse("down", e);
        }
        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button == MouseButtons.Left) Mouse("up", e);
            if (e.Button == MouseButtons.Right) Mouse("right", e);
        }
        protected override void OnMouseMove(MouseEventArgs e)
        { if (e.Button == MouseButtons.Left) Mouse("move", e); }
        protected override void OnMouseWheel(MouseEventArgs e)
        { if (e.Delta != 0) Mouse(e.Delta > 0 ? "wheel-up" : "wheel-down", e); }

        private bool Accept(DragEventArgs e)
        { return Visible && !receiving && (e.AllowedEffect & DragDropEffects.Copy) != 0 && e.Data.GetDataPresent(DataFormats.FileDrop, false); }

        protected override void OnDragEnter(DragEventArgs e) { OnDragOver(e); }
        protected override void OnDragOver(DragEventArgs e)
        { e.Effect = Accept(e) ? DragDropEffects.Copy : DragDropEffects.None; }
        protected override void OnDragDrop(DragEventArgs e)
        {
            if (!Accept(e)) { e.Effect = DragDropEffects.None; return; }
            var paths = (string[])e.Data.GetData(DataFormats.FileDrop, false);
            e.Effect = DragDropEffects.Copy;
            receiving = true;
            int target = generation;
            Task.Run(() => Stage(target, paths));
        }

        private void Stage(int target, string[] paths)
        {
            try
            {
                Send("B " + target.ToString(Invariant));
                var block = new byte[65536];
                foreach (string path in paths.Distinct(StringComparer.OrdinalIgnoreCase))
                {
                    using (var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                    {
                        Send("F " + file.Length.ToString(Invariant) + " " + Convert.ToBase64String(Encoding.UTF8.GetBytes(Path.GetFileName(path))));
                        int count;
                        while ((count = file.Read(block, 0, block.Length)) > 0)
                            Send("D " + count.ToString(Invariant), block, count);
                        Send("C");
                    }
                }
                Send("E");
            }
            catch (IOException) { Send("X"); }
            catch (UnauthorizedAccessException) { Send("X"); }
            finally { receiving = false; }
        }

        private void Send(string line, byte[] block = null, int count = 0)
        {
            lock (outputLock)
            {
                WriteAscii(pipe, line);
                if (block != null) pipe.Write(block, 0, count);
            }
        }
    }

    private static void WriteAscii(Stream stream, string line)
    {
        byte[] bytes = Encoding.ASCII.GetBytes(line + "\n");
        stream.Write(bytes, 0, bytes.Length);
    }

    private static string ReadAsciiLine(Stream stream)
    {
        var text = new StringBuilder();
        int value;
        while ((value = stream.ReadByte()) >= 0 && value != '\n') text.Append((char)value);
        return text.ToString();
    }

    private static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }

    private static SecurityIdentifier TokenSid(IntPtr token, int kind)
    {
        int length;
        GetTokenInformation(token, kind, IntPtr.Zero, 0, out length);
        IntPtr buffer = Marshal.AllocHGlobal(length);
        try { Check(GetTokenInformation(token, kind, buffer, length, out length)); return new SecurityIdentifier(Marshal.ReadIntPtr(buffer)); }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static Process StartWithToken(IntPtr token, string executable, string arguments)
    {
        IntPtr primary;
        Check(DuplicateTokenEx(token, 0x02000000, IntPtr.Zero, 2, 1, out primary));
        try
        {
            var startup = new Startup { Size = Marshal.SizeOf(typeof(Startup)), Desktop = @"winsta0\default" };
            ProcessInfo info;
            Check(CreateProcessWithTokenW(primary, 1, executable, new StringBuilder("\"" + executable + "\" " + arguments),
                0x08000000, IntPtr.Zero, null, ref startup, out info));
            CloseHandle(info.Thread);
            CloseHandle(info.Process);
            return Process.GetProcessById(info.Pid);
        }
        finally { CloseHandle(primary); }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Startup
    {
        public int Size;
        public string Reserved, Desktop, Title;
        public int X, Y, Width, Height, XCount, YCount, Fill, Flags;
        public short Show, ReservedLength;
        public IntPtr ReservedData, In, Out, Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo
    { public IntPtr Process, Thread; public int Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] private struct MessageData
    { public IntPtr Window; public uint Message; public IntPtr WParam, LParam; public uint Time; public Point Point; public uint Private; }
    private delegate void EventCallback(IntPtr hook, uint type, IntPtr window, int obj, int child, uint thread, uint time);
    private delegate bool WindowCallback(IntPtr window, IntPtr state);

    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr state);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(IntPtr window, StringBuilder name, int length);
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)] private static extern int SetWindowLong(IntPtr window, int index, int value);
    [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint low, uint high, IntPtr module, EventCallback callback, uint pid, uint thread, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out MessageData message, IntPtr window, uint low, uint high, uint remove);
    [DllImport("user32.dll")] private static extern int GetMessage(out MessageData message, IntPtr window, uint low, uint high);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr info, int size, out int length);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attributes, int level, int kind, out IntPtr copy);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateProcessWithTokenW(IntPtr token,
        uint logon, string executable, StringBuilder command, uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInfo info);
}
