//! Timing profiler for unpack scan / enrich pipelines.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnpackScanProfileStep {
    pub id: String,
    pub label: String,
    pub ms: u64,
    pub pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnpackScanProfile {
    pub stage: String,
    pub total_ms: u64,
    #[serde(default)]
    pub peak_rss_bytes: Option<u64>,
    pub steps: Vec<UnpackScanProfileStep>,
}

pub struct UnpackScanProfiler {
    stage: String,
    started: Instant,
    last: Instant,
    steps: Vec<UnpackScanProfileStep>,
}

impl UnpackScanProfiler {
    pub fn new(stage: impl Into<String>) -> Self {
        let now = Instant::now();
        Self {
            stage: stage.into(),
            started: now,
            last: now,
            steps: Vec::new(),
        }
    }

    pub fn step(&mut self, id: impl Into<String>, label: impl Into<String>) {
        let now = Instant::now();
        let ms = now.duration_since(self.last).as_millis() as u64;
        self.steps.push(UnpackScanProfileStep {
            id: id.into(),
            label: label.into(),
            ms,
            pct: 0.0,
        });
        self.last = now;
    }

    pub fn finish(mut self) -> UnpackScanProfile {
        let total_ms = self.started.elapsed().as_millis() as u64;
        recalculate_profile_pcts(&mut self.steps, total_ms);
        UnpackScanProfile {
            stage: self.stage,
            total_ms,
            peak_rss_bytes: process_peak_rss_bytes(),
            steps: self.steps,
        }
    }
}

fn process_peak_rss_bytes() -> Option<u64> {
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "linux"))]
    {
        let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
        let ok = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } == 0;
        if !ok {
            return None;
        }
        let usage = unsafe { usage.assume_init() };
        let raw = usage.ru_maxrss;
        if raw <= 0 {
            return None;
        }
        #[cfg(target_os = "linux")]
        {
            return Some(raw as u64 * 1024);
        }
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            return Some(raw as u64);
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "linux")))]
    {
        None
    }
}

pub fn recalculate_profile_pcts(steps: &mut [UnpackScanProfileStep], total_ms: u64) {
    if steps.is_empty() {
        return;
    }
    let denom = total_ms.max(1) as f64;
    for step in steps.iter_mut() {
        step.pct = (step.ms as f64 / denom) * 100.0;
    }
}

pub fn emit_unpack_scan_profile(
    app: &AppHandle,
    report_id: &str,
    repo_path: &str,
    profile: &UnpackScanProfile,
) {
    let _ = app.emit(
        "unpack-scan-profile",
        json!({
            "report_id": report_id,
            "repo_path": repo_path,
            "stage": profile.stage,
            "total_ms": profile.total_ms,
            "peak_rss_bytes": profile.peak_rss_bytes,
            "steps": profile.steps,
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiler_records_steps_and_percentages() {
        let mut profiler = UnpackScanProfiler::new("test");
        std::thread::sleep(std::time::Duration::from_millis(5));
        profiler.step("a", "Step A");
        std::thread::sleep(std::time::Duration::from_millis(5));
        profiler.step("b", "Step B");
        let profile = profiler.finish();
        assert_eq!(profile.steps.len(), 2);
        assert!(profile.total_ms >= 10);
        let pct_sum: f64 = profile.steps.iter().map(|s| s.pct).sum();
        assert!(pct_sum > 90.0 && pct_sum <= 100.5);
    }
}
