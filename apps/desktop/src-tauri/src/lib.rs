use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub children: Vec<DirEntry>,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    ".git",
    ".svn",
    ".hg",
    "__pycache__",
    ".next",
    ".nuxt",
    "build",
];

fn scan_recursive(dir: &Path, depth: u32, max_depth: u32) -> Vec<DirEntry> {
    if depth >= max_depth {
        return Vec::new();
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut result: Vec<DirEntry> = Vec::new();

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden directories and known non-project dirs
        if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        let path = entry.path();
        let children = scan_recursive(&path, depth + 1, max_depth);

        result.push(DirEntry {
            name,
            path: path.to_string_lossy().to_string(),
            children,
        });
    }

    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

#[tauri::command]
fn scan_directory(root: String) -> DirEntry {
    let path = Path::new(&root);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root.clone());

    let children = scan_recursive(path, 0, 4);

    DirEntry {
        name,
        path: root,
        children,
    }
}

// ── Git helper commands ────────────────────────────────

#[derive(Serialize)]
pub struct GitStatus {
    pub git_installed: bool,
    pub is_repo: bool,
    pub user_configured: bool,
}

#[tauri::command]
fn git_status(path: String) -> GitStatus {
    // Check if git is installed
    let git_installed = Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !git_installed {
        return GitStatus {
            git_installed: false,
            is_repo: false,
            user_configured: false,
        };
    }

    // Check if path is inside a git work tree
    let is_repo = Command::new("git")
        .args(["-C", &path, "rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !is_repo {
        return GitStatus {
            git_installed: true,
            is_repo: false,
            user_configured: false,
        };
    }

    // Check if user.name and user.email are configured
    let has_name = Command::new("git")
        .args(["-C", &path, "config", "user.name"])
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false);

    let has_email = Command::new("git")
        .args(["-C", &path, "config", "user.email"])
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false);

    GitStatus {
        git_installed: true,
        is_repo: true,
        user_configured: has_name && has_email,
    }
}

#[tauri::command]
fn git_list_branches(path: String) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .args(["-C", &path, "branch", "--format=%(refname:short)"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let branches = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    Ok(branches)
}

#[tauri::command]
fn git_branch_exists(path: String, branch: String) -> Result<bool, String> {
    let output = Command::new("git")
        .args(["-C", &path, "rev-parse", "--verify", &format!("refs/heads/{}", branch)])
        .output()
        .map_err(|e| e.to_string())?;

    Ok(output.status.success())
}

#[tauri::command]
fn git_create_branch(path: String, branch: String) -> Result<(), String> {
    let output = Command::new("git")
        .args(["-C", &path, "branch", &branch])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(())
}

#[tauri::command]
fn git_current_branch(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C", &path, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_pty::init())
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            git_status,
            git_list_branches,
            git_branch_exists,
            git_create_branch,
            git_current_branch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
