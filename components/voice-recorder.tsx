'use client';

import { useEffect, useRef, useState } from 'react';
import { IconSend, IconX } from '@/components/ui/icons';

type Props = {
  /** Called with the recorded clip once the user confirms. */
  onRecorded: (blob: Blob, durationSec: number) => void;
  disabled?: boolean;
};

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const IconMic = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" />
  </svg>
);

const IconStop = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

/** Microphone recorder for chat voice notes (MediaRecorder + preview before sending). */
export function VoiceRecorder({ onRecorded, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState<{ url: string; blob: Blob; duration: number } | null>(null);
  const [error, setError] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const secondsRef = useRef(0);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  async function start() {
    setError('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('הדפדפן הזה לא תומך בהקלטה');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        previewRef.current = url;
        setPreview({ url, blob, duration: secondsRef.current });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      recorder.start();
      recorderRef.current = recorder;
      secondsRef.current = 0;
      setSeconds(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1000);
    } catch {
      setError('אין הרשאה למיקרופון — אפשרו אותה בהגדרות הדפדפן');
    }
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  function clearPreview() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreview(null);
  }

  function cancel() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current) {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    clearPreview();
    setRecording(false);
    setSeconds(0);
  }

  function send() {
    if (!preview) return;
    onRecorded(preview.blob, preview.duration || seconds);
    clearPreview();
    setSeconds(0);
  }

  if (preview) {
    return (
      <div className="voice-preview">
        <audio controls src={preview.url} style={{ height: 34 }} />
        <span className="muted tiny num">{formatDuration(preview.duration || seconds)}</span>
        <button type="button" className="button button-compact" onClick={send}>
          <IconSend size={15} /> שליחת ההקלטה
        </button>
        <button type="button" className="button button-quiet button-compact" onClick={cancel}>
          ביטול
        </button>
      </div>
    );
  }

  if (recording) {
    return (
      <div className="voice-preview" role="status" aria-live="polite">
        <span className="rec-dot" aria-hidden="true" />
        <span className="num strong">{formatDuration(seconds)}</span>
        <span className="muted small">מקליט…</span>
        <button type="button" className="button button-secondary button-compact" onClick={stop}>
          <IconStop /> סיום
        </button>
        <button type="button" className="icon-button small" onClick={cancel} aria-label="ביטול ההקלטה">
          <IconX size={15} />
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="icon-button composer-btn"
        onClick={start}
        disabled={disabled}
        title="הקלטת הודעה קולית"
        aria-label="הקלטת הודעה קולית"
      >
        <IconMic />
      </button>
      {error && <span className="form-error tiny">{error}</span>}
    </>
  );
}
