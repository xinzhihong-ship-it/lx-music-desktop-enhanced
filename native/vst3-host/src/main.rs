use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use vst3_host::{AudioBuffers, Plugin, PluginWindow, Vst3Host};

const MAX_MESSAGE: usize = 32 * 1024 * 1024;
const MAX_FRAMES: usize = 4096;
const MAX_CHAIN_PLUGINS: usize = 16;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LoadSpec {
    id: String,
    path: String,
    sample_rate: u32,
    block_size: usize,
    state: Option<Vec<u8>>,
}

#[derive(Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
enum Command {
    Probe {
        path: String,
    },
    // Kept for the standalone host test/API. The production chain uses load_chain so that
    // all plugin instances live in one helper and one audio request crosses the process boundary.
    Load {
        path: String,
        sample_rate: u32,
        block_size: usize,
        state: Option<Vec<u8>>,
    },
    LoadChain {
        plugins: Vec<LoadSpec>,
    },
    Parameters {
        #[serde(default)]
        plugin_id: Option<String>,
    },
    SetParameter {
        #[serde(default)]
        plugin_id: Option<String>,
        id: u32,
        value: f64,
    },
    SaveState {
        #[serde(default)]
        plugin_id: Option<String>,
    },
    Reset {},
    Editor {
        #[serde(default)]
        plugin_id: Option<String>,
        open: bool,
    },
    ProcessBinary {
        frames: usize,
    },
    Unload {},
}

// A loaded plugin instance and its identity. The Arc is shared with the dedicated audio worker
// and, when open, with the native editor window. The outer chain lock is only held while taking
// a snapshot or atomically swapping the chain; DSP never holds it.
#[derive(Clone)]
struct PluginSlot {
    id: String,
    plugin: Arc<Mutex<Plugin>>,
    sample_rate: f64,
    latency_samples: usize,
}

type SharedPluginChain = Arc<Mutex<Vec<PluginSlot>>>;

struct Session {
    window: Option<PluginWindow>,
    window_id: Option<String>,
    shared: SharedPluginChain,
}

fn validate_load_spec(spec: &LoadSpec) -> Result<(), Box<dyn std::error::Error>> {
    if !(8000..=384000).contains(&spec.sample_rate) || !(1..=MAX_FRAMES).contains(&spec.block_size) {
        return Err("unsupported sample rate or block size".into());
    }
    if spec.id.is_empty()
        || spec.id.len() > 128
        || spec.id.contains('\0')
        || spec.path.is_empty()
        || spec.path.len() > 32 * 1024
        || spec.path.contains('\0')
        || spec.state.as_ref().is_some_and(|state| state.len() > MAX_MESSAGE)
    {
        return Err("invalid VST3 plugin load specification".into());
    }
    Ok(())
}

fn load_plugin(spec: &LoadSpec) -> Result<(PluginSlot, Value), Box<dyn std::error::Error>> {
    validate_load_spec(spec)?;

    let mut host = Vst3Host::builder()
        .sample_rate(spec.sample_rate as f64)
        .block_size(spec.block_size)
        .input_channels(2)
        .output_channels(2)
        .build()?;
    let mut plugin = host.load_plugin(&spec.path)?;
    if let Some(state) = &spec.state {
        plugin.load_state(state)?;
    }

    let buses = plugin.audio_bus_layout()?;
    // VST3 bus index 0 is always the main bus; auxiliary buses (sidechains, stem outputs like
    // Acon Remix's Vocals/Drums) are intentionally ignored by the player.
    let main_input = buses
        .inputs
        .first()
        .filter(|bus| bus.active)
        .map(|bus| bus.channel_count)
        .unwrap_or(0);
    let main_output = buses
        .outputs
        .first()
        .filter(|bus| bus.active)
        .map(|bus| bus.channel_count)
        .unwrap_or(0);
    if main_input != 2 || main_output != 2 {
        return Err(format!(
            "plugin main bus is {main_input}in/{main_output}out, only stereo effects are supported"
        )
        .into());
    }

    plugin.start_processing()?;
    plugin.set_playing(true)?;
    let latency_samples = plugin.latency_samples() as usize;
    let info = plugin.info().clone();
    let shared = Arc::new(Mutex::new(plugin));
    let slot = PluginSlot {
        id: spec.id.clone(),
        plugin: shared,
        sample_rate: spec.sample_rate as f64,
        latency_samples,
    };
    let response = json!({
        "id": spec.id,
        "info": info,
        "latency_samples": latency_samples,
    });
    Ok((slot, response))
}

