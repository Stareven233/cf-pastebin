/**
 * HTML5 现代音频播放器组件 (支持在线试听、进度拖动、音量调节与直链下载)
 */

import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { formatBytes, copyToClipboard } from '../utils/format';
import { showToast } from './Toast';

export interface AudioPlayerProps {
  filename: string;
  sizeBytes: number;
  audioSrc: string;      // 例如 /d/xxxx/fileId?inline=1
  downloadUrl: string;   // 例如 /d/xxxx/fileId
}

export function AudioPlayer(props: AudioPlayerProps) {
  let audioElement: HTMLAudioElement | undefined;

  const [isPlaying, setIsPlaying] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [volume, setVolume] = createSignal(1);
  const [isMuted, setIsMuted] = createSignal(false);
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [hasError, setHasError] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal('');

  const formatSeconds = (sec: number) => {
    if (isNaN(sec) || !isFinite(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const togglePlay = () => {
    if (!audioElement) return;
    if (isPlaying()) {
      audioElement.pause();
    } else {
      audioElement.play().catch(err => {
        console.error('Audio play failed:', err);
        const errCode = audioElement?.error?.code;
        if (errCode === 4 || err.name === 'NotSupportedError') {
          showToast('此音频格式暂不受当前浏览器直接解码支持，请点击下载至本地播放喵', 'warning');
        } else if (errCode === 2) {
          showToast('音频网络流传输异常，请刷新重试或直接下载喵', 'warning');
        } else {
          showToast('无法播放音频，建议点击右上角直接下载试听喵', 'warning');
        }
      });
    }
  };

  const handleTimeUpdate = () => {
    if (!audioElement) return;
    setCurrentTime(audioElement.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!audioElement) return;
    setDuration(audioElement.duration);
    setIsLoaded(true);
  };

  const handleSeek = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const time = parseFloat(target.value);
    if (audioElement) {
      audioElement.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const val = parseFloat(target.value);
    setVolume(val);
    if (audioElement) {
      audioElement.volume = val;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!audioElement) return;
    if (isMuted()) {
      audioElement.volume = volume() || 0.5;
      setIsMuted(false);
    } else {
      audioElement.volume = 0;
      setIsMuted(true);
    }
  };

  const handleCopyLink = async () => {
    const fullUrl = `${window.location.origin}${props.downloadUrl}`;
    const success = await copyToClipboard(fullUrl);
    if (success) {
      showToast('音频直连已复制到剪贴板喵！', 'success');
    } else {
      showToast('复制失败，请手动长按复制', 'error');
    }
  };

  onCleanup(() => {
    if (audioElement) {
      audioElement.pause();
    }
  });

  return (
    <div class="w-full bg-white rounded-2xl border border-emerald-100 shadow-md p-5 sm:p-6 transition-all hover:shadow-lg">
      <audio
        ref={audioElement}
        src={props.audioSrc}
        preload="metadata"
        onPlay={() => {
          setIsPlaying(true);
          setHasError(false);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onError={() => {
          setHasError(true);
          const err = audioElement?.error;
          console.error('Audio element error:', err);
          if (err?.code === 4) {
            setErrorMessage('当前浏览器无法直接解码此音频格式喵');
          } else {
            setErrorMessage('音频加载异常喵');
          }
        }}
      />

      {/* 音频信息头部 */}
      <div class="flex items-start justify-between gap-4 mb-4">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12 0c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
          <div class="truncate">
            <h4 class="text-base font-semibold text-slate-800 truncate" title={props.filename}>
              {props.filename}
            </h4>
            <div class="flex items-center gap-2 mt-0.5 text-xs text-slate-500 font-medium">
              <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                {formatBytes(props.sizeBytes)}
              </span>
              <span>•</span>
              <span>{formatSeconds(duration())}</span>
            </div>
          </div>
        </div>

        {/* 快捷下载与直链 */}
        <div class="flex items-center gap-2 shrink-0">
          <button
            onClick={handleCopyLink}
            class="p-2 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors"
            title="复制音频直链"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <a
            href={props.downloadUrl}
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold transition-colors border border-emerald-200/60"
            download={props.filename}
          >
            <svg class="w-4 h-4 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>下载</span>
          </a>
        </div>
      </div>

      {/* 播放控制与进度条 */}
      <div class="bg-slate-50 rounded-xl p-3 sm:p-4 border border-slate-100 flex flex-col gap-3">
        {/* 进度条 */}
        <div class="flex items-center gap-3">
          <span class="text-xs text-slate-500 font-mono w-10 text-right shrink-0">
            {formatSeconds(currentTime())}
          </span>
          <input
            type="range"
            min="0"
            max={duration() || 100}
            step="0.1"
            value={currentTime()}
            onInput={handleSeek}
            class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600 focus:outline-hidden"
          />
          <span class="text-xs text-slate-500 font-mono w-10 text-left shrink-0">
            {formatSeconds(duration())}
          </span>
        </div>

        {/* 控制按键栏 */}
        <div class="flex items-center justify-between">
          {/* 播放/暂停大按键 (活力暖橙或清新绿高光) */}
          <div class="flex items-center gap-3">
            <button
              onClick={togglePlay}
              class="w-11 h-11 rounded-full bg-gradient-to-tr from-brand-600 to-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-600/30 hover:scale-105 active:scale-95 transition-all focus:outline-hidden"
            >
              <Show when={isPlaying()} fallback={
                <svg class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              }>
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              </Show>
            </button>
            <span class="text-xs font-medium text-slate-600">
              {hasError() ? (errorMessage() || '解码受阻，可直接下载') : (isPlaying() ? '播放中...' : '点击试听')}
            </span>
          </div>

          {/* 音量控制 */}
          <div class="flex items-center gap-2">
            <button
              onClick={toggleMute}
              class="text-slate-400 hover:text-slate-600 p-1 transition-colors"
            >
              <Show when={!isMuted() && volume() > 0} fallback={
                <svg class="w-4 h-4 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              }>
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </Show>
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted() ? 0 : volume()}
              onInput={handleVolumeChange}
              class="w-16 sm:w-20 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
