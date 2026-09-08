import argparse
import time
import sys
import os
import subprocess
from pathlib import Path

def get_audio_for_duration(duration_minutes):
    print(f"Acquiring {duration_minutes} minutes of audio...")
    
    try:
        import datasets
        datasets.config.TORCHCODEC_AVAILABLE = False
        import soundfile as sf
        import numpy as np
    except ImportError:
        print("Installing required packages (datasets, soundfile, librosa)...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "datasets", "soundfile", "librosa"])
        import datasets
        datasets.config.TORCHCODEC_AVAILABLE = False
        from datasets import load_dataset
        import soundfile as sf
        import numpy as np
    else:
        from datasets import load_dataset
        import soundfile as sf
        import numpy as np
    
    print("Loading AMI dataset (ihm mix)...")
    dataset = load_dataset("edinburghcstr/ami", "ihm", split="train", streaming=True)
    
    target_samples = duration_minutes * 60 * 16000
    collected_audio = []
    collected_samples = 0
    
    print("Fetching audio chunks from huggingface (this may take a moment for large durations)...")
    for item in dataset:
        audio = item['audio']['array']
        sr = item['audio']['sampling_rate']
        
        if sr != 16000:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
            
        collected_audio.append(audio)
        collected_samples += len(audio)
        print(f"  Got chunk of {len(audio)/16000:.1f}s. Total: {collected_samples/16000:.1f}s / {duration_minutes*60}s")
        
        if collected_samples >= target_samples:
            break
            
    full_audio = np.concatenate(collected_audio)
    full_audio = full_audio[:target_samples]
    
    output_path = Path(__file__).parent.parent / "audio" / "benchmark.wav"
    output_path.parent.mkdir(exist_ok=True)
    print(f"Writing concatenated audio to {output_path}...")
    sf.write(str(output_path), full_audio, 16000)
    return str(output_path)

def run_transcription(audio_path, engine, model, batch_size, beam_size, max_speakers, diarization_model, embed_batch_size, segment_batch_size):
    script_dir = Path(__file__).parent
    
    if engine == "whisperx":
        script = "transcribe_whisperx.py"
    elif engine == "faster-whisper":
        script = "transcribe_faster_whisper.py"
    else:
        script = "transcribe.py"
        
    script_path = script_dir / script
    out_path = audio_path.replace(".wav", ".json")
    
    if engine in ["faster-whisper", "whisperx"]:
        if model.startswith("openai/"):
            model_arg = model.split("/")[-1].replace("whisper-", "")
        elif model == "distil-whisper/distil-large-v3.5" or model == "distil-large-v3.5":
            model_arg = "distil-large-v3.5"
        else:
            model_arg = model
    else:
        model_arg = model
    
    cmd = [
        sys.executable, str(script_path),
        "--audio", audio_path,
        "--output", out_path,
        "--model", model_arg,
        "--batch-size", str(batch_size),
        "--beam-size", str(beam_size),
        "--max-speakers", str(max_speakers),
        "--diarization-model", diarization_model,
        "--embed-batch-size", str(embed_batch_size),
        "--segment-batch-size", str(segment_batch_size)
    ]
    
    hf_token = os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
    if hf_token:
        cmd.extend(["--hf-token", hf_token])
        
    print(f"Running transcription via {engine} with model {model}...")
    
    stage_times = {}
    current_stage = "Initialization / Loading"
    stage_start_time = time.time()
    start_time = stage_start_time
    
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in proc.stdout:
        print(f"  {line.strip()}")
        line_lower = line.lower()
        
        new_stage = None
        if "[stage] diarization" in line_lower or "diarizing..." in line_lower or "diarization" in line_lower:
            new_stage = "Diarization"
        elif "transcrib" in line_lower and current_stage == "Initialization / Loading":
            new_stage = "Transcription"
        elif "embed" in line_lower and "embedding" not in current_stage.lower():
            new_stage = "Embedding (if applicable)"
            
        if new_stage and new_stage != current_stage:
            now = time.time()
            stage_times[current_stage] = stage_times.get(current_stage, 0) + (now - stage_start_time)
            current_stage = new_stage
            stage_start_time = now
            
    proc.wait()
    end_time = time.time()
    
    stage_times[current_stage] = stage_times.get(current_stage, 0) + (end_time - stage_start_time)
    
    if proc.returncode != 0:
        print(f"Transcription failed with code {proc.returncode}")
        sys.exit(1)
        
    return end_time - start_time, out_path, stage_times

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=int, default=15, help="Duration in minutes")
    parser.add_argument("--engine", type=str, default="insanely-fast-whisper")
    parser.add_argument("--model", type=str, default="openai/whisper-large-v3-turbo")
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--max-speakers", type=int, default=4)
    parser.add_argument("--diarization-model", type=str, default="pyannote/speaker-diarization-3.1")
    parser.add_argument("--embed-batch-size", type=int, default=1)
    parser.add_argument("--segment-batch-size", type=int, default=1)
    parser.add_argument("--gpu-count", type=int, default=1)
    parser.add_argument("--transcribe-threads", type=int, default=1)
    args = parser.parse_args()
    
    # Flush prints so they appear immediately in the stream
    sys.stdout.reconfigure(line_buffering=True)
    
    audio_path = get_audio_for_duration(args.duration)
    
    print("\nStarting Benchmark Timer...")
    duration_s, out_json, stage_times = run_transcription(
        audio_path, args.engine, args.model, 
        args.batch_size, args.beam_size, args.max_speakers,
        args.diarization_model, args.embed_batch_size, args.segment_batch_size
    )
    
    audio_dur_s = args.duration * 60
    rtfx = audio_dur_s / duration_s
    
    print("\n" + "="*40)
    print("BENCHMARK RESULTS")
    print("="*40)
    print(f"Audio Duration: {args.duration} minutes ({audio_dur_s} seconds)")
    print(f"Engine:         {args.engine}")
    print(f"Model:          {args.model}")
    print("-" * 40)
    print("SETTINGS USED:")
    print(f"Batch Size:         {args.batch_size}")
    print(f"Beam Size:          {args.beam_size}")
    print(f"Max Speakers:       {args.max_speakers}")
    print(f"Diarization Model:  {args.diarization_model}")
    print(f"Embed Batch Size:   {args.embed_batch_size}")
    print(f"Segment Batch Size: {args.segment_batch_size}")
    print(f"GPU Count:          {args.gpu_count}")
    print(f"Transcribe Threads: {args.transcribe_threads}")
    print("-" * 40)
    for stage, t in stage_times.items():
        print(f"Stage - {stage:<20} : {t:.2f}s")
    print("-" * 40)
    print(f"Total Process Time: {duration_s:.2f} seconds")
    print(f"RTFx:           {rtfx:.2f}x (processed {rtfx:.2f} seconds of audio per second of compute)")
    print("="*40)
    
    # Cleanup
    try:
        os.remove(audio_path)
        os.remove(out_json)
    except:
        pass
