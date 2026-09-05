use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use vst3_host::{AudioBuffers, Plugin, PluginWindow, Vst3Host};

const MAX_MESSAGE: usize = 32 * 1024 * 1024;
const MAX_FRAMES: usize = 4096;

#[derive(Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
enum Command {
    Probe {
        path: String,
    },
    Load {
        path: String,
        sample_rate: u32,
        block_size: usize,
        state: Option<Vec<u8>>,
    },
    Parameters {},
    SetParameter {
        id: u32,
        value: f64,
    },
    SaveState {},
    Reset {},
    Editor {
        open: bool,
    },
    ProcessBinary {
        frames: usize,
    },
    Unload {},
}

// The loaded plugin plus its sample rate, shared between the control thread (which swaps
// it on load/unload) and the audio worker (which processes against it).
type SharedPlugin = Arc<Mutex<Option<(Arc<Mutex<Plugin>>, f64)>>>;

struct Session {
    window: Option<PluginWindow>,
    plugin: Option<Arc<Mutex<Plugin>>>,
    shared: SharedPlugin,
}

impl Session {
    fn execute(&mut self, command: Command) -> Result<Value, Box<dyn std::error::Error>> {
        match command {
            Command::Probe { path } => Ok(serde_json::to_value(
                vst3_host::discovery::get_detailed_plugin_info(std::path::Path::new(&path))?,
            )?),
            Command::Load {
                path,
                sample_rate,
                block_size,
                state,
            } => {
                if !(8000..=384000).contains(&sample_rate)
                    || !(1..=MAX_FRAMES).contains(&block_size)
                {
                    return Err("unsupported sample rate or block size".into());
                }
                let mut host = Vst3Host::builder()
                    .sample_rate(sample_rate as f64)
                    .block_size(block_size)
                    .input_channels(2)
                    .output_channels(2)
                    .build()?;
                let mut plugin = host.load_plugin(path)?;
                if let Some(state) = state {
                    plugin.load_state(&state)?;
                }
                let buses = plugin.audio_bus_layout()?;
                // VST3 bus index 0 is always the main bus; auxiliary buses (sidechains, stem
                // outputs like Acon Remix's Vocals/Drums) are ignored. The flattened process
                // path copies back only the first stereo output channels anyway.
                let main_input = buses.inputs.first().filter(|b| b.active).map(|b| b.channel_count).unwrap_or(0);
                let main_output = buses.outputs.first().filter(|b| b.active).map(|b| b.channel_count).unwrap_or(0);
                if main_input != 2 || main_output != 2 {
                    return Err(format!("plugin main bus is {main_input}in/{main_output}out, only stereo effects are supported").into());
                }
                plugin.start_processing()?;
                plugin.set_playing(true)?;
                let response = json!({"info": plugin.info(), "latency_samples": plugin.latency_samples(), "sample_rate": sample_rate});
                let shared = Arc::new(Mutex::new(plugin));
                *self
                    .shared
                    .lock()
                    .map_err(|_| "plugin slot poisoned")? = Some((Arc::clone(&shared), sample_rate as f64));
                self.window = None;
                self.plugin = Some(shared);
                Ok(response)
            }
            Command::Unload {} => {
                self.window = None;
                *self
                    .shared
                    .lock()
                    .map_err(|_| "plugin slot poisoned")? = None;
                self.plugin = None;
                Ok(Value::Null)
            }
            Command::Editor { open } => {
                self.window = None;
                if open {
                    let plugin = self.plugin.as_ref().ok_or("no plugin loaded")?;
                    let mut window = PluginWindow::new(plugin.clone());
                    window.open()?;
                    self.window = Some(window);
                    // Newer macOS refuses to put a background accessory app's window onscreen
                    // after orderFront; activate the host so the editor actually shows up.
                    #[cfg(target_os = "macos")]
                    {
                        use objc2::MainThreadMarker;
                        use objc2_app_kit::NSApplication;
                        NSApplication::sharedApplication(
                            MainThreadMarker::new().expect("editor must open on the main thread"),
                        )
                        .activate();
                    }
                }
                Ok(Value::Null)
            }
            command => {
                let mut plugin = self
                    .plugin
                    .as_ref()
                    .ok_or("no plugin loaded")?
                    .lock()
                    .map_err(|_| "plugin lock poisoned")?;
                match command {
                    Command::Parameters {} => Ok(serde_json::to_value(plugin.get_parameters()?)?),
                    Command::SetParameter { id, value } => {
                        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                            return Err("parameter must be finite and between 0 and 1".into());
                        }
                        plugin.set_parameter(id, value)?;
                        plugin.service_host_requests()?;
                        Ok(json!({"latency_samples": plugin.latency_samples()}))
                    }
                    Command::SaveState {} => Ok(json!({"state": plugin.save_state()?})),
                    Command::Reset {} => {
                        plugin.stop_processing()?;
                        plugin.start_processing()?;
                        plugin.set_playing(true)?;
                        Ok(Value::Null)
                    }
                    // Only reachable when the audio worker is gone and the reader forwards
                    // the request here for an error response.
                    Command::ProcessBinary { .. } => Err("audio worker is not running".into()),
                    _ => unreachable!(),
                }
            }
        }
    }
}

