// Vox voice engine client for Unity (2021.3+). Free to use in any project.
//
// Setup: put this file anywhere under Assets/, add the VoxClient component to a
// GameObject, and start the server on your machine:  vox serve --ckpt vox.pt
//
//   voxClient.Speak("Halt! Who goes there?", "guard", "angry", 0.7f,
//                   (clip, info) => audioSource.PlayOneShot(clip));
//
//   // Lowest latency: starts playing the first sentence while the rest generates
//   voxClient.SpeakStreaming("A long speech...", "narrator", audioSource);
//
//   // Shipping build with no server: bake lines with `vox bake`, copy the folder to
//   // Assets/StreamingAssets/vox/, then:
//   voxClient.PlayBaked("gob_01", audioSource);

using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

public class VoxClient : MonoBehaviour
{
    [Tooltip("Address of the Vox server. Keep 127.0.0.1 for a local server.")]
    public string serverUrl = "http://127.0.0.1:5150";
    public int sampleRate = 24000;

    [Serializable]
    public class SpeakOptions
    {
        public string text;
        public string voice = "narrator";
        public string emotion;
        public float intensity = 1f;
        public float rate;          // -2 slow .. +2 fast
        public float pitch;         // semitones
        public float pitch_range;   // -1 monotone .. +1 expressive
        public float energy;        // dB
        public string style_prompt; // e.g. "hushed, slightly fearful"
        public int seed = -1;       // -1 = random; set for repeatable lines
        public string translate_to; // e.g. "es": translate the line, then speak it
        public float enunciate;     // 0..1: clearer, more deliberate speech
        public string format = "pcm16";
    }

    public struct LineInfo
    {
        public string take;         // pass to Edit() to change words later
        public float duration;
        public string segmentsJson; // per-sentence timings for subtitles / lip-sync
    }

    // ------------------------------------------------------------------ HTTP
    public void Speak(string text, string voice, string emotion, float intensity,
                      Action<AudioClip, LineInfo> onReady, Action<string> onError = null)
    {
        Speak(new SpeakOptions { text = text, voice = voice, emotion = emotion, intensity = intensity },
              onReady, onError);
    }

    public void Speak(SpeakOptions o, Action<AudioClip, LineInfo> onReady, Action<string> onError = null)
    {
        StartCoroutine(Post("/v1/speak", ToJson(o), onReady, onError));
    }

    /// Edit a previous line: e.g. Edit(info.take, "[{\"op\":\"replace\",\"old\":\"mill\",\"new\":\"tower\"}]", ...)
    public void Edit(string take, string opsJson, Action<AudioClip, LineInfo> onReady, Action<string> onError = null)
    {
        string body = "{\"take\":\"" + take + "\",\"ops\":" + opsJson + "}";
        StartCoroutine(Post("/v1/edit", body, onReady, onError));
    }

    IEnumerator Post(string path, string json, Action<AudioClip, LineInfo> onReady, Action<string> onError)
    {
        using (var req = new UnityWebRequest(serverUrl + path, "POST"))
        {
            req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            yield return req.SendWebRequest();
            if (req.result != UnityWebRequest.Result.Success)
            {
                string msg = "Vox: " + req.error + " " + req.downloadHandler.text;
                if (onError != null) onError(msg); else Debug.LogError(msg);
                yield break;
            }
            byte[] data = req.downloadHandler.data;
            bool isWav = data.Length > 12 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F';
            float[] samples = isWav ? WavToFloats(data, out _) : Pcm16ToFloats(data, 0, data.Length);
            var clip = AudioClip.Create("vox_line", samples.Length, 1, sampleRate, false);
            clip.SetData(samples, 0);
            var info = new LineInfo
            {
                take = req.GetResponseHeader("X-Vox-Take"),
                duration = float.Parse(req.GetResponseHeader("X-Vox-Duration") ?? "0",
                                       System.Globalization.CultureInfo.InvariantCulture),
                segmentsJson = req.GetResponseHeader("X-Vox-Segments")
            };
            onReady?.Invoke(clip, info);
        }
    }

    // ------------------------------------------------------------- streaming
    readonly ConcurrentQueue<float> streamQueue = new ConcurrentQueue<float>();
    CancellationTokenSource streamCancel;

    /// Plays audio as it is generated through the given AudioSource.
    public void SpeakStreaming(string text, string voice, AudioSource source, string emotion = null)
    {
        StopStreaming();
        while (streamQueue.TryDequeue(out _)) { }
        streamCancel = new CancellationTokenSource();
        var o = new SpeakOptions { text = text, voice = voice, emotion = emotion };
        var clip = AudioClip.Create("vox_stream", sampleRate * 600, 1, sampleRate, true, OnStreamRead);
        source.clip = clip;
        source.loop = false;
        source.Play();
        _ = RunStream(ToJson(o), streamCancel.Token);
    }

    public void StopStreaming() { streamCancel?.Cancel(); }

