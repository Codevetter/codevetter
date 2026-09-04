//! Temporary source-compatible host facade for transport-neutral command code.
//!
//! This crate contains no Tauri, WebView, windowing, or platform UI runtime.

use std::fmt;
use std::ops::Deref;
use std::path::PathBuf;

pub use codevetter_transport_macros::command;

#[derive(Clone, Debug, Default)]
pub struct AppHandle;

#[derive(Debug)]
pub struct Error(String);

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

pub struct State<'a, T: ?Sized>(&'a T);

impl<'a, T: ?Sized> State<'a, T> {
    pub fn inner(&self) -> &'a T {
        self.0
    }
}

impl<T: ?Sized> Deref for State<'_, T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        self.0
    }
}

pub trait Emitter {
    fn emit<S>(&self, _event: &str, _payload: S) -> Result<(), Error>;
}

impl Emitter for AppHandle {
    fn emit<S>(&self, _event: &str, _payload: S) -> Result<(), Error> {
        Ok(())
    }
}

pub trait Manager {
    fn path(&self) -> PathResolver;

    fn state<T: Send + Sync + 'static>(&self) -> State<'_, T>;

    fn get_webview_window(&self, _label: &str) -> Option<WebviewWindow>;
}

impl Manager for AppHandle {
    fn path(&self) -> PathResolver {
        PathResolver
    }

    fn state<T: Send + Sync + 'static>(&self) -> State<'_, T> {
        panic!("host-managed state is unavailable outside the retired desktop transport")
    }

    fn get_webview_window(&self, _label: &str) -> Option<WebviewWindow> {
        None
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct WebviewWindow;

impl WebviewWindow {
    pub fn show(&self) -> Result<(), Error> {
        Err(Error(
            "the retired WebView window is unavailable".to_string(),
        ))
    }

    pub fn set_focus(&self) -> Result<(), Error> {
        Err(Error(
            "the retired WebView window is unavailable".to_string(),
        ))
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct PathResolver;

impl PathResolver {
    pub fn app_data_dir(&self) -> Result<PathBuf, Error> {
        if let Some(path) = std::env::var_os("CODEVETTER_APP_DATA_DIR") {
            return Ok(PathBuf::from(path));
        }
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| Error("HOME is unavailable".to_string()))?;
        Ok(home.join("Library/Application Support/com.codevetter.desktop"))
    }

    pub fn resource_dir(&self) -> Result<PathBuf, Error> {
        let executable = std::env::current_exe()
            .map_err(|error| Error(format!("resolve current executable: {error}")))?;
        let executable_dir = executable
            .parent()
            .ok_or_else(|| Error("current executable has no parent".to_string()))?;
        if executable_dir.ends_with("Contents/MacOS") {
            return Ok(executable_dir.join("../Resources"));
        }
        Ok(executable_dir.to_path_buf())
    }
}

pub mod async_runtime {
    use std::future::Future;
    use std::sync::OnceLock;

    pub type JoinHandle<T> = tokio::task::JoinHandle<T>;

    pub fn spawn<F>(future: F) -> JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        runtime().spawn(future)
    }

    pub fn block_on<F>(future: F) -> F::Output
    where
        F: Future,
    {
        if tokio::runtime::Handle::try_current().is_ok() {
            tokio::task::block_in_place(|| runtime().block_on(future))
        } else {
            runtime().block_on(future)
        }
    }

    fn runtime() -> &'static tokio::runtime::Runtime {
        static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
        RUNTIME.get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .thread_name("codevetter-transport")
                .build()
                .expect("build CodeVetter transport runtime")
        })
    }
}