// Runs on the dedicated audio worker thread. The plugin mutex is shared with the editor
// on the main thread; VST3 plugins are built for exactly this arrangement (process off
// the UI thread). Heavy UI work that holds the mutex (preset loads) bounds the stalls —
// upstream answers those with dry passthrough — but editor menus, which block the main
// thread in a modal loop without holding the mutex, no longer affect processing at all.
fn decode_payload(payload: &[u8], frames: usize) -> Result<Vec<Vec<f32>>, String> {
    if payload.len() != frames * 2 * 4 {
        return Err(format!(
            "process payload size mismatch: expected {}, got {}",
            frames * 2 * 4,
            payload.len()
        ));
    }
    let mut left = Vec::with_capacity(frames);
    let mut right = Vec::with_capacity(frames);
    for frame in 0..frames {
        let offset = frame * 4;
        left.push(f32::from_le_bytes(
            payload[offset..offset + 4].try_into().unwrap(),
        ));
        right.push(f32::from_le_bytes(
            payload[frames * 4 + offset..frames * 4 + offset + 4]
                .try_into()
                .unwrap(),
        ));
    }
    Ok(vec![left, right])
}

fn encode_outputs(outputs: &[Vec<f32>], frames: usize) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(frames * 2 * 4);
    for frame in 0..frames {
        for channel in outputs {
            bytes.extend_from_slice(&channel[frame].to_le_bytes());
        }
    }
    bytes
}

fn write_json_line(output: &mut dyn Write, value: &Value) -> io::Result<()> {
    serde_json::to_writer(&mut *output, value)?;
    output.write_all(b"\n")?;
    output.flush()
}

fn process_binary_block(
    plugin: &Arc<Mutex<Plugin>>,
    sample_rate: f64,
    frames: usize,
    payload: &[u8],
) -> Result<(usize, Vec<u8>), String> {
    let inputs = decode_payload(payload, frames)?;
    let mut plugin = plugin.lock().map_err(|_| "plugin lock poisoned".to_string())?;
    validate_audio(&inputs, plugin.block_size()).map_err(|error| error.to_string())?;
    let mut buffers = AudioBuffers::new(2, 2, frames, sample_rate);
    buffers.inputs = inputs;
    plugin.process_audio(&mut buffers).map_err(|error| error.to_string())?;
    if buffers
        .outputs
        .iter()
        .flatten()
        .any(|sample| !sample.is_finite())
    {
        return Err("plugin returned non-finite audio".to_string());
    }
    let latency_samples = plugin.latency_samples();
    Ok((latency_samples as usize, encode_outputs(&buffers.outputs, frames)))
}

fn validate_audio(inputs: &[Vec<f32>], block_size: usize) -> Result<(), &'static str> {
    if inputs.len() != 2
        || inputs[0].is_empty()
        || inputs[0].len() > block_size
        || inputs[0].len() != inputs[1].len()
        || inputs.iter().flatten().any(|sample| !sample.is_finite())
    {
        return Err("expected equal finite stereo buffers within the configured block size");
    }
    Ok(())
}

