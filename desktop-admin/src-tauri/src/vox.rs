// Vox is built into the admin app: the engine's code ships inside the app
// (bundle resource vox-engine/, from the repo's vox-engine/ folder), and its
// voices, models, learning and logs live in the app's own data folder
// (%APPDATA%\com.fantasticallogicgrid.admin\vox). On the first start the app
// sets up its own Python environment there, installs what Vox needs (PyTorch,
// the web server, and Whisper for clear-words scoring), and brings over the
// voices and learning from an older Vox folder if there is one.
//
// Vox inside the admin app: the Voice engine page can start, stop and connect to
// Vox (the free voice engine, a Python program on this computer) without a
// command window, and put it online with a free Cloudflare address so the
// admin app on any device can open it. Only these commands are open to the page, and only to the
// admin dashboard's own address (capabilities/vox.json). The page can't pass a
// program, a path or arguments: the Vox folder is chosen in a native folder
// picker and checked to really be a Vox folder, and the commands that run are
// fixed here.
use serde::Serialize;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct Vox {
    child: Mutex<Option<Child>>,
    /// idle, installing, making-model, starting, running, failed
    phase: Mutex<(String, String)>,
    /// Set by Stop Vox during setup, so Vox doesn't start once setup ends.
    cancel: AtomicBool,
}

#[derive(Serialize)]
pub struct Status {
    folder: Option<String>,
    running: bool,
    phase: String,
    message: String,
    model: Option<String>,
    /// Reachable from other devices (on by default).
    online: bool,
    /// The free Cloudflare address Vox is online at right now, if it is.
    online_url: Option<String>,
    /// Starts by itself when the admin app opens.
    autostart: bool,
}

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn config_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("vox.json"))
}

fn read_config(app: &AppHandle) -> serde_json::Value {
    config_file(app)
        .and_then(|c| fs::read_to_string(c).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn write_config(app: &AppHandle, key: &str, value: serde_json::Value) {
    let mut cfg = read_config(app);
    cfg[key] = value;
    if let Some(c) = config_file(app) {
        let _ = c.parent().map(fs::create_dir_all);
        let _ = fs::write(c, cfg.to_string());
    }
}

/// Start Vox as soon as the admin app opens (on by default).
pub fn autostart_on(app: &AppHandle) -> bool {
    read_config(app).get("autostart").and_then(|v| v.as_bool()).unwrap_or(true)
}

/// Is something already answering on Vox's port (a Vox started some other way)?
fn port_in_use() -> bool {
    std::net::TcpStream::connect_timeout(&"127.0.0.1:5150".parse().unwrap(), std::time::Duration::from_millis(400)).is_ok()
}

fn online_on(app: &AppHandle) -> bool {
    read_config(app).get("online").and_then(|v| v.as_bool()).unwrap_or(true)
}

fn is_vox_folder(p: &Path) -> bool {
    p.join("vox").join("cli.py").is_file()
}

/// Vox's data folder (voices, models, learning, logs, its Python environment).
fn folder(app: &AppHandle) -> Option<PathBuf> {
    let d = app.path().app_data_dir().ok()?.join("vox");
    fs::create_dir_all(&d).ok()?;
    Some(d)
}

/// The engine's code, shipped inside the app.
fn engine_dir(app: &AppHandle) -> Option<PathBuf> {
    let d = app.path().resource_dir().ok()?.join("vox-engine");
    is_vox_folder(&d).then_some(d)
}

/// A Vox folder from before Vox was built into the app, to bring its voices over once.
fn old_folder(app: &AppHandle) -> Option<PathBuf> {
    if let Some(p) = read_config(app).get("folder").and_then(|p| p.as_str()).map(PathBuf::from) {
        if is_vox_folder(&p) {
            return Some(p);
        }
    }
    let home = app.path().home_dir().ok()?;
    [
        "Downloads/MEGA/vox-engine/vox-engine",
        "Downloads/MEGA/MEGA/vox-engine/vox-engine",
        "Downloads/MEGA/MEGA/vox-engine",
        "Downloads/MEGA/vox-engine",
        "Downloads/vox-engine/vox-engine",
        "Downloads/vox-engine",
        "Documents/vox-engine/vox-engine",
        "Documents/vox-engine",
        "Desktop/vox-engine/vox-engine",
        "Desktop/vox-engine",
        "vox-engine",
    ]
    .iter()
    .map(|t| home.join(t))
    .find(|p| is_vox_folder(p))
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let dest = to.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &dest)?;
        } else if !dest.exists() {
            fs::copy(e.path(), dest)?;
        }
    }
    Ok(())
}

