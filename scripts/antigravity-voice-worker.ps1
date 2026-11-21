$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -ReferencedAssemblies @(
  'System.Drawing',
  'System.Windows.Forms',
  'UIAutomationClient',
  'UIAutomationTypes',
  'WindowsBase'
) -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

public static class AntigravityVoiceBridge {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDPIAware();

  [DllImport("oleacc.dll")]
  public static extern int AccessibleObjectFromWindow(
    IntPtr hwnd,
    uint dwId,
    ref Guid riid,
    [MarshalAs(UnmanagedType.IDispatch)] out object ppvObject
  );

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumerator {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig]
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
    [PreserveSig]
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
  }

  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    [PreserveSig]
    int GetCount(out uint pcDevices);
    [PreserveSig]
    int Item(uint nDevice, out IMMDevice ppDevice);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig]
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
  }

  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int NotImpl1();
    int NotImpl2();
    [PreserveSig]
    int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
  }

  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig]
    int GetCount(out int SessionCount);
    [PreserveSig]
    int GetSession(int SessionCount, out IAudioSessionControl2 Session);
  }

  [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int state);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, [MarshalAs(UnmanagedType.LPStruct)] Guid EventContext);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, [MarshalAs(UnmanagedType.LPStruct)] Guid EventContext);
    int GetGroupingParam(out Guid pRetVal);
    int SetGroupingParam([MarshalAs(UnmanagedType.LPStruct)] Guid Override, [MarshalAs(UnmanagedType.LPStruct)] Guid EventContext);
    int RegisterAudioSessionNotification(IntPtr NewNotifications);
    int UnregisterAudioSessionNotification(IntPtr NewNotifications);
    [PreserveSig]
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    [PreserveSig]
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    [PreserveSig]
    int GetProcessId(out uint pRetVal);
    [PreserveSig]
    int IsSystemSoundsSession();
    [PreserveSig]
    int SetDuckingPreference(bool optOut);
  }

  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    [PreserveSig]
    int SetMasterVolume(float fLevel, ref Guid EventContext);
    [PreserveSig]
    int GetMasterVolume(out float pfLevel);
    [PreserveSig]
    int SetMute(bool bMute, ref Guid EventContext);
    [PreserveSig]
    int GetMute(out bool pbMute);
  }

  static int MuteMatchingSessionsOnDevice(IMMDevice device, string procSubstr, bool mute) {
    if (device == null) return 0;
    int updated = 0;
    object mgrObj = null;
    IAudioSessionEnumerator sessionEnum = null;
    try {
      Guid iidMgr = typeof(IAudioSessionManager2).GUID;
      int hr = device.Activate(ref iidMgr, 23, IntPtr.Zero, out mgrObj);
      if (hr != 0 || mgrObj == null) return 0;
      var mgr = (IAudioSessionManager2)mgrObj;
      hr = mgr.GetSessionEnumerator(out sessionEnum);
      if (hr != 0 || sessionEnum == null) return 0;
      int count = 0;
      sessionEnum.GetCount(out count);
      Guid evtCtx = Guid.Empty;
      for (int i = 0; i < count; i++) {
        IAudioSessionControl2 ctl = null;
        try {
          if (sessionEnum.GetSession(i, out ctl) != 0 || ctl == null) continue;
          uint pid = 0;
          ctl.GetProcessId(out pid);
          if (pid == 0) continue;
          string pname = "";
          try { pname = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName ?? ""; } catch { continue; }
          if (pname.IndexOf(procSubstr, StringComparison.OrdinalIgnoreCase) < 0) continue;
          var vol = ctl as ISimpleAudioVolume;
          if (vol != null) {
            bool curMute = false;
            vol.GetMute(out curMute);
            if (curMute != mute) {
              vol.SetMute(mute, ref evtCtx);
            }
            updated++;
          }
        } finally {
          if (ctl != null) try { Marshal.ReleaseComObject(ctl); } catch {}
        }
      }
    } finally {
      if (sessionEnum != null) try { Marshal.ReleaseComObject(sessionEnum); } catch {}
      if (mgrObj != null) try { Marshal.ReleaseComObject(mgrObj); } catch {}
    }
    return updated;
  }

  static int SetProcessMute(string procSubstr, bool mute) {
    int touched = 0;
    object enumObj = null;
    IMMDeviceCollection col = null;
    try {
      enumObj = new MMDeviceEnumerator();
      var enumerator = (IMMDeviceEnumerator)enumObj;
      if (enumerator.EnumAudioEndpoints(0, 1, out col) == 0 && col != null) {
        uint devCount = 0;
        col.GetCount(out devCount);
        for (uint i = 0; i < devCount; i++) {
          IMMDevice dev = null;
          try {
            if (col.Item(i, out dev) == 0 && dev != null) {
              touched += MuteMatchingSessionsOnDevice(dev, procSubstr, mute);
            }
          } finally {
            if (dev != null) try { Marshal.ReleaseComObject(dev); } catch {}
          }
        }
      } else {
        foreach (int role in new int[] { 1, 2 }) {
          IMMDevice dev = null;
          try {
            if (enumerator.GetDefaultAudioEndpoint(0, role, out dev) == 0 && dev != null) {
              touched += MuteMatchingSessionsOnDevice(dev, procSubstr, mute);
            }
          } finally {
            if (dev != null) try { Marshal.ReleaseComObject(dev); } catch {}
          }
        }
      }
    } catch {
      // Fall back quietly if COM audio endpoint is unavailable.
    } finally {
      if (col != null) try { Marshal.ReleaseComObject(col); } catch {}
      if (enumObj != null) try { Marshal.ReleaseComObject(enumObj); } catch {}
    }
    return touched;
  }

  const uint OBJID_CLIENT = 0xFFFFFFFC;
  static readonly Guid IID_IAccessible = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");

  const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  const uint MOUSEEVENTF_LEFTUP = 0x0004;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const byte VK_LWIN = 0x5B;
  const byte VK_H = 0x48;

  static readonly Regex RecordRx = new Regex(
    @"(\b(?:record\w*|dictat\w*|transcrib\w*)\b|ghi âm)",
    RegexOptions.IgnoreCase
  );
  static readonly Regex VoiceModeRx = new Regex(
    @"(\bvoice\s*mode\b|\blive\s*voice\b|\bvoice\s*chat\b|\btalk\s*mode\b|\bstart\s*voice\b|\bstop\s*voice\b|\bend\s*voice\b|\bvoice\b|chế độ thoại|đàm thoại)",
    RegexOptions.IgnoreCase
  );
  static readonly Regex SendOnlyRx = new Regex(@"^(send|submit|gửi)\b", RegexOptions.IgnoreCase);

  static AntigravityVoiceBridge() {
    try { SetProcessDPIAware(); } catch {}
  }

  static string EscapeJson(string s) {
    if (string.IsNullOrEmpty(s)) return "";
    return s.Replace("\\", "\\\\")
      .Replace("\"", "\\\"")
      .Replace("\r", " ")
      .Replace("\n", " ")
      .Replace("\t", " ");
  }

  static void WriteDebugLog(string chosenMethod, int renderCount, List<UiaButtonNode> nodes, string note) {
    try {
      string dir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".gemini", "antigravity", "plugin_data", "fairy-zzz"
      );
      Directory.CreateDirectory(dir);
      string path = Path.Combine(dir, "voice-debug.json");
      var sb = new StringBuilder();
      sb.Append("{");
      sb.Append("\"ts\":\"").Append(DateTime.UtcNow.ToString("o")).Append("\",");
      sb.Append("\"chosenMethod\":\"").Append(EscapeJson(chosenMethod)).Append("\",");
      sb.Append("\"note\":\"").Append(EscapeJson(note)).Append("\",");
      sb.Append("\"renderHwndCount\":").Append(renderCount).Append(",");
      sb.Append("\"buttonCount\":").Append(nodes != null ? nodes.Count : 0).Append(",");
      sb.Append("\"buttons\":[");
      if (nodes != null) {
        for (int i = 0; i < nodes.Count; i++) {
          var n = nodes[i];
          if (i > 0) sb.Append(",");
          sb.Append("{");
          sb.Append("\"label\":\"").Append(EscapeJson(n.Label)).Append("\",");
          sb.Append("\"combined\":\"").Append(EscapeJson(n.Combined)).Append("\",");
          sb.Append("\"x\":").Append((int)Math.Round(n.Rect.Left)).Append(",");
          sb.Append("\"y\":").Append((int)Math.Round(n.Rect.Top)).Append(",");
          sb.Append("\"w\":").Append((int)Math.Round(n.Rect.Width)).Append(",");
          sb.Append("\"h\":").Append((int)Math.Round(n.Rect.Height));
          sb.Append("}");
        }
      }
      sb.Append("]}");
      File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
    } catch {}
  }

  public static IntPtr FindAntigravityWindow() {
    IntPtr best = IntPtr.Zero;
    long bestArea = 0;

    EnumWindows((hwnd, lp) => {
      if (!IsWindowVisible(hwnd)) return true;
      var cls = new StringBuilder(128);
      GetClassName(hwnd, cls, 128);
      if (!cls.ToString().StartsWith("Chrome_WidgetWin", StringComparison.OrdinalIgnoreCase)) return true;

      var sb = new StringBuilder(256);
      GetWindowText(hwnd, sb, 256);
      string title = sb.ToString();
      if (string.IsNullOrEmpty(title)) return true;
      if (title.IndexOf("Fairy III", StringComparison.OrdinalIgnoreCase) >= 0) return true;
      if (title.IndexOf("Antigravity", StringComparison.OrdinalIgnoreCase) < 0) {
        try {
          uint pid;
          GetWindowThreadProcessId(hwnd, out pid);
          var p = System.Diagnostics.Process.GetProcessById((int)pid);
          if (p.ProcessName.IndexOf("Antigravity", StringComparison.OrdinalIgnoreCase) < 0) return true;
        } catch {
          return true;
        }
      }

      RECT rc;
      if (!GetWindowRect(hwnd, out rc)) return true;
      long w = rc.Right - rc.Left;
      long h = rc.Bottom - rc.Top;
      if (w < 320 || h < 240) return true;
      long area = w * h;
      if (area > bestArea) {
        bestArea = area;
        best = hwnd;
      }
      return true;
    }, IntPtr.Zero);

    return best;
  }

  public static void FocusWindow(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return;
    if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
    IntPtr fg = GetForegroundWindow();
    uint curTid = GetCurrentThreadId();
    uint dummy;
    uint fgTid = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out dummy) : 0;
    if (fgTid != 0 && fgTid != curTid) AttachThreadInput(curTid, fgTid, true);
    SetForegroundWindow(hwnd);
    if (fgTid != 0 && fgTid != curTid) AttachThreadInput(curTid, fgTid, false);
    Thread.Sleep(70);
  }

  static void ClickAt(int x, int y) {
    SetCursorPos(x, y);
    Thread.Sleep(25);
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    Thread.Sleep(25);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
  }

  static bool ActivateElement(AutomationElement el, System.Windows.Rect br) {
    try {
      object pat;
      if (el.TryGetCurrentPattern(InvokePattern.Pattern, out pat)) {
        ((InvokePattern)pat).Invoke();
        return true;
      }
    } catch {}
    ClickAt((int)(br.Left + br.Width / 2.0), (int)(br.Top + br.Height / 2.0));
    return true;
  }

  sealed class UiaButtonNode {
    public AutomationElement Element;
    public System.Windows.Rect Rect;
    public double CenterY;
    public string Label;
    public string Combined;
  }

  static List<IntPtr> WakeRenderWidgetHosts(IntPtr parentHwnd) {
    var renderHwnds = new List<IntPtr>();
    EnumChildWindows(parentHwnd, (child, lp) => {
      var cls = new StringBuilder(128);
      GetClassName(child, cls, 128);
      string name = cls.ToString();
      if (name.Equals("Chrome_RenderWidgetHostHWND", StringComparison.OrdinalIgnoreCase) ||
          name.IndexOf("RenderWidgetHost", StringComparison.OrdinalIgnoreCase) >= 0) {
        renderHwnds.Add(child);
      }
      return true;
    }, IntPtr.Zero);

    // Send MSAA OBJID_CLIENT probe via oleacc so Chromium exposes AXPlatformNodeWin.
    var targets = new List<IntPtr>(renderHwnds);
    if (targets.Count == 0) targets.Add(parentHwnd);

    foreach (IntPtr h in targets) {
      object accObj = null;
      try {
        Guid iid = IID_IAccessible;
        AccessibleObjectFromWindow(h, OBJID_CLIENT, ref iid, out accObj);
      } catch {} finally {
        if (accObj != null) {
          try { Marshal.ReleaseComObject(accObj); } catch {}
        }
      }
    }
    return renderHwnds;
  }

  static List<UiaButtonNode> QueryButtonsFromHandle(IntPtr rootHwnd, double minTop) {
    var nodes = new List<UiaButtonNode>();
    AutomationElement root = null;
    try { root = AutomationElement.FromHandle(rootHwnd); } catch { return nodes; }
    if (root == null) return nodes;

    var cond = new OrCondition(
      new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
      new OrCondition(
        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.CheckBox),
        new OrCondition(
          new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.SplitButton),
          new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Custom)
        )
      )
    );

    AutomationElementCollection elements = null;
    try {
      elements = root.FindAll(TreeScope.Descendants, cond);
    } catch {
      return nodes;
    }
    if (elements == null || elements.Count == 0) return nodes;

    foreach (AutomationElement el in elements) {
      string name = "";
      string help = "";
      string autoId = "";
      try {
        name = el.Current.Name ?? "";
        help = el.Current.HelpText ?? "";
        autoId = el.Current.AutomationId ?? "";
      } catch { continue; }

      var br = System.Windows.Rect.Empty;
      try { br = el.Current.BoundingRectangle; } catch { continue; }
      if (br.IsEmpty || br.Width < 10 || br.Height < 10 || br.Width > 140 || br.Height > 80) continue;
      if (br.Top < minTop) continue;

      nodes.Add(new UiaButtonNode {
        Element = el,
        Rect = br,
        CenterY = br.Top + br.Height / 2.0,
        Label = name.Trim(),
        Combined = (name + " " + help + " " + autoId).Trim(),
      });
    }
    return nodes;
  }

  static List<UiaButtonNode> CollectComposerButtonsWithWakeup(IntPtr hwnd, RECT winRc, out int renderCount) {
    var renderHwnds = WakeRenderWidgetHosts(hwnd);
    renderCount = renderHwnds.Count;
    double minTop = winRc.Top + (winRc.Bottom - winRc.Top) * 0.55;

    var searchHandles = new List<IntPtr>();
    // Prefer waking/querying child RenderWidgetHost HWNDs first, then top-level window.
    for (int i = renderHwnds.Count - 1; i >= 0; i--) {
      searchHandles.Add(renderHwnds[i]);
    }
    searchHandles.Add(hwnd);

    var bestNodes = new List<UiaButtonNode>();
    for (int attempt = 0; attempt < 4; attempt++) {
      foreach (IntPtr h in searchHandles) {
        var found = QueryButtonsFromHandle(h, minTop);
        if (found.Count > bestNodes.Count) bestNodes = found;
        if (bestNodes.Count >= 2) return bestNodes;
      }
      if (attempt < 3) Thread.Sleep(110);
    }
    return bestNodes;
  }

  static List<UiaButtonNode> FindBottomComposerRow(List<UiaButtonNode> nodes) {
    var rows = new List<List<UiaButtonNode>>();
    foreach (var btn in nodes) {
      if (btn.Rect.Width > 80 || btn.Rect.Height > 56) continue;
      bool added = false;
      foreach (var row in rows) {
        if (Math.Abs(btn.CenterY - row[0].CenterY) <= 14.0) {
          row.Add(btn);
          added = true;
          break;
        }
      }
      if (!added) rows.Add(new List<UiaButtonNode> { btn });
    }

    List<UiaButtonNode> bottomRow = null;
    double maxRowY = double.MinValue;
    foreach (var row in rows) {
      if (row.Count < 2) continue;
      double avgY = 0;
      foreach (var b in row) avgY += b.CenterY;
      avgY /= row.Count;
      if (avgY > maxRowY) {
        maxRowY = avgY;
        bottomRow = row;
      }
    }
    if (bottomRow != null) {
      bottomRow.Sort((a, b) => a.Rect.Left.CompareTo(b.Rect.Left));
    }
    return bottomRow;
  }

  static bool TryClickVoiceModeViaUia(IntPtr hwnd, RECT winRc, out string method) {
    method = "";
    int renderCount = 0;
    List<UiaButtonNode> nodes = null;
    try {
      nodes = CollectComposerButtonsWithWakeup(hwnd, winRc, out renderCount);
      if (nodes == null || nodes.Count == 0) {
        WriteDebugLog("uia-empty", renderCount, nodes, "no_uia_nodes_after_oleacc");
        return false;
      }

      // Priority 1: Explicit Voice Mode label (not Record, not Send).
      // Prefer bottom-most / rightmost match in case another label matches higher up.
      UiaButtonNode voiceMatch = null;
      foreach (var n in nodes) {
        if (VoiceModeRx.IsMatch(n.Combined) && !RecordRx.IsMatch(n.Combined) && !SendOnlyRx.IsMatch(n.Label)) {
          if (voiceMatch == null || n.CenterY > voiceMatch.CenterY + 6.0 ||
              (Math.Abs(n.CenterY - voiceMatch.CenterY) <= 6.0 && n.Rect.Left > voiceMatch.Rect.Left)) {
            voiceMatch = n;
          }
        }
      }
      if (voiceMatch != null) {
        ActivateElement(voiceMatch.Element, voiceMatch.Rect);
        method = "uia-voice-mode:" + voiceMatch.Label;
        WriteDebugLog(method, renderCount, nodes, "priority1");
        return true;
      }

      // Priority 2: Sibling immediately to the RIGHT of Record button.
      UiaButtonNode recordNode = null;
      foreach (var n in nodes) {
        if (RecordRx.IsMatch(n.Combined)) {
          if (recordNode == null || n.CenterY > recordNode.CenterY) recordNode = n;
        }
      }
      if (recordNode != null) {
        UiaButtonNode rightSibling = null;
        double bestDist = double.MaxValue;
        foreach (var n in nodes) {
          if (n.Element == recordNode.Element) continue;
          if (Math.Abs(n.CenterY - recordNode.CenterY) <= 16.0 && n.Rect.Left >= recordNode.Rect.Right - 6.0) {
            double dist = n.Rect.Left - recordNode.Rect.Right;
            if (dist <= 64.0 && dist < bestDist) {
              bestDist = dist;
              rightSibling = n;
            }
          }
        }
        if (rightSibling != null) {
          if (!SendOnlyRx.IsMatch(rightSibling.Label)) {
            ActivateElement(rightSibling.Element, rightSibling.Rect);
            method = "uia-right-of-record";
            WriteDebugLog(method, renderCount, nodes, "priority2_sibling");
            return true;
          }
        } else {
          int tx = (int)(recordNode.Rect.Right + Math.Max(20.0, recordNode.Rect.Width * 1.15));
          int ty = (int)recordNode.CenterY;
          ClickAt(tx, ty);
          method = "uia-right-offset-from-record:" + tx + "," + ty;
          WriteDebugLog(method, renderCount, nodes, "priority2_offset");
          return true;
        }
      }

      // Priority 3: Bottom composer row rightmost button (when neither Send nor Record).
      var bottomRow = FindBottomComposerRow(nodes);
      if (bottomRow != null && bottomRow.Count >= 2) {
        var rightBtn = bottomRow[bottomRow.Count - 1];
        if (!SendOnlyRx.IsMatch(rightBtn.Label) && !RecordRx.IsMatch(rightBtn.Combined)) {
          ActivateElement(rightBtn.Element, rightBtn.Rect);
          method = "uia-dom-row-rightmost";
          WriteDebugLog(method, renderCount, nodes, "priority3_row");
          return true;
        }
      }

      WriteDebugLog("uia-no-match", renderCount, nodes, "fallthrough_to_pixel");
    } catch (Exception ex) {
      WriteDebugLog("uia-error", renderCount, nodes, ex.Message);
    }
    return false;
  }

  static bool IsBluePixel(Color c, int pass) {
    if (pass == 0) {
      return c.B > 185 && c.R < 115 && c.G > 95 && c.G < 190 && (c.B - c.R) > 70;
    }
    return c.B > 90 && (c.B - c.R) > 30 && (c.B - c.G) > 12 && c.R < 95;
  }

  static double Luma(Color c) {
    return 0.299 * c.R + 0.587 * c.G + 0.114 * c.B;
  }

  static double EstimateBackgroundLuma(Bitmap bmp, int xFrom, int xTo, int yFrom, int yTo) {
    int[] hist = new int[256];
    int samples = 0;
    for (int y = yFrom; y <= yTo; y += 2) {
      for (int x = xFrom; x <= xTo; x += 3) {
        int l = Math.Max(0, Math.Min(255, (int)Math.Round(Luma(bmp.GetPixel(x, y)))));
        hist[l]++;
        samples++;
      }
    }
    if (samples == 0) return 30.0;
    int target = samples / 2;
    int acc = 0;
    for (int i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 30.0;
  }

  struct PixelCluster {
    public int StartX, EndX, MinY, MaxY, Count;
    public long SumX, SumY;
  }

  static List<PixelCluster> SegmentHorizontalClusters(
    Bitmap bmp,
    int xFrom,
    int xTo,
    int yFrom,
    int yTo,
    Func<Color, bool> isHit,
    int minColHits,
    int maxGap
  ) {
    int width = xTo - xFrom + 1;
    var active = new bool[width];
    var colMinY = new int[width];
    var colMaxY = new int[width];
    var colCount = new int[width];
    var colSumX = new long[width];
    var colSumY = new long[width];

    for (int x = xFrom; x <= xTo; x++) {
      int idx = x - xFrom;
      int cnt = 0;
      int minY = int.MaxValue;
      int maxY = int.MinValue;
      long sy = 0;
      for (int y = yFrom; y <= yTo; y++) {
        Color c = bmp.GetPixel(x, y);
        if (isHit(c)) {
          cnt++;
          sy += y;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (cnt >= minColHits) {
        active[idx] = true;
        colCount[idx] = cnt;
        colMinY[idx] = minY;
        colMaxY[idx] = maxY;
        colSumX[idx] = (long)x * cnt;
        colSumY[idx] = sy;
      }
    }

    var clusters = new List<PixelCluster>();
    int i = 0;
    while (i < width) {
      if (!active[i]) { i++; continue; }
      int start = i;
      int end = i;
      while (true) {
        int next = -1;
        int limit = Math.Min(width - 1, end + 1 + maxGap);
        for (int k = end + 1; k <= limit; k++) {
          if (active[k]) { next = k; break; }
        }
        if (next < 0) break;
        end = next;
      }

      var cl = new PixelCluster {
        StartX = xFrom + start,
        EndX = xFrom + end,
        MinY = int.MaxValue,
        MaxY = int.MinValue,
        Count = 0,
        SumX = 0,
        SumY = 0
      };
      for (int k = start; k <= end; k++) {
        if (!active[k]) continue;
        cl.Count += colCount[k];
        cl.SumX += colSumX[k];
        cl.SumY += colSumY[k];
        if (colMinY[k] < cl.MinY) cl.MinY = colMinY[k];
        if (colMaxY[k] > cl.MaxY) cl.MaxY = colMaxY[k];
      }
      clusters.Add(cl);
      i = end + 1;
    }
    return clusters;
  }

  public static Point FindRightmostButtonInBitmap(Bitmap bmp, int originX, int originY) {
    int w = bmp.Width;
    int h = bmp.Height;
    if (w < 40 || h < 20) return Point.Empty;

    int xFrom = Math.Max(0, (int)(w * 0.45));
    int xTo = Math.Max(xFrom + 1, w - 10);
    int blueYFrom = Math.Max(0, h - 110);
    int blueYTo = Math.Max(blueYFrom + 1, h - 6);

    // Passes 0 & 1: cluster rightmost blue circle (Send/Active Voice Mode), ignoring stray blue elements elsewhere.
    for (int pass = 0; pass < 2; pass++) {
      int p = pass;
      var clusters = SegmentHorizontalClusters(
        bmp, xFrom, xTo, blueYFrom, blueYTo,
        c => IsBluePixel(c, p),
        minColHits: 2,
        maxGap: 4
      );
      for (int idx = clusters.Count - 1; idx >= 0; idx--) {
        var cl = clusters[idx];
        int bw = cl.EndX - cl.StartX + 1;
        int bh = cl.MaxY - cl.MinY + 1;
        if (cl.Count >= 45 && bw >= 10 && bw <= 48 && bh >= 10 && bh <= 48 && Math.Abs(bw - bh) <= 14) {
          int cx = (int)Math.Round((double)cl.SumX / cl.Count);
          int cy = (int)Math.Round((double)cl.SumY / cl.Count);
          return new Point(originX + cx, originY + cy);
        }
      }
    }

    // Pass 2: Monochrome / empty-composer / dark-theme toolbar cluster segmentation.
    int bandYFrom = Math.Max(0, h - 68);
    int bandYTo = Math.Max(bandYFrom + 1, h - 12);
    double bgLuma = EstimateBackgroundLuma(bmp, xFrom, xTo, bandYFrom, bandYTo);
    bool darkBg = bgLuma < 128.0;

    Func<Color, bool> isMonoFg = c => {
      double l = Luma(c);
      return darkBg ? (l > Math.Max(52.0, bgLuma + 22.0)) : (l < bgLuma - 28.0);
    };

    // Locate the active horizontal icon row (ignoring full-width 1px composer borders).
    int scanSpan = xTo - xFrom + 1;
    int bestRow = -1;
    int bestRowScore = 0;
    for (int y = bandYFrom; y <= bandYTo; y++) {
      int rowHits = 0;
      for (int x = xFrom; x <= xTo; x++) {
        if (isMonoFg(bmp.GetPixel(x, y))) rowHits++;
      }
      // Reject wide horizontal borders (>55% of scanned width).
      if (rowHits > scanSpan * 0.55) continue;
      if (rowHits >= bestRowScore && rowHits >= 8) {
        bestRowScore = rowHits;
        bestRow = y;
      }
    }

    int rowFrom = bestRow >= 0 ? Math.Max(0, bestRow - 12) : Math.Max(0, h - 58);
    int rowTo = bestRow >= 0 ? Math.Min(h - 4, bestRow + 12) : Math.Max(rowFrom + 1, h - 14);

    var monoClusters = SegmentHorizontalClusters(
      bmp, xFrom, xTo, rowFrom, rowTo,
      isMonoFg,
      minColHits: 2,
      maxGap: 4
    );

    for (int idx = monoClusters.Count - 1; idx >= 0; idx--) {
      var cl = monoClusters[idx];
      int bw = cl.EndX - cl.StartX + 1;
      int bh = cl.MaxY - cl.MinY + 1;
      // Filter valid toolbar button/circle width (5..44px) & height (>=7px avoids 1-2px borders).
      if (bw >= 5 && bw <= 44 && bh >= 7 && bh <= 44 && cl.Count >= 18) {
        int cx = (cl.StartX + cl.EndX) / 2;
        int cy = (int)Math.Round((double)cl.SumY / cl.Count);
        return new Point(originX + cx, originY + cy);
      }
    }

    return Point.Empty;
  }

  static bool TryClickVoiceModeViaPixel(IntPtr hwnd, RECT winRc, out string method) {
    method = "";
    int winW = winRc.Right - winRc.Left;
    int winH = winRc.Bottom - winRc.Top;
    int stripH = Math.Min(150, Math.Max(80, winH / 6));
    int stripX = winRc.Left + (int)(winW * 0.25);
    int stripW = Math.Max(200, winRc.Right - stripX);
    int stripY = winRc.Bottom - stripH;

    using (Bitmap bmp = new Bitmap(stripW, stripH)) {
      using (Graphics g = Graphics.FromImage(bmp)) {
        g.CopyFromScreen(stripX, stripY, 0, 0, new Size(stripW, stripH));
      }
      Point pt = FindRightmostButtonInBitmap(bmp, stripX, stripY);
      if (!pt.IsEmpty) {
        ClickAt(pt.X, pt.Y);
        method = "pixel-voice-mode:" + pt.X + "," + pt.Y;
        return true;
      }
    }
    return false;
  }

  static IntPtr _cachedParentHwnd = IntPtr.Zero;
  static List<IntPtr> _cachedRenderHwnds = new List<IntPtr>();
  static long _lastWakeTick = 0;

  static List<IntPtr> EnsureRenderWidgetHosts(IntPtr parentHwnd, bool forceWake) {
    long nowTick = Environment.TickCount & 0x7FFFFFFF;
    if (!forceWake && _cachedParentHwnd == parentHwnd && _cachedRenderHwnds.Count > 0 &&
        nowTick >= _lastWakeTick && (nowTick - _lastWakeTick) < 15000) {
      return _cachedRenderHwnds;
    }
    var list = WakeRenderWidgetHosts(parentHwnd);
    _cachedParentHwnd = parentHwnd;
    _cachedRenderHwnds = list;
    _lastWakeTick = nowTick;
    return list;
  }

  sealed class UiaTextItem {
    public System.Windows.Rect Rect;
    public double CenterY;
    public string Text;
    public ControlType Kind;
  }

  static void CollectSubtreeTextAndButtons(IntPtr rootHwnd, OrCondition cond, double minTop, List<UiaTextItem> outItems) {
    AutomationElement root = null;
    try { root = AutomationElement.FromHandle(rootHwnd); } catch { return; }
    if (root == null) return;
    AutomationElementCollection all = null;
    try { all = root.FindAll(TreeScope.Descendants, cond); } catch { return; }
    if (all == null || all.Count == 0) return;

    foreach (AutomationElement el in all) {
      string name = "";
      ControlType ct = null;
      System.Windows.Rect br = System.Windows.Rect.Empty;
      try {
        name = (el.Current.Name ?? "").Trim();
        if (string.IsNullOrEmpty(name)) continue;
        ct = el.Current.ControlType;
        br = el.Current.BoundingRectangle;
      } catch { continue; }

      if (br.IsEmpty || br.Width < 4 || br.Height < 8) continue;
      if (br.Top < minTop) continue;

      outItems.Add(new UiaTextItem {
        Rect = br,
        CenterY = br.Top + br.Height / 2.0,
        Text = name,
        Kind = ct
      });
    }
  }

  static string ReadVoiceModeSubtitle(IntPtr hwnd, RECT winRc) {
    try {
      int winW = winRc.Right - winRc.Left;
      int winH = winRc.Bottom - winRc.Top;
      double minTop = winRc.Top + winH * 0.40;

      var items = new List<UiaTextItem>();
      var cond = new OrCondition(
        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text),
        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)
      );

      for (int pass = 0; pass < 2; pass++) {
        var renderHwnds = EnsureRenderWidgetHosts(hwnd, pass > 0);
        for (int i = renderHwnds.Count - 1; i >= 0; i--) {
          CollectSubtreeTextAndButtons(renderHwnds[i], cond, minTop, items);
        }
        if (items.Count == 0) {
          CollectSubtreeTextAndButtons(hwnd, cond, minTop, items);
        }
        if (items.Count > 0) break;
      }

      if (items.Count == 0) {
        return "{\"ok\":true,\"voiceOpen\":false,\"subtitle\":\"\"}";
      }

      UiaTextItem endBtn = null;
      UiaTextItem timerItem = null;
      UiaTextItem agItem = null;
      var timerRx = new Regex(@"^(?:Antigravity\s+)?(\d{1,2}:\d{2})$", RegexOptions.IgnoreCase);
      var endRx = new Regex(@"^(?:[×✕xX]\s*)?(End|End\s+voice.*|Stop\s+voice.*|Kết\s+thúc.*)$", RegexOptions.IgnoreCase);

      foreach (var it in items) {
        if (it.Kind == ControlType.Button && endRx.IsMatch(it.Text) && it.Rect.Left >= winRc.Left + winW * 0.35) {
          if (endBtn == null || it.CenterY > endBtn.CenterY) endBtn = it;
        } else if (it.Kind == ControlType.Text && timerRx.IsMatch(it.Text)) {
          if (timerItem == null || it.CenterY > timerItem.CenterY) timerItem = it;
        } else if (it.Kind == ControlType.Text && it.Text.Equals("Antigravity", StringComparison.OrdinalIgnoreCase)) {
          if (agItem == null || it.CenterY > agItem.CenterY) agItem = it;
        }
      }

      bool voiceOpen = false;
      double headerBottom = 0;
      double cardLeft = winRc.Left + winW * 0.25;
      double cardRight = winRc.Right - 8;
      string timerText = "";

      if (endBtn != null) {
        int headerSiblings = 0;
        double minRowX = endBtn.Rect.Left;
        foreach (var it in items) {
          if (it == endBtn) continue;
          if (Math.Abs(it.CenterY - endBtn.CenterY) <= 24.0 && it.Rect.Right <= endBtn.Rect.Left + 8) {
            if (it.Kind == ControlType.Button) headerSiblings++;
            if (it.Rect.Left < minRowX && it.Rect.Left >= winRc.Left + winW * 0.15) {
              minRowX = it.Rect.Left;
            }
          }
        }
        bool hasTimerOnRow = timerItem != null && Math.Abs(timerItem.CenterY - endBtn.CenterY) <= 28.0;
        bool hasAgOnRow = agItem != null && Math.Abs(agItem.CenterY - endBtn.CenterY) <= 28.0;
        if (hasTimerOnRow || hasAgOnRow || headerSiblings >= 2) {
          voiceOpen = true;
          headerBottom = endBtn.Rect.Bottom;
          if (hasTimerOnRow) {
            headerBottom = Math.Max(headerBottom, timerItem.Rect.Bottom);
            timerText = timerRx.Match(timerItem.Text).Groups[1].Value;
            minRowX = Math.Min(minRowX, timerItem.Rect.Left - 90);
          }
          if (hasAgOnRow) {
            minRowX = Math.Min(minRowX, agItem.Rect.Left - 24);
          }
          cardLeft = Math.Max(winRc.Left + 10, minRowX - 36);
          cardRight = Math.Min(winRc.Right - 4, endBtn.Rect.Right + 24);
        }
      } else if (timerItem != null && agItem != null && Math.Abs(timerItem.CenterY - agItem.CenterY) <= 22.0) {
        voiceOpen = true;
        headerBottom = Math.Max(timerItem.Rect.Bottom, agItem.Rect.Bottom);
        cardLeft = Math.Max(winRc.Left + 10, agItem.Rect.Left - 36);
        timerText = timerRx.Match(timerItem.Text).Groups[1].Value;
      }

      if (!voiceOpen) {
        return "{\"ok\":true,\"voiceOpen\":false,\"subtitle\":\"\"}";
      }

      double cardBottomLimit = Math.Min((double)(winRc.Bottom - 16), headerBottom + 260.0);
      var composerLimitRx = new Regex(@"(Start\s+Voice\s+mode|Record\s+voice\s+memo|Add\s+context|^\s*Send\s*$)", RegexOptions.IgnoreCase);
      foreach (var it in items) {
        if (it.Kind == ControlType.Button && it.Rect.Top > headerBottom + 8 && composerLimitRx.IsMatch(it.Text)) {
          if (it.Rect.Top < cardBottomLimit) cardBottomLimit = it.Rect.Top;
        }
      }

      var skipTextRx = new Regex(@"^(?:[×✕xX]|End|Planning|Fast|Turbo|Model|Ask anything.*|Type a message.*|\d{1,2}:\d{2})$", RegexOptions.IgnoreCase);
      var subNodes = new List<UiaTextItem>();
      foreach (var it in items) {
        if (it.Kind != ControlType.Text) continue;
        if (agItem != null && (it == agItem || Math.Abs(it.CenterY - agItem.CenterY) <= 10.0)) continue;
        if (timerItem != null && (it == timerItem || Math.Abs(it.CenterY - timerItem.CenterY) <= 10.0)) continue;
        if (it.Rect.Top < headerBottom - 2 || it.Rect.Top > cardBottomLimit - 4) continue;
        if (it.Rect.Bottom > cardBottomLimit + 8) continue;
        if (it.Rect.Right < cardLeft || it.Rect.Left > cardRight) continue;
        if (it.Rect.Height < 10) continue;
        string cleaned = Regex.Replace(it.Text, @"\s+", " ").Trim();
        if (string.IsNullOrEmpty(cleaned) || skipTextRx.IsMatch(cleaned)) continue;
        if (!Regex.IsMatch(cleaned, @"[A-Za-zÀ-ỹ0-9.,!?;:…]")) continue;
        subNodes.Add(new UiaTextItem {
          Rect = it.Rect,
          CenterY = it.CenterY,
          Text = cleaned,
          Kind = it.Kind
        });
      }

      // Sắp xếp từng dòng theo CenterY rồi theo Left trên mỗi dòng (tránh comparator không bắc cầu).
      subNodes.Sort((a, b) => a.CenterY.CompareTo(b.CenterY));
      var rows = new List<List<UiaTextItem>>();
      foreach (var node in subNodes) {
        if (rows.Count == 0 || Math.Abs(node.CenterY - rows[rows.Count - 1][0].CenterY) > 10.0) {
          rows.Add(new List<UiaTextItem> { node });
        } else {
          rows[rows.Count - 1].Add(node);
        }
      }
      var orderedNodes = new List<UiaTextItem>();
      foreach (var row in rows) {
        row.Sort((a, b) => a.Rect.Left.CompareTo(b.Rect.Left));
        orderedNodes.AddRange(row);
      }

      // Chỉ khử trùng lặp khi hai node nằm trùng tọa độ hoặc node lớn bao trọn hộp của node nhỏ.
      var keptItems = new List<UiaTextItem>();
      var keptTexts = new List<string>();
      for (int i = 0; i < orderedNodes.Count; i++) {
        var curItem = orderedNodes[i];
        string cur = curItem.Text;
        bool duplicate = false;
        for (int j = 0; j < keptItems.Count; j++) {
          var prev = keptItems[j];
          bool sameSpot = Math.Abs(prev.Rect.Left - curItem.Rect.Left) <= 4.0 &&
            Math.Abs(prev.Rect.Top - curItem.Rect.Top) <= 4.0 &&
            prev.Text.Equals(cur, StringComparison.Ordinal);
          bool enclosedSame = prev.Rect.Left <= curItem.Rect.Left + 2.0 &&
            prev.Rect.Right >= curItem.Rect.Right - 2.0 &&
            prev.Rect.Top <= curItem.Rect.Top + 2.0 &&
            prev.Rect.Bottom >= curItem.Rect.Bottom - 2.0 &&
            prev.Text.Contains(cur);
          if (sameSpot || enclosedSame) {
            duplicate = true;
            break;
          }
        }
        if (!duplicate) {
          keptItems.Add(curItem);
          keptTexts.Add(cur);
        }
      }

      string subtitle = Regex.Replace(string.Join(" ", keptTexts), @"\s+", " ").Trim();
      if (subtitle.Length > 420) subtitle = subtitle.Substring(0, 420);

      return "{\"ok\":true,\"voiceOpen\":true,\"timer\":\"" + EscapeJson(timerText) +
        "\",\"subtitle\":\"" + EscapeJson(subtitle) + "\"}";
    } catch (Exception ex) {
      return "{\"ok\":false,\"voiceOpen\":false,\"subtitle\":\"\",\"error\":\"" + EscapeJson(ex.Message) + "\"}";
    }
  }

  public static string Execute(string cmd) {
    return Execute(cmd, false);
  }

  public static string Execute(string cmd, bool muteAg) {
    if (cmd == "MUTE_ANTIGRAVITY") {
      int touched = SetProcessMute("Antigravity", true);
      return "{\"ok\":true,\"muted\":true,\"count\":" + touched + "}";
    }
    if (cmd == "UNMUTE_ANTIGRAVITY") {
      int touched = SetProcessMute("Antigravity", false);
      return "{\"ok\":true,\"muted\":false,\"count\":" + touched + "}";
    }

    if (muteAg) {
      SetProcessMute("Antigravity", true);
    }

    IntPtr hwnd = FindAntigravityWindow();
    if (hwnd == IntPtr.Zero) return "{\"ok\":false,\"error\":\"window_not_found\"}";

    RECT winRc;
    GetWindowRect(hwnd, out winRc);

    if (cmd == "READ_VOICE_SUBTITLE") {
      return ReadVoiceModeSubtitle(hwnd, winRc);
    }

    FocusWindow(hwnd);
    GetWindowRect(hwnd, out winRc);
    int winW = winRc.Right - winRc.Left;

    if (cmd == "FOCUS_CHAT") {
      int cx = winRc.Left + (int)(winW * 0.54);
      int cy = winRc.Bottom - 68;
      ClickAt(cx, cy);
      return "{\"ok\":true,\"method\":\"focus-chat\"}";
    }

    if (cmd == "WIN_VOICE") {
      int cx = winRc.Left + (int)(winW * 0.54);
      int cy = winRc.Bottom - 68;
      ClickAt(cx, cy);
      Thread.Sleep(60);
      keybd_event(VK_LWIN, 0, 0, UIntPtr.Zero);
      keybd_event(VK_H, 0, 0, UIntPtr.Zero);
      Thread.Sleep(35);
      keybd_event(VK_H, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
      keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
      return "{\"ok\":true,\"method\":\"win-h\"}";
    }

    if (cmd == "VOICE_MODE" || cmd == "MIC" || cmd == "RECORD_MIC") {
      string method;
      if (TryClickVoiceModeViaUia(hwnd, winRc, out method)) {
        if (muteAg) { Thread.Sleep(120); SetProcessMute("Antigravity", true); }
        return "{\"ok\":true,\"method\":\"" + EscapeJson(method) + "\"}";
      }
      if (TryClickVoiceModeViaPixel(hwnd, winRc, out method)) {
        if (muteAg) { Thread.Sleep(120); SetProcessMute("Antigravity", true); }
        return "{\"ok\":true,\"method\":\"" + EscapeJson(method) + "\"}";
      }
      return "{\"ok\":false,\"error\":\"voice_mode_button_not_found\"}";
    }

    return "{\"ok\":false,\"error\":\"unknown_cmd\"}";
  }
}
'@

Write-Output '{"ready":true}'
[Console]::Out.Flush()

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $id = 0
  try {
    $req = $line | ConvertFrom-Json
    $id = [int]$req.id
    $cmd = [string]$req.cmd
    $muteAg = [bool]($req.PSObject.Properties['muteAg'] -and $req.muteAg)
    $rawJson = [AntigravityVoiceBridge]::Execute($cmd, $muteAg)
    $parsed = $rawJson | ConvertFrom-Json
    $parsed | Add-Member -NotePropertyName id -NotePropertyValue $id -Force
    Write-Output ($parsed | ConvertTo-Json -Compress)
  } catch {
    $errObj = [PSCustomObject]@{
      id = $id
      ok = $false
      error = $_.Exception.Message
    }
    Write-Output ($errObj | ConvertTo-Json -Compress)
  }
  [Console]::Out.Flush()
}
