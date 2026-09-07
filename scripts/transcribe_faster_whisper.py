import argparse
import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")

def main():
    parser = argparse.ArgumentParser(description="Transcribe audio using faster-whisper")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--hf-token", help="Hugging Face token for Pyannote diarization")
    parser.add_argument("--batch-size", default=4, required=False)
    parser.add_argument("--beam-size", default=4, required=True)
    parser.add_argument("--max-speakers", type=int, default=4, required=False)
    parser.add_argument("--diarization-model", type=str, default="pyannote/speaker-diarization-3.1", required=False)
    parser.add_argument("--embed-batch-size", type=int, default=1, required=False)
    parser.add_argument("--segment-batch-size", type=int, default=1, required=False)
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        print(f"Error: Audio file not found at {args.audio}", file=sys.stderr)
        sys.exit(1)

    args.batch_size = int(args.batch_size)
    args.beam_size = int(args.beam_size)

    if args.batch_size >= 1 and args.batch_size <= 128:
        print(f"Batch Size {args.batch_size} valid ✓")
    else:
        print(f"Batch Size {args.batch_size} invalid ✘", file=sys.stderr)
        sys.exit(1)

    if args.beam_size >= 1 and args.beam_size <= 8:
        print(f"Beam Size {args.beam_size} valid ✓")
    else:
        print(f"Beam Size {args.beam_size} invalid ✘", file=sys.stderr)
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel, BatchedInferencePipeline
    except ImportError:
        print("faster-whisper not installed. Run: pip install faster-whisper", file=sys.stderr)
        sys.exit(1)

    try:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        device = "cpu"
    compute_type = "float16" if device == "cuda" else "int8"

    pipeline = None
    if args.hf_token:
        try:
            from pyannote.audio import Pipeline
            print(f"Loading Pyannote diarization pipeline ({args.diarization_model})...")
            pipeline = Pipeline.from_pretrained(
                args.diarization_model,
                use_auth_token=args.hf_token
            )
            # Fallback for newer versions that use 'token' instead of 'use_auth_token'
        except TypeError:
            pipeline = Pipeline.from_pretrained(
                args.diarization_model,
                token=args.hf_token
            )
        except ImportError:
            print("pyannote.audio not installed, skipping diarization.", file=sys.stderr)
        except Exception as e:
            print(f"Failed to load pyannote pipeline: {e}", file=sys.stderr)

        if pipeline and device == "cuda":
            pipeline.to(torch.device("cuda"))
            # Tune batch sizes to prevent GPU starvation
            if hasattr(pipeline, "segmentation_batch_size"):
                pipeline.segmentation_batch_size = args.segment_batch_size
            if hasattr(pipeline, "embedding_batch_size"):
                pipeline.embedding_batch_size = args.embed_batch_size

    print(f"Loading model: {args.model} on {device}")
    model = WhisperModel(args.model, device=device, compute_type=compute_type)
    batched_model = BatchedInferencePipeline(model=model)
    print(f"Transcribing: {args.audio}")
    segments, info = batched_model.transcribe(args.audio, beam_size=args.beam_size, word_timestamps=True, batch_size=args.batch_size)

    result = {"segments": []}
    whisper_segments = []
    
    # Exhaust the generator to get all segments
    for seg in segments:
        words = []
        if seg.words:
            for w in seg.words:
                words.append({"start": w.start, "end": w.end, "word": w.word})
        
        whisper_segments.append({
            "start": seg.start,
            "end": seg.end,
            "text": seg.text,
            "words": words,
            "speaker": "UNKNOWN"
        })
        print(f"  [{seg.start:.1f}s] {seg.text.strip()}", flush=True)

    if pipeline:
        print("[STAGE] DIARIZATION", flush=True)
        print("Running speaker diarization...", file=sys.stderr)
        
        # Custom hook for clean terminal and log output
        hook_state = {"step": None, "percent": -1}
        def custom_hook(step_name, step_artefact, file=None, completed=None, total=None):
            if step_name != hook_state["step"]:
                print(f"\nDiarization stage: {step_name}", file=sys.stderr, flush=True)
                hook_state["step"] = step_name
                hook_state["percent"] = -1
                
            if total is not None and total > 0 and completed is not None:
                percent = int((completed / total) * 100)
                # Only log every 10% to avoid flooding the text log
                if percent >= hook_state["percent"] + 10 or percent == 100:
                    print(f"{step_name}: {percent}%", file=sys.stderr, flush=True)
                    hook_state["percent"] = percent
                    
        diarization = pipeline(args.audio, hook=custom_hook, max_speakers=args.max_speakers, batch_size=1)
        
        # Pyannote 4.x returns a DiarizeOutput object, while 3.x returns Annotation directly
        annotation = getattr(diarization, "speaker_diarization", diarization)
        
        turns = []
        for turn, _, speaker in annotation.itertracks(yield_label=True):
            turns.append({"start": turn.start, "end": turn.end, "speaker": speaker})
            
        print("Aligning diarization with transcription...")
        for w_seg in whisper_segments:
            # We will find the most common speaker for the words in this segment
            # or just use the segment midpoint if there are no word timestamps.
            speaker_counts = {}
            if w_seg["words"]:
                for w in w_seg["words"]:
                    midpoint = (w["start"] + w["end"]) / 2.0
                    assigned = "UNKNOWN"
                    for t in turns:
                        if t["start"] <= midpoint <= t["end"]:
                            assigned = t["speaker"]
                            break
                    speaker_counts[assigned] = speaker_counts.get(assigned, 0) + 1
            else:
                midpoint = (w_seg["start"] + w_seg["end"]) / 2.0
                assigned = "UNKNOWN"
                for t in turns:
                    if t["start"] <= midpoint <= t["end"]:
                        assigned = t["speaker"]
                        break
                speaker_counts[assigned] = 1

            if speaker_counts:
                # Get the speaker with the highest count
                best_speaker = max(speaker_counts, key=speaker_counts.get)
                w_seg["speaker"] = best_speaker

            # Remove words array to match previous format if desired, or keep it.
            # We'll remove it to keep the JSON output clean and compatible.
            del w_seg["words"]
            result["segments"].append(w_seg)
    else:
        for w_seg in whisper_segments:
            if "words" in w_seg:
                del w_seg["words"]
            result["segments"].append(w_seg)

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"Transcript saved to {args.output}")

if __name__ == "__main__":
    main()
