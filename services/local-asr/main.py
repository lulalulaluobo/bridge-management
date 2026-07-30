"""Local Chinese ASR: Silero VAD v5 gates FunASR Paraformer."""

from pathlib import Path
from tempfile import TemporaryDirectory
from subprocess import run
from threading import Thread

import torch
import soundfile
from fastapi import FastAPI, File, HTTPException, UploadFile
from funasr import AutoModel

app = FastAPI(title="Fridge local ASR")
vad_model = None
vad_utils = None
asr_model = None
model_error = None


@app.on_event("startup")
def start_model_loading():
    Thread(target=load_models, daemon=True).start()


def load_models():
    global vad_model, vad_utils, asr_model, model_error
    try:
        vad_model, vad_utils = torch.hub.load("snakers4/silero-vad", "silero_vad", trust_repo=True)
        asr_model = AutoModel(model="paraformer-zh", device="cpu", disable_update=True)
    except Exception as error:
        model_error = str(error)


@app.get("/health")
def health():
    status = "ready" if asr_model else "error" if model_error else "starting"
    return {"status": status, "vad": "silero-v5", "stt": "paraformer-zh"}


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if model_error:
        raise HTTPException(503, "ASR model failed to start")
    if not asr_model or not vad_model or not vad_utils:
        raise HTTPException(503, "ASR models are loading")
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(400, "audio file required")
    data = await audio.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "audio too large")
    with TemporaryDirectory() as directory:
        source = Path(directory) / "input.webm"
        wav = Path(directory) / "speech.wav"
        source.write_bytes(data)
        conversion = run(["ffmpeg", "-y", "-i", str(source), "-ar", "16000", "-ac", "1", str(wav)], capture_output=True)
        if conversion.returncode:
            raise HTTPException(400, "unsupported audio")
        samples, sample_rate = soundfile.read(str(wav), dtype="float32")
        audio_tensor = torch.from_numpy(samples).flatten()
        get_speech_timestamps = vad_utils[0]
        segments = get_speech_timestamps(audio_tensor, vad_model, sampling_rate=sample_rate, threshold=0.5, min_speech_duration_ms=180, min_silence_duration_ms=500)
        if not segments:
            raise HTTPException(422, "no speech detected")
        result = asr_model.generate(input=str(wav), batch_size_s=60, hotword="牛奶 菠菜 鸡蛋 酸奶 冰箱 冷藏室 冷冻室")
        text = "".join(item.get("text", "") for item in result).replace(" ", "").strip()
        if not text:
            raise HTTPException(422, "no transcript")
        return {"text": text, "speechSegments": len(segments)}
