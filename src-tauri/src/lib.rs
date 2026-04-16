use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
#[cfg(target_os = "macos")]
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
    EventField, KeyCode,
};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSFloatingWindowLevel, NSWindow};
#[cfg(not(target_os = "macos"))]
use rdev::{listen, Event, EventType, Key};

const SHOW_WINDOW_EVENT: &str = "window-show-requested";
const HIDE_WINDOW_EVENT: &str = "window-hide-requested";
const DOUBLE_TAP_SHIFT_TIMEOUT_MS: u64 = 250;
const MAX_SHIFT_HOLD_MS: u64 = 220;

static WINDOW_TRANSITION_LOCK: OnceLock<Mutex<bool>> = OnceLock::new();
static SHIFT_DETECTOR: OnceLock<Mutex<ShiftTapDetector>> = OnceLock::new();

#[derive(Copy, Clone)]
enum ShiftSide {
    Left,
    Right,
}

#[derive(Default)]
struct ShiftTapDetector {
    first_tap_at: Option<Instant>,
    left_shift_pressed_at: Option<Instant>,
    right_shift_pressed_at: Option<Instant>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            begin_hide_main_window,
            complete_hide_main_window,
            finish_window_transition
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            start_global_shift_listener(app_handle);

            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(err) = window.set_visible_on_all_workspaces(true) {
                        eprintln!("failed to enable visible on all workspaces: {err}");
                    }
                    apply_macos_floating_level(&window);
                }
            }

            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(err) = window.set_always_on_top(true) {
                        eprintln!("failed to enable always on top on Windows: {err}");
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn start_global_shift_listener(app: tauri::AppHandle) {
    thread::spawn(move || {
        let tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::FlagsChanged, CGEventType::KeyDown],
            move |_proxy, event_type, event| {
                let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16;
                let detector =
                    SHIFT_DETECTOR.get_or_init(|| Mutex::new(ShiftTapDetector::default()));

                let should_toggle = detector
                    .lock()
                    .map(|mut detector| match event_type {
                        CGEventType::FlagsChanged => match keycode {
                            KeyCode::SHIFT => {
                                detector.process_modifier_toggle(ShiftSide::Left, Instant::now())
                            }
                            KeyCode::RIGHT_SHIFT => {
                                detector.process_modifier_toggle(ShiftSide::Right, Instant::now())
                            }
                            _ => false,
                        },
                        CGEventType::KeyDown => {
                            detector.cancel_pending_tap();
                            false
                        }
                        _ => false,
                    })
                    .unwrap_or(false);

                if should_toggle {
                    let app_handle = app.clone();

                    if let Err(err) = app.run_on_main_thread(move || {
                        toggle_main_window(&app_handle);
                    }) {
                        eprintln!("failed to dispatch toggle onto main thread: {err}");
                    }
                }

                Some(event.clone())
            },
        );

        match tap {
            Ok(tap) => {
                let loop_source = match tap.mach_port.create_runloop_source(0) {
                    Ok(source) => source,
                    Err(()) => {
                        eprintln!("failed to create macos shift event runloop source");
                        return;
                    }
                };
                let current = CFRunLoop::get_current();
                unsafe {
                    current.add_source(&loop_source, kCFRunLoopCommonModes);
                }
                tap.enable();
                CFRunLoop::run_current();
            }
            Err(_) => {
                eprintln!("failed to start macos shift event tap");
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn start_global_shift_listener(app: tauri::AppHandle) {
    thread::spawn(move || {
        if let Err(err) = listen(move |event| {
            if should_toggle_window(&event) {
                let app_handle = app.clone();

                if let Err(err) = app.run_on_main_thread(move || {
                    toggle_main_window(&app_handle);
                }) {
                    eprintln!("failed to dispatch toggle onto main thread: {err}");
                }
            }
        }) {
            eprintln!("failed to start global key listener: {err:?}");
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn should_toggle_window(event: &Event) -> bool {
    let detector = SHIFT_DETECTOR.get_or_init(|| Mutex::new(ShiftTapDetector::default()));
    let Ok(mut detector) = detector.lock() else {
        return false;
    };

    detector.process(event)
}

impl ShiftTapDetector {
    #[cfg(not(target_os = "macos"))]
    fn process(&mut self, event: &Event) -> bool {
        let now = Instant::now();
        self.expire_stale_tap(now);

        match event.event_type {
            EventType::KeyPress(key) => self.handle_key_press(key, now),
            EventType::KeyRelease(key) => self.handle_key_release(key, now),
            _ => false,
        }
    }

    fn process_modifier_toggle(&mut self, side: ShiftSide, now: Instant) -> bool {
        self.expire_stale_tap(now);

        if self.pressed_at(side).is_some() {
            self.handle_shift_release(side, now)
        } else {
            self.handle_shift_press(side, now)
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn handle_key_press(&mut self, key: Key, at: Instant) -> bool {
        match key {
            Key::ShiftLeft => self.handle_shift_press(ShiftSide::Left, at),
            Key::ShiftRight => self.handle_shift_press(ShiftSide::Right, at),
            _ => {
                self.first_tap_at = None;
                false
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn handle_key_release(&mut self, key: Key, now: Instant) -> bool {
        match key {
            Key::ShiftLeft => self.handle_shift_release(ShiftSide::Left, now),
            Key::ShiftRight => self.handle_shift_release(ShiftSide::Right, now),
            _ => false,
        }
    }

    fn handle_shift_press(&mut self, side: ShiftSide, at: Instant) -> bool {
        if self.pressed_at(side).is_none() {
            *self.pressed_at_mut(side) = Some(at);
        }

        false
    }

    fn handle_shift_release(&mut self, side: ShiftSide, now: Instant) -> bool {
        let max_hold = Duration::from_millis(MAX_SHIFT_HOLD_MS);
        let timeout = Duration::from_millis(DOUBLE_TAP_SHIFT_TIMEOUT_MS);
        let pressed_at = self.pressed_at_mut(side).take();

        let Some(pressed_at) = pressed_at else {
            return false;
        };

        if now.duration_since(pressed_at) > max_hold {
            self.first_tap_at = None;
            return false;
        }

        if let Some(first_tap_at) = self.first_tap_at {
            if now.duration_since(first_tap_at) <= timeout {
                self.first_tap_at = None;
                return true;
            }
        }

        self.first_tap_at = Some(now);
        false
    }

    fn pressed_at(&self, side: ShiftSide) -> Option<Instant> {
        match side {
            ShiftSide::Left => self.left_shift_pressed_at,
            ShiftSide::Right => self.right_shift_pressed_at,
        }
    }

    fn pressed_at_mut(&mut self, side: ShiftSide) -> &mut Option<Instant> {
        match side {
            ShiftSide::Left => &mut self.left_shift_pressed_at,
            ShiftSide::Right => &mut self.right_shift_pressed_at,
        }
    }

    fn expire_stale_tap(&mut self, at: Instant) {
        let timeout = Duration::from_millis(DOUBLE_TAP_SHIFT_TIMEOUT_MS);

        if let Some(first_tap_at) = self.first_tap_at {
            if at.duration_since(first_tap_at) > timeout {
                self.first_tap_at = None;
            }
        }
    }

    fn cancel_pending_tap(&mut self) {
        self.first_tap_at = None;
    }
}

fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    match window.is_visible() {
        Ok(true) => {
            if !begin_window_transition() {
                return;
            }

            if let Err(err) = window.emit(HIDE_WINDOW_EVENT, ()) {
                eprintln!("failed to request hide animation: {err}");
                finish_transition();
            }
        }
        Ok(false) => {
            if !begin_window_transition() {
                return;
            }

            show_window(app, &window);

            if let Err(err) = window.emit(SHOW_WINDOW_EVENT, ()) {
                eprintln!("failed to request show animation: {err}");
                finish_transition();
            }
        }
        Err(err) => {
            eprintln!("failed to read window visibility: {err}");
        }
    }
}

#[tauri::command]
fn begin_hide_main_window(app: tauri::AppHandle) -> bool {
    if !begin_window_transition() {
        return false;
    }

    let Some(window) = app.get_webview_window("main") else {
        finish_transition();
        return false;
    };

    match window.is_visible() {
        Ok(true) => true,
        Ok(false) => {
            finish_transition();
            false
        }
        Err(err) => {
            eprintln!("failed to read window visibility: {err}");
            finish_transition();
            false
        }
    }
}

#[tauri::command]
fn complete_hide_main_window(app: tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        finish_transition();
        return;
    };

    hide_window(&window);
    finish_transition();
}

#[tauri::command]
fn finish_window_transition() {
    finish_transition();
}

fn hide_window(window: &tauri::WebviewWindow) {
    if let Err(err) = window.hide() {
        eprintln!("failed to hide main window: {err}");
    }
}

fn show_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    if let Err(err) = app.show() {
        eprintln!("failed to show macos application: {err}");
    }

    if let Err(err) = window.show() {
        eprintln!("failed to show main window: {err}");
    }
    if let Err(err) = window.unminimize() {
        eprintln!("failed to unminimize main window: {err}");
    }
    if let Err(err) = window.set_focus() {
        eprintln!("failed to focus main window: {err}");
    }
}

fn begin_window_transition() -> bool {
    let lock = WINDOW_TRANSITION_LOCK.get_or_init(|| Mutex::new(false));
    let Ok(mut is_transitioning) = lock.lock() else {
        return false;
    };

    if *is_transitioning {
        return false;
    }

    *is_transitioning = true;
    true
}

fn finish_transition() {
    let lock = WINDOW_TRANSITION_LOCK.get_or_init(|| Mutex::new(false));
    let Ok(mut is_transitioning) = lock.lock() else {
        return;
    };

    *is_transitioning = false;
}

#[cfg(target_os = "macos")]
fn apply_macos_floating_level(window: &tauri::WebviewWindow) {
    let ns_window = match window.ns_window() {
        Ok(ns_window) => ns_window,
        Err(err) => {
            eprintln!("failed to get NSWindow handle: {err}");
            return;
        }
    };

    unsafe {
        let ns_window: &NSWindow = &*ns_window.cast();
        ns_window.setLevel(NSFloatingWindowLevel);
    }
}
