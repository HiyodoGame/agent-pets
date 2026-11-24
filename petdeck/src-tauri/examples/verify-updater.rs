use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use minisign_verify::{PublicKey, Signature};
use std::{env, error::Error, fs, path::PathBuf};

fn run() -> Result<(), Box<dyn Error>> {
    let mut args = env::args_os().skip(1);
    let artifact = PathBuf::from(args.next().ok_or("missing artifact path")?);
    let signature_file = PathBuf::from(args.next().ok_or("missing signature path")?);
    let encoded_public_key = args.next().ok_or("missing updater public key")?;
    if args.next().is_some() {
        return Err("usage: verify-updater <artifact> <signature> <public-key>".into());
    }

    let public_key_text =
        String::from_utf8(BASE64.decode(encoded_public_key.to_string_lossy().as_ref())?)?;
    let public_key = PublicKey::decode(&public_key_text)?;
    let encoded_signature = fs::read_to_string(signature_file)?;
    let signature_text = String::from_utf8(BASE64.decode(encoded_signature.trim())?)?;
    let signature = Signature::decode(&signature_text)?;
    let bytes = fs::read(&artifact)?;
    public_key.verify(&bytes, &signature, true)?;
    println!("verified updater signature for {}", artifact.display());
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("updater signature verification failed: {error}");
        std::process::exit(1);
    }
}