impl Session {
    fn plugin_slot(
        &self,
        plugin_id: Option<&str>,
    ) -> Result<PluginSlot, Box<dyn std::error::Error>> {
        let slots = self
            .shared
            .lock()
            .map_err(|_| "plugin chain lock poisoned")?;
        match plugin_id {
            Some(id) => slots
                .iter()
                .find(|slot| slot.id == id)
                .cloned()
                .ok_or_else(|| format!("no plugin with id '{id}'").into()),
            None if slots.len() == 1 => Ok(slots[0].clone()),
            None if slots.is_empty() => Err("no plugin loaded".into()),
            None => Err("plugin_id is required when multiple plugins are loaded".into()),
        }
    }

    fn load_chain(&mut self, specs: Vec<LoadSpec>) -> Result<Value, Box<dyn std::error::Error>> {
        if specs.len() > MAX_CHAIN_PLUGINS {
            return Err("too many VST3 plugins in chain".into());
        }

        let mut ids = std::collections::HashSet::with_capacity(specs.len());
        let mut next = Vec::with_capacity(specs.len());
        let mut response_plugins = Vec::with_capacity(specs.len());
        for spec in &specs {
            validate_load_spec(spec)?;
            if !ids.insert(spec.id.as_str()) {
                return Err(format!("duplicate plugin id '{}'", spec.id).into());
            }
            let (slot, response) = load_plugin(spec)?;
            next.push(slot);
            response_plugins.push(response);
        }

        // Load all new instances before swapping. If any plugin fails, the previous chain remains
        // live and the caller can continue playback with it.
        self.window = None;
        self.window_id = None;
        let total_latency = next
            .iter()
            .map(|slot| slot.latency_samples)
            .sum::<usize>();
        *self
            .shared
            .lock()
            .map_err(|_| "plugin chain lock poisoned")? = next;
        Ok(json!({
            "plugins": response_plugins,
            "latency_samples": total_latency,
        }))
    }

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
            } => self.load_chain(vec![LoadSpec {
                id: "default".to_string(),
                path,
                sample_rate,
                block_size,
                state,
            }]),
            Command::LoadChain { plugins } => self.load_chain(plugins),
            Command::Unload {} => {
                self.window = None;
                self.window_id = None;
                *self
                    .shared
                    .lock()
                    .map_err(|_| "plugin chain lock poisoned")? = Vec::new();
                Ok(Value::Null)
            }
            Command::Editor { plugin_id, open } => {
                if !open {
                    self.window = None;
                    self.window_id = None;
                    return Ok(Value::Null);
                }

                let slot = self.plugin_slot(plugin_id.as_deref())?;
                let mut window = PluginWindow::new(slot.plugin);
                window.open()?;
                self.window = Some(window);
                self.window_id = Some(slot.id);

                // Newer macOS refuses to put a background accessory app's window onscreen after
                // orderFront; activate the helper so the editor actually shows up.
                #[cfg(target_os = "macos")]
                {
                    use objc2::MainThreadMarker;
                    use objc2_app_kit::NSApplication;
                    NSApplication::sharedApplication(
                        MainThreadMarker::new().expect("editor must open on the main thread"),
                    )
                    .activate();
                }
                Ok(Value::Null)
            }
            Command::Parameters { plugin_id } => {
                let slot = self.plugin_slot(plugin_id.as_deref())?;
                let plugin = slot
                    .plugin
                    .lock()
                    .map_err(|_| "plugin lock poisoned")?;
                Ok(serde_json::to_value(plugin.get_parameters()?)?)
            }
            Command::SetParameter {
                plugin_id,
                id,
                value,
            } => {
                if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                    return Err("parameter must be finite and between 0 and 1".into());
                }
                let slot = self.plugin_slot(plugin_id.as_deref())?;
                let mut plugin = slot
                    .plugin
                    .lock()
                    .map_err(|_| "plugin lock poisoned")?;
                plugin.set_parameter(id, value)?;
                plugin.service_host_requests()?;
                Ok(json!({
                    "latency_samples": plugin.latency_samples() as usize,
                }))
            }
            Command::SaveState { plugin_id } => {
                let slot = self.plugin_slot(plugin_id.as_deref())?;
                let plugin = slot
                    .plugin
                    .lock()
                    .map_err(|_| "plugin lock poisoned")?;
                Ok(json!({ "state": plugin.save_state()? }))
            }
            Command::Reset {} => {
                let slots = self
                    .shared
                    .lock()
                    .map_err(|_| "plugin chain lock poisoned")?
                    .clone();
                for slot in slots {
                    let mut plugin = slot
                        .plugin
                        .lock()
                        .map_err(|_| "plugin lock poisoned")?;
                    plugin.stop_processing()?;
                    plugin.start_processing()?;
                    plugin.set_playing(true)?;
                }
                Ok(Value::Null)
            }
            // Process requests are routed to the dedicated audio worker before reaching here.
            Command::ProcessBinary { .. } => Err("audio worker is not running".into()),
        }
    }
}