fn write_response(output: &mut dyn Write, result: Result<Value, String>) -> io::Result<()> {
    let response = match result {
        Ok(value) => json!({ "ok": true, "result": value }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    serde_json::to_writer(&mut *output, &response)?;
    output.write_all(b"\n")?;
    output.flush()
}

// Native editor menus run AppKit's modal tracking loop, which stops our main loop from
// servicing the plugin's run loop — editor timers starve and the UI appears frozen while
// the menu stays open. A timer scheduled in NSRunLoopCommonModes keeps firing inside that
// modal loop, so the editor stays alive for as long as the user browses it.
#[cfg(target_os = "macos")]
fn schedule_plugin_servicer(shared: SharedPlugin) -> objc2::rc::Retained<objc2_foundation::NSTimer> {
    use block2::RcBlock;
    use core::ptr::NonNull;
    use objc2_foundation::{NSRunLoop, NSRunLoopCommonModes, NSTimer};

    let timer_block = RcBlock::new(move |_timer: NonNull<NSTimer>| {
        if let Ok(slot) = shared.lock() {
            if let Some((plugin, _)) = slot.as_ref() {
                if let Ok(mut plugin) = plugin.lock() {
                    if let Err(error) = plugin.service_host_requests() {
                        eprintln!("vst3 service_host_requests: {error}");
                    }
                    plugin.service_run_loop();
                }
            }
        }
    });
    let timer = unsafe { NSTimer::timerWithTimeInterval_repeats_block(0.03, true, &timer_block) };
    unsafe {
        let run_loop = NSRunLoop::mainRunLoop();
        run_loop.addTimer_forMode(&timer, NSRunLoopCommonModes);
    }
    timer
}

fn pump_events() {
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        use objc2_app_kit::{NSApplication, NSEventMask};
        use objc2_foundation::{NSDate, NSDefaultRunLoopMode};
        let app = NSApplication::sharedApplication(MainThreadMarker::new().unwrap());
        let until = NSDate::dateWithTimeIntervalSinceNow(0.0);
        unsafe {
            while let Some(event) = app.nextEventMatchingMask_untilDate_inMode_dequeue(
                NSEventMask::Any,
                Some(&until),
                NSDefaultRunLoopMode,
                true,
            ) {
                app.sendEvent(&event);
            }
        }
    }
    #[cfg(target_os = "windows")]
    unsafe {
        use winapi::um::winuser::*;
        let mut message = std::mem::zeroed();
        while PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    // Keep plugin stdout separate from the production protocol.
    let args: Vec<String> = std::env::args().skip(1).collect();
    // The audio path (reader -> worker -> response) must never touch the main thread:
    // native editor menus block it inside a modal loop for as long as they stay open.
    // The client keeps at most one request in flight, which keeps the split writers
    // (worker for process, main for control commands) from ever interleaving.
    let (mut input, mut output, new_worker_writer): (
        Box<dyn BufRead + Send>,
        Box<dyn Write + Send>,
        Box<dyn Fn() -> io::Result<Box<dyn Write + Send>> + Send>,
    ) = if args == ["--stdio"] {
        (
            Box::new(BufReader::new(io::stdin())),
            Box::new(io::stdout()),
            Box::new(|| Ok(Box::new(io::stdout()))),
        )
    } else if args.len() == 3 && args[0] == "--connect" {
        let address: SocketAddr = args[1].parse()?;
        if !address.ip().is_loopback() {
            return Err("only loopback connections are allowed".into());
        }
        let mut stream = TcpStream::connect_timeout(&address, std::time::Duration::from_secs(5))?;
        stream.set_nodelay(true)?;
        writeln!(stream, "{}", json!({"token": args[2]}))?;
        let worker_stream = stream.try_clone()?;
        (
            Box::new(BufReader::new(stream.try_clone()?)),
            Box::new(stream),
            Box::new(move || Ok(Box::new(worker_stream.try_clone()?))),
        )
    } else {
        return Err("expected --connect address token or --stdio".into());
    };
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
        let app = NSApplication::sharedApplication(objc2::MainThreadMarker::new().unwrap());
        app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
        app.finishLaunching();
    }


    let shared: SharedPlugin = Arc::new(Mutex::new(None));
    let (jobs, job_rx) = mpsc::channel::<(usize, Vec<u8>)>();
    #[cfg(target_os = "macos")]
    let _servicing_timer = schedule_plugin_servicer(Arc::clone(&shared));
    {
        // Audio worker: processes blocks and writes responses end to end. Lives for the
        // whole process; plugin loads swap the shared slot underneath it.
        let worker_shared = Arc::clone(&shared);
        let mut worker_output = new_worker_writer()?;
        std::thread::Builder::new()
            .name("vst3-audio".into())
            .spawn(move || {
                for (frames, payload) in job_rx {
                    let current = worker_shared
                        .lock()
                        .ok()
                        .and_then(|slot| slot.clone());
                    let outcome = match current {
                        Some((plugin, sample_rate)) => {
                            process_binary_block(&plugin, sample_rate, frames, &payload)
                        }
                        None => Err("no plugin loaded".to_string()),
                    };
                    let write_failed = match outcome {
                        Ok((latency_samples, out_bytes)) => {
                            let header = json!({"ok": true, "result": {"latency_samples": latency_samples, "frames": frames, "binary_bytes": out_bytes.len()}});
                            write_json_line(&mut *worker_output, &header).is_err()
                                || worker_output.write_all(&out_bytes).is_err()
                                || worker_output.flush().is_err()
                        }
                        Err(error) => write_json_line(
                            &mut *worker_output,
                            &json!({"ok": false, "error": error}),
                        )
                        .is_err(),
                    };
                    if write_failed {
                        break;
                    }
                }
            })
            .map_err(|error| format!("failed to spawn the audio worker: {error}"))?;
    }

    let (sender, receiver) = mpsc::sync_channel::<Result<Vec<u8>, &'static str>>(1);
    std::thread::spawn(move || loop {
        let mut line = Vec::new();
        match (&mut input)
            .take((MAX_MESSAGE + 1) as u64)
            .read_until(b'\n', &mut line)
        {
            Ok(0) => break,
            Ok(_) if line.len() > MAX_MESSAGE => {
                let _ = sender.send(Err("invalid or oversized request"));
                break;
            }
            Ok(_) => {
                // Route process requests straight to the audio worker so they never wait
                // behind the main thread; everything else goes to the control loop. If the
                // worker is gone, fall through so the control loop answers with an error.
                let routed = match serde_json::from_slice::<Command>(&line) {
                    Ok(Command::ProcessBinary { frames }) => {
                        if frames == 0 || frames > MAX_FRAMES {
                            let _ = sender.send(Err("invalid process frame count"));
                            break;
                        }
                        let mut payload = vec![0u8; frames * 2 * 4];
                        match input.read_exact(&mut payload) {
                            Ok(()) => jobs.send((frames, payload)).is_ok(),
                            Err(_) => {
                                let _ = sender.send(Err("truncated process payload"));
                                break;
                            }
                        }
                    }
                    _ => false,
                };
                if routed {
                    continue;
                }
                if sender.send(Ok(line)).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    });

    let mut session = Session {
        window: None,
        plugin: None,
        shared,
    };
    loop {
        pump_events();
        if let Some(window) = &session.window {
            window.service_platform_events()?;
            if window.closed_by_user() {
                session.window = None;
            }
        }
        if let Some(plugin) = &session.plugin {
            let mut plugin = plugin
                .lock()
                .map_err(|_| "plugin lock poisoned")?;
            // Restart requests (latency changes, lifecycle transitions) must be serviced on
            // the plugin control thread — this one — never from the audio worker.
            if let Err(error) = plugin.service_host_requests() {
                eprintln!("vst3 service_host_requests: {error}");
            }
            plugin.service_run_loop();
        }
        let line = match receiver.recv_timeout(Duration::from_millis(10)) {
            Ok(line) => line?,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        let result = serde_json::from_slice::<Command>(&line)
            .map_err(|error| Box::<dyn std::error::Error>::from(error))
            .and_then(|command| session.execute(command))
            .map_err(|error| error.to_string());
        write_response(&mut *output, result)?;
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_pcm_and_protocol() {
        assert!(validate_audio(&[vec![0.0; 128], vec![0.0; 128]], 512).is_ok());
        for input in [
            vec![],
            vec![vec![0.0]],
            vec![vec![], vec![]],
            vec![vec![0.0; 513], vec![0.0; 513]],
            vec![vec![0.0], vec![0.0; 2]],
            vec![vec![f32::NAN], vec![0.0]],
        ] {
            assert!(validate_audio(&input, 512).is_err());
        }
        assert!(serde_json::from_str::<Command>(r#"{"command":"unload","extra":true}"#).is_err());
        let shared: SharedPlugin = Arc::new(Mutex::new(None));
        let mut session = Session {
            window: None,
            plugin: None,
            shared: Arc::clone(&shared),
        };
        assert!(session.execute(Command::SaveState {}).is_err());
        assert!(session.execute(Command::Unload {}).is_ok());
        assert!(shared.lock().unwrap().is_none());
    }
}
