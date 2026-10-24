"""Lays the narration clips over the screen recording at the offsets in
timeline.json and writes an H.264/AAC MP4.

Usage: python mux.py <audioDir> <outDir> <output.mp4>
"""
import json
import os
import subprocess
import sys

import imageio_ffmpeg

audio_dir, out_dir, output = sys.argv[1:4]
tl = json.load(open(os.path.join(out_dir, "timeline.json"), encoding="utf-8"))
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

args = [ffmpeg, "-y", "-i", tl["video"]]
filters = []
for i, seg in enumerate(tl["timeline"], start=1):
    args += ["-i", os.path.join(audio_dir, seg["id"] + ".wav")]
    ms = int((seg["start"] + 0.35) * 1000)
    filters.append(f"[{i}:a]adelay={ms}|{ms},aresample=48000[a{i}]")
mix = "".join(f"[a{i}]" for i in range(1, len(tl["timeline"]) + 1))
filters.append(f"{mix}amix=inputs={len(tl['timeline'])}:normalize=0,volume=1.6[aout]")

args += [
    "-filter_complex", ";".join(filters),
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k",
    "-t", f"{tl['total']:.2f}",
    "-movflags", "+faststart",
    output,
]
subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
print("wrote", output)
