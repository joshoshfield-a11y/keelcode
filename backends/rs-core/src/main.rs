//! `keel-rs` headless runner binary (Wave 2a).
//!
//! ```sh
//! keel-rs --seed <u32> --input <script.json> --ticks <u64>
//! ```
//! Builds the arena [`Demo`][keel_rs::demo::Demo], loads the input script,
//! steps the sim N ticks, and prints the outcome vector JSON to stdout
//! (shape documented in `src/demo.rs`).

use std::path::PathBuf;

use clap::Parser;
use keel_rs::demo::Demo;

#[derive(Parser)]
#[command(name = "keel-rs", about = "KeelCode Rust backend — headless arena sim")]
struct Args {
    /// Master seed (the TS reference uses 1337).
    #[arg(long)]
    seed: u32,
    /// Input script JSON: {"events":[{tick,action,down}]}.
    #[arg(long)]
    input: PathBuf,
    /// Number of fixed 1/60 s sim ticks to run.
    #[arg(long)]
    ticks: u64,
}

fn main() {
    let args = Args::parse();

    let script = std::fs::read_to_string(&args.input).unwrap_or_else(|e| {
        eprintln!(
            "keel-rs: cannot read input script {}: {e}",
            args.input.display()
        );
        std::process::exit(2);
    });

    let mut demo = Demo::new(args.seed);
    if let Err(e) = demo.load_script(&script) {
        eprintln!("keel-rs: bad input script: {e}");
        std::process::exit(2);
    }
    demo.bind_phases();
    for _ in 0..args.ticks {
        demo.step();
    }

    let v = demo.outcome_vector();
    println!(
        "{}",
        serde_json::to_string(&v).unwrap_or_else(|_| "{}".into())
    );
}