// Runs on the dedicated audio worker thread. The control thread and this worker share plugin
// instances, but the outer chain lock is only held for the short snapshot. Each VST3 instance is
// then called directly in sequence, so a whole chain crosses the helper boundary once.
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
            payload[offset..offset + 4]
                .try_into()
                .map_err(|_| "invalid left PCM sample")?,
        ));
        right.push(f32::from_le_bytes(
            payload[frames * 4 + offset..frames * 4 + offset + 4]
                .try_into()
                .map_err(|_| "invalid right PCM sample")?,
        ));
    }
    Ok(vec![left, right])
}

fn encode_outputs(outputs: &[Vec<f32>], frames: usize) -> Result<Vec<u8>, String> {
    if outputs.len() != 2 || outputs.iter().any(|channel| channel.len() != frames) {
        return Err("plugin returned an invalid stereo buffer".to_string());
    }
    if outputs.iter().flatten().any(|sample| !sample.is_finite()) {
        return Err("plugin returned non-finite audio".to_string());
    }

    // Planar format: all left samples followed by all right samples. This avoids an interleave /
    // deinterleave pass in the renderer and matches the client's decodePcm layout.
    let mut bytes = Vec::with_capacity(frames * 2 * 4);
    for channel in outputs {
        for sample in channel {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
    }
    Ok(bytes)
}

fn process_binary_block(
    shared: &SharedPluginChain,
    frames: usize,
    payload: &[u8],
) -> Result<(usize, Vec<Value>, Vec<u8>), String> {
    let slots = shared
        .lock()
        .map_err(|_| "plugin chain lock poisoned".to_string())?
        .clone();
    if slots.is_empty() {
        return Err("no plugin loaded".to_string());
    }

    let mut inputs = decode_payload(payload, frames)?;
    let mut latencies = Vec::with_capacity(slots.len());
    for slot in slots {
        let mut plugin = slot
            .plugin
            .lock()
            .map_err(|_| "plugin lock poisoned".to_string())?;
        validate_audio(&inputs, plugin.block_size()).map_err(str::to_string)?;
        let mut buffers = AudioBuffers::new(2, 2, frames, slot.sample_rate);
        buffers.inputs = inputs;
        plugin
            .process_audio(&mut buffers)
            .map_err(|error| error.to_string())?;
        let latency_samples = plugin.latency_samples() as usize;
        latencies.push(json!({
            "id": slot.id,
            "latency_samples": latency_samples,
        }));
        inputs = buffers.outputs;
    }

    let total_latency = latencies
        .iter()
        .filter_map(|item| item.get("latency_samples").and_then(Value::as_u64))
        .map(|value| value as usize)
        .sum();
    let output = encode_outputs(&inputs, frames)?;
    Ok((total_latency, latencies, output))
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

fn write_json_line(output: &mut dyn Write, value: &Value) -> io::Result<()> {
    serde_json::to_writer(&mut *output, value)?;
    output.write_all(b"\n")?;
    output.flush()
}

fn write_response(output: &mut dyn Write, result: Result<Value, String>) -> io::Result<()> {
    let response = match result {
        Ok(value) => json!({ "ok": true, "result": value }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    write_json_line(output, &response)
}

// Native editor menus run AppKit's modal tracking loop, which stops our main loop from servicing
// the plugin's run loop. A common-mode timer keeps plugin callbacks alive inside that modal loop.
#[cfg(target_os = "macos")]
fn schedule_plugin_servicer(
    shared: SharedPluginChain,
) -> objc2::rc::Retained<objc2_foundation::NSTimer> {
    use block2::RcBlock;
    use core::ptr::NonNull;
    use objc2_foundation::{NSRunLoop, NSRunLoopCommonModes, NSTimer};

    let timer_block = RcBlock::new(move |_timer: NonNull<NSTimer>| {
        let slots = shared.lock().map(|slots| slots.clone());
        if let Ok(slots) = slots {
            for slot in slots {
                if let Ok(mut plugin) = slot.plugin.lock() {
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
    // The audio path (reader -> worker -> response) must never touch the main thread: native
    // editor menus can block it inside a modal loop. The client keeps at most one request in
    // flight, so the two writers cannot interleave protocol messages.
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
        let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(5))?;
        stream.set_nodelay(true)?;
        writeln!(stream, "{}", json!({ "token": args[2] }))?;
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

    let shared: SharedPluginChain = Arc::new(Mutex::new(Vec::new()));
    // A bounded queue prevents a misbehaving peer from growing an unbounded PCM backlog.
    let (jobs, job_rx) = mpsc::sync_channel::<(usize, Vec<u8>)>(2);
    #[cfg(target_os = "macos")]
    let _servicing_timer = schedule_plugin_servicer(Arc::clone(&shared));
    {
        // Audio worker: processes a complete chain and writes each response end to end. It lives
        // for the whole process; load_chain atomically swaps the shared plugin snapshot.
        let worker_shared = Arc::clone(&shared);
        let mut worker_output = new_worker_writer()?;
        std::thread::Builder::new()
            .name("vst3-audio".into())
            .spawn(move || {
                for (frames, payload) in job_rx {
                    let outcome = process_binary_block(&worker_shared, frames, &payload);
                    let write_failed = match outcome {
                        Ok((latency_samples, latencies, out_bytes)) => {
                            let header = json!({
                                "ok": true,
                                "result": {
                                    "latency_samples": latency_samples,
                                    "latencies": latencies,
                                    "frames": frames,
                                    "binary_bytes": out_bytes.len(),
                                }
                            });
                            write_json_line(&mut *worker_output, &header).is_err()
                                || worker_output.write_all(&out_bytes).is_err()
                                || worker_output.flush().is_err()
                        }
                        Err(error) => write_json_line(
                            &mut *worker_output,
                            &json!({ "ok": false, "error": error }),
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
                // Route process requests straight to the audio worker so they never wait behind
                // the control loop. If the worker is gone, let the control loop produce an error.
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
        window_id: None,
        shared,
    };
    loop {
        pump_events();
        if let Some(window) = &session.window {
            window.service_platform_events()?;
            if window.closed_by_user() {
                session.window = None;
                session.window_id = None;
            }
        }

        // Restart requests (latency changes, lifecycle transitions) must be serviced on the
        // control thread, never on the audio worker. Snapshot the chain before taking plugin
        // locks so a load/unload can still swap the chain between callbacks.
        let slots = session
            .shared
            .lock()
            .map_err(|_| "plugin chain lock poisoned")?
            .clone();
        for slot in slots {
            let mut plugin = slot
                .plugin
                .lock()
                .map_err(|_| "plugin lock poisoned")?;
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
        assert!(serde_json::from_str::<Command>(
            r#"{"command":"load_chain","plugins":[{"id":"a","path":"/tmp/a.vst3","sample_rate":48000,"block_size":512}],"extra":true}"#
        )
        .is_err());
    }

    #[test]
    fn planar_pcm_round_trip_has_expected_size() {
        let output = encode_outputs(&[vec![0.25; 4], vec![-0.5; 4]], 4).unwrap();
        assert_eq!(output.len(), 32);
        let decoded = decode_payload(&output, 4).unwrap();
        assert_eq!(decoded[0], vec![0.25; 4]);
        assert_eq!(decoded[1], vec![-0.5; 4]);
    }

    #[test]
    fn load_spec_rejects_duplicate_or_invalid_ids() {
        let invalid = LoadSpec {
            id: String::new(),
            path: "/tmp/a.vst3".into(),
            sample_rate: 48000,
            block_size: 512,
            state: None,
        };
        assert!(validate_load_spec(&invalid).is_err());
    }
}
