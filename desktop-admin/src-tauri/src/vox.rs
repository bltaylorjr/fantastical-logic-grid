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
use tauri_plugin_dialog::DialogExt;
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
    p.join("vox").join("cli.py").is_file() && p.join("pyproject.toml").is_file()
}

/// The saved Vox folder, or the first Vox folder found in the usual places.
fn folder(app: &AppHandle) -> Option<PathBuf> {
    if let Some(p) = read_config(app).get("folder").and_then(|p| p.as_str()).map(PathBuf::from) {
        if is_vox_folder(&p) {
            return Some(p);
        }
    }
    let home = app.path().home_dir().ok()?;
    let tries = [
        "Downloads/MEGA/vox-engine/vox-engine",
        "Downloads/MEGA/vox-engine",
        "Downloads/vox-engine/vox-engine",
        "Downloads/vox-engine",
        "Documents/vox-engine/vox-engine",
        "Documents/vox-engine",
        "Desktop/vox-engine/vox-engine",
        "Desktop/vox-engine",
        "vox-engine",
    ];
    tries.iter().map(|t| home.join(t)).find(|p| is_vox_folder(p))
}

fn save_folder(app: &AppHandle, p: &Path) {
    write_config(app, "folder", serde_json::json!(p));
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
/// left behind: stopping Python directly doesn't stop the tunnel it opened.
fn stop_strays() {
    #[cfg(windows)]
    {
        let _ = hidden(Command::new("powershell").args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process -Filter \"CommandLine like '%vox.cli serve%' or CommandLine like '%vox serve %' or CommandLine like '%--url http://127.0.0.1:5150%'\" | Invoke-CimMethod -MethodName Terminate | Out-Null",
        ]))
        .status();
    }
}

/// The trained model when there is one, otherwise the practice model.
fn model(dir: &Path) -> Option<String> {
    ["runs/v1/vox.pt", "practice.pt"].iter().find(|m| dir.join(m).is_file()).map(|m| m.to_string())
}

fn python() -> Option<&'static str> {
    ["python", "py"].into_iter().find(|p| {
        hidden(Command::new(p).arg("--version")).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
    })
}

fn set(vox: &Vox, phase: &str, msg: &str) {
    *vox.phase.lock().unwrap() = (phase.into(), msg.into());
}

/// Runs one setup step with its output added to vox-setup-log.txt.
fn step(dir: &Path, py: &str, args: &[&str]) -> bool {
    let log = fs::OpenOptions::new().create(true).append(true).open(dir.join("vox-setup-log.txt"));
    let mut cmd = Command::new(py);
    hidden(cmd.args(args).current_dir(dir));
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
pub async fn vox_choose_folder(app: AppHandle) -> Result<String, String> {
    let (tx, rx) = futures_channel::oneshot::channel();
    let mut picker = app.dialog().file().set_title("Choose the Vox folder (vox-engine)");
    if let Some(d) = folder(&app) {
        picker = picker.set_directory(d);
    }
    picker.pick_folder(move |f| {
        let _ = tx.send(f);
    });
    let picked = rx.await.ok().flatten().ok_or("No folder chosen.")?;
    let p = picked.into_path().map_err(|_| "That folder can't be used.")?;
    // Accept the outer folder of a double vox-engine\vox-engine unzip too.
    let p = if is_vox_folder(&p) { p } else { p.join("vox-engine") };
    if !is_vox_folder(&p) {
        return Err("That isn't the Vox folder. Choose the vox-engine folder that has README.md, pyproject.toml and a vox folder inside.".into());
    }
    save_folder(&app, &p);
    Ok(p.display().to_string())
}

#[tauri::command]
pub fn vox_start(app: AppHandle) -> Result<(), String> {
    let dir = folder(&app).ok_or("Choose the Vox folder first.")?;
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
        let Some(py) = python() else {
            set(&vox, "failed", "Python isn't installed. Get it free from python.org (tick \"Add python.exe to PATH\"), then click Start Vox again.");
            return;
        };
        let ready = |d: &Path| step(d, py, &["-c", "import vox.cli, torch, fastapi, uvicorn"]);
        if !ready(&dir) {
            set(&vox, "installing", "Installing Vox. The first time this downloads free parts (PyTorch is the biggest) and takes several minutes…");
            if !step(&dir, py, &["-m", "pip", "install", "-e", "."]) || !ready(&dir) {
                set(&vox, "failed", "Installing Vox didn't finish. Open the setup log to see why.");
                return;
            }
        }
        if model(&dir).is_none() {
            set(&vox, "making-model", "Making the practice model (practice.pt)…");
            if !step(&dir, py, &["-m", "vox.cli", "init", "--preset", "tiny", "--out", "practice.pt"]) {
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
        hidden(cmd.args(["-m", "vox.cli", "serve", "--ckpt", &m]).current_dir(&dir));
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

/// Stops Vox: the copy this app started, and one started some other way
/// (Vox.vbs or a command window) too.
#[tauri::command]
pub fn vox_stop(vox: State<'_, Vox>) {
    vox.cancel.store(true, Ordering::SeqCst);
    if let Some(mut c) = vox.child.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
    stop_strays();
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
    let dir = folder(&app).ok_or("Choose the Vox folder first.")?;
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
        let _ = c.kill();
    }
    // Also the tunnel it opened, and a Vox started from Vox.vbs or a command window.
    stop_strays();
}
