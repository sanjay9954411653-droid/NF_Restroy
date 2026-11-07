# Sends raw bytes (ESC/POS) to a Windows printer by name — for USB printers.
# Usage: powershell -File rawprint.ps1 -PrinterName "TVS RP 3230" -FilePath C:\temp\job.bin
param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$FilePath
)

$code = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

  public static string Send(string printerName, byte[] data) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
      return "Cannot open printer '" + printerName + "' (Win32 error " + Marshal.GetLastWin32Error() + "). Check the exact name in Settings > Printers.";
    string error = null;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "AuraOS print job";
    di.pDataType = "RAW";
    IntPtr unmanaged = Marshal.AllocCoTaskMem(data.Length);
    try {
      Marshal.Copy(data, 0, unmanaged, data.Length);
      if (!StartDocPrinter(hPrinter, 1, di)) { error = "StartDocPrinter failed (" + Marshal.GetLastWin32Error() + ")"; }
      else {
        if (!StartPagePrinter(hPrinter)) { error = "StartPagePrinter failed (" + Marshal.GetLastWin32Error() + ")"; }
        else {
          int written;
          if (!WritePrinter(hPrinter, unmanaged, data.Length, out written) || written != data.Length)
            error = "WritePrinter failed (" + Marshal.GetLastWin32Error() + ")";
          EndPagePrinter(hPrinter);
        }
        EndDocPrinter(hPrinter);
      }
    } finally {
      Marshal.FreeCoTaskMem(unmanaged);
      ClosePrinter(hPrinter);
    }
    return error;
  }
}
"@

Add-Type -TypeDefinition $code -ErrorAction Stop
$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$err = [RawPrinterHelper]::Send($PrinterName, $bytes)
if ($err) { [Console]::Error.WriteLine($err); exit 1 }
exit 0
