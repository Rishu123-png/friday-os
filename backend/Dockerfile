# FRIDAY OS backend — build from the repo root:
#   docker build -f backend/Dockerfile -t friday-backend .
#   docker run -d -p 8000:8000 --env-file backend/.env friday-backend
FROM python:3.12-slim

WORKDIR /srv/friday

# Light core first (caches well)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Optional heavy engines — comment in what you want:
# RUN pip install --no-cache-dir edge-tts
# RUN pip install --no-cache-dir faster-whisper
# RUN pip install --no-cache-dir sentence-transformers
# RUN pip install --no-cache-dir paho-mqtt

COPY . .

ENV FRIDAY_TOKEN="" \
    GROQ_API_KEY="" \
    CORS_ORIGINS="*" \
    TTS_VOICE="en-IN-NeerjaNeural" \
    STT_MODEL="small" \
    DB_PATH="./friday.db"

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
