using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal static class Downloader
{
    public sealed class Request
    {
        public string url { get; set; }
        public int quality { get; set; }
        public bool vertical { get; set; }
    }

    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly string Bin = AppDomain.CurrentDomain.BaseDirectory;
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

    [DllImport("shell32.dll")]
    private static extern int SHGetKnownFolderPath(ref Guid id, uint flags, IntPtr token, out IntPtr path);

    private static string Downloads()
    {
        var id = new Guid("374DE290-123F-4565-9164-39C4925E467B");
        IntPtr path;
        Marshal.ThrowExceptionForHR(SHGetKnownFolderPath(ref id, 0, IntPtr.Zero, out path));
        try { return Marshal.PtrToStringUni(path); }
        finally { Marshal.FreeCoTaskMem(path); }
    }

    private static void Main()
    {
        using (var input = new BinaryReader(Console.OpenStandardInput()))
        using (var output = new BinaryWriter(Console.OpenStandardOutput()))
        {
            object result;
            try
            {
                var length = input.ReadInt32();
                if (length < 1 || length > 4096) throw new InvalidDataException();
                var body = input.ReadBytes(length);
                if (body.Length != length) throw new EndOfStreamException();
                var request = Json.Deserialize<Request>(Utf8.GetString(body));
                if (!Valid(request)) throw new InvalidDataException();
                SaveVideo(request);
                result = new { ok = true };
            }
            catch (InvalidDataException)
            {
                result = new { error = "Video bağlantısı veya kalite seçimi geçersiz." };
            }
            catch (Exception error)
            {
                result = new { error = "İndirme başarısız. " + error.Message };
            }

            var bytes = Utf8.GetBytes(Json.Serialize(result));
            output.Write(bytes.Length);
            output.Write(bytes);
            output.Flush();
        }
    }

    private static bool Valid(Request request)
    {
        if (request == null || request.url == null || request.quality != 480 && request.quality != 720) return false;
        return Regex.IsMatch(request.url,
            @"\Ahttps://(?:www\.youtube\.com/(?:watch\?v=[A-Za-z0-9_-]{11}|(?:shorts|live)/[A-Za-z0-9_-]{11})"
            + @"|x\.com/(?:[A-Za-z0-9_]+|i/web)/status/[0-9]+"
            + @"|www\.instagram\.com/(?:p|reel|tv)/[A-Za-z0-9_-]+"
            + @"|www\.tiktok\.com/@[A-Za-z0-9_.-]+/video/[0-9]+)\z");
    }

    private static void SaveVideo(Request request)
    {
        var root = Downloads();
        Directory.CreateDirectory(root);
        var work = Path.Combine(root, ".yesil-video-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);

        try
        {
            string dimension = request.vertical ? "width" : "height";
            string limit = "[" + dimension + "<=" + request.quality + "]";
            string format = "bv" + limit + "+ba/b" + limit + "/bv" + limit + "/bv+ba/b/bv";
            var source = Run("yt-dlp.exe", "--ignore-config", "--no-plugin-dirs",
                "--no-playlist", "--no-simulate", "--no-warnings", "--encoding", "utf-8", "--socket-timeout", "25",
                "--ffmpeg-location", Bin, "--js-runtimes", "deno:" + Path.Combine(Bin, "deno.exe"),
                "-f", format, "-S", "res:" + request.quality + ",vcodec:h264,acodec:aac",
                "--windows-filenames", "--restrict-filenames", "-P", work,
                "-o", "%(title).90s [%(id)s].%(ext)s", "--print", "after_move:filepath", "--", request.url)
                .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).LastOrDefault();
            if (source == null || !File.Exists(source)) throw new IOException("Video dosyası oluşturulamadı.");

            string[] size = Run("ffprobe.exe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height", "-of", "csv=p=0", source).Trim().Split(',');
            int width;
            int height;
            if (size.Length != 2 || !int.TryParse(size[0], out width) || !int.TryParse(size[1], out height))
                throw new IOException("Video çözünürlüğü okunamadı.");

            string output = source;
            if (Math.Min(width, height) > request.quality || !source.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase))
            {
                output = Path.Combine(work, "converted.mp4");
                string scale = width < height ? "scale=" + request.quality + ":-2" : "scale=-2:" + request.quality;
                if (Math.Min(width, height) <= request.quality) scale = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
                Run("ffmpeg.exe", "-nostdin", "-v", "error", "-i", source, "-map", "0:v:0", "-map", "0:a:0?",
                    "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-movflags", "+faststart", output);
            }

            var name = Path.GetFileNameWithoutExtension(source) + " - " + request.quality + "p";
            for (int number = 1; ; number++)
            {
                string suffix = number == 1 ? "" : " (" + number + ")";
                var destination = Path.Combine(root, name + suffix + ".mp4");
                try { File.Move(output, destination); break; }
                catch (IOException) { if (!File.Exists(destination)) throw; }
            }
        }
        finally
        {
            try { Directory.Delete(work, true); }
            catch (IOException) {}
            catch (UnauthorizedAccessException) {}
        }
    }

    private static string Run(string executable, params string[] args)
    {
        var start = new ProcessStartInfo(Path.Combine(Bin, executable), string.Join(" ", args.Select(Quote)))
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        using (var process = Process.Start(start))
        {
            Task<string> stdout = process.StandardOutput.ReadToEndAsync();
            Task<string> stderr = process.StandardError.ReadToEndAsync();
            process.WaitForExit();
            if (process.ExitCode != 0)
            {
                var lines = stderr.Result.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                var last = lines.LastOrDefault() ?? "Araç hata verdi.";
                if (last.Length > 350) last = last.Substring(0, 350);
                throw new IOException(last);
            }
            return stdout.Result;
        }
    }

    private static string Quote(string argument)
    {
        return "\"" + Regex.Replace(argument, @"(\\*)(\""|$)", match =>
        {
            var slashes = new string('\\', 2 * match.Groups[1].Length);
            return match.Groups[2].Value == "\"" ? slashes + "\\\"" : slashes;
        }) + "\"";
    }
}

