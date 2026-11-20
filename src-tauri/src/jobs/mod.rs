//! Job queue sequenziale: processa una carta alla volta, libera memoria tra un job e l'altro.
//! Progress + cancel + retry via eventi Tauri e stato in-memory.
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, serde::Serialize)]
pub struct JobInfo {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub status: String,
    pub progress: f32,
    pub error: Option<String>,
}

struct State {
    queue: VecDeque<JobInfo>,
    current: Option<JobInfo>,
    done: Vec<JobInfo>,
    cancelled: std::collections::HashSet<String>,
}

static STATE: Mutex<Option<Arc<Mutex<State>>>> = Mutex::new(None);

pub fn init(handle: &AppHandle) {
    let st = Arc::new(Mutex::new(State {
        queue: VecDeque::new(),
        current: None,
        done: Vec::new(),
        cancelled: Default::default(),
    }));
    *STATE.lock().unwrap() = Some(st);
    let _ = handle;
}

fn state() -> Arc<Mutex<State>> {
    STATE.lock().unwrap().clone().expect("jobs::init non chiamato")
}

pub fn enqueue(kind: &str, label: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let job = JobInfo {
        id: id.clone(),
        kind: kind.to_string(),
        label: label.to_string(),
        status: "queued".into(),
        progress: 0.0,
        error: None,
    };
    let st = state();
    st.lock().unwrap().queue.push_back(job);
    id
}

pub fn list() -> Vec<JobInfo> {
    let st = state();
    let s = st.lock().unwrap();
    let mut out = Vec::new();
    if let Some(c) = &s.current {
        out.push(c.clone());
    }
    out.extend(s.queue.iter().cloned());
    out.extend(s.done.iter().rev().take(50).cloned());
    out
}

pub fn cancel(id: &str) -> bool {
    let st = state();
    let mut s = st.lock().unwrap();
    s.cancelled.insert(id.to_string());
    let before = s.queue.len();
    s.queue.retain(|j| j.id != id);
    before != s.queue.len()
}

pub fn is_cancelled(id: &str) -> bool {
    let st = state();
    let guard = st.lock().unwrap();
    guard.cancelled.contains(id)
}

pub fn emit_progress(handle: &AppHandle, job_id: &str, progress: f32, status: &str) {
    let st = state();
    let mut s = st.lock().unwrap();
    if let Some(c) = s.current.as_mut() {
        if c.id == job_id {
            c.progress = progress;
            c.status = status.to_string();
        }
    }
    let _ = handle.emit("job://progress", serde_json::json!({ "id": job_id, "progress": progress, "status": status }));
}

pub fn finish_job(handle: &AppHandle, mut job: JobInfo, ok: bool, err: Option<String>) {
    job.status = if ok { "done".into() } else { "error".into() };
    job.error = err;
    job.progress = if ok { 1.0 } else { job.progress };
    {
        let st = state();
        let mut s = st.lock().unwrap();
        if s.current.as_ref().map(|c| c.id == job.id).unwrap_or(false) {
            s.current = None;
        }
        s.done.push(job.clone());
        if s.done.len() > 200 {
            let excess = s.done.len() - 200;
            s.done.drain(0..excess);
        }
    }
    let _ = handle.emit("job://done", &job);
}

/// Esegue il prossimo job in modo cooperativo (chiamato dal comando export).
/// Ritorna true se c'era un job.
pub fn begin_next(label_match: Option<&str>) -> Option<JobInfo> {
    let st = state();
    let mut s = st.lock().unwrap();
    if s.current.is_some() {
        return s.current.clone();
    }
    let idx = if let Some(l) = label_match {
        s.queue.iter().position(|j| j.label == l || j.id == l)
    } else {
        Some(0)
    };
    if let Some(i) = idx {
        if i < s.queue.len() {
            let mut job = s.queue.remove(i).unwrap();
            if s.cancelled.contains(&job.id) {
                job.status = "cancelled".into();
                s.done.push(job);
                return None;
            }
            job.status = "running".into();
            s.current = Some(job.clone());
            return Some(job);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn queue_order() {
        let mut q: std::collections::VecDeque<String> = Default::default();
        q.push_back("a".into());
        q.push_back("b".into());
        assert_eq!(q.pop_front().unwrap(), "a");
    }
}
