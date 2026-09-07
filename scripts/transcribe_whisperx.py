import argparse
import subprocess
import sys
import os
import shutil
import tempfile
import glob

def main():
    parser = argparse.ArgumentParser(description="Transcribe audio using whisperx")
    parser.add_argument("--audio", required=True, help="Path to input audio file")
    parser.add_argument("--output", required=True, help="Path to output transcript file (.json)")
    parser.add_argument("--model", default="large-v3-turbo", help="Whisper model to use")
    parser.add_argument("--hf-token", help="Hugging Face token for pyannote diarization")
    parser.add_argument("--max-speakers", default="4", help="Max speakers for diarization")
    parser.add_argument("--batch-size", default="1", help="Batch size for transcription")
    parser.add_argument("--beam-size", default="4", help="Beam size for transcription")
    parser.add_argument("--diarization-model", default="pyannote/speaker-diarization-3.1", help="Diarization model")
    parser.add_argument("--embed-batch-size", default="1", help="Diarization embed batch size (ignored by whisperx CLI)")
    parser.add_argument("--segment-batch-size", default="1", help="Diarization segment batch size (ignored by whisperx CLI)")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.audio):
        print(f"Error: Audio file not found at {args.audio}", file=sys.stderr)
        sys.exit(1)
        
    exe_name = "whisperx.exe" if os.name == 'nt' else "whisperx"
    whisper_exe = os.path.join(os.path.dirname(sys.executable), exe_name)
    
    with tempfile.TemporaryDirectory() as temp_dir:
        cmd = [
            whisper_exe,
            args.audio,
            "--model", args.model,
            "--output_dir", temp_dir,
            "--output_format", "json",
            "--compute_type", "int8", # Safe default for memory
            "--diarize",
            "--diarize_model", args.diarization_model
        ]
        
        if args.hf_token:
            cmd.extend(["--hf_token", args.hf_token])
            cmd.extend(["--max_speakers", str(args.max_speakers)])
            
        print(f"Running: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(cmd, check=True)
            print("Transcription complete.")
            
            # Find the generated JSON file in temp_dir
            # whisperx usually names it based on the input file e.g., input.json
            base_name = os.path.splitext(os.path.basename(args.audio))[0]
            generated_json = os.path.join(temp_dir, f"{base_name}.json")
            
            if os.path.exists(generated_json):
                os.makedirs(os.path.dirname(args.output), exist_ok=True)
                shutil.copy2(generated_json, args.output)
                print(f"Transcript saved to {args.output}")
            else:
                # Fallback: find any json in temp_dir
                jsons = glob.glob(os.path.join(temp_dir, "*.json"))
                if jsons:
                    os.makedirs(os.path.dirname(args.output), exist_ok=True)
                    shutil.copy2(jsons[0], args.output)
                    print(f"Transcript saved to {args.output}")
                else:
                    print("Error: Could not find generated JSON transcript.", file=sys.stderr)
                    sys.exit(1)
                    
        except subprocess.CalledProcessError as e:
            print(f"Transcription failed with exit code {e.returncode}", file=sys.stderr)
            print(e.stderr, file=sys.stderr)
            sys.exit(1)

if __name__ == "__main__":
    main()