/// Once: voices, learning (with the admin token, so other devices keep working),
/// trained models and the practice model from the old Vox folder.
fn migrate(app: &AppHandle, data: &Path) {
    let mark = data.join(".migrated");
    if mark.exists() {
        return;
    }
    if let Some(old) = old_folder(app) {
        for d in ["voices", "learning", "runs"] {
            if old.join(d).is_dir() {
                let _ = copy_dir(&old.join(d), &data.join(d));
            }
        }
        for f in ["practice.pt"] {
            if old.join(f).is_file() && !data.join(f).exists() {
                let _ = fs::copy(old.join(f), data.join(f));
            }
        }
    }
    let _ = fs::write(mark, "");
}

fn venv_python(data: &Path) -> PathBuf {
    if cfg!(windows) {
        data.join("venv").join("Scripts").join("python.exe")
    } else {
        data.join("venv").join("bin").join("python")
    }
}

/// The address Vox printed when it went online ("Online at https://….trycloudflare.com").
fn online_url(dir: &Path) -> Option<String> {
    let log = fs::read_to_string(dir.join("vox-log.txt")).ok()?;
    let start = log.find("https://")?;
    let rest = &log[start..];
    let end = rest.find(".trycloudflare.com")? + ".trycloudflare.com".len();
    let url = &rest[..end];
    url["https://".len()..url.len() - ".trycloudflare.com".len()]
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        .then(|| url.to_string())
}

/// cloudflared, the free Cloudflare program that puts Vox online: the one
/// installed on the computer, or a copy this app downloads once from
/// Cloudflare's own GitHub releases into its data folder.
fn cloudflared(app: &AppHandle) -> Option<PathBuf> {
    let ok = |exe: &Path| {
        hidden(Command::new(exe).arg("--version")).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
    };
    if ok(Path::new("cloudflared")) {
        return Some(PathBuf::from("cloudflared"));
    }
    let dir = app.path().app_data_dir().ok()?.join("cloudflared");
    let exe = dir.join("cloudflared.exe");
    if exe.is_file() && ok(&exe) {
        return Some(exe);
    }
    fs::create_dir_all(&dir).ok()?;
    let got = hidden(Command::new("curl.exe").args([
        "-fsSL",
        "-o",
        &exe.display().to_string(),
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
    ]))
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .map(|s| s.success())
    .unwrap_or(false);
    (got && ok(&exe)).then_some(exe)
}

/// Ends a Vox (and its cloudflared) that this app didn't start or that was
/// left behind: stopping Python alone doesn't stop the tunnel it opened. Uses
/// Windows' own taskkill (no scripts, which antivirus programs distrust): the
/// process id Vox's desktop shortcut saves (learning/vox.pid), with everything
/// it started, and any cloudflared tunnel.
fn stop_strays(dir: Option<&Path>) {
    #[cfg(windows)]
    {
        let kill = |args: &[&str]| {
            let _ = hidden(Command::new("taskkill").args(args)).stdout(Stdio::null()).stderr(Stdio::null()).status();
        };
        if let Some(pid) = dir.and_then(|d| fs::read_to_string(d.join("learning").join("vox.pid")).ok()) {
            let pid = pid.trim().to_string();
            if pid.chars().all(|c| c.is_ascii_digit()) && !pid.is_empty() {
                kill(&["/F", "/T", "/PID", &pid]);
            }
        }
        kill(&["/F", "/IM", "cloudflared.exe"]);
    }
    #[cfg(not(windows))]
    let _ = dir;
}

