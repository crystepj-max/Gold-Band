use gold_band::cli;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    cli::run().await
}