    void OnStreamRead(float[] buffer)
    {
        for (int i = 0; i < buffer.Length; i++)
            buffer[i] = streamQueue.TryDequeue(out float s) ? s : 0f;
    }

    async Task RunStream(string json, CancellationToken ct)
    {
        string wsUrl = serverUrl.Replace("http://", "ws://").Replace("https://", "wss://") + "/v1/stream";
        using (var ws = new ClientWebSocket())
        {
            try
            {
                await ws.ConnectAsync(new Uri(wsUrl), ct);
                await ws.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(json)),
                                   WebSocketMessageType.Text, true, ct);
                var buf = new byte[1 << 16];
                var msg = new System.IO.MemoryStream();
                while (!ct.IsCancellationRequested)
                {
                    var r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), ct);
                    msg.Write(buf, 0, r.Count);
                    if (!r.EndOfMessage) continue;
                    byte[] payload = msg.ToArray(); msg.SetLength(0);
                    if (r.MessageType == WebSocketMessageType.Binary)
                    {
                        foreach (float s in Pcm16ToFloats(payload, 0, payload.Length)) streamQueue.Enqueue(s);
                    }
                    else if (Encoding.UTF8.GetString(payload).Contains("\"end\"") ||
                             r.MessageType == WebSocketMessageType.Close) break;
                }
                if (ws.State == WebSocketState.Open)
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
            }
            catch (OperationCanceledException) { }
            catch (Exception e) { Debug.LogError("Vox stream: " + e.Message); }
        }
    }

    // ---------------------------------------------------------- baked lines
    /// Plays a line pre-generated with `vox bake`, from StreamingAssets/vox/<id>.wav
    public void PlayBaked(string id, AudioSource source)
    {
        StartCoroutine(LoadBaked(id, clip => { if (clip) source.PlayOneShot(clip); }));
    }

    public IEnumerator LoadBaked(string id, Action<AudioClip> onReady)
    {
        string url = "file://" + System.IO.Path.Combine(Application.streamingAssetsPath, "vox", id + ".wav");
        using (var req = UnityWebRequestMultimedia.GetAudioClip(url, AudioType.WAV))
        {
            yield return req.SendWebRequest();
            onReady(req.result == UnityWebRequest.Result.Success ? DownloadHandlerAudioClip.GetContent(req) : null);
        }
    }

    // ---------------------------------------------------------------- utils
    static float[] Pcm16ToFloats(byte[] b, int offset, int count)
    {
        int n = count / 2;
        var f = new float[n];
        for (int i = 0; i < n; i++)
            f[i] = (short)(b[offset + 2 * i] | (b[offset + 2 * i + 1] << 8)) / 32768f;
        return f;
    }

    static float[] WavToFloats(byte[] wav, out int rate)
    {
        rate = BitConverter.ToInt32(wav, 24);
        int pos = 12;
        while (pos + 8 <= wav.Length)
        {
            string id = Encoding.ASCII.GetString(wav, pos, 4);
            int size = BitConverter.ToInt32(wav, pos + 4);
            if (id == "data") return Pcm16ToFloats(wav, pos + 8, Math.Min(size, wav.Length - pos - 8));
            pos += 8 + size;
        }
        return new float[0];
    }

    static string ToJson(SpeakOptions o)
    {
        // JsonUtility can't express null/optional fields, so build the body by hand.
        var sb = new StringBuilder("{");
        sb.Append("\"text\":").Append(Quote(o.text));
        sb.Append(",\"voice\":").Append(Quote(o.voice));
        if (!string.IsNullOrEmpty(o.emotion)) sb.Append(",\"emotion\":").Append(Quote(o.emotion));
        if (!string.IsNullOrEmpty(o.style_prompt)) sb.Append(",\"style_prompt\":").Append(Quote(o.style_prompt));
        var ci = System.Globalization.CultureInfo.InvariantCulture;
        sb.Append(",\"intensity\":").Append(o.intensity.ToString(ci));
        sb.Append(",\"rate\":").Append(o.rate.ToString(ci));
        sb.Append(",\"pitch\":").Append(o.pitch.ToString(ci));
        sb.Append(",\"pitch_range\":").Append(o.pitch_range.ToString(ci));
        sb.Append(",\"energy\":").Append(o.energy.ToString(ci));
        if (o.seed >= 0) sb.Append(",\"seed\":").Append(o.seed);
        if (!string.IsNullOrEmpty(o.translate_to)) sb.Append(",\"translate_to\":").Append(Quote(o.translate_to));
        if (o.enunciate > 0) sb.Append(",\"enunciate\":").Append(o.enunciate.ToString(ci));
        sb.Append(",\"format\":").Append(Quote(o.format)).Append("}");
        return sb.ToString();
    }

    static string Quote(string s)
    {
        if (s == null) return "null";
        var sb = new StringBuilder("\"");
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }

    void OnDestroy() { StopStreaming(); }
}
