# Vox voice engine client for Godot 4.x. Free to use in any project.
#
# Setup: add this script as an Autoload named "Vox" (Project Settings > Autoload),
# then start the server:  vox serve --ckpt vox.pt
#
#   Vox.speak("Halt! Who goes there?", "guard", {"emotion": "angry", "intensity": 0.7})
#   var result = await Vox.line_ready         # {stream, take, duration, segments}
#   $AudioStreamPlayer.stream = result.stream
#   $AudioStreamPlayer.play()
#
#   # Lowest latency, plays while generating:
#   Vox.speak_streaming("A long speech...", "narrator", $AudioStreamPlayer)
#
#   # Shipping build with no server: bake lines with `vox bake` into res://vox/
#   $AudioStreamPlayer.stream = Vox.load_baked("gob_01")
extends Node

signal line_ready(result: Dictionary)
signal line_failed(message: String)

@export var server_url := "http://127.0.0.1:5150"
const SAMPLE_RATE := 24000

var _ws := WebSocketPeer.new()
var _ws_open := false
var _ws_request := ""
var _playback: AudioStreamGeneratorPlayback
var _pending := PackedFloat32Array()


## options: emotion, intensity, rate, pitch, pitch_range, energy, style_prompt, seed,
##          translate_to ("es", "fr", ...), enunciate (0..1), autotune
func speak(text: String, voice := "narrator", options := {}) -> void:
	var body := {"text": text, "voice": voice, "format": "pcm16"}
	body.merge(options, true)
	_post("/v1/speak", body)


## ops example: [{"op": "replace", "old": "mill", "new": "tower"}, {"op": "undo"}]
func edit(take: String, ops: Array) -> void:
	_post("/v1/edit", {"take": take, "ops": ops})


func _post(path: String, body: Dictionary) -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(_on_done.bind(http))
	var err := http.request(server_url + path, ["Content-Type: application/json"],
		HTTPClient.METHOD_POST, JSON.stringify(body))
	if err != OK:
		line_failed.emit("Could not reach the Vox server at %s" % server_url)
		http.queue_free()


func _on_done(result: int, code: int, headers: PackedStringArray, body: PackedByteArray, http: HTTPRequest) -> void:
	http.queue_free()
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		line_failed.emit("Vox error %d: %s" % [code, body.get_string_from_utf8()])
		return
	var h := {}
	for line in headers:
		var i := line.find(":")
		if i > 0:
			h[line.substr(0, i).to_lower()] = line.substr(i + 1).strip_edges()
	var pcm := body
	if body.size() > 12 and body.slice(0, 4).get_string_from_ascii() == "RIFF":
		pcm = _wav_data(body)
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = SAMPLE_RATE
	stream.stereo = false
	stream.data = pcm
	line_ready.emit({
		"stream": stream,
		"take": h.get("x-vox-take", ""),
		"duration": float(h.get("x-vox-duration", "0")),
		"segments": JSON.parse_string(h.get("x-vox-segments", "[]")),
	})


func _wav_data(wav: PackedByteArray) -> PackedByteArray:
	var pos := 12
	while pos + 8 <= wav.size():
		var id := wav.slice(pos, pos + 4).get_string_from_ascii()
		var size := wav.decode_u32(pos + 4)
		if id == "data":
			return wav.slice(pos + 8, pos + 8 + size)
		pos += 8 + size
	return PackedByteArray()


# ------------------------------------------------------------------ streaming
func speak_streaming(text: String, voice: String, player: AudioStreamPlayer, options := {}) -> void:
	var gen := AudioStreamGenerator.new()
	gen.mix_rate = SAMPLE_RATE
	gen.buffer_length = 0.5
	player.stream = gen
	player.play()
	_playback = player.get_stream_playback()
	_pending = PackedFloat32Array()
	var body := {"text": text, "voice": voice}
	body.merge(options, true)
	_ws_request = JSON.stringify(body)
	_ws = WebSocketPeer.new()
	_ws_open = false
	_ws.connect_to_url(server_url.replace("http", "ws") + "/v1/stream")


func _process(_delta: float) -> void:
	if _ws.get_ready_state() == WebSocketPeer.STATE_CLOSED and _pending.is_empty():
		return
	_ws.poll()
	if _ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		if not _ws_open:
			_ws_open = true
			_ws.send_text(_ws_request)
		while _ws.get_available_packet_count() > 0:
			var pkt := _ws.get_packet()
			var was_text := _ws.was_string_packet()   # must be read after get_packet()
			if was_text:
				var msg = JSON.parse_string(pkt.get_string_from_utf8())
				if msg and msg.get("event") == "end":
					_ws.close()
				elif msg and msg.get("event") == "error":
					line_failed.emit(str(msg.get("message")))
			else:
				for i in range(0, pkt.size() - 1, 2):
					_pending.append(pkt.decode_s16(i) / 32768.0)
	# feed the audio generator as space frees up
	if _playback and not _pending.is_empty():
		var n := mini(_playback.get_frames_available(), _pending.size())
		for i in n:
			_playback.push_frame(Vector2(_pending[i], _pending[i]))
		_pending = _pending.slice(n)


# ----------------------------------------------------------------- baked lines
func load_baked(id: String, folder := "res://vox") -> AudioStream:
	var path := "%s/%s.wav" % [folder, id]
	if ResourceLoader.exists(path):
		return load(path)
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("Vox: baked line not found: " + path)
		return null
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = SAMPLE_RATE
	stream.data = _wav_data(f.get_buffer(f.get_length()))
	return stream
