import argparse
import subprocess
import sys
import os

def main():
    parser = argparse.ArgumentParser(description="Transcribe audio using insanely-fast-whisper")
    parser.add_argument("--audio", required=True, help="Path to input audio file")
    parser.add_argument("--output", required=True, help="Path to output transcript file (.json or .md)")
    parser.add_argument("--model", default="openai/whisper-large-v3-turbo", help="Whisper model to use")
    parser.add_argument("--hf-token", help="Hugging Face token for pyannote diarization")
    parser.add_argument("--diarization-model", default="pyannote/speaker-diarization-3.1", help="Diarization model to use")
    parser.add_argument("--max-speakers", default="4", help="Max speakers for diarization")
    parser.add_argument("--batch-size", default="4", help="Batch size for transcription")
    parser.add_argument("--beam-size", default="5", help="Beam size for transcription")
    parser.add_argument("--embed-batch-size", default="1", help="Diarization embed batch size (ignored by insanely-fast-whisper)")
    parser.add_argument("--segment-batch-size", default="1", help="Diarization segment batch size (ignored by insanely-fast-whisper)")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.audio):
        print(f"Error: Audio file not found at {args.audio}", file=sys.stderr)
        sys.exit(1)
        
    exe_name = "insanely-fast-whisper.exe" if os.name == 'nt' else "insanely-fast-whisper"
    whisper_exe = os.path.join(os.path.dirname(sys.executable), exe_name)
    
    cmd = [
        whisper_exe,
        "--file-name", args.audio,
        "--model-name", args.model,
        "--transcript-path", args.output,
        "--batch-size", args.batch_size,
        "--diarization_model", args.diarization_model
    ]
    
    # Optional diarization token and constraints
    if args.hf_token:
        cmd.extend(["--hf-token", args.hf_token])
        cmd.extend(["--max-speakers", str(args.max_speakers)])
        
    print(f"Running: {' '.join(cmd)}")
    
    try:
        # Run insanely-fast-whisper
        subprocess.run(cmd, check=True)
        print("Transcription complete.")
    except subprocess.CalledProcessError as e:
        print(f"Transcription failed with exit code {e.returncode}", file=sys.stderr)
        if e.stderr:
            print(e.stderr, file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