/// Stops a child and everything it started (Vox and its tunnel).
fn kill_tree(c: &mut Child) {
    #[cfg(windows)]
    {
        let pid = c.id().to_string();
        let _ = hidden(Command::new("taskkill").args(["/F", "/T", "/PID", &pid])).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    let _ = c.kill();
    let _ = c.wait();
}

/// The trained model when there is one, otherwise the practice model.
fn model(dir: &Path) -> Option<String> {
    ["runs/v1/vox.pt", "practice.pt"].iter().find(|m| dir.join(m).is_file()).map(|m| m.to_string())
}

/// A real Python: where the python.org installer puts it (found even before
/// Windows refreshes PATH), the py launcher, or python on PATH. The Microsoft
/// Store shortcut named "python" fails --version, so it never counts.
fn find_python() -> Option<String> {
    let works = |exe: &str| {
        hidden(Command::new(exe).arg("--version")).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
    };
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        for v in ["Python313", "Python312", "Python311"] {
            let exe = PathBuf::from(&local).join("Programs").join("Python").join(v).join("python.exe");
            if exe.is_file() && works(&exe.display().to_string()) {
                return Some(exe.display().to_string());
            }
        }
    }
    ["python", "py"].into_iter().find(|p| works(p)).map(String::from)
}

/// Python, installing it (free, from python.org through winget) if it's missing.
fn python(vox: &Vox) -> Option<String> {
    if let Some(p) = find_python() {
        return Some(p);
    }
    set(vox, "installing", "Installing Python (free, from python.org). This takes a few minutes the first time…");
    let _ = hidden(Command::new("winget").args([
        "install", "-e", "--id", "Python.Python.3.13", "--scope", "user", "--silent",
        "--accept-package-agreements", "--accept-source-agreements",
    ]))
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status();
    find_python()
}

fn set(vox: &Vox, phase: &str, msg: &str) {
    *vox.phase.lock().unwrap() = (phase.into(), msg.into());
}

