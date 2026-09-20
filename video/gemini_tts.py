#!/usr/bin/env python3
"""Gemini text-to-speech for the narration paragraphs (stdlib only).

    GEMINI_API_KEY=... python3 gemini_tts.py <jobs.json> <out_dir>

jobs.json: [{"id": "roadmap/01", "text": "..."}]. Each clip is saved as <out_dir>/<id>.wav
(24 kHz mono PCM). Clips that already exist are skipped, so a run stopped by the daily
quota can simply be started again the next day.

Runs on the Germany server because the API refuses requests from Iran.
"""
import base64, json, os, sys, time, urllib.error, urllib.request, wave

MODEL = os.environ.get('TTS_MODEL', 'gemini-3.1-flash-tts-preview')
VOICE = os.environ.get('TTS_VOICE', 'Charon')
STYLE = os.environ.get(
    'TTS_STYLE',
    'این متن را به فارسی معیار، با لحنی گرم، آرام و آموزشی، مثل راوی یک ویدیوی آموزشی بخوان. '
    'شمرده و واضح، بدون عجله:',
)
KEY = os.environ['GEMINI_API_KEY']


def speak(text):
    body = {
        'contents': [{'parts': [{'text': f'{STYLE}\n\n{text}'}]}],
        'generationConfig': {
            'responseModalities': ['AUDIO'],
            'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': VOICE}}},
        },
    }
    req = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'X-goog-api-key': KEY},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.load(r)
    part = data['candidates'][0]['content']['parts'][0]['inlineData']
    return base64.b64decode(part['data']), part.get('mimeType', '')


def main():
    jobs = json.load(open(sys.argv[1], encoding='utf-8'))
    out = sys.argv[2]
    for job in jobs:
        path = os.path.join(out, job['id'] + '.wav')
        if os.path.exists(path):
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        for attempt in range(6):
            try:
                pcm, mime = speak(job['text'])
                break
            except urllib.error.HTTPError as e:
                msg = e.read().decode(errors='replace')[:400]
                if e.code == 429 and 'PerDay' in msg:
                    print(f'QUOTA_DAY {job["id"]}: {msg}', flush=True)
                    sys.exit(3)
                wait = 20 * (attempt + 1) if e.code in (429, 500, 503) else None
                print(f'HTTP {e.code} {job["id"]} (attempt {attempt + 1}): {msg}', flush=True)
                if wait is None:
                    sys.exit(2)
                time.sleep(wait)
            except Exception as e:  # network hiccup
                print(f'ERR {job["id"]}: {e}', flush=True)
                time.sleep(15)
        else:
            print(f'FAILED {job["id"]}', flush=True)
            sys.exit(2)
        with wave.open(path, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(24000)
            w.writeframes(pcm)
        print(f'OK {job["id"]} {len(pcm) / 48000:.1f}s {mime}', flush=True)


if __name__ == '__main__':
    main()
