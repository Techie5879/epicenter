#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;
    use std::time::Duration;

    use block2::{Block, RcBlock};
    use dispatch2::{DispatchQueue, DispatchSemaphore, DispatchTime};
    use dlopen2::raw::Library;
    use log::info;
    use objc2::msg_send;
    use objc2::rc::{autoreleasepool, Retained};
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2_foundation::{NSDate, NSNumber, NSRunLoop, NSString};
    use serde::Serialize;

    const MEDIA_REMOTE_FRAMEWORK_PATH: &str =
        "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote";
    const MEDIA_REMOTE_COMMAND_PLAY: u32 = 0;
    const MEDIA_REMOTE_COMMAND_PAUSE: u32 = 1;

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct PauseMediaForRecordingOutcome {
        pub should_resume: bool,
    }

    #[derive(Clone, Copy, Debug)]
    enum PlaybackState {
        Playing,
        NotPlaying,
        Unknown,
    }

    type MRMediaRemoteSendCommand =
        unsafe extern "C" fn(command: u32, user_info: *const c_void) -> Bool;
    type MRMediaRemoteRegisterForNowPlayingNotifications =
        unsafe extern "C" fn(queue: &DispatchQueue);
    type MRMediaRemoteSetCanBeNowPlayingApplication =
        unsafe extern "C" fn(can_be_now_playing: Bool);
    type MRMediaRemoteGetNowPlayingInfo =
        unsafe extern "C" fn(queue: &DispatchQueue, completion: *mut Block<dyn Fn(*mut AnyObject)>);
    type MRMediaRemoteGetNowPlayingApplicationIsPlaying =
        unsafe extern "C" fn(queue: &DispatchQueue, completion: *mut Block<dyn Fn(Bool)>);

    pub fn pause_media_for_recording() -> Result<PauseMediaForRecordingOutcome, String> {
        let media_remote = MediaRemote::load()?;
        let playback_state = media_remote.playback_state();
        info!("Media pause for recording playback state: {playback_state:?}");
        if matches!(playback_state, PlaybackState::NotPlaying) {
            return Ok(PauseMediaForRecordingOutcome {
                should_resume: false,
            });
        }

        media_remote.send_command(MEDIA_REMOTE_COMMAND_PAUSE)?;
        info!("Media pause command sent for recording");
        Ok(PauseMediaForRecordingOutcome {
            should_resume: matches!(playback_state, PlaybackState::Playing),
        })
    }

    pub fn resume_media_after_recording() -> Result<(), String> {
        let media_remote = MediaRemote::load()?;
        media_remote.send_command(MEDIA_REMOTE_COMMAND_PLAY)?;
        info!("Media resume command sent after recording");
        Ok(())
    }

    struct MediaRemote {
        _library: Library,
        send_command: MRMediaRemoteSendCommand,
        register_for_now_playing_notifications:
            Option<MRMediaRemoteRegisterForNowPlayingNotifications>,
        set_can_be_now_playing_application: Option<MRMediaRemoteSetCanBeNowPlayingApplication>,
        get_now_playing_info: Option<MRMediaRemoteGetNowPlayingInfo>,
        get_now_playing_application_is_playing:
            Option<MRMediaRemoteGetNowPlayingApplicationIsPlaying>,
    }

    impl MediaRemote {
        fn load() -> Result<Self, String> {
            let library = Library::open_with_flags(
                MEDIA_REMOTE_FRAMEWORK_PATH,
                Some(libc::RTLD_NOW | libc::RTLD_GLOBAL),
            )
            .map_err(|error| format!("Failed to load MediaRemote: {error}"))?;
            let send_command = unsafe {
                library
                    .symbol::<MRMediaRemoteSendCommand>("MRMediaRemoteSendCommand")
                    .map_err(|error| format!("Failed to load MediaRemote send command: {error}"))?
            };
            let register_for_now_playing_notifications = unsafe {
                library
                    .symbol::<MRMediaRemoteRegisterForNowPlayingNotifications>(
                        "MRMediaRemoteRegisterForNowPlayingNotifications",
                    )
                    .ok()
            };
            let set_can_be_now_playing_application = unsafe {
                library
                    .symbol::<MRMediaRemoteSetCanBeNowPlayingApplication>(
                        "MRMediaRemoteSetCanBeNowPlayingApplication",
                    )
                    .ok()
            };
            let get_now_playing_info = unsafe {
                library
                    .symbol::<MRMediaRemoteGetNowPlayingInfo>("MRMediaRemoteGetNowPlayingInfo")
                    .ok()
            };
            let get_now_playing_application_is_playing = unsafe {
                library
                    .symbol::<MRMediaRemoteGetNowPlayingApplicationIsPlaying>(
                        "MRMediaRemoteGetNowPlayingApplicationIsPlaying",
                    )
                    .ok()
            };

            Ok(Self {
                _library: library,
                send_command,
                register_for_now_playing_notifications,
                set_can_be_now_playing_application,
                get_now_playing_info,
                get_now_playing_application_is_playing,
            })
        }

        fn send_command(&self, command: u32) -> Result<(), String> {
            let did_send = unsafe { (self.send_command)(command, std::ptr::null()) };
            if did_send.as_bool() {
                Ok(())
            } else {
                Err("MediaRemote rejected the media command".to_string())
            }
        }

        fn playback_state(&self) -> PlaybackState {
            self.register_for_notifications();
            self.prevent_now_playing_registration();

            let legacy_info_state = self.legacy_now_playing_info();
            if !matches!(legacy_info_state, PlaybackState::Unknown) {
                return legacy_info_state;
            }

            let controller_state = controller_playback_state();
            if !matches!(controller_state, PlaybackState::Unknown) {
                return controller_state;
            }

            self.legacy_is_playing()
        }

        fn register_for_notifications(&self) {
            if let Some(register) = self.register_for_now_playing_notifications {
                unsafe { register(DispatchQueue::main()) };
            }
        }

        fn prevent_now_playing_registration(&self) {
            if let Some(set_can_be_now_playing) = self.set_can_be_now_playing_application {
                unsafe { set_can_be_now_playing(Bool::NO) };
            }
        }

        fn legacy_now_playing_info(&self) -> PlaybackState {
            let Some(get_now_playing_info) = self.get_now_playing_info else {
                return PlaybackState::Unknown;
            };

            let semaphore = DispatchSemaphore::new(0);
            let result = std::sync::Arc::new(std::sync::Mutex::new(PlaybackState::Unknown));
            let result_for_block = result.clone();
            let semaphore_for_block = semaphore.clone();
            let block = RcBlock::new(move |information: *mut AnyObject| {
                let state = playback_state_from_legacy_info(information);
                if let Ok(mut value) = result_for_block.lock() {
                    *value = state;
                }
                semaphore_for_block.signal();
            });

            unsafe {
                get_now_playing_info(DispatchQueue::main(), RcBlock::as_ptr(&block));
            }
            let timeout =
                DispatchTime::try_from(Duration::from_millis(800)).unwrap_or(DispatchTime::FOREVER);
            if semaphore.wait(timeout) != 0 {
                return PlaybackState::Unknown;
            }

            result
                .lock()
                .map(|value| *value)
                .unwrap_or(PlaybackState::Unknown)
        }

        fn legacy_is_playing(&self) -> PlaybackState {
            let Some(get_is_playing) = self.get_now_playing_application_is_playing else {
                return PlaybackState::Unknown;
            };

            let semaphore = DispatchSemaphore::new(0);
            let result = std::sync::Arc::new(std::sync::Mutex::new(None));
            let result_for_block = result.clone();
            let semaphore_for_block = semaphore.clone();
            let block = RcBlock::new(move |is_playing: Bool| {
                if let Ok(mut value) = result_for_block.lock() {
                    *value = Some(is_playing.as_bool());
                }
                semaphore_for_block.signal();
            });

            unsafe {
                get_is_playing(DispatchQueue::main(), RcBlock::as_ptr(&block));
            }
            let timeout =
                DispatchTime::try_from(Duration::from_millis(600)).unwrap_or(DispatchTime::FOREVER);
            if semaphore.wait(timeout) != 0 {
                return PlaybackState::Unknown;
            }

            match result.lock().ok().and_then(|value| *value) {
                Some(true) => PlaybackState::Playing,
                Some(false) => PlaybackState::NotPlaying,
                None => PlaybackState::Unknown,
            }
        }
    }

    fn playback_state_from_legacy_info(information: *mut AnyObject) -> PlaybackState {
        if information.is_null() {
            return PlaybackState::Unknown;
        }

        autoreleasepool(|_| unsafe {
            let playback_rate_key = NSString::from_str("kMRMediaRemoteNowPlayingInfoPlaybackRate");
            let playback_rate: *mut AnyObject = msg_send![
                information,
                objectForKey: Retained::as_ptr(&playback_rate_key)
            ];
            if playback_rate.is_null() {
                return PlaybackState::Unknown;
            }

            let playback_rate_value: f64 = msg_send![playback_rate, doubleValue];
            if playback_rate_value > 0.0 {
                PlaybackState::Playing
            } else {
                PlaybackState::NotPlaying
            }
        })
    }

    fn controller_playback_state() -> PlaybackState {
        autoreleasepool(|_| unsafe { controller_playback_state_inner() })
    }

    unsafe fn controller_playback_state_inner() -> PlaybackState {
        let Some(destination_class) = AnyClass::get(c"MRDestination") else {
            return PlaybackState::Unknown;
        };
        let Some(configuration_class) = AnyClass::get(c"MRNowPlayingControllerConfiguration")
        else {
            return PlaybackState::Unknown;
        };
        let Some(controller_class) = AnyClass::get(c"MRNowPlayingController") else {
            return PlaybackState::Unknown;
        };

        let destination: *mut AnyObject = msg_send![destination_class, userSelectedDestination];
        if destination.is_null() {
            return PlaybackState::Unknown;
        }

        let configuration_allocated: *mut AnyObject = msg_send![configuration_class, alloc];
        if configuration_allocated.is_null() {
            return PlaybackState::Unknown;
        }

        let configuration: *mut AnyObject = msg_send![
            configuration_allocated,
            initWithDestination: destination
        ];
        if configuration.is_null() {
            return PlaybackState::Unknown;
        }

        let single_shot = NSNumber::new_bool(false);
        let request_playback_state = NSNumber::new_bool(true);
        let request_playback_queue = NSNumber::new_bool(true);
        let single_shot_key = NSString::from_str("singleShot");
        let request_playback_state_key = NSString::from_str("requestPlaybackState");
        let request_playback_queue_key = NSString::from_str("requestPlaybackQueue");
        let _: () = msg_send![
            configuration,
            setValue: Retained::as_ptr(&single_shot),
            forKey: Retained::as_ptr(&single_shot_key)
        ];
        let _: () = msg_send![
            configuration,
            setValue: Retained::as_ptr(&request_playback_state),
            forKey: Retained::as_ptr(&request_playback_state_key)
        ];
        let _: () = msg_send![
            configuration,
            setValue: Retained::as_ptr(&request_playback_queue),
            forKey: Retained::as_ptr(&request_playback_queue_key)
        ];

        let controller_allocated: *mut AnyObject = msg_send![controller_class, alloc];
        if controller_allocated.is_null() {
            return PlaybackState::Unknown;
        }

        let controller: *mut AnyObject = msg_send![
            controller_allocated,
            initWithConfiguration: configuration
        ];
        if controller.is_null() {
            return PlaybackState::Unknown;
        }

        let _: () = msg_send![controller, beginLoadingUpdates];

        let response_key = NSString::from_str("response");
        let playback_rate_key = NSString::from_str("playbackRate");
        let playback_state_key = NSString::from_str("playbackState");
        let run_loop = NSRunLoop::currentRunLoop();

        let mut state = PlaybackState::Unknown;
        for _ in 0..12 {
            let response: *mut AnyObject =
                msg_send![controller, valueForKey: Retained::as_ptr(&response_key)];
            if !response.is_null() {
                let playback_rate: *mut AnyObject = msg_send![
                    response,
                    valueForKey: Retained::as_ptr(&playback_rate_key)
                ];
                if !playback_rate.is_null() {
                    let playback_rate_value: f64 = msg_send![playback_rate, doubleValue];
                    state = if playback_rate_value > 0.0 {
                        PlaybackState::Playing
                    } else {
                        PlaybackState::NotPlaying
                    };
                    break;
                }

                let playback_state: *mut AnyObject = msg_send![
                    response,
                    valueForKey: Retained::as_ptr(&playback_state_key)
                ];
                if !playback_state.is_null() {
                    let playback_state_value: isize = msg_send![playback_state, integerValue];
                    state = if playback_state_value == 1 {
                        PlaybackState::Playing
                    } else {
                        PlaybackState::NotPlaying
                    };
                    break;
                }
            }

            let limit_date = NSDate::dateWithTimeIntervalSinceNow(0.05);
            run_loop.runUntilDate(&limit_date);
        }

        let _: () = msg_send![controller, endLoadingUpdates];
        state
    }
}

#[cfg(target_os = "macos")]
use macos::PauseMediaForRecordingOutcome;

#[cfg(not(target_os = "macos"))]
use serde::Serialize;

#[cfg(not(target_os = "macos"))]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseMediaForRecordingOutcome {
    pub should_resume: bool,
}

#[tauri::command]
pub fn macos_pause_media_for_recording() -> Result<PauseMediaForRecordingOutcome, String> {
    #[cfg(target_os = "macos")]
    {
        macos::pause_media_for_recording()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(PauseMediaForRecordingOutcome {
            should_resume: false,
        })
    }
}

#[tauri::command]
pub fn macos_resume_media_after_recording() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::resume_media_after_recording()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}
