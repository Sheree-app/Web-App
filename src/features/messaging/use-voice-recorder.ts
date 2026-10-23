"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice notes in the browser.
 *
 * `MediaRecorder` is the only audio capture API shared by Chrome, Firefox and
 * Safari; the native `expo-audio` path stays untouched in the mobile app. This
 * hook owns permission, the recording timer, the min/max duration guards, and
 * the preview blob. It never uploads — the composer decides when and where.
 */

export const MIN_VOICE_MS = 1_000;
export const MAX_VOICE_MS = 10 * 60_000;

export type VoiceState = "idle" | "requesting" | "recording" | "preview";

type MimeChoice = { mimeType: string; extension: string };

const CANDIDATES: MimeChoice[] = [
  { mimeType: "audio/webm;codecs=opus", extension: "webm" },
  { mimeType: "audio/webm", extension: "webm" },
  { mimeType: "audio/mp4", extension: "m4a" },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  { mimeType: "audio/ogg", extension: "ogg" },
];

function chooseMime(): MimeChoice | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate.mimeType)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** True when this browser can record at all. Checked after mount only. */
export function isVoiceRecordingSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    chooseMime() !== null
  );
}

export type VoiceRecording = {
  blob: Blob;
  file: File;
  url: string;
  durationMillis: number;
  mimeType: string;
};

export function useVoiceRecorder() {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState<VoiceRecording | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const discardRef = useRef(false);
  /** Kept outside state so an unmount can always revoke the last preview. */
  const recordingUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setSupported(isVoiceRecordingSupported());
  }, []);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    stopStream();
    recorderRef.current = null;
    chunksRef.current = [];
    discardRef.current = false;
    setElapsed(0);
    setState("idle");
    setError("");
    setRecording((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
    }
  }, [stopStream]);

  useEffect(() => () => {
    clearTimer();
    discardRef.current = true;
    try {
      recorderRef.current?.stop();
    } catch {
      /* already stopped */
    }
    stopStream();
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
    }
  }, [stopStream]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    clearTimer();
    try {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      /* already stopped */
    }
    stopStream();
    chunksRef.current = [];
    setElapsed(0);
    setState("idle");
    setError("");
    setRecording((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
    }
  }, [stopStream]);

  const start = useCallback(async () => {
    if (state === "recording" || state === "requesting") return;
    if (!isVoiceRecordingSupported()) {
      setError("Voice notes aren't supported in this browser. Try Chrome, Safari or Firefox.");
      return;
    }
    const choice = chooseMime();
    if (!choice) {
      setError("This browser can't record audio. You can still send text and photos.");
      return;
    }

    setState("requesting");
    setError("");
    // A fresh record replaces any previous preview rather than leaking its URL.
    setRecording((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "";
      setState("idle");
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access is blocked. Allow it in your browser settings to record a voice note."
          : name === "NotFoundError"
            ? "No microphone was found. Connect one and try again."
            : "The microphone could not start. Check it isn't in use and try again.",
      );
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    discardRef.current = false;
    startedAtRef.current = Date.now();

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: choice.mimeType });
    } catch {
      stopStream();
      setState("idle");
      setError("This browser couldn't start a recording. Try a different browser.");
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      clearTimer();
      stopStream();
      setState("idle");
      setError("The recording was interrupted. Try again.");
    };

    recorder.onstop = () => {
      clearTimer();
      stopStream();
      // Clamp to the ceiling: the auto-stop timer can fire a fraction late, and
      // a recording one millisecond over the limit must not be rejected.
      const durationMillis = Math.min(
        MAX_VOICE_MS,
        Math.max(0, Date.now() - startedAtRef.current),
      );
      const chunks = chunksRef.current;
      chunksRef.current = [];

      if (discardRef.current) {
        discardRef.current = false;
        return;
      }
      if (durationMillis < MIN_VOICE_MS) {
        setState("idle");
        setElapsed(0);
        setError("That was too short. Hold the record button for at least a second.");
        return;
      }

      const blob = new Blob(chunks, { type: choice.mimeType });
      if (blob.size === 0) {
        setState("idle");
        setError("The recording was empty. Try again.");
        return;
      }
      const file = new File([blob], `voice-note.${choice.extension}`, {
        type: choice.mimeType,
      });
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
      const url = URL.createObjectURL(blob);
      recordingUrlRef.current = url;
      setRecording({
        blob,
        file,
        url,
        durationMillis,
        mimeType: choice.mimeType,
      });
      setState("preview");
    };

    recorder.start();
    setElapsed(0);
    setState("recording");

    timerRef.current = window.setInterval(() => {
      const next = Date.now() - startedAtRef.current;
      setElapsed(next);
      if (next >= MAX_VOICE_MS) stop();
    }, 200);
  }, [state, stop, stopStream]);

  return {
    supported,
    state,
    elapsed,
    error,
    recording,
    start: () => void start(),
    stop,
    cancel,
    reset,
    clearError: () => setError(""),
  };
}