/// Runs one setup step with its output added to vox-setup-log.txt.
fn step(dir: &Path, engine: &Path, py: &str, args: &[&str]) -> bool {
    let log = fs::OpenOptions::new().create(true).append(true).open(dir.join("vox-setup-log.txt"));
    let mut cmd = Command::new(py);
    hidden(cmd.args(args).current_dir(dir)).env("PYTHONPATH", engine).env("PYTHONDONTWRITEBYTECODE", "1");
    if let Ok(log) = log {
        if let Ok(err) = log.try_clone() {
            cmd.stdout(log).stderr(err);
        }
    }
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

fn alive(vox: &Vox) -> bool {
    let mut child = vox.child.lock().unwrap();
    match child.as_mut().map(|c| c.try_wait()) {
        Some(Ok(None)) => true,
        Some(_) => {
            *child = None;
            false
        }
        None => false,
    }
}

#[tauri::command]
pub fn vox_status(app: AppHandle, vox: State<'_, Vox>) -> Status {
    let dir = folder(&app);
    let running = alive(&vox);
    let (mut phase, mut message) = vox.phase.lock().unwrap().clone();
    if phase == "running" && !running {
        phase = "failed".into();
        message = "Vox stopped. Open its log to see why.".into();
        set(&vox, &phase, &message);
    }
    Status {
        model: dir.as_deref().and_then(model),
        online_url: if running { dir.as_deref().and_then(online_url) } else { None },
        folder: dir.map(|d| d.display().to_string()),
        running,
        phase,
        message,
        online: online_on(&app),
        autostart: autostart_on(&app),
    }
}

#[tauri::command]
pub fn vox_start(app: AppHandle) -> Result<(), String> {
    let dir = folder(&app).ok_or("The admin app can't make its data folder.")?;
    let vox = app.state::<Vox>();
    if alive(&vox) {
        return Ok(());
    }
    {
        let p = vox.phase.lock().unwrap().0.clone();
        if p == "installing" || p == "making-model" || p == "starting" {
            return Ok(());
        }
    }
    if port_in_use() {
        set(&vox, "idle", "Vox is already running on this computer (started outside the admin app).");
        return Ok(());
    }
    vox.cancel.store(false, Ordering::SeqCst);
    set(&vox, "starting", "Starting Vox…");
    let app2 = app.clone();
    std::thread::spawn(move || {
        let vox = app2.state::<Vox>();
        let Some(py) = python(&vox) else {
            set(&vox, "failed", "Python couldn't be installed automatically. Get it free from python.org (tick \"Add python.exe to PATH\"), then click Start Vox again.");
            return;
        };
        let Some(engine) = engine_dir(&app2) else {
            set(&vox, "failed", "The Vox engine is missing from the admin app. Reinstall the admin app.");
            return;
        };
        migrate(&app2, &dir);
        // Vox's own Python environment, so nothing else on the computer is touched
        let vpy = venv_python(&dir);
        if !vpy.is_file() {
            set(&vox, "installing", "Setting up Vox's own Python environment…");
            if !step(&dir, &engine, &py, &["-m", "venv", &dir.join("venv").display().to_string()]) || !vpy.is_file() {
                set(&vox, "failed", "Setting up Vox's Python environment didn't work. Open the setup log to see why.");
                return;
            }
        }
        let py = vpy.display().to_string();
        let py = py.as_str();
        // What Vox needs, installed again only when the list changes (app updates)
        let req = engine.join("requirements.txt");
        let wanted = fs::read_to_string(&req).unwrap_or_default();
        let stamp = dir.join("venv").join("vox-requirements.txt");
        let ready = |d: &Path| step(d, &engine, py, &["-c", "import vox.cli, torch, fastapi, uvicorn"]);
        if fs::read_to_string(&stamp).ok().as_deref() != Some(wanted.as_str()) || !ready(&dir) {
            set(&vox, "installing", "Installing what Vox needs. The first time this downloads free parts (PyTorch is the biggest) and takes several minutes…");
            let _ = step(&dir, &engine, py, &["-m", "pip", "install", "--upgrade", "pip"]);
            if !step(&dir, &engine, py, &["-m", "pip", "install", "-r", &req.display().to_string()]) || !ready(&dir) {
                set(&vox, "failed", "Installing what Vox needs didn't finish. Open the setup log to see why.");
                return;
            }
            let _ = fs::write(&stamp, &wanted);
        }
        // Whisper (free, on this computer): clear-words scoring and transcripts.
        // Optional: if it can't install, Vox runs without it.
        let whisper = dir.join("venv").join("vox-whisper-ready");
        if !whisper.exists() {
            set(&vox, "installing", "Installing Whisper, which checks how clearly each line is said…");
            let ok = step(&dir, &engine, py, &["-m", "pip", "install", "faster-whisper"])
                && step(&dir, &engine, py, &["-c", "from faster_whisper import WhisperModel; WhisperModel('base', compute_type='int8')"]);
            if ok {
                let _ = fs::write(&whisper, "");
            }
        }
        if model(&dir).is_none() {
            set(&vox, "making-model", "Making the practice model (practice.pt)…");
            if !step(&dir, &engine, py, &["-m", "vox.cli", "init", "--preset", "tiny", "--out", "practice.pt"]) {
                set(&vox, "failed", "Making the practice model didn't work. Open the setup log to see why.");
                return;
            }
        }
        if vox.cancel.load(Ordering::SeqCst) {
            set(&vox, "idle", "Vox is stopped.");
            return;
        }
        let m = model(&dir).unwrap_or_else(|| "practice.pt".into());
        let mut cmd = Command::new(py);
        hidden(cmd.args(["-m", "vox.cli", "serve", "--ckpt", &m]).current_dir(&dir))
            .env("PYTHONPATH", &engine)
            .env("PYTHONDONTWRITEBYTECODE", "1");
        if online_on(&app2) {
            set(&vox, "starting", "Getting the free Cloudflare program that puts Vox online…");
            match cloudflared(&app2) {
                Some(exe) => {
                    if let Some(bin) = exe.parent().filter(|p| !p.as_os_str().is_empty()) {
                        let path = std::env::var_os("PATH").unwrap_or_default();
                        let mut parts = vec![bin.to_path_buf()];
                        parts.extend(std::env::split_paths(&path));
                        if let Ok(joined) = std::env::join_paths(parts) {
                            cmd.env("PATH", joined);
                        }
                    }
                    cmd.arg("--tunnel");
                }
                None => set(&vox, "starting", "Couldn't get the Cloudflare program, so Vox runs on this computer only for now."),
            }
        }
        if let Ok(log) = File::create(dir.join("vox-log.txt")) {
            if let Ok(err) = log.try_clone() {
                cmd.stdout(log).stderr(err);
            }
        }
        match cmd.spawn() {
            Ok(child) => {
                *vox.child.lock().unwrap() = Some(child);
                set(&vox, "running", &format!("Vox is running with {m}."));
            }
            Err(e) => set(&vox, "failed", &format!("Vox couldn't start: {e}")),
        }
    });
    Ok(())
}

/// Stops Vox: the copy this app started, and one started from the old desktop
/// shortcut or a command window too.
#[tauri::command]
pub fn vox_stop(app: AppHandle, vox: State<'_, Vox>) {
    vox.cancel.store(true, Ordering::SeqCst);
    if let Some(mut c) = vox.child.lock().unwrap().take() {
        kill_tree(&mut c);
    }
    stop_strays(folder(&app).as_deref());
    set(&vox, "idle", "Vox is stopped.");
}

/// Whether Vox goes online (reachable from the admin app on other devices)
/// the next time it starts.
#[tauri::command]
pub fn vox_set_online(app: AppHandle, on: bool) {
    write_config(&app, "online", serde_json::json!(on));
}

/// Whether Vox starts by itself when the admin app opens.
#[tauri::command]
pub fn vox_set_autostart(app: AppHandle, on: bool) {
    write_config(&app, "autostart", serde_json::json!(on));
}

/// The admin token Vox wrote when it started, so the page connects by itself.
#[tauri::command]
pub fn vox_token(app: AppHandle) -> Option<String> {
    let dir = folder(&app)?;
    fs::read_to_string(dir.join("learning").join("admin_token.txt")).ok().map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

/// Opens the Vox folder, its log or its setup log in Windows.
#[tauri::command]
pub fn vox_open(app: AppHandle, what: String) -> Result<(), String> {
    let dir = folder(&app).ok_or("The admin app can't make its data folder.")?;
    let p = match what.as_str() {
        "folder" => dir,
        "log" => dir.join("vox-log.txt"),
        "setup-log" => dir.join("vox-setup-log.txt"),
        _ => return Err("Unknown item.".into()),
    };
    if !p.exists() {
        return Err("There's nothing there yet.".into());
    }
    app.opener().open_path(p.display().to_string(), None::<&str>).map_err(|e| e.to_string())
}

/// Called when the app closes: Vox stops with it.
pub fn shutdown(app: &AppHandle) {
    let vox = app.state::<Vox>();
    vox.cancel.store(true, Ordering::SeqCst);
    if let Some(mut c) = vox.child.lock().unwrap().take() {
        kill_tree(&mut c);
    }
    // Also a Vox started from the desktop shortcut, and any tunnel left behind.
    stop_strays(folder(app).as_deref());
}
