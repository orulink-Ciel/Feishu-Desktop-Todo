fn main() {
    // Company links and table/field IDs stay in an ignored local build file.
    // A fresh checkout compiles with the documented example configuration.
    let local = std::path::Path::new("duty-config.local.rs");
    let example = std::path::Path::new("duty-config.example.rs");
    println!("cargo:rerun-if-changed={}", local.display());
    println!("cargo:rerun-if-changed={}", example.display());
    println!("cargo:rerun-if-env-changed=FEISHU_TODO_PUBLIC_BUILD");
    let public = std::env::var("FEISHU_TODO_PUBLIC_BUILD").is_ok_and(|v| v == "1");
    let source = if !public && local.exists() {
        local
    } else {
        example
    };
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    std::fs::copy(source, output.join("duty_config.rs"))
        .expect("Unable to prepare duty configuration");
    tauri_build::build()
}
